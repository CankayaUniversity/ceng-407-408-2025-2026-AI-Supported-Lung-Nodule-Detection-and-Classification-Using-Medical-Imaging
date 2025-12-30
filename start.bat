@echo off
echo ========================================
echo    Lung Nodule Detection System
echo ========================================
echo.
echo Starting Backend and Frontend...
echo.
echo Backend:  http://localhost:3001
echo Frontend: http://localhost:5173
echo ========================================
echo.

cd /d "%~dp0"

echo Starting Backend Server...
start "Backend" cmd /k "cd backend && node server.js"

timeout /t 3 /nobreak > nul

echo Starting Frontend Server...
start "Frontend" cmd /k "cd UI && npm run dev"

echo.
echo ========================================
echo Both servers are starting!
echo.
echo Backend:  http://localhost:3001
echo Frontend: http://localhost:5173
echo ========================================
echo.
echo Press any key to exit this window...
pause > nul
