'use strict';

const { readBody }     = require('../http/helpers');
const { proxyAuthApi } = require('../http/proxy');

/**
 * POST /auth/login  — проксируется на nextalk-auth
 * POST /auth/register — проксируется на nextalk-auth
 */
module.exports = {
  async login(req, res) {
    const body = await readBody(req);
    return proxyAuthApi(res, 'POST', '/auth/login', body);
  },

  async register(req, res) {
    const body = await readBody(req);
    return proxyAuthApi(res, 'POST', '/auth/register', body);
  },
};
