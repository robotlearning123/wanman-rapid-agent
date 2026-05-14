/**
 * GitHub Issue Fetcher — fetches open issues via Octokit
 *
 * Handles pagination and normalizes issue objects for downstream processing.
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.mjs';
import { withRetry, DEFAULT_RETRY_DELAYS_MS } from '../utils/retry.mjs';

/**
 * Default threshold for remaining API calls before throttling kicks in.
 * When x-ratelimit-remaining drops below this value, the fetcher will
 * pause before requesting the next page.
 */
export const DEFAULT_RATE_LIMIT_THRESHOLD = 100;

/**
 * Default delay (ms) to sleep when approaching the rate limit.
 */
export const DEFAULT_RATE_LIMIT_DELAY_MS = 1000;

/**
 * Create a fetcher bound to a specific repository.
 *
 * @param {{ token?: string, repo: string, client?: object, retryDelaysMs?: number[], retrySleep?: function, rateLimitThreshold?: number, rateLimitDelayMs?: number, sleepFn?: function }} opts
 * @returns {{ fetchIssues(): Promise<NormalizedIssue[]> }}
 */
export function createFetcher({
  token,
  repo,
  client,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  retrySleep,
  rateLimitThreshold = Number(process.env.RATE_LIMIT_THRESHOLD) || DEFAULT_RATE_LIMIT_THRESHOLD,
  rateLimitDelayMs = DEFAULT_RATE_LIMIT_DELAY_MS,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const octokit = client ?? new Octokit({ auth: token });

  return {
    /**
     * Fetch all open issues (not PRs) from the target repo.
     * Uses manual pagination to track rate limit headers per page.
     *
     * @returns {Promise<NormalizedIssue[]>}
     */
    async fetchIssues() {
      const [owner, repository] = repo.split('/');
      if (!owner || !repository) {
        throw new Error(`Invalid repository format: "${repo}". Expected "owner/repo".`);
      }

      logger.info('fetching issues', { repo, rateLimitThreshold });

      const allIssues = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await withRetry(
          () => octokit.rest.issues.listForRepo({
            owner,
            repo: repository,
            state: 'open',
            per_page: 100,
            page,
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

        const issues = response.data;
        allIssues.push(...issues);

        // Check rate limit from response headers
        const remaining = parseInt(response.headers['x-ratelimit-remaining'] ?? '5000', 10);
        if (remaining < rateLimitThreshold) {
          logger.warn('approaching rate limit, throttling', {
            remaining,
            threshold: rateLimitThreshold,
            delayMs: rateLimitDelayMs,
            nextPage: page + 1,
          });
          await sleepFn(rateLimitDelayMs);
        }

        hasMore = issues.length === 100;
        page++;
      }

      // Filter out pull requests (GitHub API returns PRs as issues)
      const openIssues = allIssues.filter(
        (issue) => !issue.pull_request
      );

      logger.info('fetched issues', { repo, total: allIssues.length, issues: openIssues.length });

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
