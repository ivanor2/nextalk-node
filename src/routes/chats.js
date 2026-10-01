'use strict';

const log = require('../logger');
const { jsonOk, jsonErr, readBody, authMiddleware } = require('../http/helpers');
const { stmts, transactions } = require('../database');
const wsState = require('../ws/state');

/**
 * GET  /chats     — список чатов текущего юзера
 * POST /chats     — создать приватный чат
 * GET  /chats/:id — информация о конкретном чате
 */
module.exports = {
  // ── GET /chats ────────────────────────────────────────────
  async list(req, res) {
    const p = authMiddleware(req, res);
    if (!p) return;

    try {
      const chats = stmts.getChats.all(p.user_id, p.user_id);

      const enriched = chats.map(c => ({
        ...c,
        companion_online: wsState.clients.has(c.companion_name),
        last_message_time_fmt: c.last_message_time || null,
      }));

      return jsonOk(res, { chats: enriched });
    } catch (e) {
      log.error('GET /chats', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },

  // ── POST /chats ───────────────────────────────────────────
  async create(req, res) {
    const p = authMiddleware(req, res);
    if (!p) return;

    const { target_user_id, target_username } = await readBody(req);
    if (!target_user_id) return jsonErr(res, 'target_user_id required');

    try {
      // Проверяем существует ли уже чат
      const existing = stmts.findExistingChat.get(target_user_id, p.user_id);
      if (existing) {
        return jsonOk(res, { chat_id: existing.chat_id, created: false });
      }

      // Создаём новый чат (в транзакции)
      const chatId = transactions.createChat(
        p.user_id, p.sub,
        target_user_id, target_username || ''
      );

      log.info(`Chat created: ${chatId} between ${p.user_id} and ${target_user_id}`);
      return jsonOk(res, { chat_id: chatId, created: true }, 201);
    } catch (e) {
      log.error('POST /chats', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },

  // ── GET /chats/:id ────────────────────────────────────────
  async getById(req, res, chatId) {
    const p = authMiddleware(req, res);
    if (!p) return;

    try {
      const chat = stmts.getChatById.get(p.user_id, p.user_id, chatId);
      if (!chat) return jsonErr(res, 'Chat not found or access denied', 404);

      return jsonOk(res, {
        chat: {
          ...chat,
          companion_online: wsState.clients.has(chat.companion_name),
        },
      });
    } catch (e) {
      log.error('GET /chats/:id', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },
};
