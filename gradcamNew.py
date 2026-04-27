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

def load_dicom_volume_from_zip(zip_bytes):
    zip_bytes.seek(0)
    slices = []
    with zipfile.ZipFile(zip_bytes) as z:
        dcm_files = [f for f in z.namelist() if f.lower().endswith('.dcm')]
        for f in dcm_files:
            with z.open(f) as dcm_file:
                ds = pydicom.dcmread(BytesIO(dcm_file.read()))
                slices.append(ds)
    
    slices.sort(key=lambda x: int(x.InstanceNumber))
    
    dicom_arrays = []
    for s in slices:
        img = s.pixel_array.astype(np.float32)
        
        # 1. Gerçek HU değerlerine çevir
        intercept = getattr(s, 'RescaleIntercept', 0)
        slope = getattr(s, 'RescaleSlope', 1)
        hu_img = img * slope + intercept
        
        # 2. KRİTİK DÜZELTME: Çeper dışındaki (-2000 gibi) padding değerlerini havaya (-1000) eşitle.
        # Bu sayede min değer her zaman -1000 civarında kalacak ve hava griye dönmeyecek.
        hu_img[hu_img < -1000] = -1000
        
        dicom_arrays.append(hu_img)
    
    # 3. Modelin eğitildiği orijinal NPZ normalizasyonuna (preprocess_image_slice) gönder
    full_volume = np.stack([preprocess_image_slice(img) for img in dicom_arrays])
    return full_volume

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

def get_gradcam_for_volume(model, volume, cam_engine):
    num_slices = volume.shape[0]
    gradcam_results = []
    padded_vol = np.pad(volume, ((2, 2), (0, 0), (0, 0)), mode='edge')
    
    print("Grad-CAM haritaları hesaplanıyor, lütfen bekleyin...")
    for i in range(num_slices):
        input_5_slices = padded_vol[i : i+5] 
        input_tensor = torch.from_numpy(input_5_slices).float().unsqueeze(0)
        
        with torch.no_grad():
            output = model(input_tensor)
            prob_map = torch.sigmoid(output)[0, 0].cpu().numpy()
            
        # DÜZELTME: Modeli sadece %50'den emin olduğu (nodül dediği) piksellere odaklıyoruz
        target_mask = (prob_map > 0.5).astype(np.float32)
        
        # Eğer bu kesitte nodül bulamadıysa, bomboş bir siyah harita ekle ve geç
        if target_mask.sum() == 0:
            gradcam_results.append(np.zeros((224, 224), dtype=np.float32))
            continue
            
        # Hedef olarak ikili (0-1) maskeyi veriyoruz
        target = [SemanticSegmentationTarget(category=0, mask=target_mask)]
        
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


def calculate_patient_accuracy(images_vol, masks_vol, model, device="cpu"):
    model.eval() 
    model.to(device)
    
    num_slices = images_vol.shape[0]
    
    # Modelin 5 kesit (2.5D) bekliyor. Baştaki ve sondaki kesitler hata vermesin diye 
    # hacmin altına ve üstüne 2'şer boş kesit kopyalıyoruz (padding).
    padded_images = np.pad(images_vol, ((2, 2), (0, 0), (0, 0)), mode='edge')
    
    total_intersection = 0.0
    total_union = 0.0
    
    # Gradyan hesaplamasını kapatıyoruz (sadece tahmin yaptığımız için belleği rahatlatır)
    with torch.no_grad():
        for i in range(num_slices):
            # 1. Modele girecek 5 kesitlik bloğu al
            input_chunk = padded_images[i : i+5]
            
            # (1, 5, 224, 224) formatında PyTorch tensörüne çevir
            input_tensor = torch.from_numpy(input_chunk).float().unsqueeze(0).to(device)
            
            # 2. Gerçek maskeyi al ve 0-1 formatına getir
            true_mask = masks_vol[i]
            true_bin = (true_mask > 0.5).astype(np.float32) 
            
            # 3. Model Tahmini
            output = model(input_tensor)
            # Sigmoid ile olasılığa çevir ve matrisi al
            prob_map = torch.sigmoid(output)[0, 0].cpu().numpy()
            
            # Tahmini 0 veya 1 yap (Eşik: %50)
            pred_bin = (prob_map > 0.5).astype(np.float32)
            
            # 4. Kesişim ve Birleşim değerlerini genel toplama ekle
            total_intersection += np.sum(pred_bin * true_bin)
            total_union += np.sum(pred_bin) + np.sum(true_bin)
            
    # 5. Toplam (3D) Dice Skorunu Hesapla
    if total_union == 0:
        # Hasta tamamen sağlıklıysa ve model de hiçbir yeri işaretlemediyse %100 başarılıdır
        return 1.0 
    
    dice_score = (2.0 * total_intersection) / total_union
    return float(dice_score)

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
with np.load(selected_data_npz) as data:
    all_images = data['images'] if 'images' in data else data['arr_0']
    all_masks = data['masks'] if 'masks' in data else data['arr_1']
    
    # Boyutlandırmalar
    all_images_resized = np.stack([preprocess_image_slice(img) for img in all_images])
    all_masks_resized = np.stack([cv2.resize(m.astype(np.float32), (224, 224), interpolation=cv2.INTER_NEAREST) for m in all_masks])

