/**
 * Tests for src/index.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('main', () => {
  it('exports main as a function', async () => {
    const mod = await import('../src/index.mjs');
    assert.equal(typeof mod.main, 'function');
  });

  it('main returns triage results with correct shape', async () => {
    const mod = await import('../src/index.mjs?' + Date.now());
    const result = await mod.main();
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
  });

  it('main logs start and complete messages', async () => {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => chunks.push(chunk);
    try {
      const mod = await import('../src/index.mjs?' + Date.now() + 'b');
      await mod.main();
    } finally {
      process.stderr.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('wanman-rapid-agent starting'), 'should log start');
    assert.ok(output.includes('triage complete'), 'should log complete');
  });
});
