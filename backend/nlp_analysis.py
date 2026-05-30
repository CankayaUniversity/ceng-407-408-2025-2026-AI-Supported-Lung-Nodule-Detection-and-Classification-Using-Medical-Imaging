import json
import os
import re
import sys
from pathlib import Path

if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

try:
    import torch
    from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer
except ImportError:
    AutoModel = None
    AutoModelForSequenceClassification = None
    AutoTokenizer = None
    torch = None


MODEL_NAME = os.getenv('BERTURK_MODEL_NAME', 'dbmdz/bert-base-turkish-cased')
FINETUNED_MODEL_DIR = os.getenv('BERTURK_FINETUNED_MODEL_DIR', '').strip()
LABEL_ID_ALIASES = {
    'prior_malignancy': 'prior_cancer_history',
}
SIGNAL_DEFS = [
    {
        'id': 'smoking_history',
        'label': 'sigara öyküsü',
        'patterns': [r'sigara', r'smoker', r'smoking', r'pack.?year', r'paket\s*/?\s*y', r'tobacco'],
        'anchors': [r'sigara', r'smoking', r'pack', r'paket', r'tobacco'],
        'prototypes': ['sigara kullanımı mevcut', 'uzun süreli sigara öyküsü var'],
        'weight': 2,
    },
    {
        'id': 'family_history',
        'label': 'aile/genetik öyküsü',
        'patterns': [r'aile', r'family', r'genetik', r'herediter'],
        'anchors': [r'aile', r'family', r'genetik', r'herediter'],
        'prototypes': ['ailede akciğer kanseri öyküsü', 'genetik yatkınlık mevcut'],
        'weight': 2,
    },
    {
        'id': 'prior_cancer_history',
        'label': 'önceki kanser / onkolojik öykü',
        'patterns': [r'onceki', r'önceki', r'gecmis', r'geçmiş', r'prior', r'malign', r'kanser'],
        'anchors': [r'onceki', r'önceki', r'gecmis', r'geçmiş', r'prior', r'malign', r'kanser'],
        'prototypes': ['önceki malignite öyküsü var', 'kanser geçmişi mevcut'],
        'weight': 3,
    },
    {
        'id': 'copd',
        'label': 'eşlik eden akciğer hastalığı / hava yolu obstrüksiyonu',
        'patterns': [
            r'koah', r'copd', r'amfizem', r'emphysema', r'kronik obstruktif',
            r'bronşektazi', r'bronsiektazi', r'bronsiect', r'interstisyel fibroz',
            r'pulmoner fibroz', r'fibroz', r'skar', r'sikatris', r'apse'
        ],
        'anchors': [r'koah', r'copd', r'amfizem', r'obstruktif', r'fibroz', r'bronş', r'brons', r'skar', r'apse'],
        'prototypes': ['KOAH öyküsü mevcut', 'eşlik eden akciğer hastalığı ve hava yolu obstrüksiyonu bulunuyor'],
        'weight': 2,
    },
    {
        'id': 'age_gender_risk',
        'label': 'cinsiyet ve yaş ilişkili risk',
        'patterns': [r'ileri yaş', r'yaşlı', r'erkek', r'male', r'kadın', r'female', r'postmenopoz', r'menopoz'],
        'anchors': [r'yaş', r'erkek', r'male', r'kadın', r'female', r'menopoz'],
        'prototypes': ['ileri yaş erkek hasta', 'cinsiyet ve yaş nedeniyle risk artışı olabilir'],
        'weight': 1,
    },
    {
        'id': 'obesity_metabolic',
        'label': 'diyet / obezite ilişkili risk',
        'patterns': [r'obez', r'obesity', r'obesite', r'beden kitle', r'bmi', r'adipoz', r'morbid obez'],
        'anchors': [r'obez', r'obesity', r'obesite', r'bmi', r'adipoz'],
        'prototypes': ['obezite öyküsü mevcut', 'diyet ve obezite ilişkili risk olabilir'],
        'weight': 1,
    },
    {
        'id': 'infection_history',
        'label': 'enfeksiyon / kronik inflamasyon öyküsü',
        'patterns': [r't[üu]berk[üu]loz', r'\btb\b', r'verem', r'kronik enfeks', r'hpv', r'human papilloma', r'viral enfeks', r'kronik inflam'],
        'anchors': [r't[üu]berk', r'\btb\b', r'verem', r'enfeks', r'hpv', r'inflam'],
        'prototypes': ['tüberküloz veya kronik enfeksiyon öyküsü mevcut', 'kronik inflamasyon ile ilişkili enfeksiyon geçmişi var'],
        'weight': 1,
    },
    {
        'id': 'environmental_exposure',
        'label': 'çevresel maruziyet öyküsü',
        'patterns': [r'radon', r'hava kirlili', r'pasif içici', r'pasif sigara', r'ikinci el sigara', r'duman maruziyeti', r'biyok[üu]tle', r'biomass', r'iç ortam duman'],
        'anchors': [r'radon', r'hava kirlili', r'pasif', r'duman', r'biyok', r'biomass'],
        'prototypes': ['radon veya hava kirliliği maruziyeti mevcut', 'çevresel duman maruziyeti öyküsü bulunuyor'],
        'weight': 2,
    },
    {
        'id': 'occupational_exposure_lung_disease',
        'label': 'mesleki maruziyet / pnömokonyoz öyküsü',
        'patterns': [
            r'silikoz',
            r'silicos',
            r'asbest',
            r'asbestoz',
            r'pn[oö]mokon',
            r'k[oö]m[üu]r iş[çc]i',
            r'k[oö]m[üu]r madenc',
            r'coal worker',
            r'mesleki maruziyet',
            r'mesleki karsinojen',
            r'occupational exposure',
            r'occupational carcinogen',
        ],
        'anchors': [
            r'silikoz',
            r'asbest',
            r'pn[oö]mokon',
            r'k[oö]m[üu]r',
            r'mesleki',
            r'occupational',
        ],
        'prototypes': [
            'silikozis öyküsü mevcut',
            'asbestozis veya mesleki maruziyet öyküsü bulunuyor',
            'kömür işçisi pnömokonyozu öyküsü var',
        ],
        'weight': 3,
    },
    {
        'id': 'systemic_symptoms',
        'label': 'sistemik semptom',
        'patterns': [r'hemoptizi', r'kilo kaybi', r'kilo kaybı', r'weight loss', r'gece terlemesi', r'dispne', r'nefes darligi', r'nefes darlığı'],
        'anchors': [r'hemoptizi', r'kilo', r'weight', r'gece', r'dispne', r'nefes darl'],
        'prototypes': ['hemoptizi tarifliyor', 'kilo kaybi ve semptomlar mevcut'],
        'weight': 2,
    },
]
NEGATION_PATTERN = re.compile(r'\b(yok|degil|değil|bulunmuyor|izlenmedi|saptanmadi|saptanmadı|inkar|reddediyor|negatif)\b', re.IGNORECASE)
SENTENCE_SPLIT_PATTERN = re.compile(r'(?<=[\.!?])\s+|\n+')
_MODEL_CACHE = None
_TOKENIZER_CACHE = None
_MODEL_LOAD_FAILED = False
_CLASSIFIER_MODEL_CACHE = None
_CLASSIFIER_TOKENIZER_CACHE = None
_CLASSIFIER_LABELS_CACHE = None
_CLASSIFIER_THRESHOLD_CACHE = 0.5
_CLASSIFIER_LOAD_FAILED = False


