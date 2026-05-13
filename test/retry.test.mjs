/**
 * Tests for src/utils/retry.mjs — exponential backoff utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, DEFAULT_RETRY_DELAYS_MS } from '../src/utils/retry.mjs';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(async () => 42, {
      delaysMs: [100],
      sleepFn: async () => {},
    });
    assert.equal(result, 42);
  });

  it('retries on failure and eventually succeeds', async () => {
    let attempt = 0;
    const delays = [];
    const result = await withRetry(
      async () => {
        attempt++;
        if (attempt < 3) throw new Error('transient');
        return 'ok';
      },
      {
        delaysMs: [10, 20],
        sleepFn: async (ms) => { delays.push(ms); },
      }
    );
    assert.equal(result, 'ok');
    assert.equal(attempt, 3);
    assert.deepEqual(delays, [10, 20]);
  });

  it('throws after exhausting all retries', async () => {
    await assert.rejects(
      () => withRetry(
        async () => { throw new Error('persistent'); },
        { delaysMs: [10], sleepFn: async () => {} }
      ),
      { message: 'persistent' }
    );
  });

  it('throws immediately when delaysMs is empty', async () => {
    await assert.rejects(
      () => withRetry(
        async () => { throw new Error('no-retries'); },
        { delaysMs: [], sleepFn: async () => {} }
      ),
      { message: 'no-retries' }
    );
  });

  it('calls onRetry callback with attempt details', async () => {
    const events = [];
    let attempt = 0;
    await withRetry(
      async () => {
        attempt++;
        if (attempt < 2) throw new Error('retry-me');
        return 'done';
      },
      {
        delaysMs: [10],
        sleepFn: async () => {},
        onRetry: (e) => events.push(e),
      }
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].attempt, 1);
    assert.equal(events[0].nextAttempt, 2);
    assert.equal(events[0].delayMs, 10);
    assert.equal(events[0].error.message, 'retry-me');
  });

  it('respects shouldRetry returning false', async () => {
    await assert.rejects(
      () => withRetry(
        async () => { throw new Error('nope'); },
        {
          delaysMs: [10, 20],
          sleepFn: async () => {},
          shouldRetry: () => false,
        }
      ),
      { message: 'nope' }
    );
  });

  it('uses default sleep function when sleepFn is not provided', async () => {
    // Exercise the default `sleep` function (lines 7-9) by doing one retry
    // with a minimal delay so the test stays fast.
    let attempt = 0;
    const result = await withRetry(
      async () => {
        attempt++;
        if (attempt < 2) throw new Error('first-fail');
        return 'recovered';
      },
      { delaysMs: [1] }  // No sleepFn — uses default sleep()
    );
    assert.equal(result, 'recovered');
    assert.equal(attempt, 2);
  });

  it('exports DEFAULT_RETRY_DELAYS_MS as frozen array', () => {
    assert.deepEqual(DEFAULT_RETRY_DELAYS_MS, [1000, 2000, 4000]);
    assert.ok(Object.isFrozen(DEFAULT_RETRY_DELAYS_MS));
  });
});
