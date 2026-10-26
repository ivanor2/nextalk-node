'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const projectRoot = path.join(__dirname, '..');
const authDir     = path.join(projectRoot, '..', 'nextalk-auth');

console.log('Generating RSA 2048 keypair for JWT (RS256)...');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Сохраняем публичный ключ в nextalk-node
const nodePublicPemPath = path.join(projectRoot, 'public.pem');
fs.writeFileSync(nodePublicPemPath, publicKey, 'utf8');
console.log(' Saved public key to:', nodePublicPemPath);

// Сохраняем приватный ключ в nextalk-auth если папка существует
if (fs.existsSync(authDir)) {
  const authPrivatePemPath = path.join(authDir, 'private.pem');
  fs.writeFileSync(authPrivatePemPath, privateKey, 'utf8');
  console.log(' Saved private key to:', authPrivatePemPath);
} else {
  console.warn(' Warning: nextalk-auth directory not found at', authDir);
}

console.log('Done!');
