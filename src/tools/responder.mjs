/**
 * Responder Tool — applies labels and posts triage comments on GitHub issues
 *
 * Provides two operations:
 *  1. applyLabels — sets priority/area/severity labels on an issue
 *  2. postComment — writes a triage summary comment
 *
 * In dry-run mode, actions are logged but not executed against the GitHub API.
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.mjs';

/**
 * Map classification results to GitHub label names.
 *
 * @param {{ priority: string, area: string, severity: string }} classification
 * @returns {string[]} label names to apply
 */
export function classificationToLabels(classification) {
  const labels = [];

  if (classification.priority) {
    labels.push(`priority:${classification.priority}`);
  }
  if (classification.area) {
    labels.push(`area:${classification.area}`);
  }
  if (classification.severity) {
    labels.push(`severity:${classification.severity}`);
  }

  return labels;
}

/**
 * Build the triage summary comment body.
 *
 * @param {{ priority: string, area: string, severity: string, summary: string }} classification
 * @returns {string} markdown comment body
 */
export function buildComment(classification) {
  return [
    '### Issue Triage Report',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Priority** | ${classification.priority} |`,
    `| **Area** | ${classification.area} |`,
    `| **Severity** | ${classification.severity} |`,
    '',
    `> ${classification.summary}`,
    '',
    '_Automated by [wanman-rapid-agent](https://github.com/your-org/wanman-rapid-agent) — classify issues with Vertex AI_',
  ].join('\n');
}

/**
 * Create a responder bound to a specific repository.
 *
 * @param {{ token?: string, repo: string, dryRun?: boolean }} opts
 * @returns {{ applyLabels(number, object): Promise<string[]>, postComment(number, string): Promise<boolean> }}
 */
export function createResponder({ token, repo, dryRun = true }) {
  const octokit = token ? new Octokit({ auth: token }) : null;
  const [owner, repository] = repo.split('/');

  if (!owner || !repository) {
    throw new Error(`Invalid repository format: "${repo}". Expected "owner/repo".`);
  }

  return {
    /**
     * Apply classification labels to an issue.
     * Returns the list of labels applied (or would have applied in dry-run).
     *
     * @param {number} issueNumber
     * @param {{ priority: string, area: string, severity: string }} classification
     * @returns {Promise<string[]>}
     */
    async applyLabels(issueNumber, classification) {
      const labels = classificationToLabels(classification);

      if (dryRun) {
        logger.info('dry-run: would apply labels', { issue: issueNumber, labels });
        return labels;
      }

      if (!octokit) {
        logger.warn('no token configured, skipping label application', { issue: issueNumber });
        return [];
      }

      await octokit.rest.issues.addLabels({
        owner,
        repo: repository,
        issue_number: issueNumber,
        labels,
      });

      logger.info('applied labels', { issue: issueNumber, labels });
      return labels;
    },

    /**
     * Post a triage summary comment on an issue.
     *
     * @param {number} issueNumber
     * @param {string} commentBody
     * @returns {Promise<boolean>} true if comment was posted (or dry-run)
     */
    async postComment(issueNumber, commentBody) {
      if (dryRun) {
        logger.info('dry-run: would post comment', { issue: issueNumber });
        return true;
      }

      if (!octokit) {
        logger.warn('no token configured, skipping comment', { issue: issueNumber });
        return false;
      }

      await octokit.rest.issues.createComment({
        owner,
        repo: repository,
        issue_number: issueNumber,
        body: commentBody,
      });

      logger.info('posted triage comment', { issue: issueNumber });
      return true;
    },
  };
}
