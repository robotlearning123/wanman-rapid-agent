/**
 * GitHub Webhook Handler — receives issue events and triggers triage
 *
 * Provides an HTTP handler that:
 *   1. Validates the HMAC-SHA256 signature from GitHub
 *   2. Filters for relevant event types (issues.opened, issues.edited)
 *   3. Normalizes the webhook payload into a single-issue triage request
 *   4. Dispatches through the existing TriageAgent pipeline
 */

import { createHmac } from 'node:crypto';
import { TriageAgent } from './agents/triage.mjs';
import { logger } from './utils/logger.mjs';

/**
 * Verify the GitHub webhook signature using HMAC-SHA256.
 *
 * @param {string} body - raw request body string
 * @param {string} signature - X-Hub-Signature-256 header value (sha256=<hex>)
 * @param {string} secret - webhook secret
 * @returns {boolean}
 */
export function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;

  const expected = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  const computed = `sha256=${hmac.digest('hex')}`;

  // Constant-time comparison to prevent timing attacks
  if (computed.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Check if a webhook event action should trigger triage.
 *
 * @param {string} event - X-GitHub-Event header value
 * @param {string} action - action field from payload
 * @returns {boolean}
 */
export function shouldProcess(event, action) {
  if (event === 'issues' && (action === 'opened' || action === 'edited')) return true;
  if (event === 'pull_request') return false; // PRs excluded from triage
  return false;
}

/**
 * Extract a normalized issue from a GitHub webhook payload.
 *
 * @param {object} payload - parsed JSON payload from GitHub
 * @returns {{ number: number, title: string, body: string, labels: string[], url: string, createdAt: string, updatedAt: string, author: string } | null}
 */
export function extractIssue(payload) {
  const issue = payload.issue;
  if (!issue) return null;

  return {
    number: issue.number,
    title: issue.title ?? '',
    body: issue.body ?? '',
    labels: (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
    url: issue.html_url ?? '',
    createdAt: issue.created_at ?? new Date().toISOString(),
    updatedAt: issue.updated_at ?? new Date().toISOString(),
    author: issue.user?.login ?? 'unknown',
  };
}

/**
 * Create a webhook handler for triaging GitHub issue events.
 *
 * @param {{ secret: string, triageConfig: object }} opts
 * @returns {{ handleRequest(req: object, res: object): Promise<void> }}
 */
export function createWebhookHandler({ secret, triageConfig }) {
  return {
    /**
     * Process an incoming GitHub webhook request.
     *
     * Expects Node.js http.IncomingMessage and http.ServerResponse objects.
     *
     * @param {{ on: function, method?: string, headers: object }} req
     * @param {{ statusCode?: number, setHeader?: function, end: function }} res
     */
    async handleRequest(req, res) {
      const event = req.headers['x-github-event'] ?? '';
      const signature = req.headers['x-hub-signature-256'] ?? '';

      // Collect raw body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');

      // Verify signature
      if (!verifySignature(rawBody, signature, secret)) {
        logger.warn('webhook: invalid signature', { event });
        res.statusCode = 401;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      // Parse payload
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        logger.warn('webhook: invalid JSON payload');
        res.statusCode = 400;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const action = payload.action ?? '';

      // Filter irrelevant events
      if (!shouldProcess(event, action)) {
        logger.info('webhook: event ignored', { event, action });
        res.statusCode = 200;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ignored', event, action }));
        return;
      }

      // Extract and triage
      const issue = extractIssue(payload);
      if (!issue) {
        logger.warn('webhook: no issue in payload', { event, action });
        res.statusCode = 400;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'No issue found in payload' }));
        return;
      }

      logger.info('webhook: processing issue', { event, action, issue: issue.number });

      try {
        const repo = payload.repository?.full_name ?? triageConfig.repo;
        const agent = new TriageAgent({ ...triageConfig, repo });
        await agent.initialize();
        const result = await agent.run();

        res.statusCode = 200;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'triaged', issue: issue.number, result }));
      } catch (err) {
        logger.error('webhook: triage failed', { error: err.message });
        res.statusCode = 500;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Triage failed', message: err.message }));
      }
    },
  };
}

/**
 * Start a webhook server.
 *
 * @param {{ port?: number, secret: string, triageConfig: object, httpServer?: function }} opts
 * @returns {Promise<import('node:http').Server>}
 */
export async function startWebhookServer({ port = 3000, secret, triageConfig, httpServer }) {
  const handler = createWebhookHandler({ secret, triageConfig });

  const createServer = httpServer ?? (await import('node:http')).createServer;

  const server = createServer(async (req, res) => {
    await handler.handleRequest(req, res);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      logger.info('webhook server started', { port });
      resolve(server);
    });
  });
}
