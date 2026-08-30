import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

// Lets the UI show a deployment's most recent run without the browser having
// to remember a specific runId — the log a viewer wants is nearly always
// "whatever this deployment's last attempt was", including after a page
// reload, when a client-side-only runId would already be gone.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const run = await prisma.provisionRun.findFirst({
    where: { deploymentId: id },
    orderBy: { startedAt: 'desc' },
  });
  if (!run) return NextResponse.json({ error: 'No runs yet' }, { status: 404 });
  return NextResponse.json({
    status: run.status,
    logText: run.logText,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
}
