import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathWithShim, writeKeyAuthShim } from '../src/lib/ssh-shim';

describe('writeKeyAuthShim', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const opts = {
    identityKeyPath: '/home/jarvis/.ssh/jarvis_ed25519',
    knownHostsPath: '/home/jarvis/.jarvis/known_hosts',
    port: 2222,
  };

  it('writes executable ssh and scp wrapper scripts', () => {
    dir = writeKeyAuthShim(opts).dir;
    expect(statSync(join(dir, 'ssh')).mode & 0o111).toBeTruthy();
    expect(statSync(join(dir, 'scp')).mode & 0o111).toBeTruthy();
  });

  it('forces batch-mode, TOFU-accept host key checking, and the given identity', () => {
    dir = writeKeyAuthShim(opts).dir;
    const ssh = readFileSync(join(dir, 'ssh'), 'utf8');
    expect(ssh).toContain('StrictHostKeyChecking=accept-new');
    expect(ssh).toContain('BatchMode=yes');
    expect(ssh).toContain(opts.knownHostsPath);
    expect(ssh).toContain(opts.identityKeyPath);
  });

  it('uses lowercase -p for ssh and uppercase -P for scp', () => {
    dir = writeKeyAuthShim(opts).dir;
    const ssh = readFileSync(join(dir, 'ssh'), 'utf8');
    const scp = readFileSync(join(dir, 'scp'), 'utf8');
    expect(ssh).toContain('-p 2222');
    expect(scp).toContain('-P 2222');
  });

  it('forwards all arguments to the real binary', () => {
    dir = writeKeyAuthShim(opts).dir;
    const ssh = readFileSync(join(dir, 'ssh'), 'utf8');
    expect(ssh.trim().endsWith('"$@"')).toBe(true);
  });

  it('resolves each shim to the real, non-shimmed binary path', () => {
    dir = writeKeyAuthShim(opts).dir;
    const ssh = readFileSync(join(dir, 'ssh'), 'utf8');
    expect(ssh).not.toContain(dir);
  });

  it('creates a fresh directory on each call', () => {
    const a = writeKeyAuthShim(opts);
    const b = writeKeyAuthShim(opts);
    dir = a.dir;
    expect(a.dir).not.toBe(b.dir);
    rmSync(b.dir, { recursive: true, force: true });
  });
});

describe('pathWithShim', () => {
  it('prepends the shim directory to the given PATH', () => {
    expect(pathWithShim('/shim', '/usr/bin:/bin')).toBe('/shim:/usr/bin:/bin');
  });
});
