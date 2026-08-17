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
      await prisma.provisionRun.update({ where: { id: runId }, data: { logText } });
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
        data: { status: 'FAILED', logText, finishedAt: new Date() },
      });
      await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
      return;
    }

    const password = parseAdminPassword(logText);
    if (!password) {
      logText += '\n[jarvis] deploy.sh succeeded but the admin password could not be parsed from its output.';
      await prisma.provisionRun.update({
        where: { id: runId },
        data: { status: 'FAILED', logText, finishedAt: new Date() },
      });
      await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
      return;
    }

    const contentApiKey = await mintContentApiKey(deployment.baseUrl, deployment.adminEmail, password);
    await prisma.provisionRun.update({
      where: { id: runId },
      data: { status: 'SUCCESS', logText, finishedAt: new Date() },
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
      data: { status: 'FAILED', logText, finishedAt: new Date() },
    });
    await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'FAILED' } });
  }
}
