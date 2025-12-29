<<<<<<< HEAD
# 🫁 AI-Supported Lung Nodule Detection System

Medikal görüntüleme üzerinde akciğer nodüllerinin tespiti ve sınıflandırması için yapay zeka destekli web uygulaması.

## 🚀 Özellikler

### ✅ Tamamlanan Özellikler

#### 1. Database Entegrasyonu
- **SQLite veritabanı** ile tam entegrasyon
- Otomatik tablo oluşturma ve ilişkilendirme
- 4 ana tablo: patients, studies, dicom_files, nodules
- REST API ile veri yönetimi

#### 2. DICOM Dosya Yönetimi
- **DICOM dosya yükleme** (NewStudy sayfası)
- Çoklu dosya desteği
- DICOM metadata otomatik parse
- Hasta bilgileri otomatik çekme
- Dosya bilgilerini database'e kaydetme

#### 3. Görüntü Gösterme (Review Sayfası)
- **Cornerstone.js** ile profesyonel DICOM görüntüleme
- Gerçek zamanlı görüntü render
- Mouse ile window/level ayarı
- Scroll ile zoom
- Görüntüler arası geçiş
- Viewport reset özelliği

#### 4. Kullanıcı Arayüzü
- Modern ve responsive tasarım
- Worklist entegrasyonu
- Hasta ve çalışma yönetimi
- AI analiz simülasyonu
- Progress tracking

## 🔧 Hızlı Başlangıç

### Gereksinimler
- Node.js (v16+)
- npm

### Kurulum ve Çalıştırma

**Windows için tek tıkla başlatma:**
```bash
start.bat
```

**Manuel başlatma:**
```bash
# Terminal 1 - Backend
cd backend
node server.js

# Terminal 2 - Frontend  
cd UI
npm run dev
```

**Tarayıcıda açın:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## 📖 Kullanım

### Yeni Çalışma Oluşturma
1. New Study sayfasına git
2. Hasta bilgilerini gir
3. DICOM dosyalarını yükle
4. AI analizi başlat
5. Review sayfasında sonuçları görüntüle

### DICOM Görüntüleme
- **Sol tıkla + sürükle**: Window/Level
- **Mouse wheel**: Zoom
- **Previous/Next**: Görüntü değiştir
- **Reset View**: Varsayılana dön

## 🛠️ Teknolojiler

**Backend:** Express.js, SQLite3, Multer, CORS
**Frontend:** React 19, Vite, Cornerstone.js, Axios, React Router

## 📁 Detaylı Dokümantasyon

Tüm API endpoints, database şeması ve detaylı kullanım bilgileri için [SETUP.md](SETUP.md) dosyasına bakın.

## 📝 Proje Ekibi

CENG 407-408 2025-2026 Proje Ekibi
=======
<img width="2816" height="1504" alt="LUNGXAİ LOGO" src="https://github.com/user-attachments/assets/31a38582-d823-4d31-a14e-3df083df65ea" /># ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging
AI-Supported Lung Nodule Detection and Classification Using Medical Imaging



---
![Uploading LUNGXAİ LOGO.png…]()

## Repository Structure

```
UI/                    # Frontend interface
models/                # Machine Learning components
└── lung25demo/         # ML pipeline (submodule)
.gitmodules             # Git submodule configuration
Literature Review.docx
README.md
package.json
```

> ⚠️ The `models/lung25demo` directory is a **Git submodule** and must be initialized after cloning.

---

## Clone (First Time)

Recommended way (clone repository **with submodules**):

```bash
git clone --recurse-submodules https://github.com/CankayaUniversity/ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging.git
```

---

## If You Already Cloned the Repository

If the `models/lung25demo` folder is empty or missing:

```bash
git submodule update --init --recursive
```

---

## Pulling Updates

When you pull new changes from the main repository (or switch branches):

```bash
git pull
git submodule update --init --recursive
```

This ensures that submodules are synced to the commit referenced by the main repository.

---

## Submodule Notes

- `models/lung25demo` is managed as a **submodule**.
- Do **not** manually copy files into or out of the submodule directory.
- If the submodule folder appears empty, initialize/update submodules using the commands above.

---

## Common Issues

### Submodule folder is empty

```bash
git submodule update --init --recursive
```

### After switching branches, submodule looks incorrect

```bash
git submodule update --init --recursive
```

### One-line update command

```bash
git pull && git submodule update --init --recursive
```

>>>>>>> 347c7f5b056eebac81e0d3716c7c1832d07789c7
