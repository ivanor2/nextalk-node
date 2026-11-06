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

const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const config = require('./src/config');
const log = require('./src/logger');
const { db } = require('./src/database');
const { setCors, jsonOk, jsonErr } = require('./src/http/helpers');
const { handleAPI } = require('./src/http/router');
const { createWSS } = require('./src/ws');
const wsState = require('./src/ws/state');

  // ── HTTP/HTTPS Request Handler ─────────────────────────────────
  const requestListener = async (req, res) => {
    setCors(res, req);

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const hostHeader = req.headers.host || `localhost:${config.PORT}`;
    const protocol = req.socket && req.socket.encrypted ? 'https' : 'http';
    const url = new URL(req.url, `${protocol}://${hostHeader}`);

    // Health
    if (url.pathname === '/health' || url.pathname === '/' || url.pathname === '/api/health') {
      let dbOk = false;
      try { db.prepare('SELECT 1').get(); dbOk = true; } catch (e) { }

      return jsonOk(res, {
        node_id: config.NODE_ID,
        name: config.NODE_NAME,
        version: '3.0.0',
        status: 'online',
        port: config.PORT,
        db_type: 'sqlite',
        db_path: config.DB_PATH,
        db_connected: dbOk,
        connections: wsState.clients.size,
        rooms: wsState.rooms.size,
        total_messages: wsState.totalMessages,
        total_connections: wsState.totalConnections,
        uptime_seconds: Math.floor(process.uptime()),
        started_at: wsState.startedAt,
        jwt_issuer: config.JWT_ISSUER,
        auth_required: true,
        tls_enabled: Boolean(httpsServer),
      });
    }

    // API
    if (url.pathname.startsWith('/api/') || /^\/(auth|chats|messages|users|nodes)/.test(url.pathname)) {
      return handleAPI(req, res, url).catch(e => {
        log.error('Unhandled API error', { error: e.message });
        jsonErr(res, 'Internal server error', 500);
      });
    }

    res.writeHead(404); res.end('Not found');
};

const httpServer = http.createServer(requestListener);

// ── Optional TLS/WSS Server (OSPanel SSL or custom) ────────────
let httpsServer = null;
const candidateCertPaths = [
  process.env.SSL_CERT_PATH,
  'C:/OSPanel/userdata/config/cert_files/server.crt',
  'c:/OSPanel/userdata/config/cert_files/server.crt',
  path.join(__dirname, 'server.crt')
].filter(Boolean);

const candidateKeyPaths = [
  process.env.SSL_KEY_PATH,
  'C:/OSPanel/userdata/config/cert_files/server.key',
  'c:/OSPanel/userdata/config/cert_files/server.key',
  path.join(__dirname, 'server.key')
].filter(Boolean);

const foundCert = candidateCertPaths.find(p => fs.existsSync(p));
const foundKey = candidateKeyPaths.find(p => fs.existsSync(p));

if (foundCert && foundKey) {
  try {
    httpsServer = https.createServer({
      cert: fs.readFileSync(foundCert),
      key: fs.readFileSync(foundKey),
    }, requestListener);
    log.info('TLS/WSS support active', { cert: foundCert });
  } catch (err) {
    log.warn('Could not initialize TLS server', { error: err.message });
    httpsServer = null;
  }
}

// ── WebSocket Server (binds to both HTTP and HTTPS) ────────────
createWSS([httpServer, httpsServer]);

// ── LocalTunnel helper ────────────────────────────────────────
async function startTunnel() {
  if (!config.LOCALTUNNEL_ENABLED) return;

  const localtunnel = require('localtunnel');
  const opts = { port: config.PORT };
  if (config.LOCALTUNNEL_SUBDOMAIN) opts.subdomain = config.LOCALTUNNEL_SUBDOMAIN;

  try {
    const tunnel = await localtunnel(opts);

    console.log(`
╔═══════════════════════════════════════════════════╗
║  🌐 LocalTunnel active                           ║
║  URL : ${tunnel.url.padEnd(42)}║
╚═══════════════════════════════════════════════════╝
`);
    log.info(`LocalTunnel opened: ${tunnel.url}`);

    tunnel.on('close', () => {
      log.warn('LocalTunnel closed, reconnecting in 3s...');
      setTimeout(startTunnel, 3000);
    });

    tunnel.on('error', (err) => {
      log.error('LocalTunnel error', { error: err.message });
    });

    // Keep reference for graceful shutdown
    httpServer.__tunnel = tunnel;
  } catch (err) {
    log.error('Failed to open LocalTunnel', { error: err.message });
    log.info('Retrying LocalTunnel in 5s...');
    setTimeout(startTunnel, 5000);
  }
}

// ── Start ─────────────────────────────────────────────────────
  let listenerServer = httpServer;
  if (httpsServer) {
    listenerServer = net.createServer(socket => {
      socket.once('data', buf => {
        socket.pause();
        socket.unshift(buf);
        if (buf[0] === 22) { // 0x16 = TLS handshake ClientHello
          httpsServer.emit('connection', socket);
        } else {
          httpServer.emit('connection', socket);
        }
        process.nextTick(() => socket.resume());
      });
      socket.on('error', err => {
        // Ignore client connection reset
      });
    });
  }

  listenerServer.listen(config.PORT, '0.0.0.0', () => {
    const dbSize = fs.existsSync(config.DB_PATH)
      ? `${(fs.statSync(config.DB_PATH).size / 1024).toFixed(1)} KB`
      : 'new';

    console.log(`
╔═══════════════════════════════════════════════════╗
║   NexTalk WebSocket Node v3.0 — SQLite Edition    ║
╠═══════════════════════════════════════════════════╣
║  Port     : ${String(config.PORT).padEnd(38)}║
║  WS / WSS : port ${String(config.PORT).padEnd(31)}║
║  TLS Mode : ${(httpsServer ? 'ENABLED (OSPanel SSL)' : 'DISABLED').padEnd(38)}║
║  HTTP API : http://localhost:${String(config.PORT).padEnd(21)}║
║  JWT Auth : RS256 (${config.JWT_ISSUER.padEnd(30)})║
╠═══════════════════════════════════════════════════╣
║  DB: SQLite (${dbSize.padEnd(37)})║
╚═══════════════════════════════════════════════════╝
`);
    log.info(`Server started on port ${config.PORT}`, { tls: Boolean(httpsServer) });

    // Start LocalTunnel if enabled
    startTunnel();
  });

  // ── Graceful Shutdown ─────────────────────────────────────────
  process.on('SIGINT', () => {
    log.info('Shutdown...');
    if (httpServer.__tunnel) httpServer.__tunnel.close();
    const { wsSend } = require('./src/ws/handlers');
    wsState.clients.forEach(c => { wsSend(c.ws, 'server_shutdown', {}); c.ws.close(); });
    if (httpsServer) {
      try { httpsServer.close(); } catch (e) { }
    }
    if (listenerServer && listenerServer !== httpServer) {
      try { listenerServer.close(); } catch (e) { }
    }
    httpServer.close(() => { db.close(); process.exit(0); });
  });

  process.on('uncaughtException', err => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
  });

  process.on('unhandledRejection', reason => {
    log.error('Unhandled rejection', { reason: reason instanceof Error ? (reason.stack || reason.message) : String(reason) });
  });
