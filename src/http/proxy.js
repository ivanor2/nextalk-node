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
  let response;
  let rawText = '';
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (bodyObj) options.body = JSON.stringify(bodyObj);

    const url = `${config.AUTH_URL}${path}`;
    response = await global.fetch(url, options);
    rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      const startObj = rawText.indexOf('{');
      const startArr = rawText.indexOf('[');
      let jsonStart = -1;
      if (startObj !== -1 && startArr !== -1) {
        jsonStart = Math.min(startObj, startArr);
      } else {
        jsonStart = startObj !== -1 ? startObj : startArr;
      }

      if (jsonStart !== -1) {
        try {
          data = JSON.parse(rawText.slice(jsonStart));
        } catch {
          throw parseErr;
        }
      } else {
        throw parseErr;
      }
    }
    jsonRes(res, data, response.status);
  } catch (e) {
    const snippet = rawText ? rawText.slice(0, 300).replace(/\s+/g, ' ').trim() : null;
    log.error(`Proxy Auth API failed: ${path}`, {
      error: e.message,
      status: response ? response.status : undefined,
      bodySnippet: snippet || undefined,
    });
    jsonErr(res, 'Auth Server Offline or Error', 502);
  }
}

module.exports = { proxyAuthApi };
