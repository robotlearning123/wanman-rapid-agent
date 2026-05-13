/**
 * GitHub Issue Fetcher — fetches open issues via Octokit
 *
 * Handles pagination and normalizes issue objects for downstream processing.
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.mjs';

/**
 * Create a fetcher bound to a specific repository.
 *
 * @param {{ token?: string, repo: string }} opts
 * @returns {{ fetchIssues(): Promise<NormalizedIssue[]> }}
 */
export function createFetcher({ token, repo }) {
  const octokit = new Octokit({ auth: token });

  return {
    /**
     * Fetch all open issues (not PRs) from the target repo.
     * Automatically paginates through all pages.
     *
     * @returns {Promise<NormalizedIssue[]>}
     */
    async fetchIssues() {
      const [owner, repository] = repo.split('/');
      if (!owner || !repository) {
        throw new Error(`Invalid repository format: "${repo}". Expected "owner/repo".`);
      }

      logger.info('fetching issues', { repo });

      const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        owner,
        repo: repository,
        state: 'open',
        per_page: 100,
      });

      // Filter out pull requests (GitHub API returns PRs as issues)
      const openIssues = issues.filter(
        (issue) => !issue.pull_request
      );

      logger.info('fetched issues', { repo, total: issues.length, issues: openIssues.length });

      return openIssues.map(normalize);
    },
  };
}

/**
 * Normalize a GitHub API issue into a flat shape for classification.
 *
 * @param {import('@octokit/rest').RestEndpointMethodTypes['issues']['listForRepo']['response']['data'][number]} raw
 * @returns {NormalizedIssue}
 */
export function normalize(raw) {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    labels: raw.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    url: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    author: raw.user?.login ?? 'unknown',
  };
}

/**
 * @typedef {Object} NormalizedIssue
 * @property {number} number
 * @property {string} title
 * @property {string} body
 * @property {string[]} labels
 * @property {string} url
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} author
 */
