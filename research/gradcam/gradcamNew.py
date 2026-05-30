import torch
import numpy as np
import matplotlib.pyplot as plt
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget
from matplotlib.widgets import Slider
from monai.networks.nets import SegResNet
from pytorch_grad_cam import GradCAMPlusPlus
from pydrive2.auth import GoogleAuth
from pydrive2.drive import GoogleDrive
from io import BytesIO
import zipfile
import requests
import tempfile
import os
import pydicom
import cv2

pat_id = "1"
pat_id = pat_id.zfill(4)

# PyDrive2 kimlik doğrulama (settings.yaml ile otomatik yapılandırma)
gauth = GoogleAuth()
if gauth.credentials and not gauth.access_token_expired:
    print("Kaydedilmiş credentials kullanılıyor...")
else:
    print("Yeni giriş yapılıyor...")
    gauth.LocalWebserverAuth()

drive = GoogleDrive(gauth)

def download_drive_file_bytes_gdown(file_id):
    """gdown ile daha stabil indirme - sahibi siz olmasanız bile çalışır."""
    from io import BytesIO
    import gdown
    
    url = f"https://drive.google.com/uc?id={file_id}"
    buffer = BytesIO()
    
    # fuzzy=True: ID'den direkt indirmeyi dener
    # quiet=False: ilerlemeyi gösterir
    gdown.download(url, output=buffer, fuzzy=True, quiet=False)
    
    buffer.seek(0)
    return buffer

from typing import Optional
def find_file_by_path(root_id: str, breadcrumb: list) -> Optional[str]:
    """breadcrumb = ['LIDC-IDRI-0001','01-01-2000'] gibi. Son öge dosya adı."""
    current_id = root_id
    for idx, name in enumerate(breadcrumb):
        q = f"'{current_id}' in parents and trashed=false and title='{name}'"
        candidates = drive.ListFile({'q': q}).GetList()
        if not candidates:
            return None
        current_id = candidates[0]['id']
    return current_id

def find_zip(root_id, breadcrumb):
    return find_file_by_path(root_id, breadcrumb)  # aynı mantık

def get_gradcam_for_volume(model, volume, cam_engine):
    """
    volume: (S, H, W)  S=slice saysı
    cam_engine: GradCAMPlusPlus vb nes
    return: (S, H, W) CAM heat
    """
    model.eval()
    S, H, W = volume.shape
    cam_vol = np.zeros_like(volume)

    target = SemanticSegmentationTarget(category=0, mask=None)  # tek sınıf

    for s in range(S):
        sl = volume[s:s + 1, :, :]               # (1,H,W)
        sl = sl[None, None, :, :]                # (1,1,H,W)
        tensor = torch.from_numpy(sl).float()

        cam_map = cam_engine(input_tensor=tensor, targets=[target])[0]  # (H,W)
        cam_vol[s] = cam_map
    return cam_vol

def build_segresnet_model():
    model = SegResNet(
        spatial_dims=2,
        init_filters=8,
        in_channels=5,
        out_channels=1,
        blocks_down=(1, 2, 2, 4),
        blocks_up=(1, 1, 1),
        use_conv_final=True,
    )

    ckpt = torch.load("segresnet_25d_best.pt", map_location="cpu", weights_only=True)
    if isinstance(ckpt, dict):
        if "model_state_dict" in ckpt:
            state_dict = ckpt["model_state_dict"]
        elif "state_dict" in ckpt:
            state_dict = ckpt["state_dict"]
        else:
            state_dict = ckpt
    else:
        state_dict = ckpt

    if any(k.startswith("module.") for k in state_dict.keys()):
        state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}

    model.load_state_dict(state_dict)
    model.eval()
    return model

def preprocess_image_slice(img: np.ndarray, size=(224, 224)) -> np.ndarray:
    """Akciğer CT için tipik pencere: –1000…400 HU, sonra 0-1 ve resize."""
    
    # 🔧 Çok kanallı ise ilk kanalı al
    if img.ndim == 3:
        img = img[:, :, 0]  # Veya ortalaması: img.mean(axis=2)
    
    img = np.clip(img, -1000, 400)
    img = (img + 1000) / 1400          # 0-1 aralığına normalize
    img = cv2.resize(img, size)
    return img.astype(np.float32)

