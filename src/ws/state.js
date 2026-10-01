'use strict';

/**
 * Глобальное состояние WebSocket-соединений.
 *
 * clients : Map<username, { ws, rooms: Set<chatId>, user_id }>
 * rooms   : Map<chatId,   Set<username>>
 * pending : Map<username,  Array<message>>  — очередь оффлайн-сообщений
 */
const clients = new Map();
const rooms   = new Map();
const pending = new Map();

let totalMessages    = 0;
let totalConnections = 0;

const startedAt = new Date().toISOString();

module.exports = {
  clients,
  rooms,
  pending,
  get totalMessages()    { return totalMessages; },
  set totalMessages(v)   { totalMessages = v; },
  get totalConnections() { return totalConnections; },
  set totalConnections(v){ totalConnections = v; },
  startedAt,
};
