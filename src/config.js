'use strict';

const crypto = require('crypto');
const path   = require('path');

// ── Сервер ───────────────────────────────────────────────────
const PORT      = parseInt(process.argv[2] || process.env.PORT || '3001');
const NODE_ID   = process.env.NODE_ID || crypto.randomBytes(8).toString('hex');
const defaultName = PORT === 3001 ? 'Локальный узел (Node 1)' : `Локальный узел (Node ${PORT})`;
const NODE_NAME = process.env.NODE_NAME
  ? (PORT === 3001 ? process.env.NODE_NAME : `${process.env.NODE_NAME} (${PORT})`)
  : defaultName;

// ── JWT ──────────────────────────────────────────────────────
const JWT_ISSUER = process.env.JWT_ISSUER || 'nextalk-auth';
const JWT_TTL    = parseInt(process.env.JWT_TTL || String(86400 * 7));

// ── SQLite ───────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(
  __dirname, '..', 'data',
  PORT === 3001 ? 'nextalk.db' : `nextalk-${PORT}.db`
);

// ── Auth server ──────────────────────────────────────────────
const AUTH_URL = process.env.AUTH_URL || 'http://nextalk-auth';

// ── Межузловое взаимодействие (Inter-Node) ────────────────────
const NODE_URL          = process.env.NODE_URL || `http://localhost:${PORT}`;
const NODE_WS_URL       = process.env.NODE_WS_URL || `ws://localhost:${PORT}`;
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET || 'nextalk_inter_node_secret';

// ── LocalTunnel ─────────────────────────────────────────────
const LOCALTUNNEL_ENABLED   = (process.env.LOCALTUNNEL_ENABLED || '').toLowerCase() === 'true';
const baseLtSubdomain       = process.env.LOCALTUNNEL_SUBDOMAIN || '';
const LOCALTUNNEL_SUBDOMAIN = baseLtSubdomain
  ? (PORT === 3001 ? baseLtSubdomain : `${baseLtSubdomain}-${PORT}`)
  : '';

module.exports = {
  PORT,
  NODE_ID,
  NODE_NAME,
  NODE_URL,
  NODE_WS_URL,
  INTER_NODE_SECRET,
  JWT_ISSUER,
  JWT_TTL,
  DB_PATH,
  AUTH_URL,
  LOCALTUNNEL_ENABLED,
  LOCALTUNNEL_SUBDOMAIN,
};
