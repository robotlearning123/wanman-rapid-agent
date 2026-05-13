/**
 * Retry an async operation with exponential backoff.
 */

export const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @param {{
 *   delaysMs?: readonly number[],
 *   sleepFn?: (ms: number) => Promise<void>,
 *   shouldRetry?: (error: Error) => boolean,
 *   onRetry?: (event: { attempt: number, nextAttempt: number, delayMs: number, error: Error }) => void,
 * }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(operation, {
  delaysMs = DEFAULT_RETRY_DELAYS_MS,
  sleepFn = sleep,
  shouldRetry = () => true,
  onRetry,
} = {}) {
  let attempt = 1;

  while (true) {
    try {
      return await operation();
    } catch (err) {
      const delayMs = delaysMs[attempt - 1];
      if (delayMs === undefined || !shouldRetry(err)) {
        throw err;
      }

      onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error: err,
      });

      await sleepFn(delayMs);
      attempt++;
    }
  }
}
