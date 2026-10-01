/**
 * NexTalk WebSocket Node v3.0 — SQLite Edition
 *
 * Точка входа. Поднимает HTTP + WebSocket сервер.
 * Вся логика разнесена по модулям в src/.
 *
 * Запуск: node server.js [PORT]
 */

'use strict';

require('dotenv').config();

const fs     = require('fs');
const http   = require('http');
const config = require('./src/config');
const log    = require('./src/logger');
const { db } = require('./src/database');
const { setCors, jsonOk, jsonErr } = require('./src/http/helpers');
const { handleAPI }   = require('./src/http/router');
const { createWSS }   = require('./src/ws');
const wsState         = require('./src/ws/state');

// ── HTTP Server ───────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  setCors(res, req);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${config.PORT}`);

  // Health
  if (url.pathname === '/health' || url.pathname === '/') {
    let dbOk = false;
    try { db.prepare('SELECT 1').get(); dbOk = true; } catch (e) {}

    return jsonOk(res, {
      node_id:           config.NODE_ID,
      name:              config.NODE_NAME,
      version:           '3.0.0',
      status:            'online',
      port:              config.PORT,
      db_type:           'sqlite',
      db_path:           config.DB_PATH,
      db_connected:      dbOk,
      connections:       wsState.clients.size,
      rooms:             wsState.rooms.size,
      total_messages:    wsState.totalMessages,
      total_connections: wsState.totalConnections,
      uptime_seconds:    Math.floor(process.uptime()),
      started_at:        wsState.startedAt,
      jwt_issuer:        config.JWT_ISSUER,
      auth_required:     true,
    });
  }

  // API
  if (url.pathname.startsWith('/api/')) {
    return handleAPI(req, res, url).catch(e => {
      log.error('Unhandled API error', { error: e.message });
      jsonErr(res, 'Internal server error', 500);
    });
  }

  res.writeHead(404); res.end('Not found');
});

// ── WebSocket Server ──────────────────────────────────────────
createWSS(httpServer);

// ── Start ─────────────────────────────────────────────────────
httpServer.listen(config.PORT, '0.0.0.0', () => {
  const dbSize = fs.existsSync(config.DB_PATH)
    ? `${(fs.statSync(config.DB_PATH).size / 1024).toFixed(1)} KB`
    : 'new';

  console.log(`
╔═══════════════════════════════════════════════════╗
║   NexTalk WebSocket Node v3.0 — SQLite Edition    ║
╠═══════════════════════════════════════════════════╣
║  Port     : ${String(config.PORT).padEnd(38)}║
║  WS       : ws://localhost:${String(config.PORT).padEnd(23)}║
║  HTTP API : http://localhost:${String(config.PORT).padEnd(21)}║
║  JWT Auth : RS256 (${config.JWT_ISSUER.padEnd(30)})║
╠═══════════════════════════════════════════════════╣
║  DB: SQLite (${dbSize.padEnd(37)})║
╚═══════════════════════════════════════════════════╝
`);
  log.info(`Server started on port ${config.PORT}`);
});

// ── Graceful Shutdown ─────────────────────────────────────────
process.on('SIGINT', () => {
  log.info('Shutdown...');
  const { wsSend } = require('./src/ws/handlers');
  wsState.clients.forEach(c => { wsSend(c.ws, 'server_shutdown', {}); c.ws.close(); });
  httpServer.close(() => { db.close(); process.exit(0); });
});

process.on('uncaughtException', err => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
});
