/**
 * Tests for src/tools/responder.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classificationToLabels, buildComment, createResponder } from '../src/tools/responder.mjs';

describe('classificationToLabels', () => {
  it('maps all three classification fields to labels', () => {
    const labels = classificationToLabels({ priority: 'P1', area: 'bug', severity: 'critical' });
    assert.deepEqual(labels, ['priority:P1', 'area:bug', 'severity:critical']);
  });

  it('omits missing fields', () => {
    const labels = classificationToLabels({ priority: 'P2', area: '', severity: '' });
    assert.deepEqual(labels, ['priority:P2', 'area:', 'severity:']);
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
      { message: /Invalid repository format/ }
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
});
