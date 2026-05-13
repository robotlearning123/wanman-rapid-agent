/**
 * Cloud Storage run-report sink.
 *
 * The hackathon demo can run safely without a bucket, but when GCS_BUCKET is
 * configured each triage run writes a JSON report to Google Cloud Storage.
 */

import { Storage } from '@google-cloud/storage';
import { logger } from '../utils/logger.mjs';

/**
 * Build a deterministic object path for a triage run report.
 *
 * @param {{ repo: string, prefix?: string, now?: Date }} opts
 * @returns {string}
 */
export function buildRunReportPath({ repo, prefix = 'triage-runs', now = new Date() }) {
  const safeRepo = String(repo || 'unknown-repo')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown-repo';
  const safeTimestamp = now.toISOString().replace(/[:.]/g, '-');
  const safePrefix = String(prefix || 'triage-runs')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9._/-]+/g, '-');

  return `${safePrefix}/${safeRepo}/${safeTimestamp}.json`;
}

/**
 * Create a Cloud Storage sink for triage run reports.
 *
 * @param {{ bucketName?: string, prefix?: string, client?: object }} opts
 * @returns {{ enabled: boolean, saveRunReport(report: object): Promise<object> }}
 */
export function createRunStorage({ bucketName, prefix = 'triage-runs', client } = {}) {
  if (!bucketName) {
    return {
      enabled: false,
      async saveRunReport() {
        logger.info('cloud storage report skipped', { reason: 'GCS_BUCKET not configured' });
        return { saved: false, reason: 'GCS_BUCKET not configured' };
      },
    };
  }

  const storage = client ?? new Storage();

  return {
    enabled: true,

    /**
     * Persist a triage report as JSON.
     *
     * @param {{ repo?: string, result?: object }} report
     * @returns {Promise<{ saved: boolean, bucket: string, path: string }>}
     */
    async saveRunReport(report) {
      const path = buildRunReportPath({ repo: report.repo, prefix });
      const payload = JSON.stringify({
        generatedAt: new Date().toISOString(),
        ...report,
      }, null, 2);

      await storage
        .bucket(bucketName)
        .file(path)
        .save(payload, {
          contentType: 'application/json',
          resumable: false,
          metadata: {
            cacheControl: 'no-store',
          },
        });

      logger.info('cloud storage report saved', { bucket: bucketName, path });
      return { saved: true, bucket: bucketName, path };
    },
  };
}
