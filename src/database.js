'use strict';

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');
const config   = require('./config');
const log      = require('./logger');

// Создаём директорию data если не существует
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.DB_PATH);

// Оптимизации SQLite
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ── Автоматическая миграция ──────────────────────────────────
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT    NOT NULL DEFAULT 'private',
      name       TEXT    DEFAULT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id  INTEGER NOT NULL,
      user_id  INTEGER NOT NULL,
      username TEXT    NOT NULL DEFAULT '',
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      UNIQUE(chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    INTEGER NOT NULL,
      sender_id  INTEGER NOT NULL,
      username   TEXT    NOT NULL DEFAULT '',
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_chat ON chat_members(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat     ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id  ON messages(chat_id, id);
  `);

  log.info('Database migrated', { path: config.DB_PATH });
}

migrate();

// ── Prepared Statements ──────────────────────────────────────
const stmts = {
  // GET /chats — список чатов юзера
  getChats: db.prepare(`
    SELECT
      c.id, c.type, c.name,
      (SELECT content    FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_time,
      (SELECT sender_id  FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_sender_id,
      cm2.user_id  AS companion_id,
      cm2.username AS companion_name
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
    LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != ?
    WHERE c.type = 'private'
    ORDER BY last_message_time DESC
  `),

  // POST /chats — поиск существующего
  findExistingChat: db.prepare(`
    SELECT cm1.chat_id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id = ?
    WHERE cm1.user_id = ?
    LIMIT 1
  `),

  // POST /chats — создание
  createChat: db.prepare("INSERT INTO chats (type) VALUES ('private')"),
  addChatMember: db.prepare('INSERT INTO chat_members (chat_id, user_id, username) VALUES (?, ?, ?)'),

  // GET /chats/:id
  getChatById: db.prepare(`
    SELECT c.id, c.type, c.name,
           cm2.user_id AS companion_id, cm2.username AS companion_name
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
    LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != ?
    WHERE c.id = ?
  `),

  // Проверка доступа к чату
  checkAccess: db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'),

  // GET /messages — начальная загрузка
  getMessages: db.prepare(`
    SELECT id, content, created_at, sender_id, username
    FROM messages WHERE chat_id = ?
    ORDER BY created_at ASC LIMIT ?
  `),

  // GET /messages — polling новых
  getMessagesAfter: db.prepare(`
    SELECT id, content, created_at, sender_id, username
    FROM messages WHERE chat_id = ? AND id > ?
    ORDER BY created_at ASC LIMIT ?
  `),

  // POST /messages
  insertMessage: db.prepare(
    'INSERT INTO messages (chat_id, sender_id, username, content) VALUES (?, ?, ?, ?)'
  ),

  // Health check
  healthCheck: db.prepare('SELECT 1'),
};

// ── Транзакции ───────────────────────────────────────────────
const transactions = {
  createChat: db.transaction((userId, username, targetUserId, targetUsername) => {
    const result = stmts.createChat.run();
    const chatId = result.lastInsertRowid;
    stmts.addChatMember.run(chatId, userId, username);
    stmts.addChatMember.run(chatId, targetUserId, targetUsername || '');
    return chatId;
  }),
};

module.exports = { db, stmts, transactions };
