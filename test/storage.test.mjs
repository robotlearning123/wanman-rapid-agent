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
});
