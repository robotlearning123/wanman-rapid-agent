/**
 * Tests for src/agents/triage.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TriageAgent } from '../src/agents/triage.mjs';

describe('TriageAgent', () => {
  it('constructor — stores repo and dryRun', () => {
    const agent = new TriageAgent({ repo: 'owner/repo', dryRun: false });
    assert.equal(agent.repo, 'owner/repo');
    assert.equal(agent.dryRun, false);
  });

  it('constructor — defaults dryRun to true', () => {
    const agent = new TriageAgent({ repo: 'owner/repo' });
    assert.equal(agent.dryRun, true);
  });

  it('run — returns total, classified, errors', async () => {
    const agent = new TriageAgent({ repo: 'test/repo', dryRun: true });
    const result = await agent.run();
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
  });

  it('run — returns zero counts when no issues exist', async () => {
    const agent = new TriageAgent({ repo: 'test/repo', dryRun: true });
    const result = await agent.run();
    assert.equal(result.total, 0);
    assert.equal(result.classified, 0);
    assert.equal(result.errors, 0);
  });

  it('run — logs to stderr without throwing', async () => {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => chunks.push(chunk);
    try {
      const agent = new TriageAgent({ repo: 'test/repo', dryRun: true });
      await agent.run();
    } finally {
      process.stderr.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('fetching open issues'), 'should log fetching');
    assert.ok(output.includes('classifying issues'), 'should log classifying');
  });
});
