import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { prisma } from './prisma';
import { buildDeployInvocation, parseAdminPassword, parseDeployedCommit } from './deploy-command';
import { defaultKnownHostsPath, ensureKnownHostsDir, resolveSshIdentity } from './ssh-identity';
import { pathWithShim, writeKeyAuthShim } from './ssh-shim';
import { syncMissingContent } from './content-sync';

/**
 * Fires whenever a deployment transitions to ACTIVE (both call sites below): a deployment that
 * only just went live has never had a fan-out chance for any ContentItem submitted before this
 * moment (see the module comment on syncMissingContent), so without this every deployment starts
 * out missing its entire back catalog until someone notices and clicks "Sync missing content" by
 * hand. Best-effort and non-blocking on purpose — the deployment itself is already successfully
 * ACTIVE by the time this runs, and a sync hiccup (a transient DB error) must not undo that or
 * fail an otherwise-successful provision run; the manual sync button is the backstop.
 */
async function syncOnActivation(deploymentId: string): Promise<void> {
  try {
    await syncMissingContent(deploymentId);
  } catch (err) {
    console.error(`[jarvis] syncMissingContent(deploymentId=${deploymentId}) failed after activation`, err);
  }
}

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
  let shimDir: string | undefined;

  try {
    const deployment = await prisma.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    const { command, args, env } = buildDeployInvocation(deployment);
    const ottRepoPath = process.env.OTT_REPO_PATH;
    if (!ottRepoPath) throw new Error('OTT_REPO_PATH is not set');

    // deploy.sh calls bare ssh/scp at 10 call sites assuming the target
    // already trusts the invoking identity — including trusting its host
    // key, which a freshly registered box never does yet. Without this, the
    // very first deploy to any new server fails at the first ssh call with
    // "Host key verification failed." (deploy.sh has no terminal to answer
    // the interactive prompt). Every deploy, not only password-bootstrapped
    // ones, goes through this shim.
    const identity = resolveSshIdentity();
    const knownHostsPath = ensureKnownHostsDir(defaultKnownHostsPath());
    shimDir = writeKeyAuthShim({
      identityKeyPath: identity.privateKeyPath,
      knownHostsPath,
      port: deployment.sshPort,
    }).dir;

    const flush = async () => {
      if (logText === lastFlushed) return;
      lastFlushed = logText;
      await prisma.provisionRun.update({ where: { id: runId }, data: { logText: redactSecrets(logText) } });
    };
    flushInterval = setInterval(() => void flush(), 1000);

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(command, args, {
        cwd: ottRepoPath,
        env: { ...process.env, ...env, PATH: pathWithShim(shimDir!) },
      });
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
          data: { status: 'ACTIVE', lastProvisionedAt: new Date(), deployedCommit: parseDeployedCommit(logText) },
        });
        await syncOnActivation(deploymentId);
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
          `(ssh ${deployment.sshUser}@${deployment.sshHost}) and read the admin password deploy.sh wrote ` +
          `into the target's own .env when it originally set this box up: ` +
          `grep SEED_ADMIN_PASSWORD /srv/ott/.env. Then mint a key against the target yourself:` +
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
          `state on its own: deploy.sh generates a fresh random DB password into the new .env while only ` +
          `creating the "ott" Postgres role if it is missing, so on a box that already has that role, the ` +
          `run fails at "prisma migrate deploy" (wrong password for the existing role) before it ever gets ` +
          `to seeding an admin or printing a summary — deploy.sh aborts outright, it does not silently produce ` +
          `a broken deploy. Even past that, the OTT seed upserts an existing admin with update:{role:'ADMIN'} ` +
          `only, so a freshly printed admin password still would not apply to the already-existing ` +
          `${deployment.adminEmail} user. Taking this route means first running ALTER USER ott WITH PASSWORD ` +
          `to match whatever new .env would contain, and separately resetting that admin user's password hash ` +
          `— or wiping the box and starting from a genuinely clean target.`;
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
      data: {
        status: 'ACTIVE',
        contentApiKey,
        lastProvisionedAt: new Date(),
        deployedCommit: parseDeployedCommit(logText),
      },
    });
    await syncOnActivation(deploymentId);
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
  } finally {
    if (shimDir) rmSync(shimDir, { recursive: true, force: true });
  }
}
