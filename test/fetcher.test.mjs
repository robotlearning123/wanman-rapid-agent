/**
 * Tests for src/tools/fetcher.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFetcher, normalize, DEFAULT_RATE_LIMIT_THRESHOLD } from '../src/tools/fetcher.mjs';

// --- Test helpers ---

function makeRawIssue(number, labels = []) {
  return {
    number,
    title: `Issue ${number}`,
    body: `Body for issue ${number}`,
    labels: labels.length ? labels.map((l) => ({ name: l })) : [],
    html_url: `https://github.com/owner/repo/issues/${number}`,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    user: { login: 'dev1' },
    pull_request: undefined,
  };
}

/**
 * Create a mock Octokit client with paginated responses and rate limit headers.
 * @param {Array<Array<object>>} pages - array of pages, each an array of raw issues
 * @param {string[]} [remainingPerPage] - x-ratelimit-remaining values per page
 */
function makeMockClient(pages, remainingPerPage) {
  let callIdx = 0;
  return {
    rest: {
      issues: {
        async listForRepo() {
          const page = pages[callIdx] ?? [];
          const remaining = remainingPerPage?.[callIdx] ?? '5000';
          callIdx++;
          return {
            data: page,
            headers: { 'x-ratelimit-remaining': remaining },
          };
        },
      },
    },
  };
}

describe('normalize', () => {
  it('maps raw GitHub issue to flat shape', () => {
    const raw = {
      number: 42,
      title: 'Bug in login',
      body: 'Steps to reproduce...',
      labels: [{ name: 'bug' }, { name: 'critical' }],
      html_url: 'https://github.com/owner/repo/issues/42',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
      user: { login: 'reporter' },
    };
    const result = normalize(raw);
    assert.deepEqual(result, {
      number: 42,
      title: 'Bug in login',
      body: 'Steps to reproduce...',
      labels: ['bug', 'critical'],
      url: 'https://github.com/owner/repo/issues/42',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      author: 'reporter',
    });
  });

  it('defaults body to empty string when null', () => {
    const raw = {
      number: 1,
      title: 'No body issue',
      body: null,
      labels: [],
      html_url: 'https://github.com/o/r/issues/1',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      user: { login: 'user' },
    };
    const result = normalize(raw);
    assert.equal(result.body, '');
  });

  it('handles string labels (not objects)', () => {
    const raw = {
      number: 2,
      title: 'String labels',
      body: '',
      labels: ['enhancement', 'good first issue'],
      html_url: 'https://github.com/o/r/issues/2',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      user: { login: 'dev' },
    };
    const result = normalize(raw);
    assert.deepEqual(result.labels, ['enhancement', 'good first issue']);
  });

  it('defaults author to "unknown" when user is null', () => {
    const raw = {
      number: 3,
      title: 'No user',
      body: '',
      labels: [],
      html_url: 'https://github.com/o/r/issues/3',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      user: null,
    };
    const result = normalize(raw);
    assert.equal(result.author, 'unknown');
  });

  it('defaults author to "unknown" when user.login is undefined', () => {
    const raw = {
      number: 4,
      title: 'Deleted user',
      body: '',
      labels: [],
      html_url: 'https://github.com/o/r/issues/4',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      user: {},
    };
    const result = normalize(raw);
    assert.equal(result.author, 'unknown');
  });
});

