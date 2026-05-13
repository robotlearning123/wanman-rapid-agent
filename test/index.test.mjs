/**
 * Tests for src/index.mjs — orchestrator entry point
 *
 * Behavioral notes:
 *   1. process.exit mock safety: process.exit(1) in main() terminates the process.
 *      Simple lambda mocks (code => {}) don't prevent code after exit from running,
 *      violating Node's contract. Safe mocks throw after recording to halt execution,
 *      matching real process.exit behavior.
 *   2. TriageAgent._onRun() now catches fetch errors gracefully (returns error result
 *      instead of throwing). This means main()'s catch/process.exit(1) path is only
 *      reachable via initialize-time failures (e.g., invalid repo format in createResponder).
 *   3. Agent state machine: run() transitions RUNNING → IDLE on success, not RUNNING → STOPPED.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

  it('returns error result when fetcher fails (agent handles internally)', async () => {
    const result = await main({
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

    assert.equal(result.total, 0);
    assert.equal(result.errors, 1);
  });

  it('calls process.exit(1) on initialize failure', async () => {
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };

    try {
      await main({
        repo: 'invalid-format',
        dryRun: true,
        _tools: {
          fetcher: { async fetchIssues() { return []; } },
          classifier: { async classify() { return { priority: 'P3', area: 'other', severity: 'minor', summary: 't' }; } },
        },
      });
    } catch (err) {
      assert.ok(err.message.includes('process.exit'), `unexpected error: ${err.message}`);
    } finally {
      process.exit = originalExit;
    }

    assert.equal(exitCode, 1, 'should call process.exit(1)');
  });

  it('auto-run guard calls main() when executed directly', () => {
    const projectRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
    const result = spawnSync('node', ['src/index.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, DRY_RUN: 'true' },
    });

    const stderr = result.stderr || '';
    assert.ok(stderr.includes('wanman-rapid-agent starting'), 'auto-run guard should call main()');
  });
});
