@echo off
title LungXAI Setup
setlocal

set "ROOT=%~dp0"

echo ============================================================
echo   LungXAI - First-Time Setup
echo ============================================================
echo.
echo   If you cloned WITHOUT --recurse-submodules, run first:
echo     git submodule update --init --recursive
echo ============================================================
echo.

rem ─── 1. Check Node.js ───────────────────────────────────────
echo [1/5] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 goto :fail_nodejs
for /f "tokens=*" %%v in ('node -v') do echo       Node.js %%v found.

rem ─── 2. Check Python ────────────────────────────────────────
echo.
echo [2/5] Checking Python...
where python >nul 2>&1
if errorlevel 1 goto :fail_python
for /f "tokens=*" %%v in ('python --version') do echo       %%v found.

rem ─── 3. npm install ─────────────────────────────────────────
echo.
echo [3/5] Installing Node.js dependencies...
echo       Running npm run install:all  (this may take ~30 seconds)...
cd /d "%ROOT%"
call npm run install:all
echo       Node.js dependencies ready.

rem ─── 4. Python packages ─────────────────────────────────────
echo.
echo [4/5] Installing Python dependencies...
python -c "import cv2, torch, monai, pydicom, fastapi, uvicorn" >nul 2>&1
if errorlevel 1 goto :install_python
echo       Already installed, skipping.
goto :step5

:install_python
echo       Installing packages (this may take a few minutes)...
pip install -r "%ROOT%backend\requirements.txt"
if errorlevel 1 goto :fail_pip
pip install -r "%ROOT%backend\ai_service\requirements.txt"
if errorlevel 1 goto :fail_pip
echo       Python dependencies ready.

rem ─── 5. .env ────────────────────────────────────────────────
:step5
echo.
echo [5/5] Configuring backend .env...
if exist "%ROOT%backend\.env" goto :check_env

if not exist "%ROOT%backend\.env.example" goto :env_missing
copy "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
echo       Created backend\.env from .env.example

:check_env
findstr /c:"DB_SERVER=." "%ROOT%backend\.env" >nul 2>&1
if not errorlevel 1 goto :env_ok
echo.
echo  *** ACTION REQUIRED ***
echo  DB_SERVER is not set in backend\.env
echo  Opening Notepad — set DB_SERVER to your SQL Server instance:
echo    DB_SERVER=.\SQLEXPRESS         (most common)
echo    DB_SERVER=localhost\SQLEXPRESS
echo.
start /wait notepad.exe "%ROOT%backend\.env"
echo       .env saved. Continuing...
goto :launch

:env_ok
echo       .env is configured.
goto :launch

:env_missing
echo       WARNING: .env.example not found. Create backend\.env manually.

rem ─── Launch ─────────────────────────────────────────────────
:launch
echo.
echo ============================================================
echo   Setup complete! Starting LungXAI...
echo ============================================================
echo.
echo   Backend:    http://localhost:3001
echo   AI Service: http://localhost:3002
echo   Frontend:   http://localhost:5173
echo.

start "LungXAI Backend"    cmd /k "cd /d "%ROOT%backend" && node server.js"
timeout /t 2 /nobreak >nul
start "LungXAI AI Service" cmd /k "cd /d "%ROOT%backend\ai_service" && pip install -r requirements.txt -q && python main.py"
timeout /t 2 /nobreak >nul
start "LungXAI Frontend"   cmd /k "cd /d "%ROOT%UI" && npm run dev"

echo   All three windows are opening. You can close this window.
echo.
pause
exit /b 0

rem ─── Error messages ─────────────────────────────────────────
:fail_nodejs
echo.
echo [FAIL] Node.js is not installed.
echo        Install LTS from: https://nodejs.org
echo        Then re-run setup.bat
goto :fail_end

:fail_python
echo.
echo [FAIL] Python is not installed.
echo        Install 3.9+ from: https://python.org
echo        Then re-run setup.bat
goto :fail_end

:fail_pip
echo.
echo [FAIL] pip install failed. Check your internet connection.
echo        Try manually: pip install -r backend\requirements.txt
goto :fail_end

:fail_end
echo.
pause
exit /b 1
