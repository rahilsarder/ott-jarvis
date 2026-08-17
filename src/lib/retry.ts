export const MAX_RETRIES = 3;

const BACKOFF_TIERS_MS = [30_000, 120_000, 600_000];

export function nextRetryDelayMs(retryCount: number): number {
  const tier = Math.min(retryCount, BACKOFF_TIERS_MS.length - 1);
  return BACKOFF_TIERS_MS[tier];
}
