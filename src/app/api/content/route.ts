import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { verifyApiKey } from '@/lib/api-key.service';
import { contentItemSchema } from '@/lib/content-schema';

type Auth = { via: 'session'; userId: string } | { via: 'apikey'; apiKeyId: string };

async function authenticate(req: NextRequest): Promise<Auth | null> {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const result = await verifyApiKey(authHeader.slice(7));
    return result ? { via: 'apikey', apiKeyId: result.id } : null;
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  return session ? { via: 'session', userId: session.userId } : null;
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = contentItemSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const item = await prisma.contentItem.create({
    data: {
      ...parsed.data,
      submittedByUserId: auth.via === 'session' ? auth.userId : null,
      submittedByApiKeyId: auth.via === 'apikey' ? auth.apiKeyId : null,
    },
  });

  const activeDeployments = await prisma.deployment.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  if (activeDeployments.length > 0) {
    await prisma.pushAttempt.createMany({
      data: activeDeployments.map((d) => ({ contentItemId: item.id, deploymentId: d.id })),
    });
  }

  return NextResponse.json(item, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const items = await prisma.contentItem.findMany({
    orderBy: { submittedAt: 'desc' },
    include: { pushAttempts: { include: { deployment: { select: { id: true, name: true } } } } },
  });
  return NextResponse.json(items);
}
