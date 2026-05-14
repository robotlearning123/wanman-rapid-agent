/**
 * wanman-rapid-agent — entry point and orchestrator
 *
 * A multi-agent system that autonomously triages GitHub issues
 * using Google Cloud Vertex AI for classification.
 *
 * Orchestrates the TriageAgent lifecycle:
 *   1. Read configuration from environment
 *   2. Initialize the agent (tools, connections)
 *   3. Run triage (fetch → classify → label → comment)
 *   4. Report results
 */

import { TriageAgent } from './agents/triage.mjs';
import { logger } from './utils/logger.mjs';

/**
 * Build agent configuration from environment variables.
 *
 * @returns {object} config for TriageAgent
 */
export function loadConfig() {
  return {
    repo: process.env.GITHUB_REPOSITORY || 'example/repo',
    token: process.env.GITHUB_TOKEN || '',
    gcpProject: process.env.GOOGLE_CLOUD_PROJECT || '',
    gcpLocation: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    gcpModel: process.env.VERTEX_MODEL || 'gemini-1.5-flash',
    gcsBucket: process.env.GCS_BUCKET || '',
    gcsPrefix: process.env.GCS_PREFIX || 'triage-runs',
    dryRun: process.env.DRY_RUN !== 'false', // default: true for safety
  };
}

/**
 * Validate that all required configuration values are present.
 * Collects ALL missing vars before throwing so the user sees
 * a complete fix list in one shot.
 *
 * @param {object} config - the config object from loadConfig()
 * @returns {object} the same config object if valid
 * @throws {Error} listing all missing required variables
 */
export function validateConfig(config) {
  const missing = [];
  const liveMode = config.dryRun === false;

  if (!liveMode) {
    return config;
  }

  if (!config.token) missing.push('GITHUB_TOKEN');
  if (!config.gcpProject) missing.push('GOOGLE_CLOUD_PROJECT');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) missing.push('GOOGLE_APPLICATION_CREDENTIALS');

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return config;
}

/**
 * Parse a comma-separated repo string into an array of owner/repo strings.
 * Trims whitespace and filters out empty segments.
 *
 * @param {string} repoStr - comma-separated repos (e.g. "org/repo1,org/repo2")
 * @returns {string[]}
 */
export function parseRepos(repoStr) {
  return repoStr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Main orchestrator — creates, initializes, runs, and reports the TriageAgent.
 *
 * Supports multi-repo mode when GITHUB_REPOSITORY contains commas:
 *   - Splits repos and runs TriageAgent for each sequentially
 *   - Aggregates results into a combined summary
 *
 * @param {object} [configOverride] - override config (useful for testing)
 * @returns {Promise<object>} triage results (combined when multi-repo)
 */
export async function main(configOverride) {
  const config = configOverride ?? loadConfig();
  validateConfig(config);

  const repos = parseRepos(config.repo);

  logger.info('wanman-rapid-agent starting', {
    repos,
    repoCount: repos.length,
    dryRun: config.dryRun,
  });

  try {
    const allResults = [];

    for (const repo of repos) {
      const repoConfig = { ...config, repo };
      const agent = new TriageAgent(repoConfig);
      await agent.initialize();
      const results = await agent.run();
      allResults.push({ repo, ...results });
    }

    // Aggregate if multiple repos
    if (repos.length > 1) {
      const combined = {
        repos: repos,
        repoCount: repos.length,
        total: allResults.reduce((sum, r) => sum + r.total, 0),
        skipped: allResults.reduce((sum, r) => sum + (r.skipped ?? 0), 0),
        classified: allResults.reduce((sum, r) => sum + r.classified, 0),
        labeled: allResults.reduce((sum, r) => sum + r.labeled, 0),
        commented: allResults.reduce((sum, r) => sum + r.commented, 0),
        errors: allResults.reduce((sum, r) => sum + r.errors, 0),
        perRepo: allResults,
      };

      logger.info('multi-repo orchestration complete', {
        repoCount: combined.repoCount,
        total: combined.total,
        classified: combined.classified,
        errors: combined.errors,
      });

      return combined;
    }

    const results = allResults[0];
    logger.info('orchestration complete', {
      total: results.total,
      classified: results.classified,
      errors: results.errors,
    });

    return results;
  } catch (err) {
    logger.error('orchestration failed', { error: err.message });
    process.exit(1);
  }
}

// Run when executed directly (not imported)
if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  main();
}
