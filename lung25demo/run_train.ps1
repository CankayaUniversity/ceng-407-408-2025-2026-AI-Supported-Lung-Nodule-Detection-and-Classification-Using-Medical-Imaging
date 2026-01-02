# run_train.ps1 (single command -> starts training + opens tail window reliably)
$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

# ---- activate venv ----
if (-Not (Test-Path ".\venv\Scripts\Activate.ps1")) { throw "venv not found. Run setup_venv.ps1 first." }
.\venv\Scripts\Activate.ps1

# ---- dataset root ----
$DATASET_TXT = Join-Path $ROOT "dataset_root.txt"
if (-Not (Test-Path $DATASET_TXT)) { throw "dataset_root.txt missing." }

$DATASET_ROOT = (Get-Content $DATASET_TXT -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($DATASET_ROOT)) { throw "dataset_root.txt empty." }
if (-Not (Test-Path $DATASET_ROOT)) { throw "dataset_root path invalid: $DATASET_ROOT" }

# ---- find manifest ----
$MANIFEST_ROOT = $null
Get-ChildItem -Path $DATASET_ROOT -Directory | Where-Object { $_.Name -like "manifest-*" } | ForEach-Object {
    $cand = Join-Path $_.FullName "LIDC-IDRI"
    if (Test-Path $cand) { $MANIFEST_ROOT = $cand }
}
if ($null -eq $MANIFEST_ROOT) { throw "LIDC-IDRI not found under manifest-*." }

# ---- reader csv ----
$READER_CSV = Join-Path $DATASET_ROOT "lidc_reader_level.csv"
if (-Not (Test-Path $READER_CSV)) { throw "lidc_reader_level.csv not found at: $READER_CSV" }

# ---- dirs ----
$CACHE_DIR = Join-Path $ROOT "cache"
$OUT_DIR   = Join-Path $ROOT "outputs"
$LOG_DIR   = Join-Path $ROOT "logs"
New-Item -ItemType Directory -Force -Path $CACHE_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $OUT_DIR   | Out-Null
New-Item -ItemType Directory -Force -Path $LOG_DIR   | Out-Null

$TS = Get-Date -Format "yyyyMMdd_HHmmss"
$LOG_FILE = Join-Path $LOG_DIR "train_$TS.log"

Write-Host "DATASET_ROOT  : $DATASET_ROOT"
Write-Host "MANIFEST_ROOT : $MANIFEST_ROOT"
Write-Host "READER_CSV    : $READER_CSV"
Write-Host "CACHE_DIR     : $CACHE_DIR"
Write-Host "OUT_DIR       : $OUT_DIR"
Write-Host "LOG_FILE      : $LOG_FILE"
Write-Host ""

# ---- build command ----
$PYTHON = Join-Path $ROOT "venv\Scripts\python.exe"
$CMD = "`"$PYTHON`" -u train.py --manifest_root `"$MANIFEST_ROOT`" --reader_csv `"$READER_CSV`" --backbone resnet18 --epochs 12 --batch_size 32 --k 1 --neg_ratio 1.0 --lr 0.0001 --cache_dir `"$CACHE_DIR`" --out_dir `"$OUT_DIR`""

Write-Host "RUNNING:"
Write-Host $CMD
Write-Host ""

# ---- write tail script to file (reliable) ----
$TAIL_PS1 = Join-Path $LOG_DIR "tail_latest.ps1"

@"
param([string]`$log)
if ([string]::IsNullOrWhiteSpace(`$log)) { Write-Host "log path is empty"; exit 1 }

while (-not (Test-Path `"$LOG_FILE`")) { Start-Sleep -Milliseconds 200 }

Write-Host "Tailing log:"
Write-Host `"$LOG_FILE`"
Write-Host "----------------------------------------"
Get-Content `"$LOG_FILE`" -Wait
"@ | Set-Content -Path $TAIL_PS1 -Encoding UTF8

# ---- open tail window ----
Start-Process powershell -WorkingDirectory $ROOT -ArgumentList @(
  "-NoExit",
  "-File", $TAIL_PS1,
  "-log", $LOG_FILE
) | Out-Null

# ---- run training via cmd.exe (stable) ----
cmd.exe /C "$CMD 1>> `"$LOG_FILE`" 2>>&1"
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host ""
    Write-Host "TRAIN FAILED. Last log lines:" -ForegroundColor Red
    if (Test-Path $LOG_FILE) { Get-Content $LOG_FILE -Tail 80 }
    exit $code
}

Write-Host ""
Write-Host "TRAIN FINISHED OK" -ForegroundColor Green
Write-Host "Log: $LOG_FILE" -ForegroundColor Green
Write-Host "Outputs: $OUT_DIR" -ForegroundColor Green

Add-Content -Path $LOG_FILE -Value ""
Add-Content -Path $LOG_FILE -Value "=== TRAIN FINISHED OK ==="