def load_dicom_volume_from_zip(zip_bytes: BytesIO) -> np.ndarray:
    """Zip içindeki *.dcm'leri InstanceNumber veya ImagePositionPatient'a göre sıralayıp 3D volume yapar."""
    import pydicom
    slices = []
    
    with zipfile.ZipFile(zip_bytes) as zf:
        dcm_names = zf.namelist()
        
        for nm in dcm_names:
            if nm.lower().endswith('.dcm'):
                with zf.open(nm) as dcm_io:
                    ds = pydicom.dcmread(dcm_io)
                    pixel_array = ds.pixel_array.astype(np.float32)
                    
                    # 🔧 HU dönüşümü (varsa)
                    if hasattr(ds, 'RescaleSlope') and hasattr(ds, 'RescaleIntercept'):
                        pixel_array = pixel_array * ds.RescaleSlope + ds.RescaleIntercept
                    
                    # 🔑 Kritik: Sıralama için metadata ekle
                    slice_info = {
                        'array': pixel_array,
                        'instance_number': getattr(ds, 'InstanceNumber', 0),
                        'z_pos': getattr(ds, 'ImagePositionPatient', [0, 0, 0])[2] if hasattr(ds, 'ImagePositionPatient') else 0
                    }
                    slices.append(slice_info)
    
    # 🎯 Önce ImagePositionPatient (z koordinatı), yoksa InstanceNumber'a göre sırala
    if slices and slices[0]['z_pos'] != 0:
        slices.sort(key=lambda x: x['z_pos'])  # ✅ En güvenilir: anatomik Z pozisyonu
    else:
        slices.sort(key=lambda x: x['instance_number'])  # ✅ Fallback: InstanceNumber
    
    # Sadece array'leri çıkar
    volume = np.stack([s['array'] for s in slices])
    return volume

def download_drive_file_bytes(file_id):
    """file_id ile Drive’dan raw byte dizisini döndürür."""
    from io import BytesIO
    from pydrive2.files import GoogleDriveFile
    gfile: GoogleDriveFile = drive.CreateFile({'id': file_id})
    gfile.GetContentFile('tmp', mimetype=None)  # tmp disk’e
    with open('tmp', 'rb') as f:
        data = f.read()
    os.remove('tmp')
    return data

