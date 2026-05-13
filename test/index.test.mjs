/**
 * Tests for src/index.mjs — orchestrator entry point
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, main } from '../src/index.mjs';

const mockTools = {
  fetcher: { async fetchIssues() { return []; } },
  classifier: { async classify() { return { priority: 'P3', area: 'other', severity: 'minor', summary: 'test' }; } },
  responder: { async applyLabels() { return []; }, async postComment() { return true; } },
};

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns defaults when no env vars set', () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.VERTEX_MODEL;
    delete process.env.DRY_RUN;

    const config = loadConfig();
    assert.equal(config.repo, 'example/repo');
    assert.equal(config.token, '');
    assert.equal(config.gcpProject, '');
    assert.equal(config.gcpLocation, 'us-central1');
    assert.equal(config.gcpModel, 'gemini-1.5-flash');
    assert.equal(config.dryRun, true);
  });

  it('reads configuration from environment variables', () => {
    process.env.GITHUB_REPOSITORY = 'myorg/myrepo';
    process.env.GITHUB_TOKEN = 'ghp_abc123';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'europe-west1';
    process.env.VERTEX_MODEL = 'gemini-1.5-pro';
    process.env.DRY_RUN = 'false';

    const config = loadConfig();
    assert.equal(config.repo, 'myorg/myrepo');
    assert.equal(config.token, 'ghp_abc123');
    assert.equal(config.gcpProject, 'my-gcp-project');
    assert.equal(config.gcpLocation, 'europe-west1');
    assert.equal(config.gcpModel, 'gemini-1.5-pro');
    assert.equal(config.dryRun, false);
  });

  it('dryRun defaults to true unless DRY_RUN is exactly "false"', () => {
    process.env.DRY_RUN = 'true';
    assert.equal(loadConfig().dryRun, true);

    process.env.DRY_RUN = 'yes';
    assert.equal(loadConfig().dryRun, true);

    delete process.env.DRY_RUN;
    assert.equal(loadConfig().dryRun, true);
  });
});

describe('main', () => {
  const testConfig = {
    repo: 'example/repo',
    dryRun: true,
    gcpProject: 'test-project',
    _tools: mockTools,
  };

  it('returns triage results with correct shape', async () => {
    const result = await main(testConfig);
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.classified, 'number');
    assert.equal(typeof result.errors, 'number');
    assert.equal(typeof result.labeled, 'number');
    assert.equal(typeof result.commented, 'number');
  });

  it('logs start and complete messages', async () => {
    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => chunks.push(chunk);
    try {
      await main(testConfig);
    } finally {
      process.stderr.write = original;
    }
    const output = chunks.join('');
    assert.ok(output.includes('wanman-rapid-agent starting'), 'should log start');
    assert.ok(output.includes('orchestration complete'), 'should log complete');
  });

  it('returns zero results for empty repo', async () => {
    const result = await main(testConfig);
    assert.equal(result.total, 0);
    assert.equal(result.classified, 0);
    assert.equal(result.errors, 0);
  });

  it('handles orchestration failure gracefully', async () => {
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; };

    try {
      await main({
        repo: 'example/repo',
        dryRun: true,
        gcpProject: 'test-project',
        _tools: {
          ...mockTools,
          fetcher: {
            fetchIssues: async () => { throw new Error('fetch exploded'); },
          },
        },
      });
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1, 'should call process.exit(1)');
  });
});
