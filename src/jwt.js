'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');

// ── Base64url helpers ────────────────────────────────────────
function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  return Buffer.from(pad ? b64 + '='.repeat(4 - pad) : b64, 'base64');
}

// ── Загрузка публичного ключа ────────────────────────────────
const publicKeyPath = path.join(__dirname, '..', 'public.pem');
const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

// ── Верификация JWT (RS256) ──────────────────────────────────
function verify(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [h, p, sig] = parts;

  const header = JSON.parse(base64urlDecode(h).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('Unsupported algorithm');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);

  const isValid = verifier.verify(publicKey, base64urlDecode(sig));
  if (!isValid) throw new Error('Invalid signature');

  const payload = JSON.parse(base64urlDecode(p).toString('utf8'));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000))
    throw new Error('Token expired');
  if (payload.iss && payload.iss !== config.JWT_ISSUER)
    throw new Error('Invalid issuer');

  return payload;
}

module.exports = { verify };
