/**
 * Lightweight structured logger — outputs JSON to stderr
 */

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(msg, data = {}) {
    process.stderr.write(JSON.stringify({ level: 'info', ts: timestamp(), msg, ...data }) + '\n');
  },
  error(msg, data = {}) {
    process.stderr.write(JSON.stringify({ level: 'error', ts: timestamp(), msg, ...data }) + '\n');
  },
  warn(msg, data = {}) {
    process.stderr.write(JSON.stringify({ level: 'warn', ts: timestamp(), msg, ...data }) + '\n');
  },
};
