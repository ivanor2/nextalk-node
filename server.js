/**
 * NexTalk WebSocket Node v3.0 — DB Gateway + Real-time
 *
 * Узел является ЕДИНСТВЕННОЙ точкой доступа к MySQL.
 * PHP-frontend обращается к узлу через HTTP REST API.
 * Клиентский браузер подключается через WebSocket.
 *
 * HTTP REST API (для PHP):
 *   POST /api/auth/login          — вход (username + password)
 *   POST /api/auth/register       — регистрация
 *   GET  /api/chats               — список чатов текущего юзера
 *   POST /api/chats               — создать/найти приватный чат
 *   GET  /api/chats/:id           — инфо о чате + собеседник
 *   GET  /api/messages            — история сообщений (?chat_id=X&last_id=Y)
 *   POST /api/messages            — сохранить сообщение в БД
 *   GET  /api/users/search        — поиск пользователей (?q=X)
 *
 * WebSocket (для браузера):
 *   → { type:'auth', token }       — JWT-авторизация
 *   → { type:'join', chat_id }     — войти в комнату
 *   → { type:'send', chat_id, content, db_message_id } — трансляция
 *   → { type:'typing', chat_id, is_typing }
 *   → { type:'ping' }
 *
 * Запуск: node server.js [PORT]
 */

'use strict';

require('dotenv').config();

const WebSocket = require('ws');
const http      = require('http');
const crypto    = require('crypto');
const mysql     = require('mysql2/promise');

// ── Конфигурация ─────────────────────────────────────────────
const PORT      = parseInt(process.env.PORT || process.argv[2] || '3001');
const NODE_ID   = process.env.NODE_ID || crypto.randomBytes(8).toString('hex');
const NODE_NAME = process.env.NODE_NAME || 'NexTalk Node';

// JWT (должен совпадать с nextalk-auth/config.php)
const JWT_ISSUER = process.env.JWT_ISSUER || 'nextalk-auth';
const JWT_TTL    = parseInt(process.env.JWT_TTL || String(86400 * 7));

// MySQL (тот же хост что и у OSPanel)
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.DB_PORT || '3306');
const DB_NAME = process.env.DB_NAME || 'messenger';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '';

// ── MySQL Pool ───────────────────────────────────────────────
let pool = null;

async function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host:             DB_HOST,
    port:             DB_PORT,
    database:         DB_NAME,
    user:             DB_USER,
    password:         DB_PASS,
    charset:          'utf8mb4',
    waitForConnections: true,
    connectionLimit:  10,
    enableKeepAlive:  true,
  });
  return pool;
}

async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// ── JWT Verifier (HMAC-SHA256, без внешних библиотек) ────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  return Buffer.from(pad ? b64 + '='.repeat(4 - pad) : b64, 'base64');
}

const fs = require('fs');
const publicKey = fs.readFileSync(__dirname + '/public.pem', 'utf8');

function verifyJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [h, p, sig] = parts;
  
  const header = JSON.parse(base64urlDecode(h).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('Unsupported algorithm');

  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`);
  
  const isValid = verify.verify(publicKey, base64urlDecode(sig));
  if (!isValid) throw new Error('Invalid signature');

  const payload = JSON.parse(base64urlDecode(p).toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000))
    throw new Error('Token expired');
  if (payload.iss && payload.iss !== JWT_ISSUER)
    throw new Error('Invalid issuer');
  return payload;
}

// signJWT is no longer needed on the node, it's proxying to auth
function signJWT(payload) {
  throw new Error("Node should not sign JWTs directly!");
}

// ── Logging ───────────────────────────────────────────────────
function log(level, msg, data) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  data ? console.log(line, JSON.stringify(data)) : console.log(line);
}

// ── HTTP helpers ──────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonRes(res, data, code = 200) {
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function jsonOk(res, data, code = 200)  { jsonRes(res, { ok: true,  ...data }, code); }
function jsonErr(res, msg, code = 400)  { jsonRes(res, { ok: false, error: msg }, code); }

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function authMiddleware(req, res) {
  const token = getBearerToken(req);
  if (!token) { jsonErr(res, 'Authorization required', 401); return null; }
  try { return verifyJWT(token); }
  catch(e) { jsonErr(res, e.message, 401); return null; }
}

async function proxyAuthApi(res, method, path, bodyObj = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (bodyObj) options.body = JSON.stringify(bodyObj);

    const authUrl = `http://nextalk-auth${path}`;
    const response = await global.fetch(authUrl, options);
    const data = await response.json();
    jsonRes(res, data, response.status);
  } catch (e) {
    log('ERROR', `Proxy Auth API failed: ${path}`, { error: e.message });
    jsonErr(res, 'Auth Server Offline or Error', 502);
  }
}


