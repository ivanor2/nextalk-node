'use strict';

const log = require('../logger');
const { jsonOk, jsonErr, readBody, authMiddleware } = require('../http/helpers');
const { stmts } = require('../database');
const wsState   = require('../ws/state');

/**
 * GET  /messages?chat_id=X&last_id=Y&limit=N — история сообщений
 * POST /messages                               — отправить сообщение
 */
module.exports = {
  // ── GET /messages ─────────────────────────────────────────
  async list(req, res, url) {
    const p = authMiddleware(req, res);
    if (!p) return;

    const chatId = parseInt(url.searchParams.get('chat_id') || '0');
    const lastId = parseInt(url.searchParams.get('last_id') || '0');
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);

    if (!chatId) return jsonErr(res, 'chat_id required');

    try {
      const access = stmts.checkAccess.get(chatId, p.user_id);
      if (!access) return jsonErr(res, 'Access denied', 403);

      const msgs = lastId > 0
        ? stmts.getMessagesAfter.all(chatId, lastId, limit)
        : stmts.getMessages.all(chatId, limit);

      return jsonOk(res, { messages: msgs });
    } catch (e) {
      log.error('GET /messages', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },

  // ── POST /messages ────────────────────────────────────────
  async create(req, res) {
    const p = authMiddleware(req, res);
    if (!p) return;

    const { chat_id, content } = await readBody(req);
    if (!chat_id || !content) return jsonErr(res, 'chat_id and content required');
    if (content.length > 4000) return jsonErr(res, 'Message too long');

    try {
      const access = stmts.checkAccess.get(chat_id, p.user_id);
      if (!access) return jsonErr(res, 'Access denied', 403);

      const result = stmts.insertMessage.run(chat_id, p.user_id, p.sub || '', content);
      const msgId = result.lastInsertRowid;
      wsState.totalMessages++;

      log.info(`Message saved: id=${msgId} chat=${chat_id} user=${p.sub}`);
      return jsonOk(res, { id: Number(msgId), timestamp: new Date().toISOString() }, 201);
    } catch (e) {
      log.error('POST /messages', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },
};
