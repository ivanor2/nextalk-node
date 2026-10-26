@echo off
setlocal enabledelayedexpansion
title NexTalk WebSocket Node

:: Переходим в папку со скриптом
cd /d "%~dp0"

echo.
echo  ========================================
echo    NexTalk WebSocket Node Launcher
echo  ========================================
echo.

:: Значения по умолчанию
set "USE_LOCAL_NODE=true"
set "LOCAL_NODE_DIR=.node"
set "NODE_VERSION=v22.13.0"
set "PORT="
set "ACTION_DOWNLOAD_ONLY=0"

:: Чтение настроек из .env при наличии
if exist ".env" (
    for /f "usebackq eol=# tokens=1* delims==" %%A in (".env") do (
        set "RAW_K=%%A"
        set "RAW_V=%%B"
        for /f "tokens=1" %%k in ("!RAW_K!") do set "KEY=%%k"
        if /i "!KEY!"=="USE_LOCAL_NODE" for /f "tokens=*" %%v in ("!RAW_V!") do set "USE_LOCAL_NODE=%%~v"
        if /i "!KEY!"=="LOCAL_NODE_DIR" for /f "tokens=*" %%v in ("!RAW_V!") do set "LOCAL_NODE_DIR=%%~v"
        if /i "!KEY!"=="NODE_VERSION" for /f "tokens=*" %%v in ("!RAW_V!") do set "NODE_VERSION=%%~v"
        if /i "!KEY!"=="PORT" for /f "tokens=*" %%v in ("!RAW_V!") do set "PORT=%%~v"
    )
)

:: Разбор аргументов командной строки
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--local" (
    set "USE_LOCAL_NODE=true"
    shift
    goto parse_args
)
if /i "%~1"=="--system" (
    set "USE_LOCAL_NODE=false"
    shift
    goto parse_args
)
if /i "%~1"=="--download-node" (
    set "ACTION_DOWNLOAD_ONLY=1"
    shift
    goto parse_args
)
if /i "%~1"=="--setup-node" (
    set "ACTION_DOWNLOAD_ONLY=1"
    shift
    goto parse_args
)
:: Если аргумент не ключ, считаем его портом
set "PORT=%~1"
shift
goto parse_args
:args_done

if "%ACTION_DOWNLOAD_ONLY%"=="1" (
    echo  [ACTION] Принудительная загрузка локального Node.js...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local-node.ps1" -TargetDir "%LOCAL_NODE_DIR%" -Version "%NODE_VERSION%" -Force
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] Не удалось скачать Node.js!
        pause
        exit /b %errorlevel%
    )
    echo  [DONE] Локальный Node.js успешно скачан.
    pause
    exit /b 0
)

:: Нормализуем флаг локального режима
set "IS_LOCAL=0"
if /i "%USE_LOCAL_NODE%"=="true" set "IS_LOCAL=1"
if /i "%USE_LOCAL_NODE%"=="1"    set "IS_LOCAL=1"
if /i "%USE_LOCAL_NODE%"=="yes"  set "IS_LOCAL=1"

if "%IS_LOCAL%"=="1" goto setup_local_node
goto setup_system_node

:setup_local_node
set "LOCAL_NODE_EXE=%~dp0%LOCAL_NODE_DIR%\node.exe"
if exist "%LOCAL_NODE_EXE%" goto local_node_ready

echo  [INFO] Режим локального Node.js активен (USE_LOCAL_NODE=%USE_LOCAL_NODE%).
echo  [INFO] Файл node.exe не найден в '%LOCAL_NODE_DIR%'.
echo  [INFO] Запускается автоматическая загрузка Node.js %NODE_VERSION%...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local-node.ps1" -TargetDir "%LOCAL_NODE_DIR%" -Version "%NODE_VERSION%"
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Ошибка при загрузке локального Node.js!
    echo  Проверьте подключение к интернету или укажите USE_LOCAL_NODE=false в .env.
    pause
    exit /b 1
)

if not exist "%LOCAL_NODE_EXE%" (
    echo.
    echo  [ERROR] Локальный node.exe не найден по пути: "%LOCAL_NODE_EXE%"
    pause
    exit /b 1
)

:local_node_ready
set "PATH=%~dp0%LOCAL_NODE_DIR%;%PATH%"
echo  [OK] Локальный Node.js подключен:
node -v
goto node_ready

:setup_system_node
echo  [INFO] Режим системного Node.js (USE_LOCAL_NODE=false).
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Системный Node.js не найден в переменной PATH!
    echo  Скачайте Node.js с https://nodejs.org/ или включите локальный режим:
    echo  Установите USE_LOCAL_NODE=true в .env
    pause
    exit /b 1
)
echo  [OK] Используется системный Node.js:
node -v
goto node_ready

:node_ready
echo.

:: Устанавливаем зависимости если нужно
if not exist "node_modules\ws" (
    echo  Устанавливаем зависимости...
    call npm install
    if !errorlevel! neq 0 (
        echo.
        echo  [ERROR] Ошибка при установке зависимостей npm!
        pause
        exit /b !errorlevel!
    )
    echo.
)

if "%PORT%"=="" set "PORT=3001"

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
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Сервер завершил работу с кодом ошибки %errorlevel%.
)
echo.
pause
