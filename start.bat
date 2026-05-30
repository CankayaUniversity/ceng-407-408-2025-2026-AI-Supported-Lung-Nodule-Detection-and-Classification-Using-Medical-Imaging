@echo off
echo ========================================
echo    Lung Nodule Detection System
echo ========================================
echo.
echo Starting Backend, AI Service, and Frontend...
echo.
echo Backend:    http://localhost:3001
echo AI Service: http://localhost:3002
echo Frontend:   http://localhost:5173
echo ========================================
echo.

cd /d "%~dp0"

echo Starting Backend Server...
start "Backend" cmd /k "cd backend && node server.js"

timeout /t 2 /nobreak > nul

echo Installing backend Python dependencies...
pip install -r backend\requirements.txt -q

echo Starting Pulmo AI Service...
start "AI Service" cmd /k "cd backend\ai_service && pip install -r requirements.txt -q && python main.py"

timeout /t 2 /nobreak > nul

echo Starting Frontend Server...
start "Frontend" cmd /k "cd UI && npm run dev"

echo.
echo ========================================
echo All servers are starting!
echo.
echo Backend:    http://localhost:3001
echo AI Service: http://localhost:3002  (Pulmo model)
echo Frontend:   http://localhost:5173
echo.
echo Note: First run installs Python packages (~1-2 min)
echo       Download Pulmo model from New Study page
echo ========================================
echo.
echo Press any key to exit this window...
pause > nul
