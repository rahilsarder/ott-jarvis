import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { getRemoteMainHead } from '@/lib/git-remote';

// The OTT repo's real current main HEAD, straight from GitHub — not the local
// OTT_REPO_PATH checkout's own remote-tracking ref, which is only as fresh as
// its last fetch. Lets the deployments UI show which rows are running stale
// code without deploy.sh needing to run at all.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ottRepoPath = process.env.OTT_REPO_PATH;
  if (!ottRepoPath) return NextResponse.json({ error: 'OTT_REPO_PATH is not set' }, { status: 500 });

  try {
    const sha = await getRemoteMainHead(ottRepoPath);
    return NextResponse.json({ sha });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
