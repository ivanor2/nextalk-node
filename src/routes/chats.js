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

    const body = await readBody(req);
    const { type, name, members, target_user_id, target_username } = body;

    // Групповой чат
    if (type === 'group') {
      const groupName = (name || '').trim();
      if (!groupName) return jsonErr(res, 'Group name required');

      try {
        const memberList = Array.isArray(members) ? members : [];
        const chatId = transactions.createGroup(p.user_id, p.sub, groupName, memberList);
        log.info(`Group chat created: ${chatId} (${groupName}) by ${p.user_id}`);
        return jsonOk(res, { chat_id: chatId, created: true, type: 'group', name: groupName }, 201);
      } catch (e) {
        log.error('POST /chats (group)', { error: e.message });
        return jsonErr(res, e.message, 500);
      }
    }

    // Приватный чат
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

      let members = [];
      try {
        members = stmts.getChatMembers.all(chatId);
      } catch (me) {}

      return jsonOk(res, {
        chat: {
          ...chat,
          members,
          companion_online: wsState.clients.has(chat.companion_name),
        },
      });
    } catch (e) {
      log.error('GET /chats/:id', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },

  // ── POST /chats/:id/members ────────────────────────────────
  async addMember(req, res, chatId) {
    const p = authMiddleware(req, res);
    if (!p) return;

    try {
      const access = stmts.checkAccess.get(chatId, p.user_id);
      if (!access) return jsonErr(res, 'Access denied', 403);

      const body = await readBody(req);
      const { user_id, username } = body;
      const targetUserId = parseInt(user_id || '0');
      if (!targetUserId) return jsonErr(res, 'user_id required', 400);

      stmts.addChatMember.run(chatId, targetUserId, username || '');
      log.info(`Member ${targetUserId} (${username}) added to chat ${chatId} by ${p.user_id}`);

      return jsonOk(res, { added: true, chat_id: chatId, user_id: targetUserId, username: username || '' });
    } catch (e) {
      log.error('POST /chats/:id/members', { error: e.message });
      return jsonErr(res, e.message, 500);
    }
  },
};
