# 🧪 Test Senaryoları ve Kullanım Rehberi

## Sistem Testi

### 1. Backend Sunucu Testi

```bash
# Backend çalıştığını kontrol et
curl http://localhost:3001/api/health

# Beklenen cevap:
# {"status":"ok","message":"Server is running"}
```

### 2. Frontend Erişim Testi

Tarayıcıda `http://localhost:5173` adresine git ve aşağıdaki sayfaların yüklendiğini kontrol et:
- ✅ Dashboard
- ✅ New Study
- ✅ WorkList
- ✅ Review

## Test Senaryosu 1: Yeni Hasta ve Çalışma Oluşturma

### Adımlar:

1. **New Study sayfasına git**
   - Sol menüden "New Study" tıkla

2. **Hasta bilgilerini gir:**
   ```
   Patient ID: P12345
   Name Surname: John Doe
   Age: 65
   Gender: M
   Clinical Note: Routine chest CT scan
   ```

3. **DICOM dosyalarını yükle:**
   - "Choose DICOM Files" butonuna tıkla
   - DICOM dosyaları seç (.dcm veya .dicom uzantılı)
   - Dosya sayısı göstergesini kontrol et: "X files selected"

4. **AI Analizi başlat:**
   - "Start AI Analysis" butonuna tıkla
   - Progress bar'ın ilerlemesini izle
   - %100 olduğunda "View Results in Review" butonu görünmeli

5. **Review sayfasına geç:**
   - "View Results in Review" butonuna tıkla
   - Otomatik olarak Review sayfasına yönlendirilmelisin

### Beklenen Sonuçlar:
- ✅ Hasta bilgileri database'e kaydedildi
- ✅ Çalışma oluşturuldu
- ✅ DICOM dosyaları yüklendi
- ✅ Review sayfasında görüntüler gösteriliyor

## Test Senaryosu 2: DICOM Görüntüleme

### Review Sayfasında:

#### Sol Panel Kontrolleri:
- ✅ Patient ID görüntüleniyor
- ✅ Age görüntüleniyor
- ✅ Gender görüntüleniyor
- ✅ Total nodules sayısı görüntüleniyor
- ✅ Images sayısı DICOM dosya sayısıyla eşleşiyor

#### Orta Panel - DICOM Viewer Kontrolleri:

1. **Görüntü Yükleme:**
   - ✅ DICOM görüntüsü siyah arka planda render ediliyor
   - ✅ Görüntü net ve okunaklı

2. **Mouse Kontrolleri:**
   ```
   Test 1: Window/Level Ayarı
   - Sol tıkla ve fareyi hareket ettir
   - Görüntünün parlaklık/kontrast değişmeli
   
   Test 2: Zoom
   - Mouse wheel'i yukarı çevir → Zoom in
   - Mouse wheel'i aşağı çevir → Zoom out
   ```

3. **Navigasyon Kontrolleri:**
   ```
   Test 3: Görüntü Geçişi
   - "Next →" butonuna tıkla
   - Bir sonraki DICOM slice görünmeli
   - Sayaç artmalı (örn: 2/10)
   
   Test 4: Geri Gitme
   - "← Previous" butonuna tıkla
   - Bir önceki slice görünmeli
   - Sayaç azalmalı
   ```

4. **View Kontrolleri:**
   ```
   Test 5: Reset View
   - Zoom ve pan yap
   - "Reset View" butonuna tıkla
   - Görüntü varsayılan konumuna dönmeli
   ```

5. **Toggle Butonları:**
   ```
   Test 6: Segmentation
   - "Segmentation" butonuna tıkla
   - Buton mavi renge dönmeli (aktif)
   - Tekrar tıkla → Deaktif
   
   Test 7: Heatmap
   - "Heatmap" butonuna tıkla
   - Buton mavi renge dönmeli (aktif)
   - Tekrar tıkla → Deaktif
   ```

#### Sağ Panel Kontrolleri:
- ✅ Nodül listesi görüntüleniyor
- ✅ Her nodül için detay bilgiler var
- ✅ Form alanları doldurulabilir

## Test Senaryosu 3: WorkList Filtreleme

### WorkList Sayfasında:

1. **Tüm Çalışmaları Görüntüle:**
   - WorkList sayfasına git
   - Database'den ve mock data'dan tüm çalışmalar listelenmeli

2. **Priority Filter Testi:**
   ```
   Test 1: High Risk filtresi
   - "High Risk" butonuna tıkla
   - Sadece 3+ nodül içeren çalışmalar görünmeli
   
   Test 2: Medium Risk filtresi
   - "Medium Risk" butonuna tıkla
   - Sadece 2 nodül içeren çalışmalar görünmeli
   
   Test 3: Low Risk filtresi
   - "Low Risk" butonuna tıkla
   - Sadece 0-1 nodül içeren çalışmalar görünmeli
   ```

3. **Search Testi:**
   ```
   Test 4: İsim ile arama
   - Search box'a hasta adı yaz
   - Sonuçlar filtrelenmeli
   
   Test 5: ID ile arama
   - Search box'a patient ID yaz
   - İlgili hasta görünmeli
   ```

