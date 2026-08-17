import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const result = await prisma.pushAttempt.updateMany({
    where: { contentItemId: id, status: 'FAILED' },
    data: { status: 'PENDING', retryCount: 0, nextRetryAt: null, errorMessage: null },
  });
  return NextResponse.json({ retried: result.count });
}
