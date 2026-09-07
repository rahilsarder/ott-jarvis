import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { contentItemSchema } from '@/lib/content-schema';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/**
 * Edits an already-submitted item — e.g. fixing a typo'd streamPath that a
 * push has been failing on. Session-only: this is an admin correcting a
 * mistake, not something a machine watcher client ever does.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.contentItem.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const parsed = contentItemSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const item = await prisma.contentItem.update({ where: { id }, data: parsed.data });

  // The edit invalidates whatever every existing push attempt already sent — reset all of them
  // (not just the failed ones) so the corrected fields actually reach every deployment, including
  // one that had already succeeded with the wrong data.
  await prisma.pushAttempt.updateMany({
    where: { contentItemId: id },
    data: { status: 'PENDING', retryCount: 0, nextRetryAt: null, errorMessage: null, httpStatus: null, attemptedAt: null },
  });

  return NextResponse.json(item);
}