def normalize_text(value):
    if value is None:
        return ''
    text = str(value).replace('\r', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def safe_lower(text):
    return normalize_text(text).casefold()


def split_sentences(text):
    normalized = normalize_text(text)
    if not normalized:
        return []
    return [part.strip() for part in SENTENCE_SPLIT_PATTERN.split(normalized) if part.strip()]


def is_negated(sentence):
    return bool(NEGATION_PATTERN.search(sentence))


def find_keyword_evidence(sentences, definition):
    matches = []
    for sentence in sentences:
        lowered = safe_lower(sentence)
        if is_negated(lowered):
            continue
        if any(re.search(pattern, lowered, re.IGNORECASE) for pattern in definition['patterns']):
            matches.append(sentence)
    return matches


def load_model():
    global _MODEL_CACHE, _TOKENIZER_CACHE, _MODEL_LOAD_FAILED
    if _MODEL_CACHE is not None or _MODEL_LOAD_FAILED or AutoTokenizer is None or AutoModel is None or torch is None:
        return _TOKENIZER_CACHE, _MODEL_CACHE
    try:
        _TOKENIZER_CACHE = AutoTokenizer.from_pretrained(MODEL_NAME)
        _MODEL_CACHE = AutoModel.from_pretrained(MODEL_NAME)
        _MODEL_CACHE.eval()
    except Exception:
        _MODEL_LOAD_FAILED = True
        _TOKENIZER_CACHE = None
        _MODEL_CACHE = None
    return _TOKENIZER_CACHE, _MODEL_CACHE


def canonicalize_label_id(label_id):
    return LABEL_ID_ALIASES.get(label_id, label_id)


def get_signal_definition_map():
    definitions = {definition['id']: definition for definition in SIGNAL_DEFS}
    for legacy_id, canonical_id in LABEL_ID_ALIASES.items():
        if canonical_id in definitions:
            definitions[legacy_id] = definitions[canonical_id]
    return definitions


def load_finetuned_classifier():
    global _CLASSIFIER_MODEL_CACHE, _CLASSIFIER_TOKENIZER_CACHE, _CLASSIFIER_LABELS_CACHE
    global _CLASSIFIER_THRESHOLD_CACHE, _CLASSIFIER_LOAD_FAILED

    if _CLASSIFIER_MODEL_CACHE is not None:
        return _CLASSIFIER_TOKENIZER_CACHE, _CLASSIFIER_MODEL_CACHE, _CLASSIFIER_LABELS_CACHE, _CLASSIFIER_THRESHOLD_CACHE
    if _CLASSIFIER_LOAD_FAILED or AutoTokenizer is None or AutoModelForSequenceClassification is None or torch is None:
        return None, None, None, 0.5

    model_dir = FINETUNED_MODEL_DIR
    if not model_dir:
        default_dir = Path(__file__).resolve().parent / 'models' / 'berturk-risk-multilabel'
        if default_dir.exists():
            model_dir = str(default_dir)
    if not model_dir:
        _CLASSIFIER_LOAD_FAILED = True
        return None, None, None, 0.5

    config_path = Path(model_dir) / 'training_config.json'
    try:
        _CLASSIFIER_TOKENIZER_CACHE = AutoTokenizer.from_pretrained(model_dir)
        _CLASSIFIER_MODEL_CACHE = AutoModelForSequenceClassification.from_pretrained(model_dir)
        _CLASSIFIER_MODEL_CACHE.eval()
        label_names = None
        threshold = 0.5
        if config_path.exists():
            config_data = json.loads(config_path.read_text(encoding='utf-8'))
            label_names = config_data.get('label_names')
            threshold = float(config_data.get('threshold', 0.5))
        if not label_names:
            id2label = getattr(_CLASSIFIER_MODEL_CACHE.config, 'id2label', {}) or {}
            if isinstance(id2label, dict) and id2label:
                label_names = [id2label[str(index)] if str(index) in id2label else id2label.get(index) for index in range(len(id2label))]
        _CLASSIFIER_LABELS_CACHE = label_names
        _CLASSIFIER_THRESHOLD_CACHE = threshold
    except Exception:
        _CLASSIFIER_LOAD_FAILED = True
        _CLASSIFIER_TOKENIZER_CACHE = None
        _CLASSIFIER_MODEL_CACHE = None
        _CLASSIFIER_LABELS_CACHE = None
        _CLASSIFIER_THRESHOLD_CACHE = 0.5

    return _CLASSIFIER_TOKENIZER_CACHE, _CLASSIFIER_MODEL_CACHE, _CLASSIFIER_LABELS_CACHE, _CLASSIFIER_THRESHOLD_CACHE


def mean_pool(last_hidden_state, attention_mask):
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    masked = last_hidden_state * mask
    summed = masked.sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1e-9)
    return summed / counts


