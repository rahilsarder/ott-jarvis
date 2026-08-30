import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SshIdentity } from './ssh-identity';

function resolveRealBinary(name: 'ssh' | 'scp'): string {
  return execFileSync('which', [name]).toString().trim();
}

export interface KeyAuthShimOptions {
  identityKeyPath: string;
  knownHostsPath: string;
  port: number;
  connectTimeoutSec?: number;
}

/**
 * `ops/deploy.sh` in the OTT repo calls bare `ssh`/`scp` directly at 10 call
 * sites, with no port or identity flags of its own — it assumes the target
 * is already reachable via the invoking user's default, pre-authorized SSH
 * setup. Rather than editing deploy.sh (a script this repo doesn't own) to
 * add flags at every call site, this writes throwaway wrapper scripts that
 * inject them and puts their directory first on PATH for the one child
 * process deploy.sh is spawned in.
 *
 * `StrictHostKeyChecking=accept-new` + a Jarvis-owned UserKnownHostsFile
 * (never the operator's own ~/.ssh/known_hosts) auto-accepts a target's
 * host key on first contact — trust-on-first-use, same as a human
 * operator's first interactive `ssh` to a new box, just without the prompt
 * deploy.sh has no terminal to answer. BatchMode=yes forbids falling back to
 * a password prompt: this shim is for key-only auth, so a failure here is
 * meant to fail fast, not hang.
 */
export function writeKeyAuthShim(opts: KeyAuthShimOptions): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-sshshim-'));
  const timeout = opts.connectTimeoutSec ?? 10;
  const commonOpts = [
    '-o StrictHostKeyChecking=accept-new',
    `-o UserKnownHostsFile="${opts.knownHostsPath}"`,
    '-o BatchMode=yes',
    `-o ConnectTimeout=${timeout}`,
    `-i "${opts.identityKeyPath}"`,
  ].join(' ');

  writeShimScript(join(dir, 'ssh'), resolveRealBinary('ssh'), `${commonOpts} -p ${opts.port}`);
  writeShimScript(join(dir, 'scp'), resolveRealBinary('scp'), `${commonOpts} -P ${opts.port}`);

  return { dir };
}

function writeShimScript(path: string, realBinary: string, fixedArgs: string): void {
  writeFileSync(path, `#!/bin/sh\nexec "${realBinary}" ${fixedArgs} "$@"\n`, { mode: 0o755 });
}

export function pathWithShim(dir: string, existingPath: string = process.env.PATH ?? ''): string {
  return `${dir}:${existingPath}`;
}

/**
 * A trivial `ssh user@host true` through the shim above — used both to
 * confirm a bootstrap succeeded and as the standalone "Test connection"
 * action, so a bad credential or unreachable box fails in seconds instead
 * of minutes into a real provisioning run.
 */
export async function testKeyAuthConnection(opts: {
  identity: SshIdentity;
  knownHostsPath: string;
  sshUser: string;
  sshHost: string;
  sshPort: number;
}): Promise<{ ok: boolean; output: string }> {
  const { dir } = writeKeyAuthShim({
    identityKeyPath: opts.identity.privateKeyPath,
    knownHostsPath: opts.knownHostsPath,
    port: opts.sshPort,
  });

  return new Promise((resolve) => {
    let output = '';
    const child = spawn('ssh', [`${opts.sshUser}@${opts.sshHost}`, 'true'], {
      env: { ...process.env, PATH: pathWithShim(dir) },
    });
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
    child.on('error', (err) => resolve({ ok: false, output: `${output}\n${err.message}` }));
  });
}
