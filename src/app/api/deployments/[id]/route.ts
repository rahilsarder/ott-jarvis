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
  const parsed = updateDeploymentSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const deployment = await prisma.deployment.update({
    where: { id },
    data: parsed.data,
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
