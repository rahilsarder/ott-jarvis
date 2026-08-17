import { describe, expect, it } from 'vitest';
import { generateApiKey, hashOpaqueToken, hashPassword, verifyPassword } from '../src/lib/crypto';

describe('hashOpaqueToken', () => {
  it('is deterministic', () => {
    expect(hashOpaqueToken('abc')).toBe(hashOpaqueToken('abc'));
  });

  it('differs for different input', () => {
    expect(hashOpaqueToken('abc')).not.toBe(hashOpaqueToken('abd'));
  });
});

describe('generateApiKey', () => {
  it('generates unique, sufficiently long keys', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips a correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', stored)).toBe(false);
  });

  it('produces a different stored value each time (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});
