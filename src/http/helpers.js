'use strict';

const jwt = require('../jwt');

// ── CORS ─────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

function setCors(res, req) {
  const origin = req?.headers?.origin || '';
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

// ── JSON-ответы ──────────────────────────────────────────────
function jsonRes(res, data, code = 200) {
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function jsonOk(res, data, code = 200) {
  jsonRes(res, { ok: true, ...data }, code);
}

function jsonErr(res, msg, code = 400) {
  jsonRes(res, { ok: false, error: msg }, code);
}

// ── Чтение тела запроса ──────────────────────────────────────
async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ── Извлечение Bearer-токена ─────────────────────────────────
function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// ── Auth middleware ──────────────────────────────────────────
function authMiddleware(req, res) {
  const token = getBearerToken(req);
  if (!token) { jsonErr(res, 'Authorization required', 401); return null; }
  try { return jwt.verify(token); }
  catch (e) { jsonErr(res, e.message, 401); return null; }
}

module.exports = {
  setCors,
  jsonRes,
  jsonOk,
  jsonErr,
  readBody,
  getBearerToken,
  authMiddleware,
};
