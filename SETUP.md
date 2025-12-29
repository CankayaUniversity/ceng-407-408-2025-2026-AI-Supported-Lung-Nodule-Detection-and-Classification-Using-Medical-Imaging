# Lung Nodule Detection System - Setup Guide

## Backend Setup

1. Backend sunucusunu başlatmak için:
```bash
cd backend
npm start
```

Backend sunucu http://localhost:3001 adresinde çalışacak.

## Frontend Setup

1. Frontend'i başlatmak için:
```bash
cd UI
npm run dev
```

Frontend http://localhost:5173 adresinde çalışacak.

## Özellikler

### ✅ Database Entegrasyonu
- SQLite veritabanı ile hasta, çalışma, DICOM dosyaları ve nodül bilgileri saklanıyor
- Otomatik tablo oluşturma ve ilişkilendirme

### ✅ DICOM Dosya Yükleme
- NewStudy sayfasından DICOM dosyaları yüklenebilir
- Dosya seçerken DICOM metadata otomatik olarak parse edilir
- Hasta bilgileri DICOM'dan otomatik çekilir
- Çoklu dosya yükleme desteği

### ✅ DICOM Görüntüleme
- Review sayfasında Cornerstone.js ile DICOM görüntüleri gösterilir
- Mouse ile window/level ayarı (sürükle)
- Mouse wheel ile zoom
- Görüntüler arası geçiş (Previous/Next)
- Reset view butonu

### 📁 Database Tabloları

#### patients
- patient_id, name, age, gender, created_at

#### studies  
- study_id, patient_id, study_date, description, nodule_count, status

#### dicom_files
- study_id, file_path, file_name, instance_number

#### nodules
- study_id, nodule_number, location, size_mm, risk_level, coordinates

## API Endpoints

### Patient APIs
- POST /api/patients - Yeni hasta oluştur
- GET /api/patients - Tüm hastaları listele
- GET /api/patients/:patientId - Hasta detayı

### Study APIs
- POST /api/studies - Yeni çalışma oluştur
- GET /api/studies - Tüm çalışmaları listele
- GET /api/studies/:studyId - Çalışma detayı
- PUT /api/studies/:studyId/status - Çalışma durumunu güncelle

### DICOM APIs
- POST /api/upload-dicom - DICOM dosyaları yükle
- GET /api/studies/:studyId/dicom-files - Çalışmanın DICOM dosyalarını listele

### Nodule APIs
- POST /api/nodules - Yeni nodül kaydet
- GET /api/studies/:studyId/nodules - Çalışmanın nodüllerini listele

## Kullanım

1. **Yeni Çalışma Oluştur:**
   - New Study sayfasına git
   - Hasta bilgilerini gir
   - "Choose DICOM Files" ile DICOM dosyalarını seç
   - "Start AI Analysis" ile analizi başlat
   - "View Results in Review" ile sonuçları görüntüle

2. **Görüntüleri İncele:**
   - Review sayfasında DICOM görüntüleri otomatik yüklenir
   - Previous/Next ile görüntüler arası geçiş yap
   - Mouse ile window/level ayarla
   - Scroll ile zoom yap

## Teknolojiler

### Backend
- Express.js - Web framework
- SQLite - Veritabanı
- Multer - Dosya yükleme
- CORS - Cross-origin support

### Frontend
- React - UI framework
- Vite - Build tool
- Cornerstone.js - DICOM görüntüleme
- Axios - HTTP client
- React Router - Routing
