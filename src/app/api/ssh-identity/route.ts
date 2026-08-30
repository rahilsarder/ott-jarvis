import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { resolveSshIdentity } from '@/lib/ssh-identity';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

// Lets the UI show "paste this into the target's authorized_keys" without an
// operator having to SSH into the Jarvis box and hunt for the file — the key
// itself generates on first request if it doesn't exist yet.
export async function GET(req: NextRequest) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const identity = resolveSshIdentity();
  return NextResponse.json({ publicKey: identity.publicKey });
}
