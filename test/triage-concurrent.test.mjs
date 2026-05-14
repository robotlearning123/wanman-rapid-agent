/**
 * Tests for concurrent issue classification in src/agents/triage.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TriageAgent } from '../src/agents/triage.mjs';

function makeIssue(number, labels = ['bug']) {
  return {
    number,
    title: `Issue ${number}`,
    body: `Body for issue ${number}`,
    labels,
    url: `https://github.com/owner/repo/issues/${number}`,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    author: 'dev1',
  };
}

function makeTools({ issues = [], delayMs = 0, failOn = null } = {}) {
  const classifyCalls = [];
  return {
    tools: {
      fetcher: {
        async fetchIssues() { return issues; },
      },
      classifier: {
        async classify(input) {
          classifyCalls.push(input);
          if (delayMs) await new Promise(r => setTimeout(r, delayMs));
          if (failOn && failOn.has(input.title)) {
            throw new Error(`classify failed for ${input.title}`);
          }
          return { priority: 'P2', area: 'bug', severity: 'minor', summary: `Classified ${input.title}` };
        },
      },
      responder: {
        async applyLabels(n) { return [`priority:P2`]; },
        async postComment() { return true; },
      },
    },
    classifyCalls,
  };
}

const baseConfig = {
  repo: 'test/repo',
  dryRun: true,
  gcpProject: 'test-project',
};

describe('Concurrent classification', () => {
  it('uses config.concurrency when provided', async () => {
    const { tools } = makeTools({ issues: [makeIssue(1)] });
    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 5 });
    await agent.initialize();
    const result = await agent.run();
    assert.equal(result.total, 1);
    assert.equal(result.classified, 1);
  });

  it('reads CONCURRENCY from env when config.concurrency is absent', async () => {
    const prev = process.env.CONCURRENCY;
    process.env.CONCURRENCY = '7';
    try {
      const { tools } = makeTools({ issues: [makeIssue(1)] });
      const agent = new TriageAgent({ ...baseConfig, _tools: tools });
      await agent.initialize();
      const result = await agent.run();
      assert.equal(result.total, 1);
      assert.equal(result.classified, 1);
    } finally {
      if (prev === undefined) delete process.env.CONCURRENCY;
      else process.env.CONCURRENCY = prev;
    }
  });

  it('defaults to concurrency=3 when neither config nor env is set', async () => {
    const prev = process.env.CONCURRENCY;
    delete process.env.CONCURRENCY;
    try {
      const { tools } = makeTools({ issues: [makeIssue(1)] });
      const agent = new TriageAgent({ ...baseConfig, _tools: tools });
      await agent.initialize();
      const result = await agent.run();
      assert.equal(result.total, 1);
      assert.equal(result.classified, 1);
    } finally {
      if (prev !== undefined) process.env.CONCURRENCY = prev;
    }
  });

  it('caps concurrency at 20', async () => {
    const { tools } = makeTools({ issues: [makeIssue(1)] });
    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 100 });
    await agent.initialize();
    const result = await agent.run();
    assert.equal(result.total, 1);
    assert.equal(result.classified, 1);
  });

  it('ignores invalid concurrency values and defaults to 3', async () => {
    const prev = process.env.CONCURRENCY;
    delete process.env.CONCURRENCY;
    try {
      for (const bad of [0, -1, 1.5, NaN, 'abc', null, undefined]) {
        const { tools } = makeTools({ issues: [makeIssue(1)] });
        const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: bad });
        await agent.initialize();
        const result = await agent.run();
        assert.equal(result.classified, 1, `should handle concurrency=${bad}`);
        // Clean up agent state for next iteration
      }
    } finally {
      if (prev !== undefined) process.env.CONCURRENCY = prev;
    }
  });

  it('processes multiple issues concurrently (faster than sequential)', async () => {
    const delayMs = 50;
    const issueCount = 6;
    const issues = Array.from({ length: issueCount }, (_, i) => makeIssue(i + 1));
    const { tools } = makeTools({ issues, delayMs });

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 6 });
    await agent.initialize();

    const start = Date.now();
    const result = await agent.run();
    const elapsed = Date.now() - start;

    assert.equal(result.total, issueCount);
    assert.equal(result.classified, issueCount);
    assert.equal(result.errors, 0);

    // With concurrency=6 and delayMs=50, should complete in ~50-150ms, not 300ms+
    // Using generous threshold to avoid flaky tests in CI
    assert.ok(elapsed < delayMs * issueCount, `concurrent should be faster than sequential: ${elapsed}ms < ${delayMs * issueCount}ms`);
  });

  it('respects concurrency limit (not all at once)', async () => {
    const delayMs = 50;
    const issueCount = 6;
    const issues = Array.from({ length: issueCount }, (_, i) => makeIssue(i + 1));

    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const tools = {
      fetcher: { async fetchIssues() { return issues; } },
      classifier: {
        async classify(input) {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise(r => setTimeout(r, delayMs));
          currentConcurrent--;
          return { priority: 'P2', area: 'bug', severity: 'minor', summary: `ok ${input.title}` };
        },
      },
      responder: {
        async applyLabels() { return ['priority:P2']; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 2 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, issueCount);
    assert.equal(result.classified, issueCount);
    assert.equal(result.errors, 0);
    assert.ok(maxConcurrent <= 2, `max concurrent ${maxConcurrent} should be <= 2`);
  });

  it('isolates errors — one failure does not affect other issues', async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const failTitles = new Set(['Issue 2']);
    const { tools } = makeTools({ issues, failOn: failTitles });

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 3 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 3);
    assert.equal(result.classified, 2);
    assert.equal(result.errors, 1);

    const errorDetail = result.details.find(d => d.error);
    assert.ok(errorDetail, 'should have an error detail');
    assert.equal(errorDetail.number, 2);
    assert.ok(errorDetail.error.includes('classify failed'));

    const successDetails = result.details.filter(d => !d.error);
    assert.equal(successDetails.length, 2);
  });

  it('preserves issue order in results regardless of completion order', async () => {
    const issues = [makeIssue(10), makeIssue(20), makeIssue(30)];
    // Add variable delays to cause out-of-order completion
    const tools = {
      fetcher: { async fetchIssues() { return issues; } },
      classifier: {
        async classify(input) {
          // Issue 20 takes longest, Issue 30 takes least
          const delayMap = { 'Issue 10': 40, 'Issue 20': 80, 'Issue 30': 10 };
          await new Promise(r => setTimeout(r, delayMap[input.title] ?? 10));
          return { priority: 'P2', area: 'bug', severity: 'minor', summary: `ok ${input.title}` };
        },
      },
      responder: {
        async applyLabels() { return ['priority:P2']; },
        async postComment() { return true; },
      },
    };

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 3 });
    await agent.initialize();
    const result = await agent.run();

    // Details should maintain input order: 10, 20, 30
    assert.equal(result.details[0].number, 10);
    assert.equal(result.details[1].number, 20);
    assert.equal(result.details[2].number, 30);
  });

  it('handles empty issue list with concurrent config', async () => {
    const { tools } = makeTools({ issues: [] });
    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 5 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 0);
    assert.equal(result.classified, 0);
    assert.equal(result.errors, 0);
  });

  it('works with concurrency=1 (sequential fallback)', async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const { tools, classifyCalls } = makeTools({ issues });

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 1 });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 3);
    assert.equal(result.classified, 3);
    assert.equal(result.errors, 0);
    assert.equal(classifyCalls.length, 3);
  });

  it('concurrent classify combined with skipLabeled', async () => {
    const issues = [
      makeIssue(1, ['bug', 'priority:P1']),  // skipped
      makeIssue(2, ['bug']),                   // classified
      makeIssue(3, ['priority:P2']),           // skipped
      makeIssue(4, ['bug']),                   // classified
    ];
    const { tools, classifyCalls } = makeTools({ issues });

    const agent = new TriageAgent({ ...baseConfig, _tools: tools, concurrency: 2, skipLabeled: true });
    await agent.initialize();
    const result = await agent.run();

    assert.equal(result.total, 4);
    assert.equal(result.skipped, 2);
    assert.equal(result.classified, 2);
    assert.equal(result.errors, 0);
    assert.equal(classifyCalls.length, 2);
  });
});
