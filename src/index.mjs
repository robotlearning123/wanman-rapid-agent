/**
 * wanman-rapid-agent — entry point
 *
 * A multi-agent system that autonomously triages GitHub issues
 * using Google Cloud Vertex AI for classification.
 */

import { TriageAgent } from './agents/triage.mjs';
import { logger } from './utils/logger.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'example/repo';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // default: true for safety

export async function main() {
  logger.info('wanman-rapid-agent starting', { repo: REPO, dryRun: DRY_RUN });

  const agent = new TriageAgent({ repo: REPO, dryRun: DRY_RUN });

  try {
    const results = await agent.run();
    logger.info('triage complete', {
      total: results.total,
      classified: results.classified,
      errors: results.errors,
    });
    return results;
  } catch (err) {
    logger.error('triage failed', { error: err.message });
    process.exit(1);
  }
}

// Run when executed directly (not imported)
if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  main();
}
