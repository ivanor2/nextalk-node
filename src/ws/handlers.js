'use strict';

const WebSocket = require('ws');
const log       = require('../logger');
const config    = require('../config');
const jwt       = require('../jwt');
const state     = require('./state');
const { stmts } = require('../database');

const { clients, rooms, pending } = state;

// ── Утилиты ──────────────────────────────────────────────────
function wsSend(ws, type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch (e) {}
  }
}

function broadcastToRoom(chatId, message, excludeUsername = null) {
  // Находим всех участников чата из БД
  let members = [];
  try {
    members = stmts.getChatMembers.all(Number(chatId));
  } catch (e) {}

  if (members && members.length > 0) {
    members.forEach(m => {
      if (m.username && m.username === excludeUsername) return;
      if (message.user_id && m.user_id === message.user_id) return;

      // Ищем клиента по username или user_id
      let c = m.username ? clients.get(m.username) : null;
      if (!c) {
        for (const client of clients.values()) {
          if (client.user_id === m.user_id) {
            c = client;
            break;
          }
        }
      }

      if (c && c.ws && c.ws.readyState === WebSocket.OPEN) {
        wsSend(c.ws, 'message', message);
      } else {
        // Очередь для оффлайн пользователя
        const queueKey = m.username || String(m.user_id);
        if (!pending.has(queueKey)) pending.set(queueKey, []);
        const q = pending.get(queueKey);
        if (q.length < 200) q.push({ ...message, queued_at: new Date().toISOString() });
      }
    });
    return;
  }

  // Fallback к rooms Map если чат не найден в базе
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

function deliverPending(username, userId, ws) {
  if (username) {
    const q1 = pending.get(username);
    if (q1?.length) {
      log.info(`Delivering ${q1.length} pending msgs to ${username}`);
      q1.forEach(m => wsSend(ws, 'message', m));
      pending.delete(username);
    }
  }
  if (userId) {
    const q2 = pending.get(String(userId));
    if (q2?.length) {
      log.info(`Delivering ${q2.length} pending msgs to user_id ${userId}`);
      q2.forEach(m => wsSend(ws, 'message', m));
      pending.delete(String(userId));
    }
  }
}

// ── Обработчики типов сообщений ──────────────────────────────

function handleAuth(ws, data, ctx) {
  let payload;
  try { payload = jwt.verify(data.token); }
  catch (e) {
    wsSend(ws, 'auth_error', { message: e.message });
    ws.close(4003, e.message);
    return;
  }

  clearTimeout(ctx.authTimeout);
  const username = payload.sub;

  // Вытесняем старое соединение
  if (clients.has(username)) {
    const old = clients.get(username);
    wsSend(old.ws, 'kicked', { message: 'Connected from another device' });
    old.ws.close(4005);
  }

  ctx.user = { username, user_id: payload.user_id };
  clients.set(username, { ws, rooms: new Set(), user_id: payload.user_id });

  try {
    stmts.updateMemberUsername.run(username, payload.user_id);
  } catch (e) {}

  log.info(`WS Auth: ${username}`);
  wsSend(ws, 'auth_ok', {
    node_id: config.NODE_ID,
    node_name: config.NODE_NAME,
    username,
    user_id: payload.user_id,
    server_time: new Date().toISOString(),
  });

  broadcastStatus(username, true);
  deliverPending(username, payload.user_id, ws);
}

function handleJoin(ws, data, ctx) {
  if (!ctx.user || !ctx.user.username) return;
  const chatId = String(data.chat_id || '');
  if (!chatId) return;

  if (!rooms.has(chatId)) rooms.set(chatId, new Set());
  rooms.get(chatId).add(ctx.user.username);
  const client = clients.get(ctx.user.username);
  if (client && client.rooms) {
    client.rooms.add(chatId);
  }

  wsSend(ws, 'joined', { chat_id: chatId });

  // Статусы онлайн участников комнаты
  rooms.get(chatId).forEach(u => {
    if (u !== ctx.user.username) {
      wsSend(ws, 'user_status', { username: u, online: true });
    }
  });
}

function handleSend(ws, data, ctx) {
  if (!ctx.user || !ctx.user.username) return;
  const { chat_id, content, db_message_id } = data;
  if (!chat_id || !content) return;

  const message = {
    id:        db_message_id || `ws-${Date.now()}`,
    chat_id:   String(chat_id),
    sender:    ctx.user.username,
    user_id:   ctx.user.user_id,
    content,
    timestamp: new Date().toISOString(),
  };

  wsSend(ws, 'sent', { id: message.id, chat_id: String(chat_id) });
  broadcastToRoom(chat_id, message, ctx.user.username);
}

function handleTyping(ws, data, ctx) {
  if (!ctx.user || !ctx.user.username) return;
  const { chat_id, is_typing } = data;
  const room = rooms.get(String(chat_id));
  if (!room) return;

  room.forEach(u => {
    if (u !== ctx.user.username) {
      const peer = clients.get(u);
      if (peer?.ws.readyState === WebSocket.OPEN) {
        wsSend(peer.ws, 'typing', {
          chat_id: String(chat_id),
          username: ctx.user.username,
          is_typing: !!is_typing,
        });
      }
    }
  });
}

function handlePing(ws) {
  wsSend(ws, 'pong', { server_time: new Date().toISOString() });
}

// ── Обработка закрытия ───────────────────────────────────────
function handleDisconnect(ctx) {
  if (!ctx.user) return;
  const c = clients.get(ctx.user.username);
  if (c) {
    c.rooms.forEach(chatId => {
      rooms.get(chatId)?.delete(ctx.user.username);
      if (!rooms.get(chatId)?.size) rooms.delete(chatId);
    });
    clients.delete(ctx.user.username);
  }
  log.info(`WS Disconnect: ${ctx.user.username}`);
  broadcastStatus(ctx.user.username, false);
}

module.exports = {
  wsSend,
  broadcastToRoom,
  broadcastStatus,
  deliverPending,
  handleAuth,
  handleJoin,
  handleSend,
  handleTyping,
  handlePing,
  handleDisconnect,
};
