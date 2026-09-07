import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { syncMissingContent } from '@/lib/content-sync';

/**
 * Manual counterpart to the automatic sync that runs whenever a deployment first becomes ACTIVE
 * (see provisioner.ts) — an operator-triggered catch-up for any other reason a deployment could
 * have missing content (a sync that failed to fire, content submitted while this deployment was
 * PAUSED and later reactivated outside Jarvis's own flow, etc). Idempotent: re-running it when
 * nothing is missing is just a no-op query, so the "Sync missing content" button is always safe
 * to click.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const deployment = await prisma.deployment.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!deployment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (deployment.status !== 'ACTIVE') {
    return NextResponse.json({ error: `Cannot sync content for a deployment with status ${deployment.status}` }, { status: 409 });
  }

  const synced = await syncMissingContent(id);
  return NextResponse.json({ synced });
}