# Daha önce yazdığımız fonksiyon ile skoru alıyoruz
patient_score = calculate_patient_accuracy(all_images_resized, all_masks_resized, model)
accuracy_percentage = patient_score * 100

print("DICOM Hacmi yükleniyor...")
dicom_vol = load_dicom_volume_from_zip(selected_data_dcm)
num_slices = dicom_vol.shape[0]

# Grad-CAM Hazırlığı
target_layers = [model.up_samples[-1]]
cam = GradCAMPlusPlus(model=model, target_layers=target_layers)
gradcam_vol = get_gradcam_for_volume(model, dicom_vol, cam)

# Görselleştirme
# --- GÖRSELLEŞTİRME (Sadece Görüntüleme İyileştirmesi) ---

fig, axes = plt.subplots(1, 2, figsize=(14, 7))
plt.subplots_adjust(bottom=0.2, top=0.85) # Üstten (top) ana başlık için yer açtık
fig.patch.set_facecolor('#FFFFFF') 

# PENCERENİN EN ÜSTÜNE HASTA SKORUNU EKLİYORUZ
fig.suptitle(
    f"Hasta ID: [{pat_id}] | Genel 3D Segmentasyon Doğruluğu: %{accuracy_percentage:.2f}", 
    color='#00FFCC', 
    fontsize=16, 
    fontweight='bold'
)

ax_orig = axes[0]
ax_cam = axes[1]
THRESHOLD = 0.5 

def apply_mask(cam_map):
    masked_map = np.copy(cam_map)
    masked_map[masked_map < THRESHOLD] = 0
    return np.ma.masked_where(masked_map == 0, masked_map)

# 1. SOL TARAF
im_orig = ax_orig.imshow(dicom_vol[0], cmap='gray')
ax_orig.set_title("Orijinal DICOM", color='black', fontsize=12)
ax_orig.axis('off')

# 2. SAĞ TARAF
im_underlay = ax_cam.imshow(dicom_vol[0], cmap='gray')
im_heatmap = ax_cam.imshow(apply_mask(gradcam_vol[0]), cmap='viridis', alpha=0.8)
ax_cam.set_title(f"Kritik Odaklar (Kesit: 1)", color='black', fontsize=12)
ax_cam.axis('off')

# Slider
ax_slider = plt.axes([0.25, 0.05, 0.5, 0.03], facecolor='#333333')
slider = Slider(ax_slider, 'Kesit', 0, num_slices - 1, valinit=0, valfmt='%d', color='#00FFCC')

def update(val):
    idx = int(slider.val)
    im_orig.set_data(dicom_vol[idx])
    im_underlay.set_data(dicom_vol[idx])
    im_heatmap.set_data(apply_mask(gradcam_vol[idx]))
    ax_cam.set_title(f"Kritik Odaklar (Kesit: {idx + 1})", color='black', fontsize=12, fontweight='bold')
    fig.canvas.draw_idle()

slider.on_changed(update)
plt.show()
