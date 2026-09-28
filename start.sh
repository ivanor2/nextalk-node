#!/bin/bash
# NexTalk WebSocket Node Launcher (Linux/Mac)

echo ""
echo " ========================================"
echo "   NexTalk WebSocket Node Launcher"
echo " ========================================"
echo ""

# Проверяем Node.js
if ! command -v node &> /dev/null; then
    echo " [ERROR] Node.js не найден!"
    echo " Ubuntu/Debian: sudo apt install nodejs npm"
    echo " Mac: brew install node"
    exit 1
fi

# Переходим в папку со скриптом
cd "$(dirname "$0")"

# Устанавливаем зависимости если нужно
if [ ! -d "node_modules/ws" ]; then
    echo " Устанавливаем зависимости..."
    npm install
    echo ""
fi

PORT=${1:-3001}

echo " Запуск узла на порту $PORT..."
echo " WebSocket: ws://localhost:$PORT"
echo " Health:    http://localhost:$PORT/health"
echo ""
echo " IP адреса этого устройства:"
hostname -I 2>/dev/null || ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1
echo ""
echo " Нажмите Ctrl+C для остановки"
echo ""

node server.js $PORT
