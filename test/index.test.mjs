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

import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadConfig, validateConfig, main, parseRepos } from '../src/index.mjs';

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
    delete process.env.GCS_BUCKET;
    delete process.env.GCS_PREFIX;
    delete process.env.DRY_RUN;

    const config = loadConfig();
    assert.equal(config.repo, 'example/repo');
    assert.equal(config.token, '');
    assert.equal(config.gcpProject, '');
    assert.equal(config.gcpLocation, 'us-central1');
    assert.equal(config.gcpModel, 'gemini-1.5-flash');
    assert.equal(config.gcsBucket, '');
    assert.equal(config.gcsPrefix, 'triage-runs');
    assert.equal(config.dryRun, true);
  });

  it('reads configuration from environment variables', () => {
    process.env.GITHUB_REPOSITORY = 'myorg/myrepo';
    process.env.GITHUB_TOKEN = 'ghp_abc123';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'europe-west1';
    process.env.VERTEX_MODEL = 'gemini-1.5-pro';
    process.env.GCS_BUCKET = 'triage-reports';
    process.env.GCS_PREFIX = 'runs';
    process.env.DRY_RUN = 'false';

    const config = loadConfig();
    assert.equal(config.repo, 'myorg/myrepo');
    assert.equal(config.token, 'ghp_abc123');
    assert.equal(config.gcpProject, 'my-gcp-project');
    assert.equal(config.gcpLocation, 'europe-west1');
    assert.equal(config.gcpModel, 'gemini-1.5-pro');
    assert.equal(config.gcsBucket, 'triage-reports');
    assert.equal(config.gcsPrefix, 'runs');
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
    token: 'ghp_test',
    dryRun: true,
    gcpProject: 'test-project',
    _tools: mockTools,
  };

  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/test-key.json';
  });

  afterEach(() => {
    if (originalCreds !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

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
      token: 'ghp_test',
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
    const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/test-key.json';

    try {
      await main({
        repo: 'invalid-format',
        token: 'ghp_test',
        dryRun: true,
        gcpProject: 'test-project',
        _tools: {
          fetcher: { async fetchIssues() { return []; } },
          classifier: { async classify() { return { priority: 'P3', area: 'other', severity: 'minor', summary: 't' }; } },
        },
      });
    } catch (err) {
      assert.ok(err.message.includes('process.exit'), `unexpected error: ${err.message}`);
    } finally {
      process.exit = originalExit;
      if (originalCreds !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
      else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    assert.equal(exitCode, 1, 'should call process.exit(1)');
  });

  it('auto-run guard calls main() when executed directly', () => {
    const projectRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
    const result = spawnSync('node', ['src/index.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        DRY_RUN: 'true',
        GITHUB_REPOSITORY: 'invalid-format',
        GITHUB_TOKEN: 'ghp_test',
        GOOGLE_CLOUD_PROJECT: 'test-project',
        GOOGLE_APPLICATION_CREDENTIALS: '/tmp/test-key.json',
      },
    });

    const stderr = result.stderr || '';
    assert.ok(stderr.includes('wanman-rapid-agent starting'), 'auto-run guard should call main()');
  });
});

describe('validateConfig', () => {
  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  afterEach(() => {
    if (originalCreds !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  it('passes when all required vars are set', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/test-key.json';
    const config = {
      token: 'ghp_test',
      gcpProject: 'test-project',
    };
    const result = validateConfig(config);
    assert.equal(result, config);
  });

  it('permits dry-run mode without live credentials', () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const config = {
      token: '',
      gcpProject: '',
      dryRun: true,
    };
    const result = validateConfig(config);
    assert.equal(result, config);
  });

  it('throws listing all missing required vars', () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const config = { token: '', gcpProject: '', dryRun: false };
    assert.throws(
      () => validateConfig(config),
      (err) => err.message.includes('GITHUB_TOKEN')
        && err.message.includes('GOOGLE_CLOUD_PROJECT')
        && err.message.includes('GOOGLE_APPLICATION_CREDENTIALS'),
    );
  });

  it('throws for missing GITHUB_TOKEN only', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/test-key.json';
    const config = { token: '', gcpProject: 'test-project', dryRun: false };
    assert.throws(
      () => validateConfig(config),
      (err) => err.message.includes('GITHUB_TOKEN')
        && !err.message.includes('GOOGLE_CLOUD_PROJECT'),
    );
  });

  it('checks env var presence only, not file existence', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/nonexistent/path/key.json';
    const config = { token: 'ghp_test', gcpProject: 'test-project' };
    const result = validateConfig(config);
    assert.equal(result, config);
  });
});

