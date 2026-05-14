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

  if (!config.token) missing.push('GITHUB_TOKEN');
  if (!config.gcpProject) missing.push('GOOGLE_CLOUD_PROJECT');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) missing.push('GOOGLE_APPLICATION_CREDENTIALS');

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return config;
}

/**
 * Main orchestrator — creates, initializes, runs, and reports the TriageAgent.
 *
 * @param {object} [configOverride] - override config (useful for testing)
 * @returns {Promise<object>} triage results
 */
export async function main(configOverride) {
  const config = configOverride ?? loadConfig();
  validateConfig(config);

  logger.info('wanman-rapid-agent starting', {
    repo: config.repo,
    dryRun: config.dryRun,
  });

  const agent = new TriageAgent(config);

  try {
    await agent.initialize();
    const results = await agent.run();

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