def load_npz_slice(npz_bytes):
    with np.load(npz_bytes) as data:
        raw_im = data['images']  # (Z,Y,X,?) or (Z,Y,X)
        raw_mk = data['masks']  # aynı şekil

        if raw_im.ndim == 4:                       # (Z,Y,X,Ch)
            im = raw_im[raw_im.shape[0]//2, :, :, 0]
        else:                                        # (Z,Y,X)
            im = raw_im[raw_im.shape[0]//2]
        if raw_mk.ndim == 4:
            mk = raw_mk[raw_mk.shape[0]//2, :, :, 0]
        else:
            mk = raw_mk[raw_mk.shape[0]//2]

        im = cv2.resize(im, (224, 224))
        mk = cv2.resize(mk, (224, 224), interpolation=cv2.INTER_NEAREST)
        return im.astype(np.float32), (mk > 0.5).astype(np.uint8)

def get_first_zip_in_folder(folder_id):
    """Verilen klasör ID'si içindeki ilk .zip dosyasının ID ve adını döndürür."""
    query = f"'{folder_id}' in parents and trashed=false"
    file_list = drive.ListFile({'q': query}).GetList()
    
    for f in file_list:
        mime = f.get('mimeType', '')
        title = f.get('title', '').lower()
        # Hem MIME type hem de uzantı kontrolü yapıyoruz
        if mime == 'application/zip' or title.endswith('.zip'):
            return f['id'], f['title']
            
    return None, None

class MultiSliceSegmentationTarget:
    def __init__(self, category=0):
        self.category = category

    def __call__(self, model_output):
        target = model_output[0, self.category, :, :]
        return torch.sum(torch.relu(target))

class SemanticSegmentationTarget:
    def __init__(self, category, mask):
        self.category = category
        # Maskeyi numpy'dan torch tensörüne çeviriyoruz
        if isinstance(mask, np.ndarray):
            self.mask = torch.from_numpy(mask).float()
        else:
            self.mask = mask

    def __call__(self, model_output):
        # Batch indeksi (0) kaldırılmış hali doğruydu
        target = model_output[self.category, :, :]
        
        # Cihaz uyumu (GPU kullanıyorsan maskeyi oraya taşır, CPU ise aynı kalır)
        if self.mask.device != target.device:
            self.mask = self.mask.to(target.device)
            
        # İşlem artık iki tensör arasında olduğu için hata vermez
        return (target * self.mask).sum()

def calculate_patient_accuracy_2d(images_vol, masks_vol, model, device="cpu"):
    # 🔍 Giriş şekillerini kontrol et
    assert images_vol.ndim == 3, f"images_vol 3D olmalı, alındı: {images_vol.shape}"
    assert masks_vol.ndim == 3, f"masks_vol 3D olmalı, alındı: {masks_vol.shape}"
    
    model.to(device).eval()
    dices = []
    with torch.no_grad():
        for s in range(images_vol.shape[0]):
            im = images_vol[s]                      # (H, W)
            mk = masks_vol[s]
            
            # 2.5-D: 5 komşu kesiti stack'le
            stack = []
            for d in range(-2, 3):
                z = max(0, min(s + d, images_vol.shape[0]-1))
                stack.append(images_vol[z])
            
            # ✅ Optimize edilmiş tensor oluşturma
            x = np.array(stack, dtype=np.float32)   # (5, H, W)
            x = torch.from_numpy(x).unsqueeze(0)    # (1, 5, H, W)
            
            pred = torch.sigmoid(model(x.to(device)))
            pred = (pred.cpu().numpy() > 0.5).astype(np.uint8)
            dice = 2*(pred*mk).sum() / (pred.sum() + mk.sum() + 1e-7)
            dices.append(dice)
    return np.mean(dices)

def build_25d_tensor(center_slice: int, volume: np.ndarray, radius: int = 2):
    """
    volume: (S, H, W)
    return: (5, H, W)
    """
    S = volume.shape[0]
    idxs = [max(0, center_slice + d) for d in range(-radius, radius+1)]
    idxs = [min(i, S-1) for i in idxs]
    return torch.from_numpy(volume[idxs]).float()       # (5, H, W)

def apply_mask(cam_map, thresh=0.25):
    cam_norm = (cam_map - cam_map.min()) / (cam_map.ptp() + 1e-8)
    cam_norm[cam_norm < thresh] = np.nan
    return cam_norm

model = build_segresnet_model()

root_folder_id_dcm = '1DQ4yhUCmav-iHT2QRbLslg3Hoz_86LJK'
path_dcm = [f"LIDC-IDRI-{pat_id}", "01-01-2000"]
root_folder_id_npz = "1q0pLM_HLT1lZgzy0Vllkc3S4bfcst5TV"
path_npz = [f"LIDC-IDRI-{pat_id}", f"LIDC-IDRI-{pat_id}_data.npz"]

# =============================================================================
# 📦 DOSYA BULMA & İNDİRME (TEMİZ VERSİYON - TÜM HATALAR DÜZELTİLDİ)
# =============================================================================

print(f"🔍 NPZ dosyası aranıyor: {'/'.join(path_npz)}")
npz_id = find_file_by_path(root_folder_id_npz, path_npz)

print(f"🔍 DICOM klasörü aranıyor: {'/'.join(path_dcm)}")
dcm_folder_id = find_file_by_path(root_folder_id_dcm, path_dcm)

if npz_id is None or dcm_folder_id is None:
    print("❌ NPZ veya DICOM klasörü bulunamadı!")
    exit(1)

# 🔑 KRİTİK: Klasör içindeki ilk .zip dosyasını bul
print(f"📂 '{path_dcm[-1]}' klasöründe ZIP aranıyor...")
dcm_id, zip_name = get_first_zip_in_folder(dcm_folder_id)

if dcm_id is None:
    print("❌ Klasörde .zip dosyası bulunamadı! İçerik:")
    for f in drive.ListFile({'q': f"'{dcm_folder_id}' in parents and trashed=false"}).GetList():
        print(f"  • {f['title']} | {f['mimeType']}")
    exit(1)

print(f"✅ Bulundu: NPZ={npz_id} | ZIP={dcm_id} ({zip_name})")

# ---------------- NPZ İNDİRME ----------------
npz_url = f"https://drive.google.com/uc?id={npz_id}&export=download"
print("📥 NPZ indiriliyor...")
resp = requests.get(npz_url)
if resp.status_code != 200:
    raise RuntimeError(f"NPZ indirilemedi: {resp.status_code}")
npz_buffer = BytesIO(resp.content)

print("📊 NPZ yükleniyor...")
with np.load(npz_buffer) as data:
    all_images = data['images'] if 'images' in data else data['arr_0']
    all_masks = data['masks'] if 'masks' in data else data['arr_1']
    
    # 🔍 DEBUG: Şekilleri yazdır
    print(f"🔍 all_images shape: {all_images.shape}")
    print(f"🔍 all_masks shape: {all_masks.shape}")
    print(f"🔍 all_images.ndim: {all_images.ndim}")

all_images_resized = np.stack([preprocess_image_slice(img) for img in all_images])
all_masks_resized = np.stack([
    cv2.resize(m.astype(np.float32), (224, 224), interpolation=cv2.INTER_NEAREST) 
    for m in all_masks
])
npz_buffer.close()
del npz_buffer

# ---------------- DICOM ZIP İNDİRME (KRİTİK DÜZELTME) ----------------
print("📥 DICOM ZIP indiriliyor...")
dcm_buffer = download_drive_file_bytes_gdown(dcm_id)  # ✅ requests tabanlı fonksiyon

# 🔍 ZIP geçerli mi kontrol et (debug için)
import zipfile
try:
    zipfile.ZipFile(dcm_buffer).namelist()
    print("✅ ZIP dosyası geçerli")
except zipfile.BadZipFile:
    # Buffer'ı sıfırla ve içeriği yazdır
    dcm_buffer.seek(0)
    sample = dcm_buffer.read(200)
    print(f"❌ ZIP değil! İlk 200 byte: {sample[:100]}")
    raise

dcm_buffer.seek(0)  # 🔁 ZipFile okuması için başa sar

print("🏗️ DICOM volume oluşturuluyor...")
select_dcm_vol = load_dicom_volume_from_zip(dcm_buffer)
dcm_buffer.close()
del dcm_buffer  # ⚠️ Artık kullanılmayacak

# =============================================================================
# 🎯 SKOR HESAPLAMA & GÖRSELLEŞTİRME
# =============================================================================

patient_score = calculate_patient_accuracy_2d(all_images_resized, all_masks_resized, model)
accuracy_percentage = patient_score * 100
print(f"📈 Hasta Dice Skoru: %{accuracy_percentage:.2f}")

# ⚠️ DİKKAT: select_dcm_vol zaten yüklendi, tekrar indirme YAPMA
dicom_vol = select_dcm_vol  # ✅ Doğru kullanım
num_slices = dicom_vol.shape[0]

class LungNoduleTarget:
    def __call__(self, out):
        return out[0, 0].sum()
class MultiChannelTarget:
    def __init__(self, category=0):
        self.category = category
    def __call__(self, model_output):
        return model_output[0, self.category].sum()   # (1,1,H,W)
target_layers = [model.conv_final]      # SegResNet son katmanı
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
cam = GradCAMPlusPlus(model=model, target_layers=target_layers)
cam_25d = np.zeros_like(dicom_vol)      # (S, H, W)
for s in range(dicom_vol.shape[0]):
    t = build_25d_tensor(s, dicom_vol).unsqueeze(0)   # (1, 5, H, W)
    heat = cam(input_tensor=t.to(device), targets=[MultiChannelTarget()])[0] # (H, W)
    cam_25d[s] = heat

# Görselleştirme
fig, axes = plt.subplots(1, 2, figsize=(14, 7))
plt.subplots_adjust(bottom=0.2, top=0.85)
fig.patch.set_facecolor('#FFFFFF')
fig.suptitle(f"Hasta ID: [{pat_id}] | Dice: %{accuracy_percentage:.2f}",
             color='#00FFCC', fontsize=16, fontweight='bold')
ax_orig, ax_cam = axes
im_orig = ax_orig.imshow(dicom_vol[0], cmap='gray')
ax_orig.set_title("Orijinal DICOM", color='black', fontsize=12)
ax_orig.axis('off')
im_under = ax_cam.imshow(dicom_vol[0], cmap='gray')
# ⬅️ burası eski "select_cam_vol" yerine cam_25d !
im_heat  = ax_cam.imshow(cam_25d[0], cmap='viridis', alpha=0.8)
ax_cam.set_title("Kritik Odaklar – Grad-CAM++ (Kesit: 1)", fontsize=12)
ax_cam.axis('off')
ax_slider = plt.axes([0.25, 0.05, 0.5, 0.03], facecolor='#333333')
slider = Slider(ax_slider, 'Kesit', 0, num_slices - 1,
                valinit=0, valfmt='%d', color='#00FFCC')
def update(val):
    idx = int(slider.val)
    im_orig.set_data(dicom_vol[idx])
    im_under.set_data(dicom_vol[idx])
    im_heat.set_data(cam_25d[idx])           # ⬅️ cam_25d
    ax_cam.set_title(f"Kritik Odaklar – Grad-CAM++ (Kesit: {idx+1})")
    fig.canvas.draw_idle()
slider.on_changed(update)
plt.show()
