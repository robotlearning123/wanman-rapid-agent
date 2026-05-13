/**
 * Tests for src/tools/storage.mjs — Cloud Storage report sink
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunReportPath, createRunStorage } from '../src/tools/storage.mjs';

describe('buildRunReportPath', () => {
  it('builds a safe path from repo and timestamp', () => {
    const path = buildRunReportPath({
      repo: 'owner/repo name',
      prefix: '/reports/',
      now: new Date('2026-05-13T20:00:00.123Z'),
    });

    assert.equal(path, 'reports/owner-repo-name/2026-05-13T20-00-00-123Z.json');
  });

  it('falls back when repo is empty', () => {
    const path = buildRunReportPath({
      repo: '',
      now: new Date('2026-05-13T20:00:00.000Z'),
    });

    assert.equal(path, 'triage-runs/unknown-repo/2026-05-13T20-00-00-000Z.json');
  });

  it('falls back when repo is null/undefined', () => {
    const path = buildRunReportPath({
      now: new Date('2026-05-13T20:00:00.000Z'),
    });

    assert.equal(path, 'triage-runs/unknown-repo/2026-05-13T20-00-00-000Z.json');
  });

  it('falls back to default prefix when prefix is empty', () => {
    const path = buildRunReportPath({
      repo: 'owner/repo',
      prefix: '',
      now: new Date('2026-05-13T20:00:00.000Z'),
    });

    assert.equal(path, 'triage-runs/owner-repo/2026-05-13T20-00-00-000Z.json');
  });

  it('sanitizes special characters in repo and prefix', () => {
    const path = buildRunReportPath({
      repo: 'my/org @special!',
      prefix: 'path/with spaces',
      now: new Date('2026-05-13T20:00:00.000Z'),
    });

    assert.match(path, /^path\/with-spaces\/my-org-special\/2026-05-13T20-00-00-000Z\.json$/);
  });
});

describe('createRunStorage', () => {
  it('skips persistence when no bucket is configured', async () => {
    const sink = createRunStorage();
    const result = await sink.saveRunReport({ repo: 'owner/repo', result: { total: 0 } });

    assert.equal(sink.enabled, false);
    assert.deepEqual(result, { saved: false, reason: 'GCS_BUCKET not configured' });
  });

  it('saves JSON report to the configured bucket', async () => {
    const calls = [];
    const fakeClient = {
      bucket(name) {
        calls.push({ type: 'bucket', name });
        return {
          file(path) {
            calls.push({ type: 'file', path });
            return {
              async save(payload, options) {
                calls.push({ type: 'save', payload, options });
              },
            };
          },
        };
      },
    };

    const sink = createRunStorage({
      bucketName: 'demo-bucket',
      prefix: 'reports',
      client: fakeClient,
    });

    const result = await sink.saveRunReport({
      repo: 'owner/repo',
      result: { total: 2, errors: 0 },
    });

    assert.equal(sink.enabled, true);
    assert.equal(result.saved, true);
    assert.equal(result.bucket, 'demo-bucket');
    assert.match(result.path, /^reports\/owner-repo\/.+\.json$/);
    assert.deepEqual(calls[0], { type: 'bucket', name: 'demo-bucket' });
    assert.equal(calls[1].type, 'file');
    assert.equal(calls[2].type, 'save');
    assert.equal(calls[2].options.contentType, 'application/json');
    assert.equal(calls[2].options.resumable, false);
    assert.deepEqual(JSON.parse(calls[2].payload).result, { total: 2, errors: 0 });
  });

  it('uses default prefix when prefix is not provided', async () => {
    const calls = [];
    const fakeClient = {
      bucket() {
        return {
          file(path) {
            calls.push(path);
            return {
              async save() {},
            };
          },
        };
      },
    };

    const sink = createRunStorage({
      bucketName: 'test-bucket',
      client: fakeClient,
    });

    await sink.saveRunReport({ repo: 'owner/repo' });
    assert.match(calls[0], /^triage-runs\//);
  });

  it('skips persistence when bucketName is null', async () => {
    const sink = createRunStorage({ bucketName: null });
    const result = await sink.saveRunReport({ repo: 'test/repo' });
    assert.equal(sink.enabled, false);
    assert.equal(result.saved, false);
  });

  it('skips persistence when bucketName is empty string', async () => {
    const sink = createRunStorage({ bucketName: '' });
    const result = await sink.saveRunReport({ repo: 'test/repo' });
    assert.equal(sink.enabled, false);
  });

  it('includes generatedAt in saved payload', async () => {
    const saved = [];
    const fakeClient = {
      bucket() {
        return {
          file() {
            return {
              async save(payload) { saved.push(JSON.parse(payload)); },
            };
          },
        };
      },
    };

    const sink = createRunStorage({
      bucketName: 'test-bucket',
      client: fakeClient,
    });

    await sink.saveRunReport({ repo: 'owner/repo', result: { count: 5 } });
    assert.equal(saved.length, 1);
    assert.ok(saved[0].generatedAt);
    assert.equal(saved[0].repo, 'owner/repo');
    assert.deepEqual(saved[0].result, { count: 5 });
  });
});
