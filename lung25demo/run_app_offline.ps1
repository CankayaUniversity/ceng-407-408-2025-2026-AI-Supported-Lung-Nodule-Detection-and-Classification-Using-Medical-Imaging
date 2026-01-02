# run_app_offline.ps1
# Proje kökünden çalıştırır, venv'i açar, app_offline.py'yi eğitilmiş model ile başlatır.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Proje köküne geç (script'in bulunduğu klasör)
Set-Location $PSScriptRoot

# venv activate
$venvActivate = Join-Path $PSScriptRoot "venv\Scripts\Activate.ps1"
if (!(Test-Path $venvActivate)) {
    throw "venv bulunamadı: $venvActivate"
}
. $venvActivate

# Eğitilmiş model dosyası kontrolü
$weights = Join-Path $PSScriptRoot "outputs\best_resnet18_ag.pt"
if (!(Test-Path $weights)) {
    throw "Eğitilmiş model yok: $weights  (train bittikten sonra oluşur)"
}

# app'i başlat
python app_offline.py
