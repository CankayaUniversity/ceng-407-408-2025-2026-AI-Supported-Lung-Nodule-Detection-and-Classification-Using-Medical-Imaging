@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo   LungXAI - First-Time Setup
echo ============================================================
echo.
echo   Repository: https://github.com/CankayaUniversity/
echo     ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-
echo     Detection-and-Classification-Using-Medical-Imaging
echo.
echo   If you cloned WITHOUT --recurse-submodules, run:
echo     git submodule update --init --recursive
echo   before continuing.
echo ============================================================
echo.

set "ROOT=%~dp0"
set "SETUP_DONE=1"
set "ERRORS="

:: ─────────────────────────────────────────────────────────────
:: Helper: show error popup and exit
:: ─────────────────────────────────────────────────────────────
goto :main

:show_error_popup
powershell -Command "[System.Windows.Forms.MessageBox]::Show('%~1', 'LungXAI Setup Failed', 'OK', 'Error') | Out-Null" 2>nul
if errorlevel 1 (
    :: Fallback if powershell forms fail
    msg * "LungXAI Setup Failed: %~1" 2>nul
    echo.
    echo [ERROR] %~1
)
exit /b 1

:: ─────────────────────────────────────────────────────────────
:main
:: ─────────────────────────────────────────────────────────────

echo [1/7] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    set "ERRORS=Node.js is not installed. Please install Node.js LTS from https://nodejs.org and re-run setup."
    goto :failed
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo       Node.js %NODE_VER% found.

echo.
echo [2/7] Checking Python...
where python >nul 2>&1
if errorlevel 1 (
    set "ERRORS=Python is not installed. Please install Python 3.9+ from https://python.org and re-run setup."
    goto :failed
)
for /f "tokens=*" %%v in ('python --version 2^>nul') do set PY_VER=%%v
echo       %PY_VER% found.

echo.
echo [3/7] Installing backend Node.js dependencies...
if exist "%ROOT%backend\node_modules\express" (
    echo       Already installed, skipping.
) else (
    echo       Running npm install in backend/...
    cd /d "%ROOT%backend"
    call npm install --silent
    if errorlevel 1 (
        set "ERRORS=Failed to install backend dependencies (npm install). Check your internet connection and try again."
        goto :failed
    )
    echo       Backend dependencies installed.
)

echo.
echo [4/7] Installing frontend Node.js dependencies...
if exist "%ROOT%UI\node_modules\vite" (
    echo       Already installed, skipping.
) else (
    echo       Running npm install in UI/...
    cd /d "%ROOT%UI"
    call npm install --silent
    if errorlevel 1 (
        set "ERRORS=Failed to install frontend dependencies (npm install). Check your internet connection and try again."
        goto :failed
    )
    echo       Frontend dependencies installed.
)

echo.
echo [5/7] Installing Python dependencies (backend)...
cd /d "%ROOT%"
python -c "import cv2, torch, monai, pydicom" >nul 2>&1
if errorlevel 1 (
    echo       Installing from backend/requirements.txt...
    pip install -r "%ROOT%backend\requirements.txt" -q
    if errorlevel 1 (
        set "ERRORS=Failed to install Python packages. Please run manually: pip install -r backend/requirements.txt"
        goto :failed
    )
    echo       Python backend packages installed.
) else (
    echo       Already installed, skipping.
)

echo.
echo [6/7] Installing Python dependencies (AI service)...
python -c "import fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
    echo       Installing from backend/ai_service/requirements.txt...
    pip install -r "%ROOT%backend\ai_service\requirements.txt" -q
    if errorlevel 1 (
        set "ERRORS=Failed to install AI service Python packages. Please run manually: pip install -r backend/ai_service/requirements.txt"
        goto :failed
    )
    echo       AI service packages installed.
) else (
    echo       Already installed, skipping.
)

echo.
echo [7/7] Configuring backend environment (.env)...
if exist "%ROOT%backend\.env" (
    echo       .env already exists, skipping.
) else (
    if exist "%ROOT%backend\.env.example" (
        copy "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
        echo       Created .env from .env.example
        echo.
        echo  *** IMPORTANT: Open backend\.env and set DB_SERVER to your
        echo  *** SQL Server instance (e.g. .\SQLEXPRESS or localhost\SQLEXPRESS)
        echo.
        powershell -Command "[System.Windows.Forms.MessageBox]::Show('backend\.env was created from .env.example.`n`nPlease open it and set DB_SERVER to your SQL Server instance name (e.g. .\SQLEXPRESS).`n`nThen press OK to continue starting the application.', 'LungXAI - Configure Database', 'OK', 'Information') | Out-Null" 2>nul
    ) else (
        echo       WARNING: .env.example not found. Please create backend\.env manually.
    )
)

echo.
echo ============================================================
echo   Setup complete! Starting LungXAI...
echo ============================================================
echo.

cd /d "%ROOT%"
call start.bat
exit /b 0

:: ─────────────────────────────────────────────────────────────
:failed
echo.
echo ============================================================
echo   SETUP FAILED
echo ============================================================
echo   %ERRORS%
echo ============================================================
echo.
echo A popup will appear with the error message.
echo Please resolve the issue and run setup.bat again.
echo.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.Windows.Forms; ^
   [System.Windows.Forms.MessageBox]::Show( ^
     'Setup failed. Please resolve the following issue and run setup.bat again:`n`n%ERRORS%`n`nManual installation steps:`n1. Install Node.js LTS from https://nodejs.org`n2. Install Python 3.9+ from https://python.org`n3. Run: cd backend && npm install`n4. Run: cd UI && npm install`n5. Run: pip install -r backend/requirements.txt`n6. Copy backend/.env.example to backend/.env and edit DB_SERVER', ^
     'LungXAI Setup Failed', ^
     [System.Windows.Forms.MessageBoxButtons]::OK, ^
     [System.Windows.Forms.MessageBoxIcon]::Error ^
   ) | Out-Null"
echo.
pause
exit /b 1
