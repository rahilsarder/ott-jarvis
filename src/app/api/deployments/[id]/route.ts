import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { updateDeploymentSchema } from '@/lib/deployment-schema';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  // See the note in ../route.ts: contentApiKey is server-side only.
  const deployment = await prisma.deployment.findUnique({ where: { id }, omit: { contentApiKey: true } });
  if (!deployment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(deployment);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.deployment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.status === 'PROVISIONING') {
    return NextResponse.json({ error: 'Cannot edit while a deploy is in progress' }, { status: 409 });
  }

  const parsed = updateDeploymentSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // A changed host/user/port means "server was swapped" (e.g. the customer
  // moved to a new VPS) — Jarvis's own key was only ever proven against the
  // *previous* target, and whatever this deployment's status used to be
  // (ACTIVE, FAILED, ...) says nothing about the new one. Force both back to
  // an unverified, unprovisioned state so Deploy is required again rather
  // than silently trusting a box Jarvis has never touched. Skipped if the
  // caller explicitly set a status in the same request.
  const sshTargetChanged =
    (parsed.data.sshHost !== undefined && parsed.data.sshHost !== existing.sshHost) ||
    (parsed.data.sshUser !== undefined && parsed.data.sshUser !== existing.sshUser) ||
    (parsed.data.sshPort !== undefined && parsed.data.sshPort !== existing.sshPort);

  const deployment = await prisma.deployment.update({
    where: { id },
    data: {
      ...parsed.data,
      ...(sshTargetChanged && {
        sshKeyInstalledAt: null,
        status: parsed.data.status ?? 'REGISTERED',
      }),
    },
    omit: { contentApiKey: true },
  });
  return NextResponse.json(deployment);
}

// Soft delete: keeps push/provision history intact and matches the design's
// "PAUSED/DECOMMISSIONED skipped by new fan-out" behavior for free.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await prisma.deployment.update({ where: { id }, data: { status: 'DECOMMISSIONED' } });
  return new NextResponse(null, { status: 204 });
}
