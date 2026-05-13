/**
 * Tests for src/tools/classifier.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClassifier,
  buildPrompt,
  parseResponse,
  callVertexAI,
  Priority,
  Area,
  Severity,
} from '../src/tools/classifier.mjs';

describe('createClassifier', () => {
  it('throws if project is missing', () => {
    assert.throws(() => createClassifier({}), { message: /Google Cloud project ID/ });
  });

  it('returns object with classify method', () => {
    const clf = createClassifier({ project: 'test-project' });
    assert.equal(typeof clf.classify, 'function');
  });

  it('stores config properties', () => {
    const clf = createClassifier({
      project: 'my-project',
      location: 'europe-west1',
      model: 'gemini-1.5-pro',
    });
    assert.equal(clf.project, 'my-project');
    assert.equal(clf.location, 'europe-west1');
    assert.equal(clf.model, 'gemini-1.5-pro');
  });

  it('uses defaults for location and model', () => {
    const clf = createClassifier({ project: 'test' });
    assert.equal(clf.location, 'us-central1');
    assert.equal(clf.model, 'gemini-1.5-flash');
  });

  it('classify — success path via mock callAI', async () => {
    const mockResponse = '{"priority":"P1","area":"bug","severity":"critical","summary":"Login crash"}';
    const clf = createClassifier({
      project: 'test-project',
      callAI: async () => mockResponse,
    });

    const result = await clf.classify({ title: 'Bug report', body: 'App crashes', labels: ['bug'] });
    assert.equal(result.priority, 'P1');
    assert.equal(result.area, 'bug');
    assert.equal(result.severity, 'critical');
    assert.equal(result.summary, 'Login crash');
  });

  it('classify — returns fallback when callAI throws', async () => {
    const clf = createClassifier({
      project: 'test-project',
      callAI: async () => { throw new Error('network error'); },
    });

    const result = await clf.classify({ title: 'Test', body: 'Body', labels: [] });
    assert.equal(result.priority, Priority.P3);
    assert.equal(result.area, Area.OTHER);
    assert.equal(result.severity, Severity.MINOR);
    assert.ok(result.summary.includes('unavailable'));
  });
});

describe('buildPrompt', () => {
  it('includes issue title and body', () => {
    const prompt = buildPrompt({ title: 'Bug report', body: 'App crashes', labels: [] });
    assert.ok(prompt.includes('Bug report'));
    assert.ok(prompt.includes('App crashes'));
  });

  it('includes existing labels', () => {
    const prompt = buildPrompt({ title: 'T', body: 'B', labels: ['bug', 'urgent'] });
    assert.ok(prompt.includes('bug, urgent'));
  });

  it('handles empty labels', () => {
    const prompt = buildPrompt({ title: 'T', body: 'B', labels: [] });
    assert.ok(prompt.includes('none'));
  });
});

describe('parseResponse', () => {
  it('parses clean JSON', () => {
    const raw = '{"priority":"P1","area":"bug","severity":"major","summary":"test summary"}';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'P1');
    assert.equal(result.area, 'bug');
    assert.equal(result.severity, 'major');
    assert.equal(result.summary, 'test summary');
  });

  it('handles markdown code fences', () => {
    const raw = '```json\n{"priority":"P2","area":"feature","severity":"minor","summary":"desc"}\n```';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'P2');
    assert.equal(result.area, 'feature');
  });

  it('handles code fences without json tag', () => {
    const raw = '```\n{"priority":"P3","area":"docs","severity":"minor","summary":"ok"}\n```';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'P3');
    assert.equal(result.area, 'docs');
  });

  it('falls back to P3 for invalid priority', () => {
    const raw = '{"priority":"invalid","area":"bug","severity":"major","summary":"x"}';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'P3');
  });

  it('falls back to "other" for invalid area', () => {
    const raw = '{"priority":"P1","area":"nonexistent","severity":"critical","summary":"x"}';
    const result = parseResponse(raw);
    assert.equal(result.area, 'other');
  });

  it('handles missing summary gracefully', () => {
    const raw = '{"priority":"P1","area":"bug","severity":"major"}';
    const result = parseResponse(raw);
    assert.equal(result.summary, '');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseResponse('not json at all'), { name: 'SyntaxError' });
  });

  it('defaults severity to minor for invalid value', () => {
    const raw = '{"priority":"P1","area":"bug","severity":"UNKNOWN","summary":"x"}';
    const result = parseResponse(raw);
    assert.equal(result.severity, 'minor');
  });

  it('defaults summary to empty string when not a string', () => {
    const raw = '{"priority":"P1","area":"bug","severity":"major","summary":42}';
    const result = parseResponse(raw);
    assert.equal(result.summary, '');
  });
});

describe('callVertexAI', () => {
  it('calls fetch with correct endpoint and returns text', async () => {
    const mockFetch = async (url, options) => {
      assert.ok(url.includes('us-central1-aiplatform.googleapis.com'));
      assert.equal(options.method, 'POST');
      assert.ok(options.headers.Authorization.startsWith('Bearer '));
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"priority":"P2"}' }] } }],
        }),
      };
    };

    const result = await callVertexAI({
      project: 'test-proj',
      location: 'us-central1',
      model: 'gemini-1.5-flash',
      prompt: 'test prompt',
      getAccessToken: async () => 'mock-token',
      fetchImpl: mockFetch,
    });

    assert.equal(result, '{"priority":"P2"}');
  });

  it('throws on non-ok HTTP response', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 403,
      text: async () => 'Permission denied',
    });

    await assert.rejects(
      () => callVertexAI({
        project: 'test-proj',
        location: 'us-central1',
        model: 'gemini-1.5-flash',
        prompt: 'test',
        getAccessToken: async () => 'token',
        fetchImpl: mockFetch,
      }),
      { message: /Vertex AI API error 403/ },
    );
  });

  it('throws when response has no text content', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [] } }],
      }),
    });

    await assert.rejects(
      () => callVertexAI({
        project: 'test-proj',
        location: 'us-central1',
        model: 'gemini-1.5-flash',
        prompt: 'test',
        getAccessToken: async () => 'token',
        fetchImpl: mockFetch,
      }),
      { message: /Empty response from Vertex AI/ },
    );
  });

  it('throws when candidates array is empty', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ candidates: [] }),
    });

    await assert.rejects(
      () => callVertexAI({
        project: 'test-proj',
        location: 'us-central1',
        model: 'gemini-1.5-flash',
        prompt: 'test',
        getAccessToken: async () => 'token',
        fetchImpl: mockFetch,
      }),
      { message: /Empty response from Vertex AI/ },
    );
  });
});

describe('classify method (no callAI injection)', () => {
  it('returns fallback when Vertex AI is unavailable', async () => {
    const clf = createClassifier({ project: 'dry-run' });
    const result = await clf.classify({ title: 'Test issue', body: 'body', labels: [] });
    assert.equal(result.priority, Priority.P3);
    assert.equal(result.area, Area.OTHER);
    assert.equal(result.severity, Severity.MINOR);
    assert.ok(result.summary.includes('unavailable'));
  });
});

describe('enum exports', () => {
  it('Priority has expected values', () => {
    assert.deepEqual(Object.values(Priority), ['P0', 'P1', 'P2', 'P3', 'P4']);
  });

  it('Area has expected values', () => {
    assert.deepEqual(Object.values(Area), ['bug', 'feature', 'docs', 'infra', 'other']);
  });

  it('Severity has expected values', () => {
    assert.deepEqual(Object.values(Severity), ['critical', 'major', 'minor']);
  });
});
