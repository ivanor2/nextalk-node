@echo off
title NexTalk WebSocket Node
echo.
echo  ========================================
echo    NexTalk WebSocket Node Launcher
echo  ========================================
echo.

:: Проверяем наличие Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js не найден!
    echo  Скачайте с https://nodejs.org/
    pause
    exit /b 1
)

:: Переходим в папку с сервером
cd /d "%~dp0"

:: Устанавливаем зависимости если нужно
if not exist "node_modules\ws" (
    echo  Устанавливаем зависимости...
    npm install
    echo.
)

set PORT=3001
if not "%1"=="" set PORT=%1

echo  Запуск узла на порту %PORT%...
echo  WebSocket: ws://localhost:%PORT%
echo  Health:    http://localhost:%PORT%/health
echo.
echo  Для доступа с других устройств узнайте IP:
ipconfig | findstr "IPv4"
echo.
echo  Нажмите Ctrl+C для остановки
echo.

node server.js %PORT%
