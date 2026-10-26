#!/usr/bin/env bash
# ==============================================================================
# NexTalk WebSocket Node Launcher (Linux/Mac)
# ==============================================================================

echo ""
echo " ========================================"
echo "   NexTalk WebSocket Node Launcher"
echo " ========================================"
echo ""

# Переходим в папку со скриптом
cd "$(dirname "$0")"

# Настройки по умолчанию
USE_LOCAL_NODE="true"
LOCAL_NODE_DIR=".node"
NODE_VERSION="v22.13.0"
PORT=""
ACTION_DOWNLOAD_ONLY=0

# Чтение из .env при наличии
if [ -f ".env" ]; then
    VAL=$(grep -E '^USE_LOCAL_NODE=' .env | cut -d '=' -f2- | tr -d '"'\'' ')
    [ -n "$VAL" ] && USE_LOCAL_NODE="$VAL"
    VAL=$(grep -E '^LOCAL_NODE_DIR=' .env | cut -d '=' -f2- | tr -d '"'\'' ')
    [ -n "$VAL" ] && LOCAL_NODE_DIR="$VAL"
    VAL=$(grep -E '^NODE_VERSION=' .env | cut -d '=' -f2- | tr -d '"'\'' ')
    [ -n "$VAL" ] && NODE_VERSION="$VAL"
    VAL=$(grep -E '^PORT=' .env | cut -d '=' -f2- | tr -d '"'\'' ')
    [ -n "$VAL" ] && PORT="$VAL"
fi

# Разбор аргументов
while [ "$#" -gt 0 ]; do
    case "$1" in
        --local)
            USE_LOCAL_NODE="true"
            shift
            ;;
        --system)
            USE_LOCAL_NODE="false"
            shift
            ;;
        --download-node|--setup-node)
            ACTION_DOWNLOAD_ONLY=1
            shift
            ;;
        *)
            PORT="$1"
            shift
            ;;
    esac
done

if [ "$ACTION_DOWNLOAD_ONLY" -eq 1 ]; then
    echo " [ACTION] Принудительная загрузка локального Node.js..."
    bash scripts/setup-local-node.sh --force --target-dir "$LOCAL_NODE_DIR" --version "$NODE_VERSION"
    exit 0
fi

if [ "$USE_LOCAL_NODE" = "true" ] || [ "$USE_LOCAL_NODE" = "1" ] || [ "$USE_LOCAL_NODE" = "yes" ]; then
    LOCAL_NODE_BIN="$LOCAL_NODE_DIR/bin/node"
    if [ ! -f "$LOCAL_NODE_BIN" ]; then
        echo " [INFO] Режим локального Node.js активен (USE_LOCAL_NODE=$USE_LOCAL_NODE)."
        echo " [INFO] Локальный Node.js не найден в '$LOCAL_NODE_DIR'."
        echo " [INFO] Запускается автоматическая загрузка Node.js $NODE_VERSION..."
        echo ""
        bash scripts/setup-local-node.sh --target-dir "$LOCAL_NODE_DIR" --version "$NODE_VERSION"
    fi

    if [ ! -f "$LOCAL_NODE_BIN" ]; then
        echo " [ERROR] Локальный бинарник $LOCAL_NODE_BIN не найден после установки!"
        exit 1
    fi

    export PATH="$(pwd)/$LOCAL_NODE_DIR/bin:$PATH"
    echo " [OK] Локальный Node.js подключен: $(node -v)"
else
    echo " [INFO] Режим системного Node.js (USE_LOCAL_NODE=false)."
    if ! command -v node &> /dev/null; then
        echo " [ERROR] Системный Node.js не найден!"
        echo " Ubuntu/Debian: sudo apt install nodejs npm"
        echo " Mac: brew install node"
        echo " Или включите локальный режим (USE_LOCAL_NODE=true в .env)"
        exit 1
    fi
    echo " [OK] Используется системный Node.js: $(node -v)"
fi

echo ""

# Устанавливаем зависимости если нужно
if [ ! -d "node_modules/ws" ]; then
    echo " Устанавливаем зависимости..."
    npm install
    echo ""
fi

PORT="${PORT:-3001}"

echo " Запуск узла на порту $PORT..."
echo " WebSocket: ws://localhost:$PORT"
echo " Health:    http://localhost:$PORT/health"
echo ""
echo " IP адреса этого устройства:"
hostname -I 2>/dev/null || ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1
echo ""
echo " Нажмите Ctrl+C для остановки"
echo ""

node server.js "$PORT"
