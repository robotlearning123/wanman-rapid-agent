/**
 * Tests for src/tools/fetcher.mjs
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

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
});
