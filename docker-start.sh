#!/usr/bin/env bash
# ==============================================================================
# NexTalk Node — Docker Launcher (Linux / macOS)
# ==============================================================================

cd "$(dirname "$0")"

echo ""
echo " ========================================"
echo "   NexTalk Node — Docker Launcher"
echo " ========================================"
echo ""

if ! command -v docker &> /dev/null; then
    echo " [ERROR] Docker CLI не найден в PATH!"
    echo " Пожалуйста, установите Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo " [ERROR] Docker демон не запущен!"
    echo " Пожалуйста, запустите службу Docker (e.g. sudo systemctl start docker) и повторите."
    exit 1
fi

echo " [INFO] Сборка и запуск контейнера..."
docker compose up -d --build

if [ $? -ne 0 ]; then
    echo " [ERROR] Сбой при запуске Docker Compose!"
    exit 1
fi

echo ""
echo " ========================================"
echo "  NexTalk Node запущен в Docker!"
echo "  HTTP / Health : http://localhost:3001/health"
echo "  WebSocket     : ws://localhost:3001"
echo " ========================================"
echo ""
echo " Показ логов (Ctrl+C для выхода из логов):"
docker compose logs -f
