import { spawn } from 'node:child_process';
import type { SshIdentity } from './ssh-identity';

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Idempotent: safe to run against a box that already has this key installed
 * (e.g. a retried bootstrap after a network blip), since grep guards the
 * append. Creates ~/.ssh with the permissions sshd requires before touching
 * authorized_keys, in case this is genuinely the first key ever added.
 */
export function buildAuthorizedKeysAppendCommand(publicKey: string): string {
  const quoted = shellSingleQuote(publicKey);
  return [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    `grep -qxF ${quoted} ~/.ssh/authorized_keys || echo ${quoted} >> ~/.ssh/authorized_keys`,
  ].join(' && ');
}

export interface BootstrapArgsOptions {
  sshUser: string;
  sshHost: string;
  sshPort: number;
  knownHostsPath: string;
  publicKey: string;
  connectTimeoutSec?: number;
}

/**
 * Args for a single one-shot `ssh` call, authenticating with the password
 * supplied via the SSHPASS env var (see runSshPasswordBootstrap) rather than
 * whatever identity might already be offered by an agent — PreferredAuthentications
 * plus PubkeyAuthentication=no makes this deterministic: it either proves the
 * given password, or fails, never silently succeeds via an unrelated key.
 */
export function buildBootstrapArgs(opts: BootstrapArgsOptions): string[] {
  const timeout = opts.connectTimeoutSec ?? 10;
  return [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `UserKnownHostsFile=${opts.knownHostsPath}`,
    '-o',
    'PreferredAuthentications=password',
    '-o',
    'PubkeyAuthentication=no',
    '-o',
    `ConnectTimeout=${timeout}`,
    '-p',
    String(opts.sshPort),
    `${opts.sshUser}@${opts.sshHost}`,
    buildAuthorizedKeysAppendCommand(opts.publicKey),
  ];
}

/**
 * One-shot: proves the password by using it to install Jarvis's own public
 * key, then the password is discarded (never written to disk — it only ever
 * lives in this function's argument and the child process's env for the
 * single `ssh` call below). Every deploy from here on, including this
 * bootstrap's own verification step, goes through key auth instead.
 */
export async function runSshPasswordBootstrap(opts: {
  sshUser: string;
  sshHost: string;
  sshPort: number;
  password: string;
  identity: SshIdentity;
  knownHostsPath: string;
}): Promise<{ ok: boolean; output: string }> {
  const args = buildBootstrapArgs({
    sshUser: opts.sshUser,
    sshHost: opts.sshHost,
    sshPort: opts.sshPort,
    knownHostsPath: opts.knownHostsPath,
    publicKey: opts.identity.publicKey,
  });

  return new Promise((resolve) => {
    let output = '';
    // -e reads the password from SSHPASS rather than -p <password>, so it
    // never appears in this process's argv (and therefore never in `ps`).
    const child = spawn('sshpass', ['-e', 'ssh', ...args], {
      env: { ...process.env, SSHPASS: opts.password },
    });
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
    child.on('error', (err) => {
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'sshpass is not installed on this Jarvis host. Install it (e.g. `apt install sshpass`) and try again.'
          : err.message;
      resolve({ ok: false, output: `${output}\n${message}` });
    });
  });
}
