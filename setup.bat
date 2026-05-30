@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "LOG=%ROOT%setup_log.txt"

:: Always keep window open on any unexpected exit
if "%1"=="--child" goto :run_setup

:: Re-launch self in a persistent cmd window so output is always visible
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

:: ─── 1. Node.js ────────────────────────────────────────────
echo [1/5] Checking Node.js...
where node >> "%LOG%" 2>&1
if !errorlevel! neq 0 (
    echo [FAIL] Node.js not found >> "%LOG%"
    echo [FAIL] Node.js is not installed.
    echo        Install from: https://nodejs.org
    goto :end_fail
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do (
    echo       Node.js %%v found.
    echo Node.js %%v >> "%LOG%"
)

:: ─── 2. Python ─────────────────────────────────────────────
echo.
echo [2/5] Checking Python...
where python >> "%LOG%" 2>&1
if !errorlevel! neq 0 (
    echo [FAIL] Python not found >> "%LOG%"
    echo [FAIL] Python is not installed.
    echo        Install from: https://python.org
    goto :end_fail
)
for /f "tokens=*" %%v in ('python --version 2^>nul') do (
    echo       %%v found.
    echo %%v >> "%LOG%"
)

:: ─── 3. npm install (workspace root) ───────────────────────
echo.
echo [3/5] Installing Node.js dependencies...
cd /d "%ROOT%"
if exist "%ROOT%node_modules\express\index.js" (
    echo       Already installed, skipping.
    echo npm deps: already installed >> "%LOG%"
) else (
    echo       Running npm install from project root...
    echo Running: npm install --no-audit >> "%LOG%"
    npm install --no-audit >> "%LOG%" 2>&1
    if !errorlevel! neq 0 (
        echo [FAIL] npm install failed. See %LOG% >> "%LOG%"
        echo [FAIL] npm install failed. See %LOG% for details.
        goto :end_fail
    )
    echo       Done.
)

:: ─── 4. Python packages ────────────────────────────────────
echo.
echo [4/5] Installing Python dependencies...
cd /d "%ROOT%"
python -c "import cv2, torch, monai, pydicom, fastapi, uvicorn" >> "%LOG%" 2>&1
if !errorlevel! neq 0 (
    echo       Installing packages (this may take a few minutes)...
    echo pip install backend/requirements.txt >> "%LOG%"
    pip install -r "%ROOT%backend\requirements.txt" >> "%LOG%" 2>&1
    if !errorlevel! neq 0 (
        echo [FAIL] pip install backend/requirements.txt failed. See %LOG%
        goto :end_fail
    )
    pip install -r "%ROOT%backend\ai_service\requirements.txt" >> "%LOG%" 2>&1
    if !errorlevel! neq 0 (
        echo [FAIL] pip install ai_service/requirements.txt failed. See %LOG%
        goto :end_fail
    )
    echo       Done.
) else (
    echo       Already installed, skipping.
)

:: ─── 5. .env ───────────────────────────────────────────────
echo.
echo [5/5] Configuring backend .env...
if exist "%ROOT%backend\.env" (
    echo       .env already exists, skipping.
) else (
    if exist "%ROOT%backend\.env.example" (
        copy "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
        echo       Created .env from .env.example
        echo       IMPORTANT: Open backend\.env and set DB_SERVER
        echo       Example:   DB_SERVER=.\SQLEXPRESS
        echo.
        echo [ACTION REQUIRED] Open backend\.env and set DB_SERVER, then press any key to continue...
        pause >nul
    ) else (
        echo       WARNING: .env.example not found - create backend\.env manually
    )
)

:: ─── Launch ────────────────────────────────────────────────
echo.
echo ============================================================
echo   Setup complete! Starting LungXAI...
echo ============================================================
echo.
cd /d "%ROOT%"
call "%ROOT%start.bat"
exit /b 0

:end_fail
echo.
echo ============================================================
echo   SETUP FAILED - See details above and in:
echo   %LOG%
echo ============================================================
echo.
echo Manual steps:
echo   1. npm install              (from project root)
echo   2. pip install -r backend\requirements.txt
echo   3. pip install -r backend\ai_service\requirements.txt
echo   4. Copy backend\.env.example to backend\.env
echo   5. Edit backend\.env  (set DB_SERVER)
echo   6. Run start.bat
echo ============================================================
exit /b 1
