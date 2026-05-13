/**
 * Classifier Tool — classifies GitHub issues via Google Cloud Vertex AI
 *
 * Sends issue title + body to the Vertex AI Gemini endpoint and parses
 * structured JSON containing priority (P0–P4), area, and severity.
 *
 * The AI layer is swappable — replace this module to use a different
 * model or provider without changing the agent orchestration.
 */

import { logger } from '../utils/logger.mjs';

/**
 * Valid classification labels.
 * @enum {string}
 */
export const Priority = Object.freeze({
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
});

export const Area = Object.freeze({
  BUG: 'bug',
  FEATURE: 'feature',
  DOCS: 'docs',
  INFRA: 'infra',
  OTHER: 'other',
});

export const Severity = Object.freeze({
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
});

/**
 * Build the classification prompt sent to Vertex AI.
 *
 * @param {{ title: string, body: string, labels: string[] }} issue
 * @returns {string}
 */
export function buildPrompt(issue) {
  return `You are an expert issue triage assistant for a GitHub repository.
Classify the following GitHub issue into exactly these categories.
Respond with ONLY a JSON object (no markdown fences, no extra text):

{
  "priority": "P0" | "P1" | "P2" | "P3" | "P4",
  "area": "bug" | "feature" | "docs" | "infra" | "other",
  "severity": "critical" | "major" | "minor",
  "summary": "one-sentence summary of the issue"
}

Priority guide:
- P0: system down, data loss, security vulnerability
- P1: major feature broken, no workaround
- P2: feature degraded, workaround exists
- P3: minor feature issue, cosmetic
- P4: nice-to-have, future consideration

Issue title: ${issue.title}
Issue body: ${issue.body}
Existing labels: ${issue.labels.join(', ') || 'none'}`;
}

/**
 * Parse the raw AI response text into a classification result.
 * Handles markdown code fences and common formatting issues.
 *
 * @param {string} raw
 * @returns {{ priority: string, area: string, severity: string, summary: string }}
 */
export function parseResponse(raw) {
  let text = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(text);

  return {
    priority: validateEnum(parsed.priority, Priority, 'P3'),
    area: validateEnum(parsed.area, Area, Area.OTHER),
    severity: validateEnum(parsed.severity, Severity, Severity.MINOR),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };
}

/**
 * @param {string} value
 * @param {object} enumObj
 * @param {string} fallback
 * @returns {string}
 */
function validateEnum(value, enumObj, fallback) {
  const values = Object.values(enumObj);
  if (typeof value === 'string' && values.includes(value.toLowerCase())) {
    return value.toLowerCase();
  }
  // Try case-insensitive match
  const match = values.find((v) => v.toLowerCase() === String(value).toLowerCase());
  return match ?? fallback;
}

/**
 * Create a classifier tool bound to a Vertex AI project.
 *
 * @param {{ project: string, location?: string, model?: string }} opts
 * @returns {{ classify(issue: object): Promise<object> }}
 */
export function createClassifier({
  project,
  location = 'us-central1',
  model = 'gemini-1.5-flash',
}) {
  if (!project) {
    throw new Error('Classifier requires a Google Cloud project ID');
  }

  return {
    project,
    location,
    model,

    /**
     * Classify a single issue using Vertex AI.
     *
     * In dry-run or when credentials are unavailable, returns a safe
     * default classification instead of failing.
     *
     * @param {{ title: string, body: string, labels: string[] }} issue
     * @returns {Promise<{ priority: string, area: string, severity: string, summary: string }>}
     */
    async classify(issue) {
      const prompt = buildPrompt(issue);

      logger.info('classifying issue', {
        project: this.project,
        model: this.model,
        issue: issue.title?.substring(0, 60),
      });

      try {
        const response = await callVertexAI({
          project: this.project,
          location: this.location,
          model: this.model,
          prompt,
        });

        const result = parseResponse(response);
        logger.info('classification result', { priority: result.priority, area: result.area, severity: result.severity });
        return result;
      } catch (err) {
        logger.warn('classification failed, using defaults', { error: err.message });
        return {
          priority: Priority.P3,
          area: Area.OTHER,
          severity: Severity.MINOR,
          summary: 'Classification unavailable — AI request failed',
        };
      }
    },
  };
}

/**
 * Call the Vertex AI Predict API.
 *
 * Uses Google Application Default Credentials when available.
 * Falls back gracefully in environments without credentials.
 *
 * @param {{ project: string, location: string, model: string, prompt: string }} opts
 * @returns {Promise<string>} raw response text
 */
async function callVertexAI({ project, location, model, prompt }) {
  // Dynamic import — only needed when actually calling Vertex AI
  const { GoogleAuth } = await import('google-auth-library');

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const token = await auth.getAccessToken();

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex AI API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();

  // Extract text from Gemini response structure
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Vertex AI');
  }

  return text;
}
