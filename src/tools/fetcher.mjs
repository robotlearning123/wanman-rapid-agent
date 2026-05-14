/**
 * GitHub Issue Fetcher — fetches open issues via Octokit
 *
 * Handles pagination and normalizes issue objects for downstream processing.
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.mjs';
import { withRetry, DEFAULT_RETRY_DELAYS_MS } from '../utils/retry.mjs';

/**
 * Create a fetcher bound to a specific repository.
 *
 * @param {{ token?: string, repo: string, retryDelaysMs?: number[], retrySleep?: function }} opts
 * @returns {{ fetchIssues(): Promise<NormalizedIssue[]> }}
 */
export function createFetcher({ token, repo, client, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, retrySleep }) {
  const octokit = client ?? new Octokit({ auth: token });

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

      const issues = await withRetry(
        () => octokit.paginate(octokit.rest.issues.listForRepo, {
          owner,
          repo: repository,
          state: 'open',
          per_page: 100,
        }),
        {
          delaysMs: retryDelaysMs,
          sleepFn: retrySleep,
          onRetry: ({ attempt, nextAttempt, delayMs, error }) => {
            logger.warn('fetch issues retry scheduled', {
              attempt,
              nextAttempt,
              delayMs,
              error: error.message,
            });
          },
        },
      );

      // Filter out pull requests (GitHub API returns PRs as issues)
      const openIssues = issues.filter(
        (issue) => !issue.pull_request
      );

      logger.info('fetched issues', { repo, total: issues.length, issues: openIssues.length });

      return openIssues.map((raw) => sanitizeIssue(normalize(raw)));
    },
  };
}

/**
 * Maximum allowed length for issue body text (characters).
 * Prevents excessively long inputs from inflating AI token usage.
 */
export const MAX_BODY_LENGTH = 10_000;

/**
 * Maximum allowed length for issue title (characters).
 */
export const MAX_TITLE_LENGTH = 500;

/**
 * Maximum allowed length for individual labels.
 */
export const MAX_LABEL_LENGTH = 100;

/**
 * Maximum number of labels to process per issue.
 */
export const MAX_LABEL_COUNT = 20;

/**
 * Sanitize a normalized issue by stripping dangerous characters,
 * truncating excessively long fields, and capping label counts.
 *
 * Defends against:
 *  - Control characters (null bytes, ANSI escapes, C0/C1 controls)
 *  - Excessive length (DoS via token inflation in AI prompts)
 *  - Label count explosion
 *
 * @param {NormalizedIssue} issue
 * @returns {NormalizedIssue}
 */
export function sanitizeIssue(issue) {
  return {
    number: issue.number,
    title: truncate(stripControls(String(issue.title ?? '')), MAX_TITLE_LENGTH),
    body: truncate(stripControls(String(issue.body ?? '')), MAX_BODY_LENGTH),
    labels: sanitizeLabels(issue.labels),
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    author: stripControls(String(issue.author ?? 'unknown')).substring(0, 100),
  };
}

/**
 * Strip control characters (C0 and C1) from a string,
 * preserving newlines, tabs, and carriage returns.
 *
 * @param {string} str
 * @returns {string}
 */
export function stripControls(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x08\x0B\x0E-\x1F\x7F-\x9F]/g, '');
}

/**
 * Truncate a string to a maximum length, appending an ellipsis if truncated.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...[truncated]';
}

/**
 * Sanitize and cap the label array.
 *
 * @param {string[]} labels
 * @returns {string[]}
 */
function sanitizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .slice(0, MAX_LABEL_COUNT)
    .map((l) => truncate(stripControls(String(l ?? '')), MAX_LABEL_LENGTH))
    .filter((l) => l.length > 0);
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
