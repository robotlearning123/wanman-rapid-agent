/**
 * Tests for src/agents/triage.mjs — TriageAgent
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TriageAgent } from '../src/agents/triage.mjs';
import { AgentState } from '../src/agents/base.mjs';

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

describe('TriageAgent', () => {
  const baseConfig = {
    repo: 'test/repo',
    dryRun: true,
    gcpProject: 'test-project',
  };

  it('constructor — stores config', () => {
    const agent = new TriageAgent(baseConfig);
    assert.equal(agent.name, 'triage-agent');
    assert.equal(agent.config.repo, 'test/repo');
    assert.equal(agent.config.dryRun, true);
  });

  it('extends Agent base class', () => {
    const agent = new TriageAgent(baseConfig);
    assert.equal(typeof agent.initialize, 'function');
    assert.equal(typeof agent.run, 'function');
    assert.equal(typeof agent.stop, 'function');
    assert.equal(agent.state, AgentState.IDLE);
  });

  it('initialize — transitions to RUNNING state', async () => {
    const agent = new TriageAgent(baseConfig);
    await agent.initialize();
    assert.equal(agent.state, AgentState.RUNNING);
  });

  it('run — returns result with correct shape after initialize', async () => {
    const agent = new TriageAgent(baseConfig);
    await agent.initialize();
    const result = await agent.run();

    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
    assert.equal(typeof result.labeled, 'number');
    assert.equal(typeof result.commented, 'number');
  });

  it('run — returns zero counts when no issues exist (example/repo)', async () => {
    const agent = new TriageAgent({ ...baseConfig, repo: 'example/repo' });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 0);
    assert.equal(result.classified, 0);
    assert.equal(result.errors, 0);
  });

  it('stop — clears resources and transitions to STOPPED', async () => {
    const agent = new TriageAgent(baseConfig);
    await agent.initialize();
    await agent.stop();
    assert.equal(agent.state, AgentState.STOPPED);
  });

  it('full lifecycle — initialize → run → stop', async () => {
    const output = captureStderr(async () => {
      const agent = new TriageAgent(baseConfig);
      await agent.initialize();
      const result = await agent.run();
      assert.ok(result.total >= 0);
      await agent.stop();
    });

    assert.ok(output.includes('agent state transition'), 'should log state transitions');
  });

  it('logs triage activity to stderr', async () => {
    const output = captureStderr(async () => {
      const agent = new TriageAgent(baseConfig);
      await agent.initialize();
      await agent.run();
    });

    assert.ok(output.includes('triage agent initialized'), 'should log initialization');
  });
});
