/**
 * Tests for src/tools/classifier.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClassifier,
  buildPrompt,
  parseResponse,
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
    assert.equal(result.priority, 'p1');
    assert.equal(result.area, 'bug');
    assert.equal(result.severity, 'major');
    assert.equal(result.summary, 'test summary');
  });

  it('handles markdown code fences', () => {
    const raw = '```json\n{"priority":"P2","area":"feature","severity":"minor","summary":"desc"}\n```';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'p2');
    assert.equal(result.area, 'feature');
  });

  it('handles code fences without json tag', () => {
    const raw = '```\n{"priority":"P3","area":"docs","severity":"minor","summary":"ok"}\n```';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'p3');
    assert.equal(result.area, 'docs');
  });

  it('falls back to P3 for invalid priority', () => {
    const raw = '{"priority":"invalid","area":"bug","severity":"major","summary":"x"}';
    const result = parseResponse(raw);
    assert.equal(result.priority, 'p3'); // fallback
  });

  it('falls back to "other" for invalid area', () => {
    const raw = '{"priority":"P1","area":"nonexistent","severity":"critical","summary":"x"}';
    const result = parseResponse(raw);
    assert.equal(result.area, 'other'); // fallback
  });

  it('handles missing summary gracefully', () => {
    const raw = '{"priority":"P1","area":"bug","severity":"major"}';
    const result = parseResponse(raw);
    assert.equal(result.summary, '');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseResponse('not json at all'), { name: 'SyntaxError' });
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
