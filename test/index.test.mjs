/**
 * Tests for src/index.mjs — orchestrator entry point
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mockTools = {
  fetcher: { async fetchIssues() { return []; } },
  classifier: { async classify() { return { priority: 'P3', area: 'other', severity: 'minor', summary: 'test' }; } },
  responder: { async applyLabels() { return []; }, async postComment() { return true; } },
};

describe('loadConfig', () => {
  it('exports loadConfig function', async () => {
    const mod = await import('../src/index.mjs');
    assert.equal(typeof mod.loadConfig, 'function');
  });

  it('loadConfig returns expected shape', async () => {
    const mod = await import('../src/index.mjs?' + Date.now());
    const config = mod.loadConfig();
    assert.equal(typeof config.repo, 'string');
    assert.equal(typeof config.dryRun, 'boolean');
    assert.equal(typeof config.gcpLocation, 'string');
  });
});

describe('main', () => {
  const testConfig = {
    repo: 'example/repo',
    dryRun: true,
    gcpProject: 'test-project',
    _tools: mockTools,
  };

  it('exports main as a function', async () => {
    const mod = await import('../src/index.mjs');
    assert.equal(typeof mod.main, 'function');
  });

  it('main returns triage results with correct shape', async () => {
    const mod = await import('../src/index.mjs?' + Date.now());
    const result = await mod.main(testConfig);
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
    assert.equal(typeof result.labeled, 'number');
    assert.equal(typeof result.commented, 'number');
  });

  it('main logs start and complete messages', async () => {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => chunks.push(chunk);
    try {
      const mod = await import('../src/index.mjs?' + Date.now() + 'b');
      await mod.main(testConfig);
    } finally {
      process.stderr.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('wanman-rapid-agent starting'), 'should log start');
    assert.ok(output.includes('orchestration complete'), 'should log complete');
  });

  it('main accepts configOverride parameter', async () => {
    const mod = await import('../src/index.mjs?' + Date.now() + 'c');
    const result = await mod.main(testConfig);
    assert.ok(result);
  });
});
