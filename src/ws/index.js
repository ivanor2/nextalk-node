'use strict';

const WebSocket = require('ws');
const log = require('../logger');
const state = require('./state');
const handlers = require('./handlers');

/**
 * Инициализирует WebSocket-сервер поверх одного или нескольких HTTP/HTTPS-серверов.
 *
 * @param {http.Server|https.Server|Array} servers
 * @returns {WebSocket.Server}
 */
  function createWSS(servers) {
    const serverList = (Array.isArray(servers) ? servers : [servers]).filter(Boolean);
    const wss = new WebSocket.Server({
      noServer: true,
      maxPayload: 64 * 1024, // 64 KB — защита от oversized messages
    });

    const onUpgrade = (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    };

    serverList.forEach(s => {
      if (s && typeof s.on === 'function') {
        s.on('upgrade', onUpgrade);
      }
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
          case 'join': return handlers.handleJoin(ws, data, ctx);
          case 'send': return handlers.handleSend(ws, data, ctx);
          case 'typing': return handlers.handleTyping(ws, data, ctx);
          case 'ping': return handlers.handlePing(ws);
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
