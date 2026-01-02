# run_app.ps1
$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

# ---- venv activate ----
if (-Not (Test-Path ".\venv\Scripts\Activate.ps1")) {
  throw "venv bulunamadi. Once .\setup_venv.ps1 calistir."
}
.\venv\Scripts\Activate.ps1

# ---- dataset root txt (opsiyonel: weights aramak için) ----
$DATASET_TXT = Join-Path $ROOT "dataset_root.txt"
$DATASET_ROOT = $null

if (Test-Path $DATASET_TXT) {
  $DATASET_ROOT = (Get-Content $DATASET_TXT -Raw).Trim()
  if (-Not [string]::IsNullOrWhiteSpace($DATASET_ROOT)) {
    if (-Not (Test-Path $DATASET_ROOT)) {
      Write-Host "[!] dataset_root.txt yolu bulunamadi: $DATASET_ROOT (görmezden geliyorum)" -ForegroundColor Yellow
      $DATASET_ROOT = $null
    }
  } else {
    $DATASET_ROOT = $null
  }
}

# ---- weights bulma: önce proje outputs, yoksa dataset root içinde ara ----
$DEFAULT_BACKBONE = "resnet18"
$WEIGHTS = Join-Path $ROOT "outputs\best_resnet18.pt"

if (-Not (Test-Path $WEIGHTS)) {
  # alternatifs: outputs içinde herhangi bir best_*.pt
  $cand = Get-ChildItem -Path (Join-Path $ROOT "outputs") -Filter "*.pt" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "best_" } | Select-Object -First 1
  if ($cand) { $WEIGHTS = $cand.FullName }
}

if ((-Not (Test-Path $WEIGHTS)) -and $DATASET_ROOT) {
  # dataset root içinde best*.pt ara (sen bazen üst klasöre kaydediyorsun diye)
  $cand2 = Get-ChildItem -Path $DATASET_ROOT -Filter "*.pt" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "best" } | Select-Object -First 1
  if ($cand2) { $WEIGHTS = $cand2.FullName }
}

if (-Not (Test-Path $WEIGHTS)) {
  throw "weights bulunamadi. Once .\run_train.ps1 ile egit veya outputs\best_resnet18.pt koy."
}

# backbone tahmini (dosya adına göre)
if ($WEIGHTS.ToLower().Contains("resnet34")) { $DEFAULT_BACKBONE = "resnet34" }
elseif ($WEIGHTS.ToLower().Contains("densenet")) { $DEFAULT_BACKBONE = "densenet121" }
else { $DEFAULT_BACKBONE = "resnet18" }

$env:WEIGHTS_PATH = $WEIGHTS
$env:BACKBONE = $DEFAULT_BACKBONE

Write-Host "[i] WEIGHTS_PATH: $env:WEIGHTS_PATH" -ForegroundColor Cyan
Write-Host "[i] BACKBONE:     $env:BACKBONE"     -ForegroundColor Cyan
Write-Host "[i] cache dir:    $(Join-Path $ROOT 'cache')" -ForegroundColor Cyan
Write-Host ""

python app.py
