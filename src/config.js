'use strict';

const crypto = require('crypto');
const path   = require('path');

// ── Сервер ───────────────────────────────────────────────────
const PORT      = parseInt(process.env.PORT || process.argv[2] || '3001');
const NODE_ID   = process.env.NODE_ID || crypto.randomBytes(8).toString('hex');
const NODE_NAME = process.env.NODE_NAME || 'NexTalk Node';

// ── JWT ──────────────────────────────────────────────────────
const JWT_ISSUER = process.env.JWT_ISSUER || 'nextalk-auth';
const JWT_TTL    = parseInt(process.env.JWT_TTL || String(86400 * 7));

// ── SQLite ───────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nextalk.db');

// ── Auth server ──────────────────────────────────────────────
const AUTH_URL = process.env.AUTH_URL || 'http://nextalk-auth';

module.exports = {
  PORT,
  NODE_ID,
  NODE_NAME,
  JWT_ISSUER,
  JWT_TTL,
  DB_PATH,
  AUTH_URL,
};
