'use strict';

const log      = require('../logger');
const { jsonErr } = require('./helpers');

const authRoutes     = require('../routes/auth');
const chatsRoutes    = require('../routes/chats');
const messagesRoutes = require('../routes/messages');
const usersRoutes    = require('../routes/users');

/**
 * Маршрутизатор HTTP API.
 * Разбирает pathname и делегирует в соответствующий route-модуль.
 */
async function handleAPI(req, res, url) {
  const method   = req.method;
  const pathname = url.pathname.replace(/^\/api/, '');

  // ── Auth (proxy → nextalk-auth) ────────────────────────────
  if (method === 'POST' && pathname === '/auth/login')    return authRoutes.login(req, res);
  if (method === 'POST' && pathname === '/auth/register') return authRoutes.register(req, res);

  // ── Chats ──────────────────────────────────────────────────
  if (method === 'GET'  && pathname === '/chats') return chatsRoutes.list(req, res);
  if (method === 'POST' && pathname === '/chats') return chatsRoutes.create(req, res);

  const chatMatch = pathname.match(/^\/chats\/(\d+)$/);
  if (method === 'GET' && chatMatch) {
    return chatsRoutes.getById(req, res, parseInt(chatMatch[1]));
  }

  // ── Messages ───────────────────────────────────────────────
  if (method === 'GET'  && pathname === '/messages') return messagesRoutes.list(req, res, url);
  if (method === 'POST' && pathname === '/messages') return messagesRoutes.create(req, res);

  // ── Users (proxy → nextalk-auth) ──────────────────────────
  if (method === 'GET' && pathname === '/users/search') return usersRoutes.search(req, res, url);
  if (method === 'GET' && pathname === '/nodes')        return usersRoutes.nodes(req, res);

  // ── 404 ────────────────────────────────────────────────────
  jsonErr(res, `Not found: ${method} /api${pathname}`, 404);
}

module.exports = { handleAPI };
