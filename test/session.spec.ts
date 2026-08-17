import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../src/lib/session';

beforeEach(() => {
  process.env.JARVIS_SESSION_SECRET = 'test-secret-at-least-32-bytes-long!!';
});

describe('session tokens', () => {
  it('round-trips the payload', async () => {
    const token = await createSessionToken({ userId: 'u1', email: 'a@b.com' });
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ userId: 'u1', email: 'a@b.com' });
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken({ userId: 'u1', email: 'a@b.com' });
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifySessionToken('not-a-jwt')).toBeNull();
  });
});
