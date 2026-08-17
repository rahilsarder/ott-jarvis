import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'jarvis_session';

export interface SessionPayload {
  userId: string;
  email: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.JARVIS_SESSION_SECRET;
  if (!secret) throw new Error('JARVIS_SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
