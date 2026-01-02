$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

if (-Not (Test-Path ".\venv")) { python -m venv venv }
.\venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
pip install -r requirements.txt

function Has-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

if (-Not (Has-Command "git")) {
  Write-Host "git bulunamadi. pytorch-grad-cam icin Git gerekli." -ForegroundColor Yellow
  throw "Git gerekli."
}

pip install --upgrade "git+https://github.com/jacobgil/pytorch-grad-cam.git"
Write-Host "venv ready." -ForegroundColor Green
