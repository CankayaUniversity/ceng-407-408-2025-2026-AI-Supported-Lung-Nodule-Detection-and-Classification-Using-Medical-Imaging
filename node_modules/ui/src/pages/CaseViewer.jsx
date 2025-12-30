import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import './CaseViewer.css';

const API_URL = 'http://localhost:3001/api';

function CaseViewer() {
  const { studyId } = useParams();
  const navigate = useNavigate();
  const [study, setStudy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStudy();
  }, [studyId]);

  const fetchStudy = async () => {
    try {
      const response = await fetch(`${API_URL}/studies/${studyId}`);
      if (response.ok) {
        const data = await response.json();
        setStudy({
          id: data.study_id,
          patientName: data.patient_name || 'Bilinmeyen',
          patientID: data.patient_id,
          studyDate: data.study_date,
          modality: 'CT',
          status: data.status === 'completed' ? 'Completed' : 'Pending',
          noduleCount: data.nodule_count || 0,
          nodules: data.nodules || []
        });
      }
    } catch (error) {
      console.error('Error fetching study:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="case-viewer">
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="case-viewer">
        <div className="not-found">
          <h2>Study Not Found</h2>
          <p>The requested study was not found.</p>
          <button onClick={() => navigate('/worklist')} className="back-btn">
            Return to Work List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="case-viewer">
      <div className="case-header">
        <button
          className="back-button"
          onClick={() => navigate('/worklist')}
          title="Çalışma listesine dön"
        >
          <ChevronLeft size={20} />
          Geri
        </button>
        <div className="case-title">
          <h2>{study.patientName}</h2>
          <p>{study.patientID} | {study.studyDate}</p>
        </div>
      </div>

      <div className="case-container">
        {/* Left Panel - Nodule List */}
        <div className="nodule-list-panel">
          <div className="panel-header">
            <h3>Nodüller ({study.noduleCount})</h3>
          </div>
          <div className="nodule-items">
            {study.noduleCount > 0 ? (
              Array.from({ length: study.noduleCount }).map((_, idx) => (
                <div key={idx} className="nodule-item">
                  <div className="nodule-number">#{idx + 1}</div>
                  <div className="nodule-info">
                    <p className="nodule-size">Boyut: {(5 + idx * 3).toFixed(1)} mm</p>
                    <p className="nodule-type">Tip: {['Solid', 'Yarı-solid', 'GGO'][idx % 3]}</p>
                    <p className="nodule-risk">Risk: {['Düşük', 'Orta', 'Yüksek'][idx % 3]}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="no-nodules">
                <p>Nodül tespit edilmedi</p>
              </div>
            )}
          </div>
        </div>

        {/* Center Panel - Viewer */}
        <div className="viewer-panel">
          <div className="viewer-placeholder">
            <div className="placeholder-content">
              <h4>Tıbbi Görüntü Görüntüleyici</h4>
              <p>Çalışma: {study.id}</p>
              <p>Modalite: {study.modality}</p>
              <div className="image-mockup">
                <div className="mockup-grid"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Report */}
        <div className="report-panel">
          <div className="panel-header">
            <h3>Rapor</h3>
          </div>
          <div className="report-content">
            <div className="report-section">
              <h4>Çalışma Bilgileri</h4>
              <div className="info-row">
                <span className="label">Çalışma ID:</span>
                <span className="value">{study.id}</span>
              </div>
              <div className="info-row">
                <span className="label">Modalite:</span>
                <span className="value">{study.modality}</span>
              </div>
              <div className="info-row">
                <span className="label">Tarih:</span>
                <span className="value">{study.studyDate}</span>
              </div>
            </div>

            <div className="report-section">
              <h4>Bulgular</h4>
              <p className="findings-text">
                {study.noduleCount > 0
                  ? `Akciğerlerde ${study.noduleCount} nodül tespit edildi. Radyolog incelemesi bekleniyor.`
                  : 'Önemli bulgu yok. Çalışma normal görünüyor.'}
              </p>
            </div>

            <div className="report-section">
              <h4>Durum</h4>
              <div className={`status-badge-large status-${study.status.toLowerCase()}`}>
                {study.status === 'Completed' ? 'Tamamlandı' : 'Bekliyor'}
              </div>
            </div>

            <div className="report-actions">
              <button className="btn-primary">Raporu Kaydet</button>
              <button className="btn-secondary">Not Ekle</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CaseViewer;
