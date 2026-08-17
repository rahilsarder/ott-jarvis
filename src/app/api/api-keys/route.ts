import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { createApiKey, listApiKeys } from '@/lib/api-key.service';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

const createApiKeySchema = z.object({ label: z.string().min(1).max(100) });

export async function GET(req: NextRequest) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await listApiKeys());
}

export async function POST(req: NextRequest) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createApiKeySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // The response carries the raw key. This is the only time it is ever visible — only its hash is
  // stored — matching the OTT repo's own ApiKeyService convention.
  const created = await createApiKey(parsed.data.label);
  return NextResponse.json(created, { status: 201 });
}
