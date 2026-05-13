/**
 * Tests for src/tools/fetcher.mjs
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/tools/fetcher.mjs';

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
  let createFetcher;

  beforeEach(async () => {
    // Re-import for clean state per test
    const mod = await import('../src/tools/fetcher.mjs?' + Date.now());
    createFetcher = mod.createFetcher;
  });

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
    // Mock Octokit at the module level
    const { default: Octokit } = await import('@octokit/rest');
    const originalPaginate = Octokit.prototype.paginate;
    const originalIssues = Octokit.prototype.rest;

    // Mock paginate to return test data
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

    Octokit.prototype.paginate = async () => mockIssues;

    try {
      // Re-import to get fresh module with mock in place
      const freshMod = await import('../src/tools/fetcher.mjs?test=' + Date.now());
      const freshCreateFetcher = freshMod.createFetcher;
      const fetcher = freshCreateFetcher({ repo: 'owner/repo' });
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
    } finally {
      Octokit.prototype.paginate = originalPaginate;
    }
  });

  it('fetchIssues — returns empty array when no issues', async () => {
    const { default: Octokit } = await import('@octokit/rest');
    const originalPaginate = Octokit.prototype.paginate;

    Octokit.prototype.paginate = async () => [];

    try {
      const freshMod = await import('../src/tools/fetcher.mjs?test=' + Date.now());
      const freshCreateFetcher = freshMod.createFetcher;
      const fetcher = freshCreateFetcher({ repo: 'owner/repo' });
      const results = await fetcher.fetchIssues();
      assert.equal(results.length, 0);
    } finally {
      Octokit.prototype.paginate = originalPaginate;
    }
  });
});
