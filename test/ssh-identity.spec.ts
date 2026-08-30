import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSshIdentity } from '../src/lib/ssh-identity';

describe('resolveSshIdentity', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('generates a fresh ed25519 keypair when none exists at the given path', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ssh-identity-'));
    const keyPath = join(dir, 'nested', 'id');

    const identity = resolveSshIdentity(keyPath);

    expect(existsSync(keyPath)).toBe(true);
    expect(existsSync(`${keyPath}.pub`)).toBe(true);
    expect(identity.privateKeyPath).toBe(keyPath);
    expect(identity.publicKeyPath).toBe(`${keyPath}.pub`);
    expect(identity.publicKey).toMatch(/^ssh-ed25519 \S+ jarvis$/);
  });

  it('reuses an existing keypair rather than regenerating it', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ssh-identity-'));
    const keyPath = join(dir, 'id');

    const first = resolveSshIdentity(keyPath);
    const second = resolveSshIdentity(keyPath);

    expect(second.publicKey).toBe(first.publicKey);
  });
});
