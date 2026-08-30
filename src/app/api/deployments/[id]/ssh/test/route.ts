import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { defaultKnownHostsPath, ensureKnownHostsDir, resolveSshIdentity } from '@/lib/ssh-identity';
import { testKeyAuthConnection } from '@/lib/ssh-shim';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

// A trivial `ssh user@host true` via key auth, so a bad host/port/missing
// authorized_keys entry surfaces in seconds instead of minutes into a real
// Deploy run.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const deployment = await prisma.deployment.findUnique({ where: { id } });
  if (!deployment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const identity = resolveSshIdentity();
  const knownHostsPath = ensureKnownHostsDir(defaultKnownHostsPath());
  const result = await testKeyAuthConnection({
    identity,
    knownHostsPath,
    sshUser: deployment.sshUser,
    sshHost: deployment.sshHost,
    sshPort: deployment.sshPort,
  });
  return NextResponse.json(result);
}
