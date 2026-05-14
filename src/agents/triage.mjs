/**
 * TriageAgent — orchestrates GitHub issue triage using AI classification
 *
 * Workflow: fetch issues → classify each → apply labels + post comments
 * Extends the Agent base class for lifecycle management and state tracking.
 */

import { Agent } from './base.mjs';
import { createFetcher } from '../tools/fetcher.mjs';
import { createClassifier } from '../tools/classifier.mjs';
import { createResponder, buildComment, hasPriorityLabel } from '../tools/responder.mjs';
import { createRunStorage } from '../tools/storage.mjs';
import { logger } from '../utils/logger.mjs';

/**
 * @typedef {import('../tools/fetcher.mjs').NormalizedIssue} NormalizedIssue
 */

/**
 * @typedef {object} TriageResult
 * @property {number} total - total issues processed
 * @property {number} skipped - issues skipped (already labeled)
 * @property {number} classified - successfully classified
 * @property {number} labeled - labels applied
 * @property {number} commented - comments posted
 * @property {number} errors - errors encountered
 * @property {object[]} [details] - per-issue classification details
 * @property {object} [storage] - Cloud Storage persistence result
 */

export class TriageAgent extends Agent {
  /** @type {ReturnType<typeof createFetcher>|null} */
  #fetcher = null;

  /** @type {ReturnType<typeof createClassifier>|null} */
  #classifier = null;

  /** @type {ReturnType<typeof createResponder>|null} */
  #responder = null;

  /** @type {ReturnType<typeof createRunStorage>|null} */
  #storage = null;

  /**
   * @param {{
   *   repo: string,
   *   token?: string,
   *   gcpProject?: string,
   *   gcpLocation?: string,
   *   gcpModel?: string,
   *   gcsBucket?: string,
   *   gcsPrefix?: string,
   *   dryRun?: boolean,
   *   skipLabeled?: boolean,
   *   concurrency?: number,
   * }} config
   */
  constructor(config) {
    super('triage-agent', config);
  }

  /**
   * Set up tools from configuration. Called by Agent.initialize().
   * @protected
   */
  async _onInitialize() {
    const { repo, token, gcpProject, gcpLocation, gcpModel, gcsBucket, gcsPrefix, dryRun, _tools } = this.config;

    this.#fetcher = _tools?.fetcher ?? createFetcher({ token, repo });

    this.#classifier = _tools?.classifier ?? (gcpProject
      ? createClassifier({ project: gcpProject, location: gcpLocation, model: gcpModel })
      : createClassifier({ project: 'dry-run' }));

    this.#responder = _tools?.responder ?? createResponder({ token, repo, dryRun: dryRun ?? true });
    this.#storage = _tools?.storage ?? createRunStorage({ bucketName: gcsBucket, prefix: gcsPrefix });

    logger.info('triage agent initialized', { repo, dryRun });
  }

  /**
   * Main triage workflow. Called by Agent.run().
   *
   * Processes issues concurrently with a configurable limit (CONCURRENCY env var
   * or config.concurrency, default 3, max 20). Each issue is error-isolated.
   *
   * @protected
   * @returns {Promise<TriageResult>}
   */
  async _onRun() {
    const skipLabeled = this.config.skipLabeled ?? true;
    const concurrency = this.#resolveConcurrency();

    let issues;
    try {
      issues = await this.#fetcher.fetchIssues();
    } catch (err) {
      logger.error('fetch failed', { error: err.message });
      return this.#finalizeRun({ total: 0, skipped: 0, classified: 0, labeled: 0, commented: 0, errors: 1 });
    }
    logger.info('fetched issues for triage', { count: issues.length, concurrency });

    if (issues.length === 0) {
      return this.#finalizeRun({ total: 0, skipped: 0, classified: 0, labeled: 0, commented: 0, errors: 0 });
    }

    const details = [];
    let skipped = 0;

    // Partition: skipped issues handled synchronously, rest go to concurrent pool
    const toClassify = [];
    for (const issue of issues) {
      if (skipLabeled && hasPriorityLabel(issue.labels)) {
        skipped++;
        logger.info('skipped already-labeled issue', { number: issue.number, labels: issue.labels });
        details.push({ number: issue.number, skipped: true });
      } else {
        toClassify.push(issue);
      }
    }

    // Run classification concurrently with bounded concurrency
    const results = await this.#runConcurrent(toClassify, concurrency);

    let classified = 0;
    let labeled = 0;
    let commented = 0;
    let errors = 0;

    for (const { number, result, error } of results) {
      if (error) {
        errors++;
        logger.warn('issue triage failed', { number, error });
        details.push({ number, error });
      } else {
        details.push({ number, ...result });
        classified++;
        if (result.labelsApplied?.length) labeled++;
        if (result.commentPosted) commented++;
      }
    }

    logger.info('triage complete', {
      total: issues.length,
      skipped,
      classified,
      labeled,
      commented,
      errors,
      concurrency,
    });

    return this.#finalizeRun({
      total: issues.length,
      skipped,
      classified,
      labeled,
      commented,
      errors,
      details,
    });
  }

  /**
   * Resolve concurrency limit from config or CONCURRENCY env var.
   * @private
   * @returns {number}
   */
  #resolveConcurrency() {
    const raw = this.config.concurrency ?? process.env.CONCURRENCY;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return 3;
    return Math.min(n, 20);
  }

  /**
   * Process issues concurrently with a bounded concurrency limit.
   * Each issue is error-isolated — one failure does not affect others.
   *
   * @private
   * @param {NormalizedIssue[]} issues
   * @param {number} limit
   * @returns {Promise<Array<{ number: number, result?: object, error?: string }>>}
   */
  async #runConcurrent(issues, limit) {
    const results = [];
    let idx = 0;

    const next = async () => {
      while (idx < issues.length) {
        const current = idx++;
        const issue = issues[current];
        try {
          const result = await this.#triageIssue(issue);
          results[current] = { number: issue.number, result };
        } catch (err) {
          results[current] = { number: issue.number, error: err.message };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, issues.length) }, () => next()));
    return results;
  }

  /**
   * Process a single issue: classify → label → comment.
   *
   * @param {NormalizedIssue} issue
   * @returns {Promise<{ classification: object, labelsApplied: string[], commentPosted: boolean }>}
   */
  async #triageIssue(issue) {
    // Classify
    const classification = await this.#classifier.classify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    });

    // Apply labels
    const labelsApplied = await this.#responder.applyLabels(issue.number, classification);

    // Post comment
    const comment = buildComment(classification, { repo: this.config.repo });
    const commentPosted = await this.#responder.postComment(issue.number, comment);

    return { classification, labelsApplied, commentPosted };
  }

  /**
   * Persist a run report when Cloud Storage is configured.
   *
   * @param {TriageResult} result
   * @returns {Promise<TriageResult>}
   */
  async #finalizeRun(result) {
    try {
      const storage = await this.#storage.saveRunReport({
        repo: this.config.repo,
        dryRun: this.config.dryRun ?? true,
        result,
      });
      return { ...result, storage };
    } catch (err) {
      logger.warn('cloud storage report failed', { error: err.message });
      return {
        ...result,
        storage: { saved: false, error: err.message },
      };
    }
  }

  /**
   * Clean up resources. Called by Agent.stop().
   * @protected
   */
  async _onStop() {
    this.#fetcher = null;
    this.#classifier = null;
    this.#responder = null;
    this.#storage = null;
    logger.info('triage agent stopped');
  }
}
