#!/usr/bin/env bash
# ==============================================================================
# NexTalk Node.js Local Installer (Linux / macOS)
# Автоматическая загрузка и распаковка портативного Node.js в папку проекта
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_DIR=""
VERSION=""
FORCE=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --force|-f)
            FORCE=1
            shift
            ;;
        --target-dir|-t)
            TARGET_DIR="$2"
            shift 2
            ;;
        --version|-v)
            VERSION="$2"
            shift 2
            ;;
        *)
            if [ -z "$VERSION" ]; then
                VERSION="$1"
            fi
            shift
            ;;
    esac
done

# Чтение из .env при наличии
if [ -f "$PROJECT_ROOT/.env" ]; then
    if [ -z "$VERSION" ]; then
        VAL=$(grep -E '^NODE_VERSION=' "$PROJECT_ROOT/.env" | cut -d '=' -f2- | tr -d '"'\'' ')
        [ -n "$VAL" ] && VERSION="$VAL"
    fi
    if [ -z "$TARGET_DIR" ]; then
        VAL=$(grep -E '^LOCAL_NODE_DIR=' "$PROJECT_ROOT/.env" | cut -d '=' -f2- | tr -d '"'\'' ')
        [ -n "$VAL" ] && TARGET_DIR="$VAL"
    fi
fi

VERSION="${VERSION:-v22.13.0}"
[[ "$VERSION" != v* ]] && VERSION="v$VERSION"

TARGET_DIR="${TARGET_DIR:-.node}"
if [[ "$TARGET_DIR" != /* ]]; then
    TARGET_DIR="$PROJECT_ROOT/$TARGET_DIR"
fi

NODE_BIN="$TARGET_DIR/bin/node"

if [ -f "$NODE_BIN" ] && [ "$FORCE" -eq 0 ]; then
    CURRENT_VER=$("$NODE_BIN" -v 2>/dev/null || true)
    echo -e "\033[32m [INFO] Локальный Node.js уже установлен: $CURRENT_VER ($NODE_BIN)\033[0m"
    exit 0
fi

echo ""
echo -e "\033[36m ========================================================\033[0m"
echo -e "\033[36m   Загрузка портативного Node.js $VERSION\033[0m"
echo -e "\033[36m   Целевая папка: $TARGET_DIR\033[0m"
echo -e "\033[36m ========================================================\033[0m"
echo ""

# Определение ОС и архитектуры
OS_TYPE="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH_TYPE="$(uname -m)"

case "$ARCH_TYPE" in
    x86_64|amd64)
        NODE_ARCH="x64"
        ;;
    arm64|aarch64)
        NODE_ARCH="arm64"
        ;;
    *)
        echo -e "\033[31m [ERROR] Неподдерживаемая архитектура: $ARCH_TYPE\033[0m"
        exit 1
        ;;
esac

DIST_NAME="node-$VERSION-$OS_TYPE-$NODE_ARCH"
TAR_URL="https://nodejs.org/dist/$VERSION/$DIST_NAME.tar.gz"
TEMP_TAR="$PROJECT_ROOT/node_temp_download.tar.gz"
TMP_EXTRACT="$PROJECT_ROOT/.node_extract_tmp"

cleanup() {
    rm -rf "$TMP_EXTRACT" "$TEMP_TAR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo -e "\033[33m [1/3] Скачивание $TAR_URL...\033[0m"
if command -v curl &>/dev/null; then
    curl -fSL --progress-bar "$TAR_URL" -o "$TEMP_TAR"
elif command -v wget &>/dev/null; then
    wget -q --show-progress "$TAR_URL" -O "$TEMP_TAR"
else
    echo -e "\033[31m [ERROR] Не найден ни curl, ни wget!\033[0m"
    exit 1
fi

echo -e "\033[33m [2/3] Распаковка архива...\033[0m"
rm -rf "$TMP_EXTRACT"
mkdir -p "$TMP_EXTRACT"
tar -xzf "$TEMP_TAR" -C "$TMP_EXTRACT"

EXTRACTED_INNER="$TMP_EXTRACT/$DIST_NAME"
if [ ! -d "$EXTRACTED_INNER" ]; then
    EXTRACTED_INNER=$(find "$TMP_EXTRACT" -mindepth 1 -maxdepth 1 -type d | head -n 1)
fi

echo -e "\033[33m [3/3] Перемещение файлов в $TARGET_DIR...\033[0m"
mkdir -p "$TARGET_DIR"
cp -a "$EXTRACTED_INNER/." "$TARGET_DIR/"

if [ ! -f "$NODE_BIN" ]; then
    echo -e "\033[31m [ERROR] Файл $NODE_BIN не найден после распаковки!\033[0m"
    exit 1
fi

chmod +x "$TARGET_DIR/bin/"* 2>/dev/null || true

INSTALLED_VER=$("$NODE_BIN" -v)
echo ""
echo -e "\033[32m [SUCCESS] Локальный Node.js успешно установлен: $INSTALLED_VER\033[0m"
echo -e "\033[32m Расположение: $NODE_BIN\033[0m"
echo ""
