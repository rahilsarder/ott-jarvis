import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { defaultKnownHostsPath, ensureKnownHostsDir, resolveSshIdentity } from '@/lib/ssh-identity';
import { testKeyAuthConnection } from '@/lib/ssh-shim';
import { runSshPasswordBootstrap } from '@/lib/ssh-bootstrap';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

const bootstrapSchema = z.object({ password: z.string().min(1).max(500) });

/**
 * One-shot: uses the submitted password to install Jarvis's own public key
 * on the target, then immediately proves the key works with a fresh
 * key-only connection before recording sshKeyInstalledAt. The password
 * itself is never persisted — it lives only in this request's memory and
 * the one child process it authenticates.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const deployment = await prisma.deployment.findUnique({ where: { id } });
  if (!deployment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const parsed = bootstrapSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const identity = resolveSshIdentity();
  const knownHostsPath = ensureKnownHostsDir(defaultKnownHostsPath());

  const install = await runSshPasswordBootstrap({
    sshUser: deployment.sshUser,
    sshHost: deployment.sshHost,
    sshPort: deployment.sshPort,
    password: parsed.data.password,
    identity,
    knownHostsPath,
  });
  if (!install.ok) return NextResponse.json({ ok: false, output: install.output }, { status: 502 });

  const verify = await testKeyAuthConnection({
    identity,
    knownHostsPath,
    sshUser: deployment.sshUser,
    sshHost: deployment.sshHost,
    sshPort: deployment.sshPort,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { ok: false, output: `Key installed, but the follow-up key-only connection failed:\n${verify.output}` },
      { status: 502 },
    );
  }

  await prisma.deployment.update({ where: { id }, data: { sshKeyInstalledAt: new Date() } });
  return NextResponse.json({ ok: true, output: verify.output });
}