4. **Status Filter Testi:**
   ```
   Test 6: AI Results Ready filtresi
   - "Show only studies with AI results ready" checkbox'ını işaretle
   - Sadece completed status'lu çalışmalar görünmeli
   ```

5. **Review Buton Testi:**
   ```
   Test 7: Review'a geçiş
   - Herhangi bir çalışmanın "Review" butonuna tıkla
   - Review sayfasına yönlendirilmelisin
   - Doğru çalışma ID'si yüklenmeli
   ```

## Test Senaryosu 4: API Endpoint Testleri

### Postman veya cURL ile test:

#### 1. Patient Oluşturma:
```bash
curl -X POST http://localhost:3001/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "TEST001",
    "name": "Test Patient",
    "age": 55,
    "gender": "F"
  }'
```

**Beklenen:** `{"success":true,"id":1}`

#### 2. Study Oluşturma:
```bash
curl -X POST http://localhost:3001/api/studies \
  -H "Content-Type: application/json" \
  -d '{
    "study_id": "STD-TEST-001",
    "patient_id": "TEST001",
    "study_date": "2025-12-29",
    "description": "Test CT scan"
  }'
```

**Beklenen:** `{"success":true,"id":1}`

#### 3. Tüm Çalışmaları Listeleme:
```bash
curl http://localhost:3001/api/studies
```

**Beklenen:** JSON array with all studies

#### 4. Belirli Çalışma Detayı:
```bash
curl http://localhost:3001/api/studies/STD-TEST-001
```

**Beklenen:** Study object with DICOM files and nodules

## Test Senaryosu 5: Database Kontrolleri

### SQLite Database Testi:

```bash
# Backend dizininde
cd backend
sqlite3 lung_nodule.db

# Test queries:
.tables
# Beklenen: patients, studies, dicom_files, nodules

SELECT * FROM patients LIMIT 5;
SELECT * FROM studies LIMIT 5;
SELECT * FROM dicom_files LIMIT 5;

.quit
```

## Bilinen Sınırlamalar ve Geçici Çözümler

### 1. DICOM Dosya Formatı
**Sorun:** Sadece .dcm ve .dicom uzantılı dosyalar yüklenebilir
**Çözüm:** Dosya uzantısını kontrol et ve gerekirse yeniden adlandır

### 2. Cornerstone.js Web Worker
**Sorun:** İlk DICOM render'da gecikme olabilir
**Çözüm:** Web worker'ların başlatılması için birkaç saniye bekle

### 3. CORS (Production)
**Sorun:** Şu an tüm origin'ler için açık
**Çözüm:** Production'da backend/server.js'de CORS ayarlarını kısıtla

### 4. Mock Data
**Sorun:** WorkList'te hem database hem mock data görünüyor
**Çözüm:** İstersen mockStudies.js'i boşalt veya kaldır

## Debug İpuçları

### Frontend Console Kontrolleri:
```javascript
// Browser console'da:
localStorage.clear();  // Cache temizle
location.reload();     // Sayfayı yenile
```

### Backend Log Kontrolleri:
```bash
# Terminal'de backend loglarını izle
# Her request için log göreceksin:
# POST /api/patients
# GET /api/studies
# etc.
```

### DICOM Yükleme Hatası:
```javascript
// Browser console'da hata varsa:
// "Failed to load DICOM image"
// → Backend uploads klasörünü kontrol et
// → Dosya yolu doğru mu?
// → http://localhost:3001/uploads/... erişilebilir mi?
```

## Başarılı Test Kriterleri

### ✅ Sistem Tamamen Çalışıyor:
- [ ] Backend sunucu çalışıyor (http://localhost:3001)
- [ ] Frontend çalışıyor (http://localhost:5173)
- [ ] Database oluşturuldu (lung_nodule.db)
- [ ] Tüm sayfalar yükleniyor
- [ ] DICOM dosyaları yüklenebiliyor
- [ ] Görüntüler Review sayfasında gösteriliyor
- [ ] Mouse kontrolleri çalışıyor
- [ ] Navigasyon düğmeleri çalışıyor
- [ ] Filtreler çalışıyor
- [ ] API endpoint'ler yanıt veriyor

## Sorun Giderme

### Problem: Backend başlamıyor
```bash
# Çözüm:
cd backend
rm -f lung_nodule.db  # Database'i sil
npm install           # Bağımlılıkları yeniden yükle
node server.js        # Tekrar başlat
```

### Problem: DICOM görüntüler gösterilmiyor
```bash
# Kontrol listesi:
1. Backend çalışıyor mu?
2. DICOM dosyaları backend/uploads/ klasöründe mi?
3. Browser console'da hata var mı?
4. Network tab'de 404 hatası var mı?
```

### Problem: "Module not found" hatası
```bash
# Frontend'te:
cd UI
rm -rf node_modules
npm install

# Backend'te:
cd backend
rm -rf node_modules
npm install
```

## İletişim ve Destek

Test sırasında sorun yaşarsanız:
1. Browser console loglarını kontrol edin
2. Backend terminal loglarını kontrol edin
3. Database'i kontrol edin
4. Bu dokümandaki sorun giderme adımlarını takip edin

---

**Başarılı testler dileriz! 🚀**
