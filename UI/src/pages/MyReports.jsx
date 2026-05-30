import { useState, useEffect } from 'react';
import './WorkList.css';
import './MyReports.css';

const API_URL = 'http://localhost:3001/api';
const PDF_FONT_URL = '/fonts/arial.ttf';
let cachedPdfFont = null;

const loadPdfFont = async (doc) => {
  if (!cachedPdfFont) {
    const response = await fetch(PDF_FONT_URL);
    if (!response.ok) {
      throw new Error('PDF font dosyası yüklenemedi');
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    cachedPdfFont = btoa(binary);
  }

  doc.addFileToVFS('arial.ttf', cachedPdfFont);
  doc.addFont('arial.ttf', 'ArialUnicode', 'normal');
  doc.addFont('arial.ttf', 'ArialUnicode', 'bold');
  doc.setFont('ArialUnicode', 'normal');
};

const parseReportPayload = (report) => (
  typeof report.report_data === 'string'
    ? JSON.parse(report.report_data)
    : report.report_data
);

const getEmbeddedNlpAnalysis = (reportData) => (
  reportData?.nlpAnalysis && typeof reportData.nlpAnalysis === 'object'
    ? reportData.nlpAnalysis
    : null
);

const hasLegacyAsciiTurkish = (value) => {
  const text = String(value ?? '').toLowerCase();
  if (!text) return false;

  return /oykusu|onceki|akciger|hastaligi|saptandi|yakin|degerlendirme|ihtiyaci|dogabilir|geciyor|dusuk|yogunlukta|iceriyor|yapilmalidir|bulunamadi|tani|baglam|bulmadi/.test(text);
};

const nlpAnalysisNeedsRefresh = (nlpAnalysis) => {
  if (!nlpAnalysis) return false;

  return [
    nlpAnalysis.summary,
    nlpAnalysis.recommendedAction,
    ...(Array.isArray(nlpAnalysis.riskSignals) ? nlpAnalysis.riskSignals : []),
  ].some(hasLegacyAsciiTurkish);
};

const mergeNlpAnalysis = (reportData, nlpAnalysis) => ({
  ...(reportData || {}),
  nlpAnalysis,
});

const buildNlpPayload = (reportData) => {
  const study = reportData?.study || {};
  const nodules = reportData?.allNodules || reportData?.nodules || [];

  return {
    study_id: study.id || null,
    patient_age: study.age || null,
    patient_gender: study.gender || null,
    clinical_note: study.clinicalInfo || '',
    description: study.description || '',
    nodules: nodules.map((nodule) => ({
      id: nodule.id,
      risk: nodule.risk,
      notes: nodule.notes,
      doctorAssessment: nodule.doctorAssessment,
    })),
  };
};

const toFiniteNumber = (value) => {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const collectRiskSignals = (reportData) => {
  const nlpAnalysis = getEmbeddedNlpAnalysis(reportData);
  if (nlpAnalysis?.riskSignals?.length) {
    return [...new Set(nlpAnalysis.riskSignals.filter(Boolean))];
  }

  const study = reportData?.study || {};
  const age = toFiniteNumber(study.age);
  const gender = String(study.gender || '').toLowerCase();
  const notes = [
    study.clinicalInfo,
    study.description,
    ...(reportData?.nodules || []).flatMap((nodule) => [nodule.notes, nodule.doctorAssessment]),
  ].filter(Boolean).join(' ').toLowerCase();

  const signals = [];
  if (/(sigara|smok|paket\/y|pack.?year|tobacco)/i.test(notes)) {
    signals.push('sigara öyküsü');
  }
  if (/(aile|family).*(akciger|akciğer|kanser|malign)/i.test(notes) || /(genetik|herediter)/i.test(notes)) {
    signals.push('aile/genetik öyküsü');
  }
  if (/(onceki|önceki|prior|gecmis|geçmiş).*(malignite|kanser|malign)/i.test(notes)) {
    signals.push('önceki malignite öyküsü');
  }
  if ((age !== null && age >= 60) || /\b(ileri yaş|yaşlı|erkek|male|kadın|female|postmenopoz|menopoz)\b/i.test(notes) || ['m', 'male', 'erkek'].includes(gender)) {
    signals.push('cinsiyet ve yaş ilişkili risk');
  }
  if (/(obez|obesity|obesite|beden kitle|\bbmi\b|adipoz|morbid obez)/i.test(notes)) {
    signals.push('diyet / obezite ilişkili risk');
  }
  if (/(koah|copd|amfizem|emphysema|kronik obstruktif|bronşektazi|bronsiektazi|interstisyel fibroz|pulmoner fibroz|fibroz|skar|sikatris|apse)/i.test(notes)) {
    signals.push('eşlik eden akciğer hastalığı / hava yolu obstrüksiyonu');
  }
  if (/(t[üu]berk[üu]loz|\btb\b|verem|kronik enfeks|hpv|human papilloma|viral enfeks|kronik inflam)/i.test(notes)) {
    signals.push('enfeksiyon / kronik inflamasyon öyküsü');
  }
  if (/(radon|hava kirlili|pasif içici|pasif sigara|ikinci el sigara|duman maruziyeti|biyok[üu]tle|biomass|iç ortam duman)/i.test(notes)) {
    signals.push('çevresel maruziyet öyküsü');
  }
  if (/(silikoz|silicos|asbest|asbestoz|pn[oö]mokon|k[oö]m[üu]r iş[çc]i|k[oö]m[üu]r madenc|coal worker|mesleki maruziyet|mesleki karsinojen|occupational exposure|occupational carcinogen)/i.test(notes)) {
    signals.push('mesleki maruziyet / pnömokonyoz öyküsü');
  }

  return signals;
};

const classifyPatientRisk = (report, reportData) => {
  const study = reportData?.study || {};
  const age = toFiniteNumber(study.age);
  const riskSignals = collectRiskSignals(reportData);
  const nlpAnalysis = getEmbeddedNlpAnalysis(reportData);
  const nodules = reportData?.nodules || [];
  const maxSize = Math.max(...nodules.map((nodule) => toFiniteNumber(nodule.size) || 0), 0);
  const hasHighAIPrediction = nodules.some((nodule) => (nodule.risk || '').toLowerCase() === 'high');

  const highRisk = nlpAnalysis?.riskLevel === 'high'
    || riskSignals.length > 0
    || (age !== null && age >= 60)
    || maxSize >= 8
    || hasHighAIPrediction;
  return {
    level: highRisk ? 'high' : 'low',
    signals: riskSignals,
    age,
    urgency: nlpAnalysis?.urgency || (highRisk ? 'follow_up' : 'routine'),
  };
};

const buildClinicalContextText = (report, reportData) => {
  const study = reportData?.study || {};
  const contextParts = [];

  if (report.study_date) {
    contextParts.push(`${report.study_date} tarihli toraks BT incelemesi değerlendirilmiştir.`);
  } else {
    contextParts.push('Toraks BT incelemesi değerlendirilmiştir.');
  }

  if (study.clinicalInfo) {
    contextParts.push(`Klinik bilgi olarak ${study.clinicalInfo}.`);
  } else if (study.description) {
    contextParts.push(`Başvuru notu: ${study.description}.`);
  }

  return contextParts.join(' ');
};

const buildNodulePatternText = (nodules) => {
  if (nodules.length === 0) return 'Nodül izlenmedi';
  if (nodules.length === 1) return 'Tek nodül';
  return 'Çoklu nodül';
};

const expandNoduleLocation = (location) => {
  const names = {
    RUL: 'Sağ üst lob (RUL)',
    RML: 'Sağ orta lob (RML)',
    RLL: 'Sağ alt lob (RLL)',
    LUL: 'Sol üst lob (LUL)',
    LLL: 'Sol alt lob (LLL)',
    AI: 'Model adayı'
  };

  if (!location) {
    return 'Akciğerde tam lokalizasyonu belirtilmemiş alanda';
  }

  return names[location] || location;
};

const buildFindingsText = (reportData) => {
  const nodules = reportData?.nodules || [];
  if (nodules.length === 0) {
    return 'Rapor kapsamına alınmış belirgin pulmoner nodül saptanmamıştır.';
  }

  if (nodules.length === 1) {
    const [nodule] = nodules;
    return `${expandNoduleLocation(nodule.location)} yerleşimli, yaklaşık ${nodule.size || '-'} mm çapında tek pulmoner nodül izlenmiştir.`;
  }

  const largestNodule = [...nodules].sort((left, right) => (toFiniteNumber(right.size) || 0) - (toFiniteNumber(left.size) || 0))[0];
  return `Her iki akciğer değerlendirmesinde birden fazla pulmoner nodül izlenmiştir. En büyük nodül ${expandNoduleLocation(largestNodule.location)} yerleşimli olup yaklaşık ${largestNodule.size || '-'} mm çapındadır.`;
};

const buildRiskAssessmentText = (report, reportData, patientRisk) => {
  const nlpAnalysis = getEmbeddedNlpAnalysis(reportData);
  const nodules = reportData?.nodules || [];
  const highRiskCount = nodules.filter((nodule) => (nodule.risk || '').toLowerCase() === 'high').length;

  if (patientRisk.level === 'high') {
    const signalText = patientRisk.signals.length > 0
      ? ` Hasta öyküsünde ${patientRisk.signals.join(', ')} bulunması nedeniyle izlem gereksinimi artmaktadır.`
      : '';
    const nlpText = nlpAnalysis?.summary ? ` ${nlpAnalysis.summary}` : '';
    return `Nodül boyutu, sayısı ve mevcut klinik veriler birlikte değerlendirildiğinde yakın klinik/radyolojik takip gerektirebilecek bir görünüm mevcuttur.${signalText}${nlpText}`;
  }

  if (highRiskCount > 0) {
    return 'Otomatik değerlendirmede dikkat gerektiren bazı özellikler işaretlenmiştir; bu nedenle radyoloji ve klinik bulgular ile birlikte yorumlanması önerilir.';
  }

  return 'Mevcut boyut, nodül sayısı ve kayıtlı klinik bilgiler birlikte değerlendirildiğinde bulgular düşük riskli pulmoner nodül görünümü ile uyumludur.';
};

const buildRecommendationText = (reportData, patientRisk) => {
  const nodules = reportData?.nodules || [];
  if (nodules.length === 0) {
    return 'Bu inceleme özelinde ek nodül takibi gerektiren bir bulgu rapora yansımamıştır.';
  }

  const maxSize = Math.max(...nodules.map((nodule) => toFiniteNumber(nodule.size) || 0), 0);
  const isMultiple = nodules.length > 1;
  const highRiskPatient = patientRisk.level === 'high';

  if (maxSize < 6) {
    if (isMultiple) {
      return highRiskPatient
        ? 'Birden fazla ve 6 mm altındaki nodüller için 12 ay içinde kontrol BT planlanması değerlendirilebilir.'
        : 'Birden fazla 6 mm altı nodül için klinik gereklilik yoksa rutin takip gerekmeyebilir; karar hekim değerlendirmesi ile netleştirilmelidir.';
    }
    return highRiskPatient
      ? '6 mm altındaki tek nodül için, eşlik eden risk faktörleri nedeniyle 12 ay içinde kontrol BT planı düşünülebilir.'
      : '6 mm altındaki tek nodül için çoğu durumda rutin takip gerekmeyebilir.';
  }

  if (maxSize <= 8) {
    if (isMultiple) {
      return '6-8 mm aralığında birden fazla nodül için 3-6 ay içinde kontrol BT, ardından klinik uygunluk halinde 18-24 aya uzanan izlem planı değerlendirilebilir.';
    }
    return highRiskPatient
      ? '6-8 mm aralığındaki tek nodül için risk faktörleri de göz önüne alınarak 6-12 ay içinde kontrol BT, ardından 18-24 ay izlem önerilebilir.'
      : '6-8 mm aralığındaki tek nodül için 6-12 ay içinde kontrol BT ve uygun hastalarda devam izlem önerilebilir.';
  }

  if (isMultiple) {
    return '8 mm üstü ya da baskın büyük nodül varlığında 3-6 ay içinde kontrol BT ve gerekli görülürse ileri değerlendirme planlanması uygundur.';
  }

  return '8 mm üstü tek nodül için yaklaşık 3 ay içinde kontrol BT ve gerekli klinik durumda PET/BT ya da ileri tanısal değerlendirme düşünülmelidir.';
};

const buildConclusionText = (patientRisk) => (
  patientRisk.level === 'high'
    ? 'Bu belge mevcut görüntüleme ve kayıtlı klinik bilgiler kullanılarak hazırlanmıştır. Nihai değerlendirme ve tedavi planı ilgili uzman hekim tarafından yapılmalıdır.'
    : 'Bu belge bilgilendirme amaçlıdır. Bulguların kesin yorumu, klinik muayene ve radyoloji uzmanı değerlendirmesi ile birlikte yapılmalıdır.'
);

const addWrappedText = (doc, text, x, y, maxWidth, lineHeight = 5) => {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
};

const drawSectionHeader = (doc, title, y) => {
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.4);
  doc.line(20, y, 190, y);
  doc.setFontSize(11);
  doc.setFont('ArialUnicode', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(title.toLocaleUpperCase('tr-TR'), 20, y + 6);
  return y + 11;
};

const drawInfoRows = (doc, items, y) => {
  const leftX = 20;
  const rightX = 108;

  items.forEach((item, index) => {
    const isLeftColumn = index % 2 === 0;
    const row = Math.floor(index / 2);
    const x = isLeftColumn ? leftX : rightX;
    const currentY = y + row * 7;

    doc.setFontSize(9);
    doc.setFont('ArialUnicode', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text(`${normalizePdfText(item.label)}:`, x, currentY);

    doc.setFont('ArialUnicode', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(normalizePdfText(item.value), x + 28, currentY);
  });

  return y + Math.ceil(items.length / 2) * 7;
};

const drawParagraphBlock = (doc, text, y, options = {}) => {
  const {
    x = 20,
    width = 170,
    lineHeight = 5,
    indent = 0,
  } = options;

  doc.setFont('ArialUnicode', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(normalizePdfText(text), width - indent);
  doc.text(lines, x + indent, y);
  return y + lines.length * lineHeight;
};

const drawLabeledValue = (doc, label, value, y, options = {}) => {
  const {
    labelX = 20,
    valueX = 78,
    valueWidth = 112,
    lineHeight = 5,
  } = options;

  doc.setFont('ArialUnicode', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(`${label}:`, labelX, y);

  const valueLines = doc.splitTextToSize(normalizePdfText(value), valueWidth);
  doc.setFont('ArialUnicode', 'normal');
  doc.text(valueLines, valueX, y);

  return y + Math.max(lineHeight, valueLines.length * lineHeight);
};

const drawNoduleRows = (doc, nodule, index, y) => {
  doc.setFontSize(10);
  doc.setFont('ArialUnicode', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(`Nodül ${nodule.id || index + 1}`, 20, y);
  y += 7;

  y = drawLabeledValue(doc, 'Konum', expandNoduleLocation(nodule.location), y);
  y += 1;
  y = drawLabeledValue(doc, 'Boyut', `${nodule.size || '-'} mm`, y);
  y += 1;
  y = drawLabeledValue(doc, 'Risk Değerlendirmesi', translateRiskLabel(nodule.risk), y);

  if (nodule.doctorAssessment) {
    y += 1;
    y = drawLabeledValue(doc, 'Hekim Değerlendirmesi', nodule.doctorAssessment, y);
  }
  if (nodule.notes) {
    y += 1;
    y = drawLabeledValue(doc, 'Not', nodule.notes, y);
  }

  doc.setDrawColor(210, 210, 210);
  doc.line(20, y - 1, 190, y - 1);
  return y + 3;
};

const normalizePdfText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const ensurePageSpace = (doc, y, requiredHeight = 18) => {
  if (y + requiredHeight <= 275) {
    return y;
  }
  doc.addPage();
  return 20;
};

const translateRiskLabel = (risk) => {
  const normalizedRisk = (risk || '').toLowerCase();
  if (normalizedRisk === 'high') return 'Yüksek risk';
  if (normalizedRisk === 'medium') return 'Orta risk';
  if (normalizedRisk === 'low') return 'Düşük risk';
  return risk || '-';
};

const getRiskColor = (risk) => {
  const normalizedRisk = (risk || '').toLowerCase();
  if (normalizedRisk.includes('high') || normalizedRisk.includes('yüksek')) return '#e74c3c';
  if (normalizedRisk.includes('medium') || normalizedRisk.includes('orta')) return '#f39c12';
  if (normalizedRisk.includes('low') || normalizedRisk.includes('düşük')) return '#27ae60';
  return '#95a5a6';
};

export default function MyReports(){
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const enrichReportWithNlp = async (report) => {
    const reportData = parseReportPayload(report);
    const embeddedNlpAnalysis = getEmbeddedNlpAnalysis(reportData);
    if (embeddedNlpAnalysis && !nlpAnalysisNeedsRefresh(embeddedNlpAnalysis)) {
      return { ...report, parsedData: reportData };
    }

    try {
      const response = await fetch(`${API_URL}/nlp/analyze-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildNlpPayload(reportData)),
      });

      if (!response.ok) {
        throw new Error('NLP analizi tamamlanamadi');
      }

      const result = await response.json();
      if (!result?.analysis) {
        return { ...report, parsedData: reportData };
      }

      return { ...report, parsedData: mergeNlpAnalysis(reportData, result.analysis) };
    } catch (error) {
      console.error('Error enriching report with NLP analysis:', error);
      return { ...report, parsedData: reportData };
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const response = await fetch(`${API_URL}/reports`);
      const data = await response.json();
      setReports(data);
    } catch (error) {
      console.error('Error fetching reports:', error);
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';

    if (dateString instanceof Date && !Number.isNaN(dateString.getTime())) {
      return dateString.toLocaleString('tr-TR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    const rawValue = String(dateString).trim();
    const sqlLikeMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/);
    if (sqlLikeMatch) {
      const [, year, month, day, hour, minute] = sqlLikeMatch;
      return `${day}.${month}.${year} ${hour}:${minute}`;
    }

    const date = new Date(rawValue);
    if (Number.isNaN(date.getTime())) {
      return rawValue;
    }

    return date.toLocaleString('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const viewReport = async (report) => {
    const reportData = parseReportPayload(report);
    setSelectedReport({ ...report, parsedData: reportData });
    setShowViewModal(true);

    const enrichedReport = await enrichReportWithNlp(report);
    setSelectedReport((current) => (
      current?.report_id === report.report_id ? enrichedReport : current
    ));
  };

  const downloadPdf = async (report) => {
    setGeneratingPdf(true);
    try {
      const { default: jsPDF } = await import('jspdf');

      const enrichedReport = await enrichReportWithNlp(report);
      const reportData = enrichedReport.parsedData;
      const patientRisk = classifyPatientRisk(report, reportData);
      const clinicalContextText = buildClinicalContextText(report, reportData);
      const findingsText = buildFindingsText(reportData);
      const riskText = buildRiskAssessmentText(report, reportData, patientRisk);
      const recommendationText = buildRecommendationText(reportData, patientRisk);
      const conclusionText = buildConclusionText(patientRisk);
      const study = reportData?.study || {};
      const nodules = reportData?.nodules || [];
      const nodulePatternText = buildNodulePatternText(nodules);

      const doc = new jsPDF();
      await loadPdfFont(doc);
      let y = 20;

      doc.setTextColor(20, 20, 20);
      doc.setFontSize(16);
      doc.setFont('ArialUnicode', 'bold');
      doc.text('PULMONER NODÜL RAPORU', 105, y, { align: 'center' });
      y += 6;

      doc.setLineWidth(0.6);
      doc.setDrawColor(100, 100, 100);
      doc.line(20, y, 190, y);
      y += 7;

      doc.setFontSize(9);
      doc.setFont('ArialUnicode', 'normal');
      doc.text('Bilgilendirme ve izlem amaçlı ön değerlendirme özeti', 105, y, { align: 'center' });
      y += 10;

      y = drawSectionHeader(doc, 'Hasta ve İnceleme Bilgileri', y);
      y = drawInfoRows(doc, [
        { label: 'Rapor No', value: report.report_id || '-' },
        { label: 'Oluşturma Tarihi', value: formatDate(report.created_at) },
        { label: 'Oluşturan', value: report.generated_by || '-' },
        { label: 'Nodül Paterni', value: nodulePatternText },
        { label: 'Hasta Adı', value: report.patient_name || '-' },
        { label: 'Hasta ID', value: report.patient_id || '-' },
        { label: 'Çalışma Tarihi', value: report.study_date || '-' },
        { label: 'İnceleme No', value: report.study_id || '-' },
        { label: 'Yaş / Cinsiyet', value: `${study.age || '-'} / ${study.gender || '-'}` },
      ], y);
      y += 8;

      y = ensurePageSpace(doc, y, 18);
      y = drawSectionHeader(doc, 'İnceleme Özeti', y);
      y = drawParagraphBlock(doc, clinicalContextText, y);
      y += 8;

      y = ensurePageSpace(doc, y, 28);
      y = drawSectionHeader(doc, 'Bulgular', y);
      y = drawParagraphBlock(doc, findingsText, y);
      y += 8;

      y = ensurePageSpace(doc, y, 24);
      y = drawSectionHeader(doc, 'Değerlendirme', y);
      y = drawParagraphBlock(doc, riskText, y);
      y += 8;

      if (nodules.length > 0) {
        y = ensurePageSpace(doc, y, 30);
        y = drawSectionHeader(doc, 'Nodül Ayrıntıları', y);

        nodules.forEach((nodule, index) => {
          y = ensurePageSpace(doc, y, 28);
          y = drawNoduleRows(doc, nodule, index, y);
        });
      }

      y = ensurePageSpace(doc, y, 24);
      y = drawSectionHeader(doc, 'İzlem ve Sonuç', y);
      y = drawParagraphBlock(doc, recommendationText, y);
      y += 4;
      y = drawParagraphBlock(doc, conclusionText, y);

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(160, 160, 160);
        doc.line(15, 286, 195, 286);
        doc.setFontSize(8);
        doc.setFont('ArialUnicode', 'normal');
        doc.setTextColor(90, 90, 90);
        doc.text(normalizePdfText(`Sayfa ${i} / ${pageCount}`), 105, 290, { align: 'center' });
        doc.text('AI-Supported Lung Nodule Detection System', 105, 295, { align: 'center' });
      }

      doc.save(`report_${report.report_id}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF: ' + error.message);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!confirm('Are you sure you want to delete this report?')) return;
    
    try {
      const response = await fetch(`${API_URL}/reports/${reportId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setReports(reports.filter(r => r.report_id !== reportId));
      }
    } catch (error) {
      console.error('Error deleting report:', error);
    }
  };

  const getRiskBadge = (risk) => {
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: '4px',
        backgroundColor: getRiskColor(risk),
        color: 'white',
        fontSize: '11px',
        fontWeight: 'bold',
        textTransform: 'capitalize'
      }}>
        {risk}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="worklist">
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="worklist">
      <div className="worklist-header">
        <h2>Raporlarım</h2>
        <p>Oluşturulan raporları görüntüleyin ve yönetin</p>
      </div>

      <div className="dashboard-section">
        <div className="table-wrapper">
          <table className="worklist-table">
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Patient</th>
                <th>Study Date</th>
                <th>Nodules</th>
                <th>Generated By</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                    <div style={{ color: '#95a5a6' }}>
                      <span style={{ fontSize: '48px' }}></span>
                      <p>Rapor bulunamadı</p>
                      <p style={{ fontSize: '12px' }}>Review sayfasından rapor oluşturabilirsiniz</p>
                    </div>
                  </td>
                </tr>
              ) : (
                reports.map(report => (
                  <tr key={report.report_id}>
                    <td><code style={{ fontSize: '11px' }}>{report.report_id}</code></td>
                    <td>
                      <strong>{report.patient_name || '-'}</strong>
                      <br />
                      <span style={{ fontSize: '11px', color: '#666' }}>{report.patient_id}</span>
                    </td>
                    <td>{report.study_date || '-'}</td>
                    <td>
                      <span style={{ fontWeight: 'bold' }}>{report.included_nodule_count}</span>
                      <span style={{ color: '#666' }}> / {report.nodule_count}</span>
                    </td>
                    <td>{report.generated_by || '-'}</td>
                    <td>{formatDate(report.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="open-btn view-btn" onClick={() => viewReport(report)}>
                          Görüntüle
                        </button>
                        <button 
                          className="open-btn pdf-btn" 
                          onClick={() => downloadPdf(report)}
                          disabled={generatingPdf}
                        >
                          {generatingPdf ? '...' : ''} PDF
                        </button>
                        <button className="open-btn delete-btn" onClick={() => handleDeleteReport(report.report_id)}>
                          X
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Report Modal */}
      {showViewModal && selectedReport && (
        <div className="modal-overlay" onClick={() => setShowViewModal(false)}>
          <div className="report-view-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Rapor Detayları</h3>
              <button className="close-btn" onClick={() => setShowViewModal(false)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="report-section">
                <h4>Rapor Bilgileri</h4>
                <div className="info-grid">
                  <div className="info-item"><label>Rapor ID</label><span>{selectedReport.report_id}</span></div>
                  <div className="info-item"><label>Oluşturulma</label><span>{formatDate(selectedReport.created_at)}</span></div>
                  <div className="info-item"><label>Oluşturan</label><span>{selectedReport.generated_by || '-'}</span></div>
                  <div className="info-item"><label>Durum</label><span className="status-badge">{selectedReport.status}</span></div>
                </div>
              </div>

              <div className="report-section">
                <h4>Hasta Bilgileri</h4>
                <div className="info-grid">
                  <div className="info-item"><label>Ad</label><span>{selectedReport.patient_name || '-'}</span></div>
                  <div className="info-item"><label>Hasta ID</label><span>{selectedReport.patient_id}</span></div>
                  <div className="info-item"><label>Çalışma Tarihi</label><span>{selectedReport.study_date || '-'}</span></div>
                  <div className="info-item"><label>Study ID</label><span>{selectedReport.study_id}</span></div>
                </div>
              </div>

              <div className="report-section">
                <h4>Analiz Özeti</h4>
                <div className="summary-cards">
                  <div className="summary-card">
                    <span className="number">{selectedReport.nodule_count || 0}</span>
                    <span className="label">Toplam Nodül</span>
                  </div>
                  <div className="summary-card">
                    <span className="number">{selectedReport.included_nodule_count || 0}</span>
                    <span className="label">Rapora Dahil</span>
                  </div>
                </div>
              </div>

              {selectedReport.parsedData?.nlpAnalysis && (
                <div className="report-section">
                  <h4>NLP Klinik Özet</h4>
                  <div className="nodule-details">
                    <div><label>Risk Düzeyi:</label> {selectedReport.parsedData.nlpAnalysis.riskLevel || '-'}</div>
                    <div><label>Öncelik:</label> {selectedReport.parsedData.nlpAnalysis.urgency || '-'}</div>
                    <div><label>Model Modu:</label> {selectedReport.parsedData.nlpAnalysis.mode || '-'}</div>
                    <div><label>Özet:</label> {selectedReport.parsedData.nlpAnalysis.summary || '-'}</div>
                    <div><label>Öneri:</label> {selectedReport.parsedData.nlpAnalysis.recommendedAction || '-'}</div>
                    <div><label>Sinyaller:</label> {(selectedReport.parsedData.nlpAnalysis.riskSignals || []).join(', ') || '-'}</div>
                  </div>
                </div>
              )}

              {selectedReport.parsedData?.nodules && selectedReport.parsedData.nodules.length > 0 && (
                <div className="report-section">
                  <h4>Nodül Ayrıntıları</h4>
                  <div className="nodules-list">
                    {selectedReport.parsedData.nodules.map((nodule, index) => (
                      <div key={nodule.id || index} className="nodule-card">
                        <div className="nodule-header">
                          <span className="nodule-id">Nodül #{nodule.id || index + 1}</span>
                          {getRiskBadge(translateRiskLabel(nodule.risk))}
                        </div>
                        <div className="nodule-details">
                          <div><label>Konum:</label> {nodule.location || '-'}</div>
                          <div><label>Boyut:</label> {nodule.size || '-'} mm</div>
                          {nodule.doctorAssessment && (
                            <div><label>Hekim Değerlendirmesi:</label> 
                              <span className={`assessment-badge ${nodule.doctorAssessment}`}>
                                {nodule.doctorAssessment}
                              </span>
                            </div>
                          )}
                          {nodule.notes && <div><label>Not:</label> {nodule.notes}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowViewModal(false)}>Kapat</button>
              <button className="generate-btn" onClick={() => downloadPdf(selectedReport)}>
                PDF İndir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

