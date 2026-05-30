@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"

echo ============================================================
echo   LungXAI - First-Time Setup
echo ============================================================
echo.
echo   Repository:
echo   https://github.com/CankayaUniversity/
echo   ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-...
echo.
echo   If you cloned WITHOUT --recurse-submodules, run:
echo     git submodule update --init --recursive
echo   before continuing.
echo ============================================================
echo.

:: ─── 1. Check Node.js ──────────────────────────────────────
echo [1/7] Checking Node.js...
where node >nul 2>&1
if !errorlevel! neq 0 (
    call :popup "Node.js is not installed. Please install Node.js LTS from https://nodejs.org and re-run setup.bat."
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do echo       Node.js %%v found.

:: ─── 2. Check Python ───────────────────────────────────────
echo.
echo [2/7] Checking Python...
where python >nul 2>&1
if !errorlevel! neq 0 (
    call :popup "Python is not installed. Please install Python 3.9+ from https://python.org and re-run setup.bat."
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>nul') do echo       %%v found.

:: ─── 3. Backend npm install ────────────────────────────────
echo.
echo [3/7] Installing backend Node.js dependencies...
if exist "%ROOT%backend\node_modules\express\package.json" (
    echo       Already installed, skipping.
) else (
    echo       Running npm install in backend/ ...
    cd /d "%ROOT%backend"
    call npm install
    if !errorlevel! neq 0 (
        cd /d "%ROOT%"
        call :popup "Failed to install backend dependencies. Check your internet connection and try again."
        exit /b 1
    )
    cd /d "%ROOT%"
    echo       Done.
)

:: ─── 4. Frontend npm install ───────────────────────────────
echo.
echo [4/7] Installing frontend Node.js dependencies...
if exist "%ROOT%UI\node_modules\vite\package.json" (
    echo       Already installed, skipping.
) else (
    echo       Running npm install in UI/ ...
    cd /d "%ROOT%UI"
    call npm install
    if !errorlevel! neq 0 (
        cd /d "%ROOT%"
        call :popup "Failed to install frontend dependencies. Check your internet connection and try again."
        exit /b 1
    )
    cd /d "%ROOT%"
    echo       Done.
)

:: ─── 5. Python backend packages ────────────────────────────
echo.
echo [5/7] Installing Python backend dependencies...
python -c "import cv2, torch, monai, pydicom" >nul 2>&1
if !errorlevel! neq 0 (
    echo       Running pip install from backend/requirements.txt ...
    pip install -r "%ROOT%backend\requirements.txt"
    if !errorlevel! neq 0 (
        call :popup "Failed to install Python packages. Try running manually: pip install -r backend/requirements.txt"
        exit /b 1
    )
    echo       Done.
) else (
    echo       Already installed, skipping.
)

:: ─── 6. Python AI service packages ─────────────────────────
echo.
echo [6/7] Installing Python AI service dependencies...
python -c "import fastapi, uvicorn" >nul 2>&1
if !errorlevel! neq 0 (
    echo       Running pip install from backend/ai_service/requirements.txt ...
    pip install -r "%ROOT%backend\ai_service\requirements.txt"
    if !errorlevel! neq 0 (
        call :popup "Failed to install AI service packages. Try: pip install -r backend/ai_service/requirements.txt"
        exit /b 1
    )
    echo       Done.
) else (
    echo       Already installed, skipping.
)

:: ─── 7. .env configuration ─────────────────────────────────
echo.
echo [7/7] Configuring backend .env ...
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
        echo       WARNING: .env.example not found. Create backend\.env manually.
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
     '%~1`n`nManual steps:`n1. npm install (in backend/)`n2. npm install (in UI/)`n3. pip install -r backend/requirements.txt`n4. Copy backend/.env.example to backend/.env`n5. Run start.bat', ^
     'LungXAI Setup Failed', ^
     [System.Windows.Forms.MessageBoxButtons]::OK, ^
     [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null"
pause
exit /b 1
