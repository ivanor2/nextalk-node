'use strict';

const config = require('../config');
const log    = require('../logger');
const { jsonRes, jsonErr } = require('./helpers');

/**
 * Проксирует запрос к nextalk-auth серверу.
 *
 * @param {http.ServerResponse} res
 * @param {string} method  — HTTP-метод (GET, POST)
 * @param {string} path    — путь на auth-сервере (напр. /auth/login)
 * @param {Object|null} bodyObj — тело запроса (для POST)
 */
async function proxyAuthApi(res, method, path, bodyObj = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (bodyObj) options.body = JSON.stringify(bodyObj);

    const url = `${config.AUTH_URL}${path}`;
    const response = await global.fetch(url, options);
    const data = await response.json();
    jsonRes(res, data, response.status);
  } catch (e) {
    log.error(`Proxy Auth API failed: ${path}`, { error: e.message });
    jsonErr(res, 'Auth Server Offline or Error', 502);
  }
}

module.exports = { proxyAuthApi };
