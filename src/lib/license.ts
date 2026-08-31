export type LicenseStatus = 'none' | 'ok' | 'soon' | 'expired';

/** Matches the deployments list's Version column: a fixed, non-configurable threshold. */
const SOON_THRESHOLD_DAYS = 14;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function getLicenseStatus(expiresAt: Date | string | null, now: Date = new Date()): LicenseStatus {
  if (!expiresAt) return 'none';
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const daysRemaining = (expiry.getTime() - now.getTime()) / MS_PER_DAY;
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= SOON_THRESHOLD_DAYS) return 'soon';
  return 'ok';
}
