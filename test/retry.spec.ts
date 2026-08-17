import { describe, expect, it } from 'vitest';
import { MAX_RETRIES, nextRetryDelayMs } from '../src/lib/retry';

describe('nextRetryDelayMs', () => {
  it('backs off with each retry, capped at the last tier', () => {
    const delays = [0, 1, 2, 3, 4].map(nextRetryDelayMs);
    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
    expect(delays[3]).toBe(delays[2]); // capped once past the last defined tier
    expect(delays[4]).toBe(delays[2]);
  });

  it('is always positive', () => {
    expect(nextRetryDelayMs(0)).toBeGreaterThan(0);
  });
});

describe('MAX_RETRIES', () => {
  it('is a small bounded number', () => {
    expect(MAX_RETRIES).toBeGreaterThan(0);
    expect(MAX_RETRIES).toBeLessThanOrEqual(5);
  });
});
