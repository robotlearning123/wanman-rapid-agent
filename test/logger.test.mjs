/**
 * Tests for src/utils/logger.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../src/utils/logger.mjs';

function captureStderr(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => chunks.push(chunk);
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

describe('logger', () => {
  it('info — outputs valid JSON with level "info"', () => {
    const output = captureStderr(() => logger.info('hello'));
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'hello');
    assert.ok(parsed.ts, 'should have timestamp');
  });

  it('info — merges data into the JSON object', () => {
    const output = captureStderr(() => logger.info('test', { count: 42 }));
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.count, 42);
  });

  it('error — outputs valid JSON with level "error"', () => {
    const output = captureStderr(() => logger.error('something broke'));
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.msg, 'something broke');
  });

  it('error — merges data into the JSON object', () => {
    const output = captureStderr(() => logger.error('fail', { code: 'E001' }));
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.code, 'E001');
  });

  it('warn — outputs valid JSON with level "warn"', () => {
    const output = captureStderr(() => logger.warn('careful'));
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.level, 'warn');
    assert.equal(parsed.msg, 'careful');
  });

  it('defaults data to empty object when omitted', () => {
    const output = captureStderr(() => logger.info('no data'));
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'no data');
    // Should only have level, ts, msg — no extra keys
    assert.deepEqual(Object.keys(parsed).filter(k => k !== 'ts'), ['level', 'msg']);
  });

  it('timestamp is a valid ISO date string', () => {
    const output = captureStderr(() => logger.info('ts check'));
    const parsed = JSON.parse(output.trim());
    const date = new Date(parsed.ts);
    assert.ok(!isNaN(date.getTime()), 'ts should be a valid date');
  });
});
