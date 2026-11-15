'use strict';

const config    = require('./config');
const log       = require('./logger');
const { stmts } = require('./database');
const wsState   = require('./ws/state');

// Кэш недавно ретранслированных сообщений для предотвращения зацикливания и дублирования
const recentlyRelayed = new Map(); // key -> timestamp

function cleanOldRelayKeys() {
  const now = Date.now();
  for (const [key, ts] of recentlyRelayed.entries()) {
    if (now - ts > 30000) {
      recentlyRelayed.delete(key);
    }
  }
}
setInterval(cleanOldRelayKeys, 15000).unref();

function getRelayKey(chatId, content, senderId) {
  return `${chatId}:${senderId}:${content}`;
}

const interNode = {
  registeredNodeId: null,
  heartbeatTimer: null,

  /**
   * Инициализация узла: анонс на сервере авторизации и запуск периодического ping
   */
  async init() {
    await this.announce();
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.announce().catch(() => {}), 30000);
      if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }
  },

  /**
   * Анонс узла на сервере авторизации
   */
  async announce() {
    try {
      const payload = {
        name: config.NODE_NAME,
        url: config.NODE_URL,
        ws_url: config.NODE_WS_URL,
        node_id: this.registeredNodeId || undefined,
      };

      const res = await fetch(`${config.AUTH_URL}/nodes/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.node_id) {
          if (!this.registeredNodeId || this.registeredNodeId !== data.node_id) {
            this.registeredNodeId = data.node_id;
            log.info(`[InterNode] Registered on auth server with node_id: ${this.registeredNodeId}`, {
              url: config.NODE_URL,
              ws_url: config.NODE_WS_URL,
            });
          }
        }
      }
    } catch (e) {
      log.warn(`[InterNode] Failed to announce node to auth server (${config.AUTH_URL}): ${e.message}`);
    }
  },

  /**
   * Привязка пользователя к данному узлу в таблице user_nodes на auth-сервере
   */
  async bindUser(userId, username) {
    if (!userId) return;
    try {
      const body = {
        user_id: userId,
        username: username || '',
        node_id: this.registeredNodeId || undefined,
        node_url: config.NODE_URL,
        node_ws_url: config.NODE_WS_URL,
        node_name: config.NODE_NAME,
        is_active: 1,
      };

      const res = await fetch(`${config.AUTH_URL}/user-nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        log.info(`[InterNode] Bound user ${userId} (@${username}) to node ${this.registeredNodeId || config.NODE_URL}`);
      }
    } catch (e) {
      log.warn(`[InterNode] Error binding user ${userId} to node: ${e.message}`);
    }
  },

  /**
   * Отвязка / перевод в неактивный статус пользователя при отключении
   */
  async unbindUser(userId) {
    if (!userId) return;
    try {
      const body = {
        user_id: userId,
        node_id: this.registeredNodeId || undefined,
      };

      await fetch(`${config.AUTH_URL}/user-nodes/unbind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      log.info(`[InterNode] Unbound user ${userId} from node`);
    } catch (e) {
      // Игнорируем ошибки при shutdown
    }
  },

  /**
   * Поиск узлов для списка пользователей через таблицу user_nodes на сервере авторизации
   * @param {number[]} userIds
   * @returns {Promise<Object.<number, Array>>}
   */
  async findNodesForUsers(userIds) {
    if (!userIds || userIds.length === 0) return {};
    try {
      const idsParam = userIds.join(',');
      const res = await fetch(`${config.AUTH_URL}/user-nodes?user_ids=${encodeURIComponent(idsParam)}&active_only=1`);
      if (!res.ok) return {};
      const data = await res.json();
      return (data && data.ok && data.user_nodes) ? data.user_nodes : {};
    } catch (e) {
      log.warn(`[InterNode] Failed to query user nodes for [${userIds}]: ${e.message}`);
      return {};
    }
  },

  /**
   * Ретрансляция сообщения на другие узлы, где находятся участники чата
   */
  async relayMessage(chatId, message, senderUserId = null) {
    const numChatId = Number(chatId);
    if (!numChatId) return;

    const senderId = Number(senderUserId || message.sender_id || message.user_id || 0);
    const content = message.content || '';

    // Проверяем ключ ретрансляции, чтобы избежать повторной отправки
    const relayKey = getRelayKey(numChatId, content, senderId);
    if (recentlyRelayed.has(relayKey)) {
      return;
    }
    recentlyRelayed.set(relayKey, Date.now());

    try {
      // Получаем участников чата из локальной БД
      let members = [];
      try {
        members = stmts.getChatMembers.all(numChatId);
      } catch (e) {
        log.warn(`[InterNode] Could not fetch members for chat ${numChatId}: ${e.message}`);
      }

      if (!members || members.length === 0) return;

      // Отбираем участников, отличных от отправителя
      const otherMembers = members.filter(m => Number(m.user_id) !== senderId);
      if (otherMembers.length === 0) return;

      // Ищем узлы этих участников через сервер авторизации (таблица user_nodes)
      const otherUserIds = otherMembers.map(m => Number(m.user_id));
      const userNodesMap = await this.findNodesForUsers(otherUserIds);

      // Группируем пользователей по удаленным узлам (исключая наш текущий узел)
      const targetNodes = new Map(); // remoteNodeUrl -> { nodeId, url, userIds: Set }

      for (const uid of otherUserIds) {
        const nodes = userNodesMap[uid] || [];
        for (const n of nodes) {
          const nodeUrl = (n.node_url || '').trim().replace(/\/+$/, '');
          const myUrl = config.NODE_URL.trim().replace(/\/+$/, '');

          // Если узел чужой (не этот сервер)
          const isCurrentNode = (this.registeredNodeId && n.node_id === this.registeredNodeId) ||
                                (nodeUrl && nodeUrl === myUrl);

          if (!isCurrentNode && nodeUrl) {
            if (!targetNodes.has(nodeUrl)) {
              targetNodes.set(nodeUrl, {
                nodeId: n.node_id,
                nodeUrl,
                userIds: new Set(),
              });
            }
            targetNodes.get(nodeUrl).userIds.add(uid);
          }
        }
      }

      if (targetNodes.size === 0) {
        return; // Нет внешних узлов для отправки
      }

      // Получаем метаданные чата для синхронизации
      let chatMeta = null;
      try {
        chatMeta = stmts.getChatRaw.get(numChatId);
      } catch (e) {}

      const chatPayload = {
        id: numChatId,
        type: chatMeta?.type || 'private',
        name: chatMeta?.name || null,
        created_at: chatMeta?.created_at || null,
        members: members.map(m => ({ user_id: Number(m.user_id), username: m.username || '' })),
      };

      const messagePayload = {
        id: message.id,
        chat_id: numChatId,
        sender_id: senderId,
        username: message.username || message.sender || '',
        content: content,
        created_at: message.timestamp || message.created_at || new Date().toISOString(),
      };

      // Отправляем на каждый удаленный узел
      for (const [targetUrl, info] of targetNodes.entries()) {
        const postData = {
          source_node_id: this.registeredNodeId,
          source_node_url: config.NODE_URL,
          source_node_name: config.NODE_NAME,
          chat: chatPayload,
          message: messagePayload,
          target_user_ids: Array.from(info.userIds),
        };

        log.info(`[InterNode] Sending inter-node message chat=${numChatId} to ${targetUrl} for users [${Array.from(info.userIds)}]`);

        fetch(`${targetUrl}/api/inter-node/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Inter-Node-Secret': config.INTER_NODE_SECRET,
          },
          body: JSON.stringify(postData),
        }).then(async r => {
          if (r.ok) {
            log.info(`[InterNode] Message relayed successfully to ${targetUrl}`);
          } else {
            const errText = await r.text().catch(() => '');
            log.warn(`[InterNode] Remote node ${targetUrl} responded with ${r.status}: ${errText}`);
          }
        }).catch(err => {
          log.warn(`[InterNode] Failed to reach remote node ${targetUrl}: ${err.message}`);
        });
      }
    } catch (err) {
      log.error('[InterNode] Error during relayMessage', { error: err.message });
    }
  },

  /**
   * Обработка входящего межузлового сообщения (POST /api/inter-node/message)
   */
  handleIncoming(req, res, body) {
    if (!body || !body.chat || !body.message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid inter-node payload' }));
      return;
    }

    const { chat, message, source_node_id } = body;
    const numChatId = Number(chat.id || message.chat_id);
    const senderId = Number(message.sender_id || 0);
    const content = String(message.content || '');

    // Помечаем в ретрансляторе чтобы не отправлять обратно
    const relayKey = getRelayKey(numChatId, content, senderId);
    recentlyRelayed.set(relayKey, Date.now());

    try {
      // 1. Синхронизируем структуру чата в локальную SQLite
      stmts.ensureChat.run(numChatId, chat.type || 'private', chat.name || null, chat.created_at || null);

      if (Array.isArray(chat.members)) {
        for (const m of chat.members) {
          if (m && m.user_id) {
            stmts.ensureChatMember.run(numChatId, Number(m.user_id), m.username || '');
          }
        }
      }

      // 2. Проверяем, существует ли уже это сообщение в локальной БД
      let localMsgId = null;
      const existing = stmts.findMessageByDetails.get(numChatId, senderId, content);

      if (existing) {
        localMsgId = existing.id;
      } else {
        // Пробуем сохранить с исходным ID (если число), либо с автоинкрементом
        const msgTimestamp = message.created_at || new Date().toISOString();
        if (message.id && typeof message.id === 'number') {
          try {
            const r = stmts.insertRemoteMessageWithId.run(
              message.id,
              numChatId,
              senderId,
              message.username || '',
              content,
              msgTimestamp
            );
            if (r.changes > 0) {
              localMsgId = message.id;
            }
          } catch (e) {
            // Если ID занят другой записью
          }
        }

        if (!localMsgId) {
          const r = stmts.insertRemoteMessage.run(
            numChatId,
            senderId,
            message.username || '',
            content,
            msgTimestamp
          );
          localMsgId = Number(r.lastInsertRowid);
        }
        wsState.totalMessages++;
      }

      // 3. Доставляем локальным WebSocket клиентам
      const wsMessage = {
        id: localMsgId || message.id || `node-${Date.now()}`,
        chat_id: String(numChatId),
        sender: message.username || '',
        sender_id: senderId,
        user_id: senderId,
        content: content,
        timestamp: message.created_at || new Date().toISOString(),
        inter_node: true,
        source_node_id: source_node_id || null,
      };

      const { broadcastToRoom } = require('./ws/handlers');
      broadcastToRoom(numChatId, wsMessage, null);

      log.info(`[InterNode] Processed incoming message for chat=${numChatId} sender=${senderId} local_id=${localMsgId}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: true, message_id: localMsgId }));
    } catch (e) {
      log.error('[InterNode] Error handling incoming inter-node message', { error: e.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  },
};

module.exports = interNode;

