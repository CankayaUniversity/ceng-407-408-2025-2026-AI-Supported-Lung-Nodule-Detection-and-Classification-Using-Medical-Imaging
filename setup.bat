@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"

echo ============================================================
echo   LungXAI - First-Time Setup
echo ============================================================
echo.
echo   If you cloned WITHOUT --recurse-submodules, run first:
echo     git submodule update --init --recursive
echo ============================================================
echo.

:: ─── 1. Check Node.js ──────────────────────────────────────
echo [1/5] Checking Node.js...
where node >nul 2>&1
if !errorlevel! neq 0 (
    call :popup "Node.js is not installed. Please install Node.js LTS from https://nodejs.org and re-run setup.bat."
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do echo       Node.js %%v found.

:: ─── 2. Check Python ───────────────────────────────────────
echo.
echo [2/5] Checking Python...
where python >nul 2>&1
if !errorlevel! neq 0 (
    call :popup "Python is not installed. Please install Python 3.9+ from https://python.org and re-run setup.bat."
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>nul') do echo       %%v found.

:: ─── 3. npm install (workspace — installs backend + UI) ────
echo.
echo [3/5] Installing Node.js dependencies (workspace)...
cd /d "%ROOT%"
if exist "%ROOT%node_modules\express\index.js" (
    echo       Already installed, skipping.
) else (
    echo       Running npm install from project root...
    npm install
    if !errorlevel! neq 0 (
        call :popup "Failed to install Node.js dependencies. Check your internet connection and try again."
        exit /b 1
    )
    echo       Done.
)

:: ─── 4. Python packages ────────────────────────────────────
echo.
echo [4/5] Installing Python dependencies...
cd /d "%ROOT%"
python -c "import cv2, torch, monai, pydicom, fastapi, uvicorn" >nul 2>&1
if !errorlevel! neq 0 (
    echo       Installing backend packages...
    pip install -r "%ROOT%backend\requirements.txt"
    if !errorlevel! neq 0 (
        call :popup "Failed to install Python packages. Try manually: pip install -r backend/requirements.txt"
        exit /b 1
    )
    echo       Installing AI service packages...
    pip install -r "%ROOT%backend\ai_service\requirements.txt"
    if !errorlevel! neq 0 (
        call :popup "Failed to install AI service packages. Try: pip install -r backend/ai_service/requirements.txt"
        exit /b 1
    )
    echo       Done.
) else (
    echo       Already installed, skipping.
)

:: ─── 5. .env configuration ─────────────────────────────────
echo.
echo [5/5] Configuring backend .env...
if exist "%ROOT%backend\.env" (
    echo       .env already exists, skipping.
) else (
    if exist "%ROOT%backend\.env.example" (
        copy "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
        echo       Created .env from .env.example
        powershell -NoProfile -Command ^
          "Add-Type -AssemblyName System.Windows.Forms; ^
           [System.Windows.Forms.MessageBox]::Show( ^
             'backend\.env was created from .env.example.`n`nPlease open it and set DB_SERVER to your SQL Server instance (e.g. .\SQLEXPRESS).`n`nThen press OK to start the application.', ^
             'LungXAI - Configure Database', ^
             [System.Windows.Forms.MessageBoxButtons]::OK, ^
             [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null"
    ) else (
        echo       WARNING: .env.example not found. Please create backend\.env manually.
    )
)

:: ─── Launch ────────────────────────────────────────────────
echo.
echo ============================================================
echo   Setup complete! Launching LungXAI...
echo ============================================================
echo.
cd /d "%ROOT%"
call "%ROOT%start.bat"
exit /b 0

:: ─── Error popup subroutine ────────────────────────────────
:popup
echo.
echo [ERROR] %~1
echo.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.Windows.Forms; ^
   [System.Windows.Forms.MessageBox]::Show( ^
     '%~1`n`nManual steps:`n1. npm install  (from project root)`n2. pip install -r backend/requirements.txt`n3. pip install -r backend/ai_service/requirements.txt`n4. Copy backend/.env.example to backend/.env`n5. Run start.bat', ^
     'LungXAI Setup Failed', ^
     [System.Windows.Forms.MessageBoxButtons]::OK, ^
     [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null"
pause
exit /b 1
