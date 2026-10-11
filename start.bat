@echo off
title Arena Shooter Host
d:
cd \arena-shooter

echo ========================================
echo       ARENA SHOOTER - PC HOST
echo ========================================
echo.

:: Clear existing process holding port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Freeing port 3000 from PID %%a...
    taskkill /f /pid %%a >nul 2>&1
)

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP:~1%

echo Play locally:    http://localhost:3000
echo Share on Wi-Fi:  http://%IP%:3000
echo ========================================
echo.

start http://localhost:3000
node server.js
pause