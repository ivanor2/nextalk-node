'use strict';

const WebSocket = require('ws');
const log       = require('../logger');
const state     = require('./state');
const handlers  = require('./handlers');

/**
 * Инициализирует WebSocket-сервер поверх HTTP-сервера.
 *
 * @param {http.Server} httpServer
 * @returns {WebSocket.Server}
 */
function createWSS(httpServer) {
  const wss = new WebSocket.Server({
    server: httpServer,
    maxPayload: 64 * 1024, // 64 KB — защита от oversized messages
  });

  wss.on('connection', (ws, req) => {
    state.totalConnections++;

    // Контекст подключения
    const ctx = { user: null, authTimeout: null };

    ctx.authTimeout = setTimeout(() => {
      if (!ctx.user) {
        handlers.wsSend(ws, 'error', { message: 'Auth timeout' });
        ws.close(4001);
      }
    }, 10000);

    ws.on('message', raw => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (e) {
        handlers.wsSend(ws, 'error', { message: 'Invalid JSON' });
        return;
      }

      const { type } = data;

      // AUTH — единственный тип, разрешённый без авторизации
      if (type === 'auth') return handlers.handleAuth(ws, data, ctx);

      // Все остальные требуют авторизации
      if (!ctx.user) {
        handlers.wsSend(ws, 'error', { message: 'Not authenticated' });
        return;
      }

      switch (type) {
        case 'join':   return handlers.handleJoin(ws, data, ctx);
        case 'send':   return handlers.handleSend(ws, data, ctx);
        case 'typing': return handlers.handleTyping(ws, data, ctx);
        case 'ping':   return handlers.handlePing(ws);
        default:
          handlers.wsSend(ws, 'error', { message: `Unknown type: ${type}` });
      }
    });

    ws.on('close', () => {
      clearTimeout(ctx.authTimeout);
      handlers.handleDisconnect(ctx);
    });

    ws.on('error', err => {
      log.error(`WS error [${ctx.user?.username || 'unauth'}]`, { error: err.message });
    });
  });

  return wss;
}

module.exports = { createWSS };
