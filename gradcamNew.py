import torch
import numpy as np
import matplotlib.pyplot as plt
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

pat_id = "14"
pat_id = pat_id.zfill(4)

# PyDrive2 kimlik doğrulama (settings.yaml ile otomatik yapılandırma)
gauth = GoogleAuth()
if gauth.credentials and not gauth.access_token_expired:
    print("Kaydedilmiş credentials kullanılıyor...")
else:
    print("Yeni giriş yapılıyor...")
    gauth.LocalWebserverAuth()

drive = GoogleDrive(gauth)


def find_file_by_path(root_folder_id, path_list):
    current_parent_id = root_folder_id
    for item_name in path_list[:-1]:
        query = f"'{current_parent_id}' in parents and title = '{item_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed=false"
        file_list = drive.ListFile({'q': query}).GetList()
        if not file_list:
            return None
        current_parent_id = file_list[0]['id']

    file_name = path_list[-1]
    query = f"'{current_parent_id}' in parents and title = '{file_name}' and trashed=false"
    file_list = drive.ListFile({'q': query}).GetList()
    return file_list[0]['id'] if file_list else None


def find_zip(root_folder_id, path_list):
    current_parent_id = root_folder_id
    for item_name in path_list:
        query = f"'{current_parent_id}' in parents and title = '{item_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed=false"
        file_list = drive.ListFile({'q': query}).GetList()
        if not file_list:
            return None
        current_parent_id = file_list[0]['id']

    # Hedef klasördeki ilk ZIP dosyasını al.
    query = f"'{current_parent_id}' in parents and (mimeType = 'application/zip' or mimeType = 'application/x-zip-compressed') and trashed=false"
    file_list = drive.ListFile({'q': query, 'maxResults': 1}).GetList()
    return file_list[0]['id'] if file_list else None

def load_dicom_volume_from_zip(zip_bytes):
    """ZIP içindeki tüm DICOM'ları okur ve 3B hacim olarak döner."""
    zip_bytes.seek(0)
    slices = []
    with zipfile.ZipFile(zip_bytes) as z:
        dcm_files = [f for f in z.namelist() if f.lower().endswith('.dcm')]
        for f in dcm_files:
            with z.open(f) as dcm_file:
                ds = pydicom.dcmread(BytesIO(dcm_file.read()))
                slices.append(ds)
    
    # Kesitleri fiziksel sıralarına göre diz
    slices.sort(key=lambda x: int(x.InstanceNumber))
    
    # Pikselleri al ve ön işlemeden geçir
    full_volume = np.stack([preprocess_image_slice(s.pixel_array) for s in slices])
    return full_volume

def get_gradcam_for_volume(model, volume, cam_engine):
    num_slices = volume.shape[0]
    gradcam_results = []
    
    # 2.5D giriş için padding
    padded_vol = np.pad(volume, ((2, 2), (0, 0), (0, 0)), mode='edge')
    
    # Genel bir hedef maskesi (Tüm kesiti kapsayan 1'ler matrisi)
    # Bu, kütüphaneye "bu haritadaki tüm değerlerin toplamını skor olarak al" der.
    full_mask = np.ones((224, 224), dtype=np.float32)
    # Senin modelinde out_channels=1 olduğu için category=0'dır.
    target = [SemanticSegmentationTarget(category=0, mask=full_mask)]

    print("Grad-CAM haritaları hesaplanıyor, lütfen bekleyin...")
    for i in range(num_slices):
        input_5_slices = padded_vol[i : i+5] 
        input_tensor = torch.from_numpy(input_5_slices).float().unsqueeze(0)
        
        # targets=None yerine yukarıda oluşturduğumuz target listesini veriyoruz
        grayscale_cam = cam_engine(input_tensor=input_tensor, targets=target)[0]
        gradcam_results.append(grayscale_cam)
        
    return np.array(gradcam_results)

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

    ckpt = torch.load("segresnet_25d_best.pt", map_location="cpu")
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


