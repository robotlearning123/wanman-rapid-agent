/**
 * Tests for input sanitization — fetcher.mjs sanitizeIssue/stripControls/truncate
 * and responder.mjs sanitizeCommentField
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeIssue,
  stripControls,
  truncate,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_LABEL_COUNT,
} from '../src/tools/fetcher.mjs';
import { sanitizeCommentField } from '../src/tools/responder.mjs';

// ---------------------------------------------------------------------------
// stripControls
// ---------------------------------------------------------------------------
describe('stripControls', () => {
  it('removes null byte', () => {
    assert.equal(stripControls('hello\x00world'), 'helloworld');
  });

  it('removes ANSI escape sequences (C1 controls)', () => {
    assert.equal(stripControls('text\x1B[31mred\x1B[0m'), 'text[31mred[0m');
  });

  it('removes multiple C0 control characters', () => {
    const input = 'a\x01b\x02c\x07d\x0Ee';
    assert.equal(stripControls(input), 'abcde');
  });

  it('preserves newlines and tabs', () => {
    const input = 'line1\nline2\ttab\r\nwindows';
    assert.equal(stripControls(input), input);
  });

  it('preserves carriage return', () => {
    assert.equal(stripControls('hello\rworld'), 'hello\rworld');
  });

  it('handles empty string', () => {
    assert.equal(stripControls(''), '');
  });

  it('handles string with only control chars', () => {
    assert.equal(stripControls('\x00\x01\x02'), '');
  });

  it('strips DEL character (0x7F)', () => {
    assert.equal(stripControls('before\x7Fafter'), 'beforeafter');
  });

  it('strips C1 range (0x80-0x9F)', () => {
    assert.equal(stripControls('a\x80b\x9Fc'), 'abc');
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
describe('truncate', () => {
  it('does not truncate short strings', () => {
    assert.equal(truncate('hello', 10), 'hello');
  });

  it('does not truncate exact-length strings', () => {
    assert.equal(truncate('12345', 5), '12345');
  });

  it('truncates and appends ellipsis', () => {
    assert.equal(truncate('1234567890', 5), '12345...[truncated]');
  });

  it('handles empty string', () => {
    assert.equal(truncate('', 5), '');
  });
});

// ---------------------------------------------------------------------------
// sanitizeIssue
// ---------------------------------------------------------------------------
describe('sanitizeIssue', () => {
  const baseIssue = {
    number: 1,
    title: 'Normal bug',
    body: 'Steps to reproduce',
    labels: ['bug', 'critical'],
    url: 'https://github.com/o/r/issues/1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    author: 'dev1',
  };

  it('passes through clean issues unchanged', () => {
    const result = sanitizeIssue(baseIssue);
    assert.equal(result.title, 'Normal bug');
    assert.equal(result.body, 'Steps to reproduce');
    assert.deepEqual(result.labels, ['bug', 'critical']);
    assert.equal(result.author, 'dev1');
  });

  it('strips control characters from title', () => {
    const issue = { ...baseIssue, title: 'Bug\x00report\x01title' };
    assert.equal(sanitizeIssue(issue).title, 'Bugreporttitle');
  });

  it('strips control characters from body', () => {
    const issue = { ...baseIssue, body: 'Step 1\x07\nStep 2\x00' };
    const result = sanitizeIssue(issue);
    assert.equal(result.body, 'Step 1\nStep 2');
  });

  it('truncates excessively long title', () => {
    const longTitle = 'A'.repeat(MAX_TITLE_LENGTH + 500);
    const result = sanitizeIssue({ ...baseIssue, title: longTitle });
    assert.equal(result.title.length, MAX_TITLE_LENGTH + '...[truncated]'.length);
    assert.ok(result.title.endsWith('...[truncated]'));
  });

  it('truncates excessively long body', () => {
    const longBody = 'B'.repeat(MAX_BODY_LENGTH + 2000);
    const result = sanitizeIssue({ ...baseIssue, body: longBody });
    assert.equal(result.body.length, MAX_BODY_LENGTH + '...[truncated]'.length);
    assert.ok(result.body.endsWith('...[truncated]'));
  });

  it('caps label count to MAX_LABEL_COUNT', () => {
    const tooMany = Array.from({ length: 50 }, (_, i) => `label-${i}`);
    const result = sanitizeIssue({ ...baseIssue, labels: tooMany });
    assert.equal(result.labels.length, MAX_LABEL_COUNT);
  });

  it('strips control chars from labels', () => {
    const result = sanitizeIssue({ ...baseIssue, labels: ['bug\x00', 'fea\x07ture'] });
    assert.deepEqual(result.labels, ['bug', 'feature']);
  });

  it('filters out empty labels after sanitization', () => {
    const result = sanitizeIssue({ ...baseIssue, labels: ['\x00\x01', 'bug', ''] });
    assert.deepEqual(result.labels, ['bug']);
  });

  it('handles null/undefined fields gracefully', () => {
    const issue = { ...baseIssue, title: null, body: undefined, author: undefined };
    const result = sanitizeIssue(issue);
    assert.equal(typeof result.title, 'string');
    assert.equal(typeof result.body, 'string');
    assert.equal(result.author, 'unknown');
  });

  it('handles non-array labels gracefully', () => {
    const result = sanitizeIssue({ ...baseIssue, labels: 'not-an-array' });
    assert.deepEqual(result.labels, []);
  });

  it('preserves non-string metadata fields', () => {
    const result = sanitizeIssue(baseIssue);
    assert.equal(result.number, 1);
    assert.equal(result.url, 'https://github.com/o/r/issues/1');
    assert.equal(result.createdAt, '2025-01-01T00:00:00Z');
    assert.equal(result.updatedAt, '2025-01-01T00:00:00Z');
  });

  it('truncates excessively long labels', () => {
    const longLabel = 'x'.repeat(MAX_LABEL_LENGTH + 50);
    const result = sanitizeIssue({ ...baseIssue, labels: [longLabel] });
    assert.ok(result.labels[0].length <= MAX_LABEL_LENGTH + '...[truncated]'.length);
  });

  it('truncates author to 100 chars', () => {
    const longAuthor = 'u'.repeat(200);
    const result = sanitizeIssue({ ...baseIssue, author: longAuthor });
    assert.equal(result.author.length, 100);
  });
});

// ---------------------------------------------------------------------------
// sanitizeCommentField (responder)
// ---------------------------------------------------------------------------
describe('sanitizeCommentField', () => {
  it('strips HTML script tags', () => {
    assert.equal(
      sanitizeCommentField('<script>alert("xss")</script>pwned'),
      'alert("xss")pwned',
    );
  });

  it('strips HTML img onerror', () => {
    assert.equal(
      sanitizeCommentField('<img src=x onerror=alert(1)>'),
      '',
    );
  });

  it('strips HTML bold tags but preserves text', () => {
    assert.equal(
      sanitizeCommentField('<b>important</b> issue'),
      'important issue',
    );
  });

  it('strips control characters', () => {
    assert.equal(sanitizeCommentField('hello\x00world'), 'helloworld');
  });

  it('preserves plain text', () => {
    assert.equal(sanitizeCommentField('A normal summary'), 'A normal summary');
  });

  it('handles empty string', () => {
    assert.equal(sanitizeCommentField(''), '');
  });

  it('handles markdown safely (no stripping)', () => {
    const md = '**bold** and `code` and [link](url)';
    assert.equal(sanitizeCommentField(md), md);
  });

  it('strips nested HTML', () => {
    assert.equal(
      sanitizeCommentField('<div><p>nested</p></div>'),
      'nested',
    );
  });
});

// ---------------------------------------------------------------------------
// Integration: sanitizeIssue + normalize pipeline
// ---------------------------------------------------------------------------
describe('integration: normalize then sanitize', () => {
  // We import normalize to verify the full pipeline
  // The fetcher already wires normalize → sanitizeIssue
  // This test verifies that the composition works
  it('sanitizeIssue result is a valid NormalizedIssue shape', async () => {
    const { normalize: normalizeFn } = await import('../src/tools/fetcher.mjs');
    const raw = {
      number: 99,
      title: 'Bug with\x00 control',
      body: 'Long' + '\x01'.repeat(50),
      labels: [{ name: 'bug' }, { name: 'urgent\x07' }],
      html_url: 'https://github.com/o/r/issues/99',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      user: { login: 'dev' },
    };

    // Simulate the pipeline: normalize → sanitizeIssue
    const result = sanitizeIssue(normalizeFn(raw));

    assert.equal(result.number, 99);
    assert.ok(!result.title.includes('\x00'));
    assert.ok(!result.body.includes('\x01'));
    assert.deepEqual(result.labels, ['bug', 'urgent']);
    assert.equal(result.author, 'dev');
  });
});

// ---------------------------------------------------------------------------
// Constants sanity
// ---------------------------------------------------------------------------
describe('sanitization constants', () => {
  it('MAX_BODY_LENGTH is reasonable (>= 1000)', () => {
    assert.ok(MAX_BODY_LENGTH >= 1000);
  });

  it('MAX_TITLE_LENGTH is reasonable (>= 100)', () => {
    assert.ok(MAX_TITLE_LENGTH >= 100);
  });

  it('MAX_LABEL_LENGTH is reasonable (>= 50)', () => {
    assert.ok(MAX_LABEL_LENGTH >= 50);
  });

  it('MAX_LABEL_COUNT is reasonable (>= 10)', () => {
    assert.ok(MAX_LABEL_COUNT >= 10);
  });
});