// ── WebSocket state ───────────────────────────────────────────
const clients = new Map(); // username → { ws, rooms, user_id }
const rooms   = new Map(); // chatId  → Set<username>
const pending = new Map(); // username → Array<msg>

let totalMessages = 0, totalConnections = 0;
const startedAt = new Date().toISOString();

// ── HTTP REST API handlers ────────────────────────────────────

async function handleAPI(req, res, url) {
  const method   = req.method;
  const pathname = url.pathname.replace(/^\/api/, '');

  // ── POST /auth/login ────────────────────────────────────────
  if (method === 'POST' && pathname === '/auth/login') {
    const body = await readBody(req);
    return proxyAuthApi(res, 'POST', '/auth/login', body);
  }

  // ── POST /auth/register ─────────────────────────────────────
  if (method === 'POST' && pathname === '/auth/register') {
    const body = await readBody(req);
    return proxyAuthApi(res, 'POST', '/auth/register', body);
  }

  // ── GET /chats ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/chats') {
    const p = authMiddleware(req, res);
    if (!p) return;

    try {
      const chats = await query(`
        SELECT
          c.id, c.type, c.name,
          m.content    AS last_message,
          m.created_at AS last_message_time,
          m.sender_id  AS last_sender_id,
          u2.id        AS companion_id,
          u2.username  AS companion_name
        FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
        LEFT JOIN messages m ON m.id = (
          SELECT id FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1
        )
        LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != ?
        LEFT JOIN users u2 ON u2.id = cm2.user_id
        WHERE c.type = 'private'
        GROUP BY c.id, m.id, u2.id, u2.username
        ORDER BY last_message_time DESC
      `, [p.user_id, p.user_id]);

      // Обогащаем: онлайн-статус из WS-клиентов
      const enriched = chats.map(c => ({
        ...c,
        companion_online: clients.has(c.companion_name),
        last_message_time_fmt: c.last_message_time
          ? new Date(c.last_message_time).toISOString()
          : null,
      }));

      return jsonOk(res, { chats: enriched });

    } catch(e) {
      log('ERROR', 'GET /chats', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  }

  // ── POST /chats ─────────────────────────────────────────────
  if (method === 'POST' && pathname === '/chats') {
    const p = authMiddleware(req, res);
    if (!p) return;

    const { target_user_id } = await readBody(req);
    if (!target_user_id) return jsonErr(res, 'target_user_id required');

    try {
      // Проверяем существует ли уже чат между этими двумя
      const existing = await query(`
        SELECT cm1.chat_id FROM chat_members cm1
        JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id = ?
        WHERE cm1.user_id = ?
        LIMIT 1
      `, [target_user_id, p.user_id]);

      if (existing.length) {
        return jsonOk(res, { chat_id: existing[0].chat_id, created: false });
      }

      // Создаём новый чат
      const result = await query("INSERT INTO chats (type) VALUES ('private')");
      const chatId = result.insertId;
      await query(
        'INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)',
        [chatId, p.user_id, chatId, target_user_id]
      );

      log('INFO', `Chat created: ${chatId} between ${p.user_id} and ${target_user_id}`);
      return jsonOk(res, { chat_id: chatId, created: true }, 201);

    } catch(e) {
      log('ERROR', 'POST /chats', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  }

  // ── GET /chats/:id ──────────────────────────────────────────
  const chatMatch = pathname.match(/^\/chats\/(\d+)$/);
  if (method === 'GET' && chatMatch) {
    const p = authMiddleware(req, res);
    if (!p) return;
    const chatId = parseInt(chatMatch[1]);

    try {
      const rows = await query(`
        SELECT c.id, c.type, c.name,
               u2.id AS companion_id, u2.username AS companion_name
        FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
        LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != ?
        LEFT JOIN users u2 ON u2.id = cm2.user_id
        WHERE c.id = ?
      `, [p.user_id, p.user_id, chatId]);

      if (!rows.length) return jsonErr(res, 'Chat not found or access denied', 404);

      const chat = rows[0];
      return jsonOk(res, {
        chat: {
          ...chat,
          companion_online: clients.has(chat.companion_name),
        },
      });

    } catch(e) {
      log('ERROR', 'GET /chats/:id', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  }

  // ── GET /messages?chat_id=X&last_id=Y&limit=N ───────────────
  if (method === 'GET' && pathname === '/messages') {
    const p = authMiddleware(req, res);
    if (!p) return;

    const chatId = parseInt(url.searchParams.get('chat_id') || '0');
    const lastId = parseInt(url.searchParams.get('last_id') || '0');
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);

    if (!chatId) return jsonErr(res, 'chat_id required');

    try {
      // Проверяем доступ
      const access = await query(
        'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
        [chatId, p.user_id]
      );
      if (!access.length) return jsonErr(res, 'Access denied', 403);

      let msgs;
      if (lastId > 0) {
        // Polling: только новые
        msgs = await query(`
          SELECT m.id, m.content, m.created_at, m.sender_id, u.username
          FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.chat_id = ? AND m.id > ?
          ORDER BY m.created_at ASC LIMIT ?
        `, [chatId, lastId, limit]);
      } else {
        // Начальная загрузка
        msgs = await query(`
          SELECT m.id, m.content, m.created_at, m.sender_id, u.username
          FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.chat_id = ?
          ORDER BY m.created_at ASC LIMIT ?
        `, [chatId, limit]);
      }

      return jsonOk(res, { messages: msgs });

    } catch(e) {
      log('ERROR', 'GET /messages', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  }

  // ── POST /messages ──────────────────────────────────────────
  if (method === 'POST' && pathname === '/messages') {
    const p = authMiddleware(req, res);
    if (!p) return;

    const { chat_id, content } = await readBody(req);
    if (!chat_id || !content) return jsonErr(res, 'chat_id and content required');
    if (content.length > 4000) return jsonErr(res, 'Message too long');

    try {
      // Проверяем доступ
      const access = await query(
        'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
        [chat_id, p.user_id]
      );
      if (!access.length) return jsonErr(res, 'Access denied', 403);

      const result = await query(
        'INSERT INTO messages (chat_id, sender_id, content) VALUES (?, ?, ?)',
        [chat_id, p.user_id, content]
      );
      const msgId = result.insertId;
      await query('UPDATE users SET last_seen = NOW() WHERE id = ?', [p.user_id]);
      totalMessages++;

      log('INFO', `Message saved: id=${msgId} chat=${chat_id} user=${p.sub}`);
      return jsonOk(res, { id: msgId, timestamp: new Date().toISOString() }, 201);

    } catch(e) {
      log('ERROR', 'POST /messages', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  }

  // ── GET /users/search?q=X ───────────────────────────────────
  if (method === 'GET' && pathname === '/users/search') {
    const p = authMiddleware(req, res);
    if (!p) return;

    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 1) return jsonErr(res, 'Query too short');

    // proxy to auth server
    return proxyAuthApi(res, 'GET', `/users/search?q=${encodeURIComponent(q)}`);
  }

  // ── GET /nodes ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/nodes') {
    return proxyAuthApi(res, 'GET', '/nodes');
  }

  jsonErr(res, `Not found: ${method} /api${pathname}`, 404);
}

// ── HTTP Server ───────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health
  if (url.pathname === '/health' || url.pathname === '/') {
    let dbOk = false;
    try { await query('SELECT 1'); dbOk = true; } catch(e) {}

    return jsonOk(res, {
      node_id:           NODE_ID,
      name:              NODE_NAME,
      version:           '3.0.0',
      status:            'online',
      port:              PORT,
      db_connected:      dbOk,
      db_host:           `${DB_HOST}:${DB_PORT}`,
      db_name:           DB_NAME,
      connections:       clients.size,
      rooms:             rooms.size,
      total_messages:    totalMessages,
      total_connections: totalConnections,
      uptime_seconds:    Math.floor(process.uptime()),
      started_at:        startedAt,
      jwt_issuer:        JWT_ISSUER,
      auth_required:     true,
    });
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    return handleAPI(req, res, url).catch(e => {
      log('ERROR', 'Unhandled API error', { error: e.message });
      jsonErr(res, 'Internal server error', 500);
    });
  }

  res.writeHead(404); res.end('Not found');
});

// ── WebSocket Server ──────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

function wsSend(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch(e) {}
  }
}

function broadcastToRoom(chatId, message, excludeUsername = null) {
  const room = rooms.get(String(chatId));
  if (!room) return;
  room.forEach(username => {
    if (username === excludeUsername) return;
    const c = clients.get(username);
    if (c?.ws.readyState === WebSocket.OPEN) {
      wsSend(c.ws, 'message', message);
    } else {
      if (!pending.has(username)) pending.set(username, []);
      const q = pending.get(username);
      if (q.length < 200) q.push({ ...message, queued_at: new Date().toISOString() });
    }
  });
}

function broadcastStatus(username, online) {
  clients.forEach((c, u) => {
    if (u !== username) wsSend(c.ws, 'user_status', { username, online });
  });
}

function deliverPending(username, ws) {
  const q = pending.get(username);
  if (!q?.length) return;
  log('INFO', `Delivering ${q.length} pending msgs to ${username}`);
  q.forEach(m => wsSend(ws, 'message', m));
  pending.delete(username);
}

wss.on('connection', (ws, req) => {
  totalConnections++;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  let user = null;

  const authTimeout = setTimeout(() => {
    if (!user) { wsSend(ws, 'error', { message: 'Auth timeout' }); ws.close(4001); }
  }, 10000);

  ws.on('message', async raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch(e) {
      wsSend(ws, 'error', { message: 'Invalid JSON' }); return;
    }

    const { type } = data;

    // ── AUTH ──────────────────────────────────────────────────
    if (type === 'auth') {
      let payload;
      try { payload = verifyJWT(data.token); }
      catch(e) {
        wsSend(ws, 'auth_error', { message: e.message });
        ws.close(4003, e.message); return;
      }

      clearTimeout(authTimeout);
      const username = payload.sub;

      // Вытесняем старое соединение
      if (clients.has(username)) {
        const old = clients.get(username);
        wsSend(old.ws, 'kicked', { message: 'Connected from another device' });
        old.ws.close(4005);
      }

      user = { username, user_id: payload.user_id };
      clients.set(username, { ws, rooms: new Set(), user_id: payload.user_id });

      log('INFO', `WS Auth: ${username}`);
      wsSend(ws, 'auth_ok', {
        node_id: NODE_ID, node_name: NODE_NAME,
        username, user_id: payload.user_id,
        server_time: new Date().toISOString(),
      });

      broadcastStatus(username, true);
      deliverPending(username, ws);
      return;
    }

    if (!user) { wsSend(ws, 'error', { message: 'Not authenticated' }); return; }

    // ── JOIN room ─────────────────────────────────────────────
    if (type === 'join') {
      const chatId = String(data.chat_id || '');
      if (!chatId) return;
      if (!rooms.has(chatId)) rooms.set(chatId, new Set());
      rooms.get(chatId).add(user.username);
      clients.get(user.username).rooms.add(chatId);
      wsSend(ws, 'joined', { chat_id: chatId });

      // Статусы онлайн участников комнаты
      rooms.get(chatId).forEach(u => {
        if (u !== user.username) wsSend(ws, 'user_status', { username: u, online: true });
      });
      return;
    }

    // ── SEND — только трансляция, БД уже обновил PHP ─────────
    if (type === 'send') {
      const { chat_id, content, db_message_id } = data;
      if (!chat_id || !content) return;

      const message = {
        id:        db_message_id || `ws-${Date.now()}`,
        chat_id:   String(chat_id),
        sender:    user.username,
        user_id:   user.user_id,
        content,
        timestamp: new Date().toISOString(),
      };

      wsSend(ws, 'sent', { id: message.id, chat_id: String(chat_id) });
      broadcastToRoom(chat_id, message, user.username);
      return;
    }

    // ── TYPING ────────────────────────────────────────────────
    if (type === 'typing') {
      const { chat_id, is_typing } = data;
      const room = rooms.get(String(chat_id));
      if (!room) return;
      room.forEach(u => {
        if (u !== user.username) {
          const peer = clients.get(u);
          if (peer?.ws.readyState === WebSocket.OPEN) {
            wsSend(peer.ws, 'typing', {
              chat_id: String(chat_id),
              username: user.username,
              is_typing: !!is_typing,
            });
          }
        }
      });
      return;
    }

    // ── PING ─────────────────────────────────────────────────
    if (type === 'ping') {
      wsSend(ws, 'pong', { server_time: new Date().toISOString() }); return;
    }

    wsSend(ws, 'error', { message: `Unknown type: ${type}` });
  });

  ws.on('close', code => {
    clearTimeout(authTimeout);
    if (!user) return;
    const c = clients.get(user.username);
    if (c) {
      c.rooms.forEach(chatId => {
        rooms.get(chatId)?.delete(user.username);
        if (!rooms.get(chatId)?.size) rooms.delete(chatId);
      });
      clients.delete(user.username);
    }
    log('INFO', `WS Disconnect: ${user.username}`);
    broadcastStatus(user.username, false);
  });

  ws.on('error', err => {
    log('ERROR', `WS error [${user?.username || 'unauth'}]`, { error: err.message });
  });
});

// ── Start ─────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', async () => {
  // Проверяем соединение с БД
  let dbStatus = 'CONNECTING';
  try {
    await query('SELECT 1');
    dbStatus = `OK (${DB_HOST}:${DB_PORT}/${DB_NAME})`;
  } catch(e) {
    dbStatus = `FAILED: ${e.message}`;
  }

  console.log(`
╔═══════════════════════════════════════════════════╗
║      NexTalk WebSocket Node v3.0 — DB Gateway     ║
╠═══════════════════════════════════════════════════╣
║  Node ID  : ${NODE_ID}                ║
║  Port     : ${PORT}                               ║
║  WS       : ws://localhost:${PORT}                ║
║  HTTP API : http://localhost:${PORT}/api/...      ║
║  Health   : http://localhost:${PORT}/health       ║
║  JWT Auth : HS256 (${JWT_ISSUER})        ║
╠═══════════════════════════════════════════════════╣
║  DB: ${dbStatus.padEnd(45)}║
╚═══════════════════════════════════════════════════╝
`);
  log('INFO', `Server started on port ${PORT}. DB: ${dbStatus}`);
});

process.on('SIGINT', () => {
  log('INFO', 'Shutdown...');
  clients.forEach(c => { wsSend(c.ws, 'server_shutdown', {}); c.ws.close(); });
  httpServer.close(() => { pool?.end(); process.exit(0); });
});

process.on('uncaughtException', err => {
  log('ERROR', 'Uncaught exception', { error: err.message, stack: err.stack });
});