def encode_texts(texts):
    tokenizer, model = load_model()
    if tokenizer is None or model is None or torch is None:
        return None
    encoded = tokenizer(texts, padding=True, truncation=True, max_length=128, return_tensors='pt')
    with torch.no_grad():
        outputs = model(**encoded)
    pooled = mean_pool(outputs.last_hidden_state, encoded['attention_mask'])
    pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
    return pooled


def cosine_similarity(vector_a, vector_b):
    return float(torch.matmul(vector_a, vector_b.T).max().item())


def find_semantic_evidence(sentences, definition):
    if not sentences or torch is None:
        return []
    sentence_vectors = encode_texts(sentences)
    prototype_vectors = encode_texts(definition['prototypes'])
    if sentence_vectors is None or prototype_vectors is None:
        return []
    semantic_matches = []
    for index, sentence in enumerate(sentences):
        lowered = safe_lower(sentence)
        if is_negated(lowered):
            continue
        if not any(re.search(pattern, lowered, re.IGNORECASE) for pattern in definition.get('anchors', [])):
            continue
        score = cosine_similarity(sentence_vectors[index:index + 1], prototype_vectors)
        if score >= 0.72:
            semantic_matches.append({'sentence': sentence, 'score': round(score, 3)})
    return semantic_matches


def build_signal_entries(sentences):
    entries = []
    semantic_mode = False
    for definition in SIGNAL_DEFS:
        keyword_evidence = find_keyword_evidence(sentences, definition)
        semantic_evidence = find_semantic_evidence(sentences, definition)
        semantic_mode = semantic_mode or bool(semantic_evidence)
        combined = []
        for sentence in keyword_evidence:
            combined.append({'sentence': sentence, 'score': 0.92, 'source': 'keyword'})
        for item in semantic_evidence:
            if item['sentence'] not in [existing['sentence'] for existing in combined]:
                combined.append({'sentence': item['sentence'], 'score': item['score'], 'source': 'semantic'})
        if not combined:
            continue
        if all(item['source'] == 'semantic' for item in combined) and max(item['score'] for item in combined) < 0.8:
            continue
        top_score = max(item['score'] for item in combined)
        entries.append({
            'id': definition['id'],
            'label': definition['label'],
            'confidence': round(top_score, 3),
            'weight': definition['weight'],
            'evidence': [item['sentence'] for item in combined[:2]],
            'sources': sorted({item['source'] for item in combined}),
        })
    return entries, semantic_mode


