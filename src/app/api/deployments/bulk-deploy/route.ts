import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { getRemoteMainHead } from '@/lib/git-remote';
import { executeProvisioning, startProvisioning } from '@/lib/provisioner';

/**
 * Runs Deploy across every stale ACTIVE deployment, one at a time — each is
 * a real pnpm install/build on Jarvis's own box, so this deliberately does
 * not parallelize them. Only flips a deployment to PROVISIONING right before
 * its own turn starts, not all at once, so the deployments list accurately
 * reflects that just one is actually running at any moment.
 */
async function runSequentially(ids: string[]): Promise<void> {
  for (const id of ids) {
    const runId = await startProvisioning(id);
    await executeProvisioning(id, runId).catch((err) => {
      console.error(`[jarvis] bulk deploy: executeProvisioning(deploymentId=${id}, runId=${runId}) failed unexpectedly`, err);
    });
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ottRepoPath = process.env.OTT_REPO_PATH;
  if (!ottRepoPath) return NextResponse.json({ error: 'OTT_REPO_PATH is not set' }, { status: 500 });

  const mainHead = await getRemoteMainHead(ottRepoPath).catch(() => null);
  if (!mainHead) return NextResponse.json({ error: 'Could not resolve origin/main HEAD' }, { status: 502 });

  const active = await prisma.deployment.findMany({ where: { status: 'ACTIVE' } });
  const stale = active.filter((d) => d.deployedCommit !== mainHead).map((d) => d.id);

  if (stale.length === 0) return NextResponse.json({ triggered: [] }, { status: 200 });

  // Same fire-and-forget pattern as the single-deploy route: the response
  // doesn't wait for the (potentially many-minutes-long) run to finish.
  void runSequentially(stale).catch((err) => {
    console.error('[jarvis] bulk deploy: runSequentially failed unexpectedly', err);
  });

  return NextResponse.json({ triggered: stale }, { status: 202 });
}
