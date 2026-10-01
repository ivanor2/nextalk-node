'use strict';

const { jsonErr, authMiddleware } = require('../http/helpers');
const { proxyAuthApi }            = require('../http/proxy');

/**
 * GET /users/search?q=X — проксируется на nextalk-auth
 * GET /nodes            — проксируется на nextalk-auth
 */
module.exports = {
  async search(req, res, url) {
    const p = authMiddleware(req, res);
    if (!p) return;

    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 1) return jsonErr(res, 'Query too short');

    return proxyAuthApi(res, 'GET', `/users/search?q=${encodeURIComponent(q)}`);
  },

  async nodes(req, res) {
    return proxyAuthApi(res, 'GET', '/nodes');
  },
};