def predict_finetuned_signal_entries(text):
    normalized_text = normalize_text(text)
    if not normalized_text:
        return []

    tokenizer, model, label_names, threshold = load_finetuned_classifier()
    if tokenizer is None or model is None or not label_names or torch is None:
        return []

    encoded = tokenizer(normalized_text, truncation=True, max_length=256, return_tensors='pt')
    with torch.no_grad():
        logits = model(**encoded).logits

    probabilities = torch.sigmoid(logits)[0].detach().cpu().tolist()
    definitions = get_signal_definition_map()
    entries = []
    for index, label_id in enumerate(label_names):
        label_id = canonicalize_label_id(label_id)
        confidence = float(probabilities[index])
        if confidence < threshold:
            continue
        definition = definitions.get(label_id)
        if not definition:
            continue
        entries.append({
            'id': label_id,
            'label': definition['label'],
            'confidence': round(confidence, 3),
            'weight': definition['weight'],
            'evidence': ['Fine-tuned BERTurk çok etiketli sınıflandırma çıktısı'],
            'sources': ['finetuned_classifier'],
        })
    return entries


def merge_signal_entries(*groups):
    merged = {}
    for group in groups:
        for entry in group:
            key = entry.get('id') or entry.get('label')
            if key not in merged:
                merged[key] = {
                    **entry,
                    'evidence': list(entry.get('evidence') or []),
                    'sources': list(entry.get('sources') or []),
                }
                continue

            existing = merged[key]
            existing['confidence'] = round(max(existing.get('confidence', 0), entry.get('confidence', 0)), 3)
            existing['weight'] = max(existing.get('weight', 0), entry.get('weight', 0))
            existing['evidence'] = list(dict.fromkeys([*(existing.get('evidence') or []), *(entry.get('evidence') or [])]))[:3]
            existing['sources'] = list(dict.fromkeys([*(existing.get('sources') or []), *(entry.get('sources') or [])]))

    return list(merged.values())


def build_structured_signal_entries(patient_age, patient_gender):
    evidence = []
    try:
        if patient_age is not None and float(patient_age) >= 60:
            evidence.append(f'Yaş {int(float(patient_age))}')
    except (TypeError, ValueError):
        pass

    gender = safe_lower(patient_gender)
    if gender in {'m', 'male', 'erkek'}:
        evidence.append('Erkek cinsiyet')

    if not evidence:
        return []

    return [{
        'id': 'age_gender_risk',
        'label': 'cinsiyet ve yaş ilişkili risk',
        'confidence': 0.99,
        'weight': 1,
        'evidence': evidence,
        'sources': ['structured'],
    }]


