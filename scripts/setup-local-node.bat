@echo off
setlocal
title Установка локального Node.js

cd /d "%~dp0.."
echo.
echo  ========================================
echo    NexTalk Local Node.js Installer
echo  ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local-node.ps1" %*
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Установка не удалась (код %errorlevel%).
    pause
    exit /b %errorlevel%
)

echo.
echo  [DONE] Нажмите любую клавишу для выхода...
pause >nul
