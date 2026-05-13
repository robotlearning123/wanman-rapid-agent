/**
 * Tests for src/agents/triage.mjs — TriageAgent
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TriageAgent } from '../src/agents/triage.mjs';
import { AgentState } from '../src/agents/base.mjs';

function captureStderrAsync(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => chunks.push(chunk);
  return fn().finally(() => {
    process.stderr.write = original;
  }).then(() => chunks.join(''));
}

function makeMockTools({ issues = [], classification = { priority: 'P2', area: 'bug', severity: 'major', summary: 'test' } } = {}) {
  return {
    fetcher: {
      async fetchIssues() { return issues; },
    },
    classifier: {
      async classify() { return classification; },
    },
    responder: {
      async applyLabels() { return ['priority:P2', 'area:bug']; },
      async postComment() { return true; },
    },
  };
}

describe('TriageAgent', () => {
  const baseConfig = {
    repo: 'test/repo',
    dryRun: true,
    gcpProject: 'test-project',
    _tools: makeMockTools(),
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
    const agent = new TriageAgent({ ...baseConfig, _tools: makeMockTools({ issues: [] }) });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
    assert.equal(typeof result.labeled, 'number');
    assert.equal(typeof result.commented, 'number');
  });

  it('run — returns zero counts when no issues exist', async () => {
    const agent = new TriageAgent({ ...baseConfig, _tools: makeMockTools({ issues: [] }) });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 0);
    assert.equal(result.classified, 0);
    assert.equal(result.errors, 0);
  });

  it('run — classifies issues and applies labels', async () => {
    const mockIssues = [
      { number: 1, title: 'Bug report', body: 'Something broke', labels: ['bug'], url: 'https://github.com/test/repo/issues/1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', author: 'dev' },
      { number: 2, title: 'Feature request', body: 'Add dark mode', labels: [], url: 'https://github.com/test/repo/issues/2', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', author: 'user' },
    ];
    const tools = makeMockTools({ issues: mockIssues });
    const agent = new TriageAgent({ ...baseConfig, _tools: tools });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 2);
    assert.equal(result.classified, 2);
    assert.equal(result.labeled, 2);
    assert.equal(result.commented, 2);
    assert.equal(result.errors, 0);
    assert.equal(result.details.length, 2);
  });

  it('stop — clears resources and transitions to STOPPED', async () => {
    const agent = new TriageAgent(baseConfig);
    await agent.initialize();
    await agent.stop();
    assert.equal(agent.state, AgentState.STOPPED);
  });

  it('full lifecycle — initialize → run completes to IDLE', async () => {
    const output = await captureStderrAsync(async () => {
      const agent = new TriageAgent(baseConfig);
      await agent.initialize();
      const result = await agent.run();
      assert.ok(result.total >= 0);
      assert.equal(agent.state, AgentState.IDLE);
    });

    assert.ok(output.includes('agent state transition'), 'should log state transitions');
  });

  it('logs triage activity to stderr', async () => {
    const output = await captureStderrAsync(async () => {
      const agent = new TriageAgent(baseConfig);
      await agent.initialize();
      await agent.run();
    });

    assert.ok(output.includes('triage agent initialized'), 'should log initialization');
  });
});
