import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { createDeploymentSchema } from '@/lib/deployment-schema';
import { getContentStatusSummary } from '@/lib/content-sync';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // contentApiKey is the bearer secret Jarvis uses against each deployment's own admin API. The UI
  // never reads it, so it must not ship to the browser (React Query cache, devtools, etc.). `omit`
  // rather than an explicit `select` so fields added to the model later are exposed by default and
  // only this one stays server-side.
  const deployments = await prisma.deployment.findMany({
    orderBy: { createdAt: 'desc' },
    omit: { contentApiKey: true },
  });

  // One grouped query for every row's content status, rather than one query per row.
  const statusByDeployment = await getContentStatusSummary(deployments.map((d) => d.id));
  const withContentStatus = deployments.map((d) => ({
    ...d,
    contentStatus: statusByDeployment.get(d.id) ?? { total: 0, success: 0, pending: 0, failed: 0, missing: 0 },
  }));
  return NextResponse.json(withContentStatus);
}

export async function POST(req: NextRequest) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createDeploymentSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const deployment = await prisma.deployment.create({ data: parsed.data });
  return NextResponse.json(deployment, { status: 201 });
}
