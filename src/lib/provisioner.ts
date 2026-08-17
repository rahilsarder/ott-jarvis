import { spawn } from 'node:child_process';
import { prisma } from './prisma';
import { buildDeployInvocation, parseAdminPassword } from './deploy-command';

async function mintContentApiKey(baseUrl: string, adminEmail: string, adminPassword: string): Promise<string> {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (!loginRes.ok) throw new Error(`Login to ${baseUrl} failed: ${loginRes.status}`);
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const keyRes = await fetch(`${baseUrl}/api/admin/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ label: 'jarvis' }),
  });
  if (!keyRes.ok) throw new Error(`Creating api key on ${baseUrl} failed: ${keyRes.status}`);
  const { key } = (await keyRes.json()) as { key: string };
  return key;
}

/**
 * deploy.sh's first-time-setup summary prints the target's freshly-seeded admin password and its
 * Postgres password in the clear. That output is captured verbatim into ProvisionRun.logText, which
 * is persisted in Jarvis's own database indefinitely and served back to the browser by the
 * provision-run polling endpoint. The admin password is meant to be used once (to mint the content
 * API key) and never stored; the DB password is not a credential Jarvis has any use for at all.
 * Every write of logText to the database goes through this; the in-memory copy stays intact so
 * parseAdminPassword() can still read the real value.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/(Admin password:\s+)\S+/g, '$1[redacted]')
    .replace(/(DB password:\s+)\S+/g, '$1[redacted]');
}

/** Creates the ProvisionRun row and flips the deployment to PROVISIONING; returns the run id. */
export async function startProvisioning(deploymentId: string): Promise<string> {
  const run = await prisma.provisionRun.create({ data: { deploymentId, status: 'RUNNING' } });
  await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'PROVISIONING' } });
  return run.id;
}

/**
 * Runs deploy.sh and drives the run to completion. Not awaited by the caller — fires in the background.
 *
 * The entire body runs inside a single top-level try/catch. `startProvisioning` has already committed
 * ProvisionRun.status = RUNNING and Deployment.status = PROVISIONING before this function is even called,
 * so any unhandled throw here (e.g. a transient DB error on the initial lookup, or a missing
 * OTT_REPO_PATH) would otherwise leave both rows stuck forever with no UI-driven recovery path — the
 * deploy route only allows re-provisioning from REGISTERED/FAILED. The catch block marks both rows
 * FAILED so the operator always gets a terminal, actionable state.
 */
export async function executeProvisioning(deploymentId: string, runId: string): Promise<void> {
  let logText = '';
  let lastFlushed = '';
  let flushInterval: ReturnType<typeof setInterval> | undefined;

  try {
    const deployment = await prisma.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    const { command, args, env } = buildDeployInvocation(deployment);
    const ottRepoPath = process.env.OTT_REPO_PATH;
    if (!ottRepoPath) throw new Error('OTT_REPO_PATH is not set');

    const flush = async () => {
      if (logText === lastFlushed) return;
      lastFlushed = logText;
      await prisma.provisionRun.update({ where: { id: runId }, data: { logText: redactSecrets(logText) } });
    };
    flushInterval = setInterval(() => void flush(), 1000);

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(command, args, { cwd: ottRepoPath, env: { ...process.env, ...env } });
      child.stdout.on('data', (chunk: Buffer) => (logText += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (logText += chunk.toString()));
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', (err) => {
        logText += `\n[jarvis] failed to spawn deploy.sh: ${err.message}`;
        resolve(1);
      });
    });

    clearInterval(flushInterval);
    flushInterval = undefined;

    if (exitCode !== 0) {
      await prisma.provisionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logText: redactSecrets(logText), finishedAt: new Date() },
      });
      await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
      return;
    }

    const password = parseAdminPassword(logText);
    if (!password) {
      // deploy.sh has two success paths. First-time setup ends with a summary block containing
      // "Admin password: ...". Every subsequent run against the same target short-circuits into its
      // update path (it detects an existing /srv/ott/.env), which only pulls/builds/migrates/reloads
      // and exits 0 after printing "==> Update complete: $TARGET" — no admin password, because none
      // was seeded. An unparseable password therefore means one of two very different things.
      const tookUpdatePath = logText.includes('Update complete:');

      if (tookUpdatePath && deployment.contentApiKey) {
        // This deployment was fully provisioned by Jarvis before, so the stored key is still valid —
        // deploy.sh's update path never touches the target's API keys. This covers both re-deploying
        // to pick up new OTT platform code and the design's stated recovery path: any failure after
        // deploy.sh writes /srv/ott/.env (nginx reload, pm2 start, or Jarvis's own mintContentApiKey
        // call) leaves the target in "already deployed" state, so every retry lands here. Treat it as
        // the success it is, reusing the existing key rather than minting a second one.
        logText +=
          '\n[jarvis] deploy.sh took its update path (an existing /srv/ott/.env was found on the target), ' +
          'so it printed no fresh admin password. This deployment already has a content API key stored from ' +
          'an earlier successful provision, and the update path does not invalidate it, so the existing key ' +
          'is being reused and this run is recorded as a success.';
        await prisma.provisionRun.update({
          where: { id: runId },
          data: { status: 'SUCCESS', logText: redactSecrets(logText), finishedAt: new Date() },
        });
        await prisma.deployment.update({
          where: { id: deploymentId },
          data: { status: 'ACTIVE', lastProvisionedAt: new Date() },
        });
        return;
      }

      if (tookUpdatePath) {
        // Update path, but Jarvis has never completed provisioning for this deployment, so there is no
        // stored key and no admin password to mint one with. Jarvis cannot fix this by itself today.
        logText +=
          `\n[jarvis] deploy.sh exited 0 via its UPDATE path: it found an existing /srv/ott/.env on the ` +
          `target, so it only pulled, rebuilt, migrated and reloaded. It did not seed an admin account and ` +
          `did not print an "Admin password:" line.` +
          `\n[jarvis] This deployment has no contentApiKey stored from a previous successful provision, so ` +
          `Jarvis has no credential for the target's admin API and no password with which to mint one. ` +
          `Clicking Deploy again will land here every time — the target will keep taking the update path. ` +
          `This deployment cannot be recovered through Jarvis today; it needs manual intervention:` +
          `\n[jarvis]   Option A (recommended — adopt the existing box). SSH in ` +
          `(ssh ${deployment.sshUser}@${deployment.sshHost}) and recover the admin credentials for ` +
          `${deployment.adminEmail} on that target. Then mint a key against the target yourself:` +
          `\n[jarvis]     curl -sX POST ${deployment.baseUrl}/api/auth/login -H 'Content-Type: application/json' ` +
          `-d '{"email":"${deployment.adminEmail}","password":"<admin-password>"}'` +
          `\n[jarvis]     curl -sX POST ${deployment.baseUrl}/api/admin/api-keys -H 'Content-Type: application/json' ` +
          `-H 'Authorization: Bearer <accessToken from the previous response>' -d '{"label":"jarvis"}'` +
          `\n[jarvis]   ...then write the returned key into Jarvis's own database and mark the row active:` +
          `\n[jarvis]     UPDATE "Deployment" SET "contentApiKey" = '<key>', "status" = 'ACTIVE', ` +
          `"lastProvisionedAt" = now() WHERE "id" = '${deploymentId}';` +
          `\n[jarvis]   Option B (start the target over — destructive, and NOT a one-liner). Removing ` +
          `/srv/ott/.env on the target makes the next Deploy click take deploy.sh's first-time-setup path ` +
          `again, but on a box that has already been set up once that path does not restore a known-good ` +
          `state on its own: the OTT seed upserts the admin with update:{role:'ADMIN'}, so the freshly ` +
          `printed admin password is NOT applied to the already-existing ${deployment.adminEmail} user (Jarvis ` +
          `would parse it and then fail to log in), and deploy.sh generates a new DB password into .env while ` +
          `only creating the "ott" Postgres role if it is missing, so the app would be left with credentials ` +
          `that do not match the existing role. Taking this route means also resetting that user's password ` +
          `hash and ALTER USER ott WITH PASSWORD to match the new .env — or wiping the box and starting from ` +
          `a genuinely clean target.`;
        await prisma.provisionRun.update({
          where: { id: runId },
          data: { status: 'FAILED', logText: redactSecrets(logText), finishedAt: new Date() },
        });
        await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
        return;
      }

      // First-time-setup path that somehow produced no parseable password — a genuinely different
      // (and genuinely unexpected) failure mode; unchanged behavior.
      logText += '\n[jarvis] deploy.sh succeeded but the admin password could not be parsed from its output.';
      await prisma.provisionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logText: redactSecrets(logText), finishedAt: new Date() },
      });
      await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
      return;
    }

    const contentApiKey = await mintContentApiKey(deployment.baseUrl, deployment.adminEmail, password);
    await prisma.provisionRun.update({
      where: { id: runId },
      data: { status: 'SUCCESS', logText: redactSecrets(logText), finishedAt: new Date() },
    });
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'ACTIVE', contentApiKey, lastProvisionedAt: new Date() },
    });
  } catch (err) {
    // Belt-and-suspenders: whatever stage threw (initial lookup, missing OTT_REPO_PATH, spawn setup,
    // the terminal DB writes above, or minting), make sure the run and deployment both land in a
    // terminal FAILED state rather than staying RUNNING/PROVISIONING forever.
    if (flushInterval) clearInterval(flushInterval);
    logText += `\n[jarvis] ${err instanceof Error ? err.message : String(err)}`;
    await prisma.provisionRun.update({
      where: { id: runId },
      data: { status: 'FAILED', logText: redactSecrets(logText), finishedAt: new Date() },
    });
    await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
  }
}
