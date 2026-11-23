# ==============================================================================
# Dockerfile — NexTalk WebSocket Node (Node.js 22 + SQLite + WebSockets)
# ==============================================================================

FROM node:22-alpine

# Устанавливаем su-exec (для безопасного запуска от непривилегированного пользователя)
# и wget (для healthcheck)
RUN apk add --no-cache su-exec wget

WORKDIR /app

# Переменные окружения по умолчанию
ENV NODE_ENV=production \
    PORT=3001

# Копируем только файлы манифестов пакетов для кэширования слоев
COPY package*.json ./

# Устанавливаем только production-зависимости
RUN npm ci --omit=dev --no-audit --no-fund

# Копируем entrypoint-скрипт и настраиваем права
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# Копируем исходный код приложения и ключ авторизации
COPY src/ ./src/
COPY server.js ./
COPY public.pem ./
COPY scripts/ ./scripts/

# Создаем директорию для базы данных SQLite и назначаем владельца node
RUN mkdir -p /app/data && chown -R node:node /app

# Экспонируем порт сервера
EXPOSE 3001

# Том для персистентного хранения SQLite базы данных
VOLUME ["/app/data"]

# Проверка работоспособности сервиса
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-3001}/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
