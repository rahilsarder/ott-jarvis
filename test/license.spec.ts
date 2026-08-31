import { describe, expect, it } from 'vitest';
import { getLicenseStatus } from '../src/lib/license';

const NOW = new Date('2026-08-31T00:00:00.000Z');

describe('getLicenseStatus', () => {
  it('returns "none" when no expiration is set', () => {
    expect(getLicenseStatus(null, NOW)).toBe('none');
  });

  it('returns "ok" when more than 14 days remain', () => {
    expect(getLicenseStatus('2026-09-15T00:00:00.000Z', NOW)).toBe('ok');
  });

  it('returns "soon" at exactly 14 days remaining (inclusive)', () => {
    expect(getLicenseStatus('2026-09-14T00:00:00.000Z', NOW)).toBe('soon');
  });

  it('returns "soon" for a date a few days out', () => {
    expect(getLicenseStatus('2026-09-02T00:00:00.000Z', NOW)).toBe('soon');
  });

  it('returns "soon" for a date that is today (0 days remaining)', () => {
    expect(getLicenseStatus('2026-08-31T00:00:00.000Z', NOW)).toBe('soon');
  });

  it('returns "expired" for a date one day in the past', () => {
    expect(getLicenseStatus('2026-08-30T00:00:00.000Z', NOW)).toBe('expired');
  });

  it('returns "expired" for a date long in the past', () => {
    expect(getLicenseStatus('2020-01-01T00:00:00.000Z', NOW)).toBe('expired');
  });

  it('accepts a Date object as well as a string', () => {
    expect(getLicenseStatus(new Date('2020-01-01T00:00:00.000Z'), NOW)).toBe('expired');
  });
});
