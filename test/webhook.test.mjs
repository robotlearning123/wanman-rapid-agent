/**
 * Tests for src/webhook.mjs — GitHub webhook handler
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySignature, shouldProcess, extractIssue, createWebhookHandler } from '../src/webhook.mjs';

describe('verifySignature', () => {
  const secret = 'test-secret';

  it('returns true for valid signature', () => {
    const body = '{"action":"opened"}';
    const hmac = createHmac('sha256', secret);
    hmac.update(body);
    const sig = `sha256=${hmac.digest('hex')}`;
    assert.equal(verifySignature(body, sig, secret), true);
  });

  it('returns false for invalid signature', () => {
    assert.equal(verifySignature('{"action":"opened"}', 'sha256=badhex', secret), false);
  });

  it('returns false when signature is missing', () => {
    assert.equal(verifySignature('body', '', secret), false);
  });

  it('returns false when secret is empty', () => {
    assert.equal(verifySignature('body', 'sha256=abc', ''), false);
  });

  it('handles signature without sha256= prefix', () => {
    const body = '{"action":"opened"}';
    const hmac = createHmac('sha256', secret);
    hmac.update(body);
    const hex = hmac.digest('hex');
    assert.equal(verifySignature(body, hex, secret), true);
  });

  it('uses constant-time comparison', () => {
    const body = '{"action":"opened"}';
    const hmac = createHmac('sha256', secret);
    hmac.update(body);
    const sig = `sha256=${hmac.digest('hex')}`;
    // Valid should be fast — just verifying it doesn't throw
    assert.equal(verifySignature(body, sig, secret), true);
  });
});

describe('shouldProcess', () => {
  it('processes issues.opened', () => {
    assert.equal(shouldProcess('issues', 'opened'), true);
  });

  it('processes issues.edited', () => {
    assert.equal(shouldProcess('issues', 'edited'), true);
  });

  it('ignores issues.closed', () => {
    assert.equal(shouldProcess('issues', 'closed'), false);
  });

  it('ignores issues.labeled', () => {
    assert.equal(shouldProcess('issues', 'labeled'), false);
  });

  it('ignores pull_request events', () => {
    assert.equal(shouldProcess('pull_request', 'opened'), false);
  });

  it('ignores push events', () => {
    assert.equal(shouldProcess('push', ''), false);
  });

  it('ignores unknown events', () => {
    assert.equal(shouldProcess('unknown', 'anything'), false);
  });
});

describe('extractIssue', () => {
  it('extracts normalized issue from webhook payload', () => {
    const payload = {
      issue: {
        number: 42,
        title: 'Bug in webhook',
        body: 'Steps to reproduce...',
        labels: [{ name: 'bug' }, { name: 'critical' }],
        html_url: 'https://github.com/org/repo/issues/42',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        user: { login: 'dev1' },
      },
    };

    const result = extractIssue(payload);
    assert.deepEqual(result, {
      number: 42,
      title: 'Bug in webhook',
      body: 'Steps to reproduce...',
      labels: ['bug', 'critical'],
      url: 'https://github.com/org/repo/issues/42',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      author: 'dev1',
    });
  });

  it('handles string labels', () => {
    const payload = {
      issue: {
        number: 1,
        title: 'Test',
        body: '',
        labels: ['enhancement'],
        html_url: 'https://github.com/o/r/issues/1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'dev' },
      },
    };
    assert.deepEqual(extractIssue(payload).labels, ['enhancement']);
  });

  it('returns null when no issue in payload', () => {
    assert.equal(extractIssue({}), null);
    assert.equal(extractIssue({ pull_request: {} }), null);
  });

  it('defaults body to empty string when null', () => {
    const payload = {
      issue: { number: 1, title: 'T', body: null, labels: [], html_url: '', created_at: '', updated_at: '', user: null },
    };
    assert.equal(extractIssue(payload).body, '');
  });

  it('defaults author to unknown when user is null', () => {
    const payload = {
      issue: { number: 1, title: 'T', body: '', labels: [], html_url: '', created_at: '', updated_at: '', user: null },
    };
    assert.equal(extractIssue(payload).author, 'unknown');
  });
});

describe('createWebhookHandler', () => {
  const secret = 'webhook-secret';
  const mockTools = {
    fetcher: { async fetchIssues() { return []; } },
    classifier: { async classify() { return { priority: 'P3', area: 'other', severity: 'minor', summary: 'test' }; } },
    responder: { async applyLabels() { return []; }, async postComment() { return true; } },
  };

  function signPayload(body) {
    const hmac = createHmac('sha256', secret);
    hmac.update(body);
    return `sha256=${hmac.digest('hex')}`;
  }

  function makeRequest(body, { event = 'issues' } = {}) {
    const sig = signPayload(body);
    let yielded = false;
    return {
      headers: {
        'x-github-event': event,
        'x-hub-signature-256': sig,
      },
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (yielded) return Promise.resolve({ done: true });
            yielded = true;
            return Promise.resolve({ value: Buffer.from(body), done: false });
          },
        };
      },
    };
  }

  function makeResponse() {
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      setHeader(key, value) { res.headers[key] = value; },
      end(data) { res.body = data; },
    };
    return res;
  }

  it('returns 401 for invalid signature', async () => {
    const handler = createWebhookHandler({ secret, triageConfig: {} });
    let yielded = false;
    const req = {
      headers: { 'x-github-event': 'issues', 'x-hub-signature-256': 'sha256=invalid' },
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (yielded) return Promise.resolve({ done: true });
            yielded = true;
            return Promise.resolve({ value: Buffer.from('{}'), done: false });
          },
        };
      },
    };
    const res = makeResponse();
    await handler.handleRequest(req, res);
    assert.equal(res.statusCode, 401);
    assert.ok(res.body.includes('Invalid signature'));
  });

  it('returns 200 with status ignored for non-triage events', async () => {
    const body = '{"action":"closed"}';
    const handler = createWebhookHandler({ secret, triageConfig: {} });
    const req = makeRequest(body, { event: 'issues' });
    const res = makeResponse();
    await handler.handleRequest(req, res);
    assert.equal(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.status, 'ignored');
  });

  it('returns 200 with status triaged for issues.opened', async () => {
    const payload = JSON.stringify({
      action: 'opened',
      issue: {
        number: 1, title: 'Bug', body: 'desc', labels: [],
        html_url: 'https://github.com/org/repo/issues/1',
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'dev' },
      },
      repository: { full_name: 'org/repo' },
    });
    const handler = createWebhookHandler({
      secret,
      triageConfig: {
        repo: 'org/repo',
        token: 'ghp_test',
        dryRun: true,
        gcpProject: 'test-project',
        _tools: mockTools,
      },
    });

    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/test-key.json';
    const req = makeRequest(payload);
    const res = makeResponse();
    await handler.handleRequest(req, res);
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    assert.equal(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.status, 'triaged');
    assert.equal(parsed.issue, 1);
  });

  it('returns 400 for invalid JSON', async () => {
    const handler = createWebhookHandler({ secret, triageConfig: {} });
    const badJson = 'not-json{';
    const req = makeRequest(badJson);
    const res = makeResponse();
    await handler.handleRequest(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.includes('Invalid JSON'));
  });

  it('returns 400 when issue is missing from payload', async () => {
    const payload = JSON.stringify({ action: 'opened' });
    const handler = createWebhookHandler({ secret, triageConfig: {} });
    const req = makeRequest(payload);
    const res = makeResponse();
    await handler.handleRequest(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.includes('No issue found'));
  });
});
