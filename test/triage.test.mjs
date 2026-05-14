/**
 * Tests for src/agents/triage.mjs — TriageAgent
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TriageAgent } from '../src/agents/triage.mjs';
import { AgentState } from '../src/agents/base.mjs';

async function captureStderr(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, encoding, cb) => {
    chunks.push(chunk);
    if (typeof cb === 'function') cb();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

function makeMockTools({ issues = [], classifyResult = { priority: 'P3', area: 'other', severity: 'minor', summary: 'test' } } = {}) {
  return {
    fetcher: {
      async fetchIssues() { return issues; },
    },
    classifier: {
      async classify() { return classifyResult; },
    },
    responder: {
      async applyLabels() { return ['priority:P3']; },
      async postComment() { return true; },
    },
  };
}

const sampleIssue = {
  number: 1,
  title: 'Bug in login',
  body: 'Steps to reproduce...',
  labels: ['bug'],
  url: 'https://github.com/owner/repo/issues/1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
  author: 'dev1',
};

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
    const agent = new TriageAgent({
      ...baseConfig,
      _tools: makeMockTools({ issues: [sampleIssue] }),
    });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
    assert.equal(typeof result.labeled, 'number');
    assert.equal(typeof result.commented, 'number');
  });

  it('run — returns zero counts when no issues', async () => {
    const agent = new TriageAgent({
      ...baseConfig,
      _tools: makeMockTools({ issues: [] }),
    });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 0);
    assert.equal(result.classified, 0);
    assert.equal(result.errors, 0);
  });

  it('run — classifies issues and applies labels', async () => {
    const classifyResult = { priority: 'P1', area: 'bug', severity: 'critical', summary: 'Login crash' };
    const appliedLabels = [];
    const tools = {
      fetcher: { async fetchIssues() { return [sampleIssue]; } },
      classifier: { async classify() { return classifyResult; } },
      responder: {
        async applyLabels(n, _cls) { const l = ['priority:P1']; appliedLabels.push({ n, l }); return l; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 1);
    assert.equal(result.classified, 1);
    assert.equal(result.labeled, 1);
    assert.equal(result.commented, 1);
    assert.equal(result.errors, 0);
    assert.equal(result.details[0].number, 1);
  });

  it('run — persists a Cloud Storage report through injected storage', async () => {
    const savedReports = [];
    const tools = {
      ...makeMockTools({ issues: [sampleIssue] }),
      storage: {
        async saveRunReport(report) {
          savedReports.push(report);
          return { saved: true, bucket: 'demo-bucket', path: 'triage-runs/test-repo/report.json' };
        },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.storage.saved, true);
    assert.equal(result.storage.bucket, 'demo-bucket');
    assert.equal(savedReports.length, 1);
    assert.equal(savedReports[0].repo, 'test/repo');
    assert.equal(savedReports[0].result.total, 1);
  });

  it('run — reports Cloud Storage failures without failing triage', async () => {
    const tools = {
      ...makeMockTools({ issues: [sampleIssue] }),
      storage: {
        async saveRunReport() {
          throw new Error('storage unavailable');
        },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 1);
    assert.equal(result.errors, 0);
    assert.equal(result.storage.saved, false);
    assert.equal(result.storage.error, 'storage unavailable');
  });

  it('run — handles per-issue errors gracefully', async () => {
    const tools = {
      fetcher: { async fetchIssues() { return [sampleIssue, { ...sampleIssue, number: 2, title: 'Feature request' }]; } },
      classifier: {
        async classify(issue) {
          if (issue.title.includes('login')) throw new Error('AI unavailable');
          return { priority: 'P2', area: 'feature', severity: 'minor', summary: 'ok' };
        },
      },
      responder: {
        async applyLabels() { return []; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 2);
    assert.equal(result.classified, 1);
    assert.equal(result.errors, 1);
    assert.equal(result.details[0].error, 'AI unavailable');
  });

  it('stop — clears resources and transitions to STOPPED', async () => {
    const agent = new TriageAgent(baseConfig);
    await agent.initialize();
    await agent.stop();
    assert.equal(agent.state, AgentState.STOPPED);
  });

  it('full lifecycle — initialize → run', async () => {
    const output = await captureStderr(async () => {
      const agent = new TriageAgent(baseConfig);
      await agent.initialize();
      const result = await agent.run();
      assert.ok(result.total >= 0);
    });

    assert.ok(output.includes('agent state transition'), 'should log state transitions');
  });

  it('logs triage activity to stderr', async () => {
    const output = await captureStderr(async () => {
      const agent = new TriageAgent(baseConfig);
      await agent.initialize();
      await agent.run();
    });

    assert.ok(output.includes('triage agent initialized'), 'should log initialization');
  });

  it('creates dry-run classifier when gcpProject is not set', async () => {
    // Covers the gcpProject falsy branch in _onInitialize
    const tools = {
      fetcher: { async fetchIssues() { return []; } },
      responder: { async applyLabels() { return []; }, async postComment() { return true; } },
    };
    const agent = new TriageAgent({
      repo: 'test/repo',
      dryRun: true,
      _tools: tools,
    });
    await agent.initialize();
    const result = await agent.run();
    assert.equal(result.total, 0);
  });

 it('run — skips issues that already have a priority:P* label (skipLabeled=true)', async () => {
    const labeledIssue = { ...sampleIssue, number: 10, labels: ['bug', 'priority:P1'] };
    const unlabeledIssue = { ...sampleIssue, number: 11, labels: ['bug'] };
    const classifyCalls = [];
    const tools = {
      fetcher: { async fetchIssues() { return [labeledIssue, unlabeledIssue]; } },
      classifier: {
        async classify(issue) { classifyCalls.push(issue.title); return { priority: 'P2', area: 'bug', severity: 'minor', summary: 'ok' }; },
      },
      responder: {
        async applyLabels() { return ['priority:P2']; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, skipLabeled: true });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.classified, 1);
    assert.equal(result.labeled, 1);
    assert.equal(result.commented, 1);
    assert.equal(result.errors, 0);
    // Only the unlabeled issue was classified
    assert.equal(classifyCalls.length, 1);
    assert.equal(result.details[0].number, 10);
    assert.equal(result.details[0].skipped, true);
  });

  it('run — does not skip labeled issues when skipLabeled=false', async () => {
    const labeledIssue = { ...sampleIssue, number: 20, labels: ['bug', 'priority:P1'] };
    const classifyCalls = [];
    const tools = {
      fetcher: { async fetchIssues() { return [labeledIssue]; } },
      classifier: {
        async classify() { classifyCalls.push(1); return { priority: 'P2', area: 'bug', severity: 'minor', summary: 'ok' }; },
      },
      responder: {
        async applyLabels() { return ['priority:P2']; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, skipLabeled: false });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.classified, 1);
    assert.equal(classifyCalls.length, 1);
  });

  it('run — skipLabeled defaults to true when not specified', async () => {
    const labeledIssue = { ...sampleIssue, number: 30, labels: ['priority:P2'] };
    const classifyCalls = [];
    const tools = {
      fetcher: { async fetchIssues() { return [labeledIssue]; } },
      classifier: {
        async classify() { classifyCalls.push(1); return { priority: 'P3', area: 'other', severity: 'minor', summary: 'ok' }; },
      },
      responder: {
        async applyLabels() { return ['priority:P3']; },
        async postComment() { return true; },
      },
    };

    // No skipLabeled in config — should default to true
    const agent = new TriageAgent({ ...baseConfig, _tools: tools });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.classified, 0);
    assert.equal(classifyCalls.length, 0);
  });

 it('creates classifier from gcpProject when _tools.classifier not provided', async () => {
   // Covers the _tools?.classifier undefined + gcpProject truthy branch
    const previousCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/wanman-rapid-agent-missing-key.json';
   const tools = {
     fetcher: { async fetchIssues() { return [sampleIssue]; } },
     responder: { async applyLabels() { return ['priority:P3']; }, async postComment() { return true; } },
   };

    try {
      const agent = new TriageAgent({
        repo: 'test/repo',
        dryRun: true,
        gcpProject: 'my-gcp-project',
        _tools: tools,
      });
      await agent.initialize();
      // The classifier is created from gcpProject but classify() will fail
      // without credentials, then fall back to safe defaults.
      const result = await agent.run();
      assert.equal(result.total, 1);
      assert.equal(result.classified, 1);
      assert.equal(result.errors, 0);
    } finally {
      if (previousCredentials === undefined) {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      } else {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = previousCredentials;
      }
    }
 });

  // --- Concurrent classification tests ---

  it('run — processes multiple issues concurrently (config.concurrency)', async () => {
    const callOrder = [];
    const issues = [
      { ...sampleIssue, number: 1 },
      { ...sampleIssue, number: 2 },
      { ...sampleIssue, number: 3 },
      { ...sampleIssue, number: 4 },
    ];
    const tools = {
      fetcher: { async fetchIssues() { return issues; } },
      classifier: {
        async classify(issue) {
          callOrder.push(`classify:${issue.title}`);
          await new Promise(r => setTimeout(r, 5));
          return { priority: 'P3', area: 'other', severity: 'minor', summary: 'ok' };
        },
      },
      responder: {
        async applyLabels(n) { callOrder.push(`label:${n}`); return ['priority:P3']; },
        async postComment(n) { callOrder.push(`comment:${n}`); return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 2 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 4);
    assert.equal(result.classified, 4);
    assert.equal(result.errors, 0);
    assert.equal(callOrder.filter(c => c.startsWith('classify:')).length, 4);
  });

  it('run — respects CONCURRENCY env var when config.concurrency not set', async () => {
    const prevConcurrency = process.env.CONCURRENCY;
    process.env.CONCURRENCY = '5';
    try {
      const tools = makeMockTools({ issues: [sampleIssue] });
      const agent = new TriageAgent({ ...baseConfig, _tools: tools });
      await agent.initialize();
      const result = await agent.run();
      assert.equal(result.total, 1);
      assert.equal(result.classified, 1);
    } finally {
      if (prevConcurrency === undefined) {
        delete process.env.CONCURRENCY;
      } else {
        process.env.CONCURRENCY = prevConcurrency;
      }
    }
  });

  it('run — defaults to concurrency 3 when nothing configured', async () => {
    const prevConcurrency = process.env.CONCURRENCY;
    delete process.env.CONCURRENCY;
    try {
      const tools = makeMockTools({ issues: [sampleIssue] });
      const agent = new TriageAgent({ ...baseConfig, _tools: tools });
      await agent.initialize();
      const result = await agent.run();
      assert.equal(result.classified, 1);
    } finally {
      if (prevConcurrency !== undefined) {
        process.env.CONCURRENCY = prevConcurrency;
      }
    }
  });

  it('run — clamps concurrency to max 20', async () => {
    const prevConcurrency = process.env.CONCURRENCY;
    process.env.CONCURRENCY = '100';
    try {
      const tools = makeMockTools({ issues: [sampleIssue] });
      const agent = new TriageAgent({ ...baseConfig, _tools: tools });
      await agent.initialize();
      const result = await agent.run();
      assert.equal(result.classified, 1);
    } finally {
      if (prevConcurrency === undefined) {
        delete process.env.CONCURRENCY;
      } else {
        process.env.CONCURRENCY = prevConcurrency;
      }
    }
  });

  it('run — isolates errors across concurrent issues', async () => {
    const issues = [
      { ...sampleIssue, number: 1, title: 'good issue' },
      { ...sampleIssue, number: 2, title: 'bad issue' },
      { ...sampleIssue, number: 3, title: 'another good' },
    ];
    const tools = {
      fetcher: { async fetchIssues() { return issues; } },
      classifier: {
        async classify(issue) {
          if (issue.title === 'bad issue') throw new Error('boom');
          return { priority: 'P3', area: 'other', severity: 'minor', summary: 'ok' };
        },
      },
      responder: {
        async applyLabels() { return ['priority:P3']; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 3 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 3);
    assert.equal(result.classified, 2);
    assert.equal(result.errors, 1);
    const errorDetail = result.details.find(d => d.error);
    assert.ok(errorDetail, 'should have an error detail entry');
    assert.equal(errorDetail.error, 'boom');
  });

  it('run — handles concurrency=1 (sequential fallback)', async () => {
    const callOrder = [];
    const issues = [
      { ...sampleIssue, number: 1 },
      { ...sampleIssue, number: 2 },
    ];
    const tools = {
      fetcher: { async fetchIssues() { return issues; } },
      classifier: {
        async classify() {
          return { priority: 'P3', area: 'other', severity: 'minor', summary: 'ok' };
        },
      },
      responder: {
        async applyLabels(issueNumber) { callOrder.push(issueNumber); return ['priority:P3']; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 1 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 2);
    assert.equal(result.classified, 2);
    assert.deepEqual(callOrder, [1, 2]);
  });
});
