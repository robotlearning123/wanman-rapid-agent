/**
 * TriageAgent — orchestrates issue classification and labeling
 */

import { logger } from '../utils/logger.mjs';

export class TriageAgent {
  constructor({ repo, dryRun = true }) {
    this.repo = repo;
    this.dryRun = dryRun;
  }

  async run() {
    logger.info('fetching open issues', { repo: this.repo });

    // TODO: implement issue fetching via GitHub API (task: implement-agent-core)
    const issues = [];

    logger.info('classifying issues', { count: issues.length });

    // TODO: implement classification via Vertex AI (task: implement-github-triage)

    return {
      total: issues.length,
      classified: 0,
      errors: 0,
    };
  }
}
