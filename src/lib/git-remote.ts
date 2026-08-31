import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Pure: pulls the `refs/heads/main` sha out of `git ls-remote` output. */
export function parseLsRemoteOutput(output: string): string | null {
  const line = output
    .split('\n')
    .find((l) => l.trim().endsWith('\trefs/heads/main') || l.trim().endsWith(' refs/heads/main'));
  if (!line) return null;
  const sha = line.trim().split(/\s+/)[0];
  return sha || null;
}

/**
 * The real current HEAD of the OTT repo's main branch, straight from GitHub —
 * deliberately not `git rev-parse origin/main` against the local OTT_REPO_PATH
 * checkout, whose own remote-tracking ref is only as fresh as its last fetch
 * and would silently under-report staleness otherwise.
 */
export async function getRemoteMainHead(ottRepoPath: string): Promise<string | null> {
  const { stdout: repoUrl } = await execFileAsync('git', ['-C', ottRepoPath, 'remote', 'get-url', 'origin']);
  const { stdout } = await execFileAsync('git', ['ls-remote', repoUrl.trim(), 'refs/heads/main']);
  return parseLsRemoteOutput(stdout);
}
