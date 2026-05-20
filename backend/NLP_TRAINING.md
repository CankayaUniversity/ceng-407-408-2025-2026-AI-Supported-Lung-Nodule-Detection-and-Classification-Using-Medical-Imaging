## BERTurk Fine-Tuning

Bu proje artik klinik notlar icin gercek bir BERTurk multi-label fine-tuning hatti icerir.

`backend/data/nlp_dataset_seed.jsonl` dosyasi, sohbette paylastigin risk faktor notlarindan turetilmis tek parca baslangic veri setidir. Train/validation ayirimi script tarafinda otomatik yapilabilir; gercek performans icin daha fazla etiketli not eklenmelidir.

### Beklenen veri formati

Her satir bir JSON nesnesi olan `jsonl` dosyasi kullanin.

```json
{"text":"67 yaş erkek hasta. KOAH ve sigara öyküsü var.","labels":{"smoking_history":1,"copd":1,"age_gender_risk":1}}
{"clinical_note":"Ailede akciğer kanseri öyküsü var. Radon maruziyeti mevcut.","description":"Toraks BT kontrol","positive_labels":["family_history","environmental_exposure"]}
```

Desteklenen etiketler:

- `smoking_history`
- `family_history`
- `prior_cancer_history`
- `copd`
- `age_gender_risk`
- `obesity_metabolic`
- `infection_history`
- `environmental_exposure`
- `occupational_exposure_lung_disease`
- `systemic_symptoms`

### Egitim komutu

```powershell
cd backend
python train_berturk_multilabel.py --train-file data\nlp_dataset_seed.jsonl --output-dir models\berturk-risk-multilabel --epochs 4 --batch-size 4
```

Isterseniz ayri dogrulama dosyasi verebilirsiniz:

```powershell
python train_berturk_multilabel.py --train-file data\nlp_train.jsonl --val-file data\nlp_val.jsonl --output-dir models\berturk-risk-multilabel
```

### Inference entegrasyonu

Fine-tuned modeli backend analizinde kullanmak icin `.env` icine sunu ekleyin:

```env
BERTURK_FINETUNED_MODEL_DIR=backend/models/berturk-risk-multilabel
```

Bu checkpoint varsa `backend/nlp_analysis.py` heuristik sinyallere ek olarak fine-tuned classifier ciktilarini da kullanir.