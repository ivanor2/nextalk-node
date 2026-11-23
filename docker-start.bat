@echo off
setlocal enabledelayedexpansion
title NexTalk Node — Docker Launcher
cd /d "%~dp0"

echo.
echo  ========================================
echo    NexTalk Node — Docker Launcher
echo  ========================================
echo.

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker CLI не найден в PATH!
    echo  Пожалуйста, установите Docker Desktop: https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

echo  [1/2] Проверка состояния Docker демона...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker демон не запущен!
    echo  Запустите Docker Desktop и попробуйте снова.
    echo.
    pause
    exit /b 1
)

echo  [2/2] Запуск контейнеров через Docker Compose...
docker compose up -d --build

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Ошибка при запуске Docker Compose!
    pause
    exit /b %errorlevel%
)

echo.
echo  ========================================
echo   NexTalk Node запущен в Docker!
echo   HTTP / Health : http://localhost:3001/health
echo   WebSocket     : ws://localhost:3001
echo  ========================================
echo.
echo  Команды управления:
echo    npm run docker:logs   - просмотр логов
echo    npm run docker:down   - остановить контейнер
echo.
set /p VIEW_LOGS="Показать логи прямо сейчас? (y/n) [y]: "
if /i "%VIEW_LOGS%"=="" set "VIEW_LOGS=y"
if /i "%VIEW_LOGS%"=="y" (
    docker compose logs -f
)
