import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { executeProvisioning, startProvisioning } from '@/lib/provisioner';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const deployment = await prisma.deployment.findUnique({ where: { id } });
  if (!deployment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // ACTIVE is a normal, expected caller here now: deploy.sh's own status
  // detection (does .env already exist on the target?) is what actually
  // decides fresh install vs. update, not this route — the UI just chooses
  // which label (Deploy / Update) to show based on the deployment's current
  // status before the click.
  if (!['REGISTERED', 'FAILED', 'ACTIVE'].includes(deployment.status)) {
    return NextResponse.json({ error: `Cannot deploy from status ${deployment.status}` }, { status: 409 });
  }

  const runId = await startProvisioning(id);
  // executeProvisioning has its own top-level try/catch that marks the run/deployment FAILED on any
  // error. This .catch() is a defense-in-depth backstop only, in case that handling itself throws —
  // it must never be relied on as the primary failure path.
  void executeProvisioning(id, runId).catch((err) => {
    console.error(`[jarvis] executeProvisioning(deploymentId=${id}, runId=${runId}) failed unexpectedly`, err);
  });
  return NextResponse.json({ provisionRunId: runId }, { status: 202 });
}
