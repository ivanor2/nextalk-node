#!/bin/sh
set -e

# Создаем директорию для данных SQLite если не существует
mkdir -p /app/data

# Настраиваем права доступа к папке данных (актуально при монтировании томов с хоста)
chown -R node:node /app/data 2>/dev/null || true
chmod 775 /app/data 2>/dev/null || true

# Если запуск от root, понижаем привилегии до пользователя node через su-exec
if [ "$(id -u)" = "0" ]; then
    exec su-exec node "$@"
fi

exec "$@"