describe('createFetcher', () => {
  it('throws on invalid repo format — missing slash', async () => {
    const fetcher = createFetcher({ repo: 'invalidformat' });
    await assert.rejects(
      () => fetcher.fetchIssues(),
      { message: /Invalid repository format/ }
    );
  });

  it('throws on invalid repo format — empty owner', async () => {
    const fetcher = createFetcher({ repo: '/repo' });
    await assert.rejects(
      () => fetcher.fetchIssues(),
      { message: /Invalid repository format/ }
    );
  });

  it('throws on invalid repo format — empty repo name', async () => {
    const fetcher = createFetcher({ repo: 'owner/' });
    await assert.rejects(
      () => fetcher.fetchIssues(),
      { message: /Invalid repository format/ }
    );
  });

  it('returns an object with fetchIssues method', () => {
    const fetcher = createFetcher({ repo: 'owner/repo' });
    assert.equal(typeof fetcher.fetchIssues, 'function');
  });

  it('fetchIssues — fetches and normalizes issues, excluding PRs', async () => {
    const mockIssues = [
      {
        number: 1,
        title: 'Bug report',
        body: 'Something broke',
        labels: [{ name: 'bug' }],
        html_url: 'https://github.com/owner/repo/issues/1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        user: { login: 'dev1' },
        pull_request: undefined,
      },
      {
        number: 2,
        title: 'A PR',
        body: 'Fixes the bug',
        labels: [],
        html_url: 'https://github.com/owner/repo/pull/2',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'dev2' },
        pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/2' },
      },
      {
        number: 3,
        title: 'Feature request',
        body: null,
        labels: ['enhancement'],
        html_url: 'https://github.com/owner/repo/issues/3',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        user: null,
        pull_request: undefined,
      },
    ];

    const mockClient = makeMockClient([mockIssues]);

    const fetcher = createFetcher({ repo: 'owner/repo', client: mockClient });
    const results = await fetcher.fetchIssues();

    // PR should be filtered out
    assert.equal(results.length, 2);
    assert.equal(results[0].number, 1);
    assert.equal(results[0].title, 'Bug report');
    assert.equal(results[0].labels[0], 'bug');
    assert.equal(results[0].author, 'dev1');

    assert.equal(results[1].number, 3);
    assert.equal(results[1].body, '');
    assert.equal(results[1].author, 'unknown');
  });

  it('fetchIssues — returns empty array when no issues', async () => {
    const mockClient = makeMockClient([[]]);

    const fetcher = createFetcher({ repo: 'owner/repo', client: mockClient });
    const results = await fetcher.fetchIssues();
    assert.equal(results.length, 0);
  });

  it('fetchIssues — retries transient GitHub API failures with backoff', async () => {
    const delays = [];
    let calls = 0;
    const mockClient = {
      rest: {
        issues: {
          async listForRepo() {
            calls++;
            if (calls < 3) throw new Error('temporary GitHub API error');
            return {
              data: [{
                number: 7,
                title: 'Intermittent bug',
                body: 'Sometimes fails',
                labels: [],
                html_url: 'https://github.com/owner/repo/issues/7',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
                user: { login: 'dev7' },
                pull_request: undefined,
              }],
              headers: { 'x-ratelimit-remaining': '5000' },
            };
          },
        },
      },
    };

    const fetcher = createFetcher({
      repo: 'owner/repo',
      client: mockClient,
      retryDelaysMs: [1000, 2000, 4000],
      retrySleep: async (ms) => { delays.push(ms); },
    });

    const results = await fetcher.fetchIssues();

    assert.equal(calls, 3);
    assert.deepEqual(delays, [1000, 2000]);
    assert.equal(results.length, 1);
    assert.equal(results[0].number, 7);
  });

  // --- Rate limit tests ---

  it('does not throttle when rate limit remaining is above threshold', async () => {
    const sleepCalls = [];
    const mockClient = makeMockClient(
      [[makeRawIssue(1)], []],
      ['5000', '4999'],
    );

    const fetcher = createFetcher({
      repo: 'owner/repo',
      client: mockClient,
      rateLimitThreshold: 100,
      sleepFn: async (ms) => { sleepCalls.push(ms); },
    });

    const results = await fetcher.fetchIssues();
    assert.equal(results.length, 1);
    assert.equal(sleepCalls.length, 0, 'should not sleep when above threshold');
  });

  it('throttles when rate limit remaining drops below threshold', async () => {
    const sleepCalls = [];
    const page1 = Array.from({ length: 100 }, (_, i) => makeRawIssue(i + 1));
    const page2 = Array.from({ length: 100 }, (_, i) => makeRawIssue(i + 101));
    const page3 = [makeRawIssue(201)];
    const mockClient = makeMockClient([page1, page2, page3], ['50', '49', '48']);

    const fetcher = createFetcher({
      repo: 'owner/repo',
      client: mockClient,
      rateLimitThreshold: 100,
      rateLimitDelayMs: 500,
      sleepFn: async (ms) => { sleepCalls.push(ms); },
    });

    const results = await fetcher.fetchIssues();
    assert.equal(results.length, 201);
    assert.equal(sleepCalls.length, 3, 'should sleep after each page below threshold');
    assert.equal(sleepCalls[0], 500);
    assert.equal(sleepCalls[1], 500);
    assert.equal(sleepCalls[2], 500);
  });

  it('paginates through multiple pages of issues', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeRawIssue(i + 1));
    const page2 = [makeRawIssue(101), makeRawIssue(102)];

    const mockClient = makeMockClient([page1, page2], ['4900', '4899']);

    const fetcher = createFetcher({
      repo: 'owner/repo',
      client: mockClient,
      rateLimitThreshold: 10,
    });

    const results = await fetcher.fetchIssues();
    assert.equal(results.length, 102);
    assert.equal(results[0].number, 1);
    assert.equal(results[101].number, 102);
  });

  it('uses RATE_LIMIT_THRESHOLD from env when set', async () => {
    const prev = process.env.RATE_LIMIT_THRESHOLD;
    process.env.RATE_LIMIT_THRESHOLD = '200';
    try {
      const sleepCalls = [];
      const page1 = Array.from({ length: 100 }, (_, i) => makeRawIssue(i + 1));
      const page2 = [makeRawIssue(101)];
      const mockClient = makeMockClient([page1, page2], ['150', '149']);

      const fetcher = createFetcher({
        repo: 'owner/repo',
        client: mockClient,
        sleepFn: async (ms) => { sleepCalls.push(ms); },
      });

      await fetcher.fetchIssues();
      assert.equal(sleepCalls.length, 2, 'should use env threshold=200, sleep after each page with remaining < 200');
    } finally {
      if (prev === undefined) delete process.env.RATE_LIMIT_THRESHOLD;
      else process.env.RATE_LIMIT_THRESHOLD = prev;
    }
  });

  it('defaults to DEFAULT_RATE_LIMIT_THRESHOLD when env is not set', () => {
    const prev = process.env.RATE_LIMIT_THRESHOLD;
    delete process.env.RATE_LIMIT_THRESHOLD;
    try {
      assert.equal(DEFAULT_RATE_LIMIT_THRESHOLD, 100);
    } finally {
      if (prev !== undefined) process.env.RATE_LIMIT_THRESHOLD = prev;
    }
  });
});