describe('parseRepos', () => {
  it('parses single repo', () => {
    assert.deepEqual(parseRepos('org/repo'), ['org/repo']);
  });

  it('parses comma-separated repos', () => {
    assert.deepEqual(parseRepos('org/repo1,org/repo2,org/repo3'), ['org/repo1', 'org/repo2', 'org/repo3']);
  });

  it('trims whitespace around repos', () => {
    assert.deepEqual(parseRepos(' org/repo1 , org/repo2 '), ['org/repo1', 'org/repo2']);
  });

  it('filters out empty segments', () => {
    assert.deepEqual(parseRepos('org/repo1,,org/repo2,'), ['org/repo1', 'org/repo2']);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseRepos(''), []);
  });
});

describe('multi-repo main', () => {
  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/test-key.json';
  });

  afterEach(() => {
    if (originalCreds !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  it('runs triage for each comma-separated repo', async () => {
    const reposSeen = [];
    const multiTools = {
      fetcher: { async fetchIssues() { return []; } },
      classifier: { async classify() { return { priority: 'P3', area: 'other', severity: 'minor', summary: 'test' }; } },
      responder: { async applyLabels() { return []; }, async postComment() { return true; } },
    };

    const result = await main({
      repo: 'org/repo1,org/repo2',
      token: 'ghp_test',
      dryRun: true,
      gcpProject: 'test-project',
      _tools: multiTools,
    });

    assert.equal(result.repoCount, 2);
    assert.deepEqual(result.repos, ['org/repo1', 'org/repo2']);
    assert.equal(result.perRepo.length, 2);
    assert.equal(result.perRepo[0].repo, 'org/repo1');
    assert.equal(result.perRepo[1].repo, 'org/repo2');
  });

  it('aggregates totals across repos', async () => {
    const issue1 = { number: 1, title: 'Bug', body: 'b', labels: [], url: 'https://github.com/org/r1/issues/1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', author: 'dev' };
    const issue2 = { number: 2, title: 'Feature', body: 'f', labels: [], url: 'https://github.com/org/r2/issues/2', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', author: 'dev' };

    let callIdx = 0;
    const multiTools = {
      fetcher: {
        async fetchIssues() {
          callIdx++;
          return callIdx === 1 ? [issue1] : [issue2];
        },
      },
      classifier: { async classify() { return { priority: 'P2', area: 'bug', severity: 'minor', summary: 'ok' }; } },
      responder: { async applyLabels() { return ['priority:P2']; }, async postComment() { return true; } },
    };

    const result = await main({
      repo: 'org/repo1,org/repo2',
      token: 'ghp_test',
      dryRun: true,
      gcpProject: 'test-project',
      _tools: multiTools,
    });

    assert.equal(result.total, 2);
    assert.equal(result.classified, 2);
    assert.equal(result.labeled, 2);
    assert.equal(result.commented, 2);
    assert.equal(result.errors, 0);
  });

  it('returns single-repo result shape when only one repo', async () => {
    const result = await main({
      repo: 'org/single-repo',
      token: 'ghp_test',
      dryRun: true,
      gcpProject: 'test-project',
      _tools: mockTools,
    });

    // Single repo should NOT have multi-repo fields
    assert.equal(result.total, 0);
    assert.equal(result.repoCount, undefined);
    assert.equal(result.perRepo, undefined);
  });
});
