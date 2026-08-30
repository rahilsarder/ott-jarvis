import { describe, expect, it } from 'vitest';
import { buildAuthorizedKeysAppendCommand, buildBootstrapArgs } from '../src/lib/ssh-bootstrap';

describe('buildAuthorizedKeysAppendCommand', () => {
  it('idempotently appends the key, creating ~/.ssh with the right permissions first', () => {
    const cmd = buildAuthorizedKeysAppendCommand('ssh-ed25519 AAAAC3 jarvis');
    expect(cmd).toContain('mkdir -p ~/.ssh');
    expect(cmd).toContain('chmod 700 ~/.ssh');
    expect(cmd).toContain('chmod 600 ~/.ssh/authorized_keys');
    expect(cmd).toContain("grep -qxF 'ssh-ed25519 AAAAC3 jarvis' ~/.ssh/authorized_keys");
    expect(cmd).toContain("echo 'ssh-ed25519 AAAAC3 jarvis' >> ~/.ssh/authorized_keys");
  });

  it('safely escapes a public key containing a single quote', () => {
    const cmd = buildAuthorizedKeysAppendCommand("ssh-ed25519 AAAA jarvis's-key");
    // The whole command must remain one shell-safe string: no unescaped quote
    // can be allowed to break out of the quoted key and inject a new command.
    expect(cmd).toContain("jarvis'\\''s-key");
  });
});

describe('buildBootstrapArgs', () => {
  const opts = {
    sshUser: 'root',
    sshHost: '10.0.0.9',
    sshPort: 2222,
    knownHostsPath: '/home/jarvis/.jarvis/known_hosts',
    publicKey: 'ssh-ed25519 AAAAC3 jarvis',
  };

  it('forces password auth and refuses to silently fall back to a pre-existing key', () => {
    const args = buildBootstrapArgs(opts);
    expect(args).toContain('-o');
    expect(args).toContain('PreferredAuthentications=password');
    expect(args).toContain('PubkeyAuthentication=no');
  });

  it('TOFU-accepts the host key into the given known_hosts file, not the operator\'s own', () => {
    const args = buildBootstrapArgs(opts);
    expect(args.join(' ')).toContain('StrictHostKeyChecking=accept-new');
    expect(args.join(' ')).toContain(opts.knownHostsPath);
  });

  it('targets the given port and user@host, with the append command last', () => {
    const args = buildBootstrapArgs(opts);
    expect(args).toContain('-p');
    expect(args).toContain('2222');
    expect(args).toContain('root@10.0.0.9');
    expect(args[args.length - 1]).toContain('authorized_keys');
  });
});