def preprocess_image_slice(image, size=(224, 224)):
    if image.ndim == 3:
        image = image[image.shape[0] // 2]
    image = image.astype(np.float32)
    if image.max() != image.min():
        image = (image - image.min()) / (image.max() - image.min() + 1e-8)
    else:
        image = np.zeros_like(image)
    image = cv2.resize(image, size, interpolation=cv2.INTER_LINEAR)
    return image


def load_dicom_slice_from_zip(zip_bytes):
    zip_bytes.seek(0)
    if zipfile.is_zipfile(zip_bytes):
        zip_bytes.seek(0)
        with zipfile.ZipFile(zip_bytes) as z:
            dcm_files = [f for f in z.namelist() if f.lower().endswith('.dcm')]
            if not dcm_files:
                raise RuntimeError("ZIP içinde DICOM dosyası bulunamadı!")
            dcm_name = dcm_files[0]
            print(f"ZIP içinden ilk DICOM çıkarılıyor: {dcm_name}")
            with z.open(dcm_name) as dcm_file:
                dicom = pydicom.dcmread(BytesIO(dcm_file.read()))
    else:
        zip_bytes.seek(0)
        print("İndirilen içerik ZIP değil, doğrudan DICOM olarak okunuyor.")
        dicom = pydicom.dcmread(zip_bytes)

    image = dicom.pixel_array.astype(np.float32)
    return preprocess_image_slice(image)


def download_drive_file_bytes(file_id):
    dcm_file = drive.CreateFile({'id': file_id})
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        tmp_path = tmp.name
    try:
        dcm_file.GetContentFile(tmp_path)
        with open(tmp_path, 'rb') as f:
            return f.read()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def load_npz_slice(npz_bytes):
    with np.load(npz_bytes) as data:
        raw_image = data['images'] if 'images' in data else data['arr_0']
        raw_mask = data['masks'] if 'masks' in data else data['arr_1']

        if raw_image.ndim == 4:
            image_slice = raw_image[raw_image.shape[0] // 2, raw_image.shape[1] // 2]
        elif raw_image.ndim == 3:
            image_slice = raw_image[raw_image.shape[0] // 2]
        else:
            image_slice = raw_image

        if raw_mask.ndim == 3:
            mask_slice = raw_mask[raw_mask.shape[0] // 2]
        else:
            mask_slice = raw_mask

        image_slice = preprocess_image_slice(image_slice)
        mask_slice = cv2.resize(mask_slice.astype(np.float32), (224, 224), interpolation=cv2.INTER_NEAREST)
        mask_slice = (mask_slice > 0.5).astype(np.uint8)

    return image_slice, mask_slice


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

model = build_segresnet_model()

root_folder_id_dcm = '1DQ4yhUCmav-iHT2QRbLslg3Hoz_86LJK'
path_dcm = [f"LIDC-IDRI-{pat_id}", "01-01-2000"]
root_folder_id_npz = "1q0pLM_HLT1lZgzy0Vllkc3S4bfcst5TV"
path_npz = [f"LIDC-IDRI-{pat_id}", f"LIDC-IDRI-{pat_id}_data.npz"]

print(f"NPZ dosyası aranıyor: {'/'.join(path_npz)}")
npz_id = find_file_by_path(root_folder_id_npz, path_npz)
print(f"DICOM dosyası aranıyor: {'/'.join(path_dcm)}")
dcm_id = find_zip(root_folder_id_dcm, path_dcm)

if npz_id is None or dcm_id is None:
    print("NPZ veya DICOM dosyası bulunamadı!")
    print("Klasör yapısını kontrol edin...")
    query = f"'{root_folder_id_npz}' in parents and trashed=false"
    file_list = drive.ListFile({'q': query}).GetList()
    print("Ana klasördeki öğeler:")
    for file in file_list:
        file_type = "Klasör" if file['mimeType'] == 'application/vnd.google-apps.folder' else "Dosya"
        print(f"  - {file['title']} ({file_type})")
    exit(1)

print(f"Dosya bulundu! NPZ ID: {npz_id}, DICOM ZIP ID: {dcm_id}")

npz_url = f"https://drive.google.com/uc?id={npz_id}&export=download"
print("NPZ dosyası indiriliyor...")
response = requests.get(npz_url)
if response.status_code != 200:
    raise RuntimeError(f"NPZ indirilemedi: {response.status_code}")
selected_data_npz = BytesIO(response.content)

print("DICOM zip dosyası indiriliyor...")
selected_data_dcm = BytesIO(download_drive_file_bytes(dcm_id))

print("NPZ yükleniyor...")
npz_image, npz_mask = load_npz_slice(selected_data_npz)

print("DICOM Hacmi yükleniyor...")
dicom_vol = load_dicom_volume_from_zip(selected_data_dcm)
num_slices = dicom_vol.shape[0]

# Grad-CAM Hazırlığı
target_layers = [model.conv_final]
cam = GradCAMPlusPlus(model=model, target_layers=target_layers)
gradcam_vol = get_gradcam_for_volume(model, dicom_vol, cam)

# Görselleştirme
fig, axes = plt.subplots(1, 2, figsize=(14, 7))
plt.subplots_adjust(bottom=0.2) # Alttaki slider için boşluk bırakıyoruz

ax_orig = axes[0]
ax_cam = axes[1]

# 1. SOL TARAF: Orijinal DICOM
im_orig = ax_orig.imshow(dicom_vol[0], cmap='gray')
ax_orig.set_title("Orijinal DICOM Kesiti")
ax_orig.axis('off')

# 2. SAĞ TARAF: DICOM + Grad-CAM Overlay
# Altta orijinal görüntüyü, üstte ise %40 şeffaflıkla (alpha) ısı haritasını gösteriyoruz
im_underlay = ax_cam.imshow(dicom_vol[0], cmap='gray')
im_heatmap = ax_cam.imshow(gradcam_vol[0], cmap='jet', alpha=0.4)
ax_cam.set_title(f"Grad-CAM (Kesit: 1 / {num_slices})")
ax_cam.axis('off')

# Kaydırıcı (Slider) Tanımı
ax_slider = plt.axes([0.25, 0.05, 0.5, 0.03])
slider = Slider(ax_slider, 'Kesit', 0, num_slices - 1, valinit=0, valfmt='%d')

def update(val):
    idx = int(slider.val)
    
    # Sol taraftaki orijinal görüntüyü güncelle
    im_orig.set_data(dicom_vol[idx])
    
    # Sağ taraftaki overlay katmanlarını güncelle
    im_underlay.set_data(dicom_vol[idx])
    im_heatmap.set_data(gradcam_vol[idx])
    
    # Başlığı güncelle
    ax_cam.set_title(f"Grad-CAM (Kesit: {idx + 1} / {num_slices})")
    
    # Değişiklikleri ekrana yansıt
    fig.canvas.draw_idle()

slider.on_changed(update)
plt.show()
