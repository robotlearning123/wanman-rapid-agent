/**
 * Tests for src/tools/responder.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classificationToLabels, buildComment, createResponder, hasPriorityLabel } from '../src/tools/responder.mjs';

describe('hasPriorityLabel', () => {
  it('returns true for priority:P1', () => {
    assert.equal(hasPriorityLabel(['bug', 'priority:P1']), true);
  });

  it('returns true for priority:P3 (case-insensitive)', () => {
    assert.equal(hasPriorityLabel(['priority:p3']), true);
  });

  it('returns false when no priority label exists', () => {
    assert.equal(hasPriorityLabel(['bug', 'area:core']), false);
  });

  it('returns false for empty labels', () => {
    assert.equal(hasPriorityLabel([]), false);
  });

  it('returns false for partial match like priority:critical', () => {
    assert.equal(hasPriorityLabel(['priority:critical']), false);
  });

  it('returns true for priority:P0', () => {
    assert.equal(hasPriorityLabel(['priority:P0']), true);
  });
});

describe('classificationToLabels', () => {
  it('maps all three classification fields to labels', () => {
    const labels = classificationToLabels({ priority: 'P1', area: 'bug', severity: 'critical' });
    assert.deepEqual(labels, ['priority:P1', 'area:bug', 'severity:critical']);
  });

  it('omits missing fields', () => {
    const labels = classificationToLabels({ priority: 'P2', area: '', severity: '' });
    assert.deepEqual(labels, ['priority:P2']);
  });

  it('returns empty array for empty classification', () => {
    const labels = classificationToLabels({});
    assert.deepEqual(labels, []);
  });
});

describe('buildComment', () => {
  it('produces markdown table with classification', () => {
    const comment = buildComment({ priority: 'P1', area: 'bug', severity: 'critical', summary: 'Login crash' });
    assert.ok(comment.includes('### Issue Triage Report'));
    assert.ok(comment.includes('**Priority** | P1'));
    assert.ok(comment.includes('**Area** | bug'));
    assert.ok(comment.includes('**Severity** | critical'));
    assert.ok(comment.includes('Login crash'));
    assert.ok(comment.includes('wanman-rapid-agent'));
  });

  it('handles empty summary', () => {
    const comment = buildComment({ priority: 'P3', area: 'docs', severity: 'minor', summary: '' });
    assert.ok(comment.includes('> '));
  });
});

describe('createResponder', () => {
  it('throws on invalid repo format', () => {
    assert.throws(
      () => createResponder({ repo: 'invalid', dryRun: true }),
      { message: /Invalid repository format/ },
    );
  });

  it('returns object with applyLabels and postComment methods', () => {
    const r = createResponder({ repo: 'owner/repo', dryRun: true });
    assert.equal(typeof r.applyLabels, 'function');
    assert.equal(typeof r.postComment, 'function');
  });

  it('applyLabels — dry-run mode returns labels without API call', async () => {
    const r = createResponder({ repo: 'owner/repo', dryRun: true });
    const labels = await r.applyLabels(42, { priority: 'P1', area: 'bug', severity: 'critical' });
    assert.deepEqual(labels, ['priority:P1', 'area:bug', 'severity:critical']);
  });

  it('postComment — dry-run mode returns true without API call', async () => {
    const r = createResponder({ repo: 'owner/repo', dryRun: true });
    const result = await r.postComment(42, 'test comment');
    assert.equal(result, true);
  });

  it('applyLabels — no token returns empty array', async () => {
    const r = createResponder({ repo: 'owner/repo', dryRun: false });
    const labels = await r.applyLabels(42, { priority: 'P1', area: 'bug', severity: 'critical' });
    assert.deepEqual(labels, []);
  });

  it('postComment — no token returns false', async () => {
    const r = createResponder({ repo: 'owner/repo', dryRun: false });
    const result = await r.postComment(42, 'test comment');
    assert.equal(result, false);
  });

  it('applyLabels — live mode with mock client applies labels via API', async () => {
    const addLabelsCall = { called: false, args: null };
    const mockClient = {
      rest: {
        issues: {
          addLabels: async (args) => {
            addLabelsCall.called = true;
            addLabelsCall.args = args;
          },
        },
      },
    };

    const r = createResponder({ repo: 'owner/repo', dryRun: false, client: mockClient });
    const labels = await r.applyLabels(42, { priority: 'P1', area: 'bug', severity: 'critical' });

    assert.equal(addLabelsCall.called, true);
    assert.equal(addLabelsCall.args.owner, 'owner');
    assert.equal(addLabelsCall.args.repo, 'repo');
    assert.equal(addLabelsCall.args.issue_number, 42);
    assert.deepEqual(addLabelsCall.args.labels, ['priority:P1', 'area:bug', 'severity:critical']);
    assert.deepEqual(labels, ['priority:P1', 'area:bug', 'severity:critical']);
  });

  it('postComment — live mode with mock client posts comment via API', async () => {
    const createCommentCall = { called: false, args: null };
    const mockClient = {
      rest: {
        issues: {
          createComment: async (args) => {
            createCommentCall.called = true;
            createCommentCall.args = args;
          },
        },
      },
    };

    const r = createResponder({ repo: 'owner/repo', dryRun: false, client: mockClient });
    const result = await r.postComment(42, 'Triage comment body');

    assert.equal(createCommentCall.called, true);
    assert.equal(createCommentCall.args.owner, 'owner');
    assert.equal(createCommentCall.args.repo, 'repo');
    assert.equal(createCommentCall.args.issue_number, 42);
    assert.equal(createCommentCall.args.body, 'Triage comment body');
    assert.equal(result, true);
  });

  it('constructs Octokit from token when client not provided (dry-run)', async () => {
    // Covers the `token ? new Octokit({ auth: token }) : null` branch
    const r = createResponder({ repo: 'owner/repo', dryRun: true, token: 'ghp_test123' });
    const labels = await r.applyLabels(1, { priority: 'P2', area: 'docs', severity: 'minor' });
    assert.deepEqual(labels, ['priority:P2', 'area:docs', 'severity:minor']);
  });
});