def infer_assessment_risk(nodules):
    score = 0
    for nodule in nodules:
        assessment = safe_lower(nodule.get('doctorAssessment') or nodule.get('doctor_assessment'))
        risk = safe_lower(nodule.get('risk'))
        if 'malig' in assessment:
            score += 4
        elif 'susp' in assessment:
            score += 2
        if 'high' in risk or 'yuksek' in risk or 'yüksek' in risk:
            score += 2
    return score


def infer_risk_level(signal_entries, patient_age, nodules):
    score = sum(entry['weight'] for entry in signal_entries) + infer_assessment_risk(nodules)
    if patient_age is not None:
        try:
            if float(patient_age) >= 60:
                score += 1
        except (TypeError, ValueError):
            pass
    if score >= 5:
        return 'high', 'expedited'
    if score >= 2:
        return 'moderate', 'follow_up'
    return 'low', 'routine'


def build_summary(signal_entries, risk_level, urgency, clinical_note, description):
    if signal_entries:
        labels = ', '.join(entry['label'] for entry in signal_entries)
        if urgency == 'expedited':
            return f'Klinik notlarda {labels} saptandı. Bu nedenle yakın klinik değerlendirme ve ileri inceleme ihtiyacı doğabilir.'
        if urgency == 'follow_up':
            return f'Klinik notlarda {labels} ile uyumlu ifadeler bulunuyor. Radyolojik bulgular ile birlikte kısa dönem takip planlanabilir.'
        return f'Klinik notlarda {labels} geçiyor; mevcut veriler düşük yoğunlukta risk sinyali içeriyor.'
    if clinical_note or description:
        return 'Klinik notta belirgin yüksek risk sinyali saptanmadı; yorum yine de radyolojik bulgular ile birlikte yapılmalıdır.'
    return 'Analiz edilecek klinik not bulunamadı.'


def build_recommendation(risk_level, urgency):
    if urgency == 'expedited':
        return 'NLP analizi yakın takip veya ileri tanı ihtimalini destekliyor. Radyoloji ve klinik ekip birlikte değerlendirmelidir.'
    if urgency == 'follow_up':
        return 'NLP analizi kısa dönem takip gerektirebilecek sinyaller buldu. Klinik bağlam ile birlikte kontrol planlanabilir.'
    return 'NLP analizi belirgin yüksek risk sinyali bulmadı. Rutin klinik değerlendirme yeterli olabilir.'


def main():
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        raise ValueError('Expected JSON payload on stdin.')
    payload = json.loads(raw_input)

    clinical_note = normalize_text(payload.get('clinical_note') or payload.get('note'))
    description = normalize_text(payload.get('description'))
    nodules = payload.get('nodules') or []
    note_parts = [clinical_note, description]
    for nodule in nodules:
        note_parts.append(normalize_text(nodule.get('notes')))
        note_parts.append(normalize_text(nodule.get('doctorAssessment') or nodule.get('doctor_assessment')))
    combined_text = ' '.join(part for part in note_parts if part)
    sentences = split_sentences(combined_text)
    heuristic_entries, semantic_mode = build_signal_entries(sentences)
    finetuned_entries = predict_finetuned_signal_entries(combined_text)
    structured_entries = build_structured_signal_entries(payload.get('patient_age'), payload.get('patient_gender'))
    signal_entries = merge_signal_entries(heuristic_entries, finetuned_entries, structured_entries)
    risk_level, urgency = infer_risk_level(signal_entries, payload.get('patient_age'), nodules)
    mode = 'heuristic-fallback'
    if finetuned_entries and semantic_mode:
        mode = 'berturk-finetuned+semantic'
    elif finetuned_entries:
        mode = 'berturk-finetuned'
    elif semantic_mode:
        mode = 'berturk-semantic'
    output = {
        'model': FINETUNED_MODEL_DIR or MODEL_NAME,
        'mode': mode,
        'analyzedText': combined_text,
        'riskLevel': risk_level,
        'urgency': urgency,
        'signals': signal_entries,
        'riskSignals': [entry['label'] for entry in signal_entries],
        'summary': build_summary(signal_entries, risk_level, urgency, clinical_note, description),
        'recommendedAction': build_recommendation(risk_level, urgency),
        'metadata': {
            'sentenceCount': len(sentences),
            'noteLength': len(combined_text),
            'signalCount': len(signal_entries),
        },
    }
    sys.stdout.write(json.dumps(output, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        sys.stderr.write(str(exc))
        sys.exit(1)