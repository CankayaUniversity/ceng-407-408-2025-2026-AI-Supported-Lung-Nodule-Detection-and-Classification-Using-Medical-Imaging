@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "LOG=%ROOT%setup_log.txt"

if "%1"=="--child" goto :run_setup

start "LungXAI Setup" cmd /k ""%~f0" --child & echo. & echo Press any key to close... & pause > nul"
exit /b 0

:run_setup
echo ============================================================ >> "%LOG%"
echo   LungXAI Setup Log - %date% %time% >> "%LOG%"
echo ============================================================ >> "%LOG%"

echo ============================================================
echo   LungXAI - First-Time Setup
echo ============================================================
echo.
echo   Log file: %LOG%
echo   If you cloned WITHOUT --recurse-submodules, run first:
echo     git submodule update --init --recursive
echo ============================================================
echo.

rem ─── 1. Node.js ─────────────────────────────────────────────
echo [1/5] Checking Node.js...
where node >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_nodejs
for /f "tokens=*" %%v in ('node -v 2^>nul') do echo       Node.js %%v found.
goto :step2

:fail_nodejs
echo [FAIL] Node.js is not installed.
echo        Install from: https://nodejs.org
goto :end_fail

:step2
rem ─── 2. Python ───────────────────────────────────────────────
echo.
echo [2/5] Checking Python...
where python >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_python
for /f "tokens=*" %%v in ('python --version 2^>nul') do echo       %%v found.
goto :step3

:fail_python
echo [FAIL] Python is not installed.
echo        Install from: https://python.org
goto :end_fail

:step3
rem ─── 3. npm install ──────────────────────────────────────────
echo.
echo [3/5] Installing Node.js dependencies...
cd /d "%ROOT%"
echo Running npm run install:all >> "%LOG%"
npm run install:all >> "%LOG%" 2>&1
if not exist "%ROOT%node_modules\express\index.js" goto :fail_npm
echo       Done.
goto :step4

:fail_npm
echo [FAIL] express not found after npm install. See %LOG%
goto :end_fail

:step4
rem ─── 4. Python packages ──────────────────────────────────────
echo.
echo [4/5] Installing Python dependencies...
cd /d "%ROOT%"
python -c "import cv2, torch, monai, pydicom, fastapi, uvicorn; print('OK')" > "%TEMP%\lungxai_pycheck.txt" 2>&1
findstr /c:"OK" "%TEMP%\lungxai_pycheck.txt" >nul 2>&1
if errorlevel 1 goto :install_python
echo       Already installed, skipping.
goto :step5

:install_python
echo       Installing packages (this may take a few minutes)...
pip install -r "%ROOT%backend\requirements.txt" >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_pip
pip install -r "%ROOT%backend\ai_service\requirements.txt" >> "%LOG%" 2>&1
if errorlevel 1 goto :fail_pip
echo       Done.
goto :step5

:fail_pip
echo [FAIL] pip install failed. See %LOG%
goto :end_fail

:step5
rem ─── 5. .env ─────────────────────────────────────────────────
echo.
echo [5/5] Configuring backend .env...
if exist "%ROOT%backend\.env" goto :env_exists
if not exist "%ROOT%backend\.env.example" goto :env_missing

copy "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
echo       Created backend\.env from .env.example
echo.
echo  *** ACTION REQUIRED ***
echo  You must set DB_SERVER in backend\.env before the backend can start.
echo  Opening the file in Notepad now...
echo.
echo  Set: DB_SERVER=.\SQLEXPRESS  (most common)
echo       DB_SERVER=localhost\SQLEXPRESS
echo       DB_SERVER=BMD\SQLEXPRESS01  (example custom instance)
echo.
start /wait notepad.exe "%ROOT%backend\.env"
echo       .env configured. Continuing...
goto :launch

:env_exists
echo       .env already exists.
goto :launch

:env_missing
echo       WARNING: .env.example not found. Create backend\.env manually.
goto :launch

:launch
rem ─── Start services ──────────────────────────────────────────
echo.
echo ============================================================
echo   Setup complete! Opening services in separate windows...
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

echo   Done. All three windows are starting.
timeout /t 3 /nobreak >nul
exit /b 0

:end_fail
echo.
echo ============================================================
echo   SETUP FAILED
echo ============================================================
echo   Log: %LOG%
echo.
echo   Manual steps:
echo     1. npm install              (project root)
echo     2. pip install -r backend\requirements.txt
echo     3. pip install -r backend\ai_service\requirements.txt
echo     4. Copy backend\.env.example to backend\.env
echo     5. Set DB_SERVER in backend\.env
echo     6. Run start.bat
echo ============================================================
exit /b 1
