@echo off
title NexTalk Dual Node Launcher
cd /d "%~dp0"

echo ========================================================
echo   NexTalk - Starting 2 Nodes (3001 and 3002)
echo ========================================================
echo.
echo [1/2] Starting Node 1 on port 3001...
start "NexTalk Node 1 (3001)" "%~dp0start.bat" 3001

echo Waiting 3 seconds...
ping 127.0.0.1 -n 4 >nul

echo [2/2] Starting Node 2 on port 3002...
start "NexTalk Node 2 (3002)" "%~dp0start.bat" 3002

echo.
echo ========================================================
echo   Both nodes started successfully!
echo   Node 1: http://localhost:3001 (WS: ws://localhost:3001)
echo   Node 2: http://localhost:3002 (WS: ws://localhost:3002)
echo ========================================================
echo.
pause
