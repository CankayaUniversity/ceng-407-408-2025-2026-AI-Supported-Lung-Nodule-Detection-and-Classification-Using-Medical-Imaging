@echo off
echo Starting Backend Server...
start cmd /k "cd backend && npm start"

timeout /t 3

echo Starting Frontend...
start cmd /k "cd UI && npm run dev"

echo.
echo ========================================
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo ========================================
