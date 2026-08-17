import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { runId } = await params;
  const run = await prisma.provisionRun.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    status: run.status,
    logText: run.logText,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
}
