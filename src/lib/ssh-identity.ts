import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface SshIdentity {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
}

/**
 * Deliberately its own dedicated key rather than the process user's default
 * identity (~/.ssh/id_ed25519) — that file may already be a human operator's
 * personal login key to the Jarvis box itself, and auto-generating over it
 * (or reusing it for automated remote access) would conflate the two.
 */
export function defaultSshKeyPath(): string {
  return process.env.JARVIS_SSH_KEY_PATH || join(homedir(), '.ssh', 'jarvis_ed25519');
}

/**
 * Returns Jarvis's own SSH identity, generating a fresh ed25519 keypair the
 * first time this runs if none exists yet at the given path. Shells out to
 * ssh-keygen rather than hand-rolling the OpenSSH private/public key format.
 */
export function resolveSshIdentity(keyPath: string = defaultSshKeyPath()): SshIdentity {
  const publicKeyPath = `${keyPath}.pub`;
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'jarvis', '-f', keyPath], { stdio: 'pipe' });
  }
  return {
    privateKeyPath: keyPath,
    publicKeyPath,
    publicKey: readFileSync(publicKeyPath, 'utf8').trim(),
  };
}
