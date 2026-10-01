'use strict';

const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const minLevel = levels[process.env.LOG_LEVEL] || levels.INFO;

function log(level, msg, data) {
  if ((levels[level] ?? 0) < minLevel) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  data ? console.log(line, JSON.stringify(data)) : console.log(line);
}

module.exports = {
  debug: (msg, data) => log('DEBUG', msg, data),
  info:  (msg, data) => log('INFO',  msg, data),
  warn:  (msg, data) => log('WARN',  msg, data),
  error: (msg, data) => log('ERROR', msg, data),
};
