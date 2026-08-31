import { describe, expect, it } from 'vitest';
import { buildDeployInvocation, parseAdminPassword, parseDeployedCommit } from '../src/lib/deploy-command';

const deployment = {
  sshHost: '10.0.0.5',
  sshUser: 'root',
  baseUrl: 'http://10.0.0.5',
  brandName: 'Brand A',
  adminEmail: 'admin@branda.local',
  flussonicBaseUrl: 'http://cdn.branda.local:8082',
  flussonicSecurelinkKey: 'topsecret',
};

describe('buildDeployInvocation', () => {
  it('targets the ssh user@host, non-interactively', () => {
    const { command, args } = buildDeployInvocation(deployment);
    expect(command).toBe('ops/deploy.sh');
    expect(args).toEqual(['root@10.0.0.5', '--non-interactive']);
  });

  it('forces http protocol and never sets a certbot email', () => {
    const { env } = buildDeployInvocation(deployment);
    expect(env.DEPLOY_PROTOCOL).toBe('http');
    expect(env.DEPLOY_CERTBOT_EMAIL).toBeUndefined();
  });

  it('strips the scheme for DEPLOY_HOST_NAME', () => {
    const { env } = buildDeployInvocation(deployment);
    expect(env.DEPLOY_HOST_NAME).toBe('10.0.0.5');
  });

  it('maps the rest of the deployment fields', () => {
    const { env } = buildDeployInvocation(deployment);
    expect(env.DEPLOY_BRAND_NAME).toBe('Brand A');
    expect(env.DEPLOY_ADMIN_EMAIL).toBe('admin@branda.local');
    expect(env.DEPLOY_FLUSSONIC_BASE_URL).toBe('http://cdn.branda.local:8082');
    expect(env.DEPLOY_FLUSSONIC_SECURELINK_KEY).toBe('topsecret');
  });
});

describe('parseAdminPassword', () => {
  it('extracts the password from deploy.sh\'s summary line', () => {
    const log = [
      '==================================================================',
      ' Deploy complete: http://10.0.0.5',
      ' Admin login:    admin@branda.local',
      ' Admin password: aB3xY9qLmN2pQ7rT',
      ' DB password:    somethingelse',
    ].join('\n');
    expect(parseAdminPassword(log)).toBe('aB3xY9qLmN2pQ7rT');
  });

  it('returns null when the line is absent', () => {
    expect(parseAdminPassword('some unrelated output')).toBeNull();
  });
});

describe('parseDeployedCommit', () => {
  it('extracts the commit sha from deploy.sh\'s marker line', () => {
    const log = ['Cloning into \'.\'...', 'Deployed commit: 4f2a9c1b8e3d7a6f5c0b1e2d3a4f5c6b7d8e9f0a', 'pm2 reloaded'].join(
      '\n',
    );
    expect(parseDeployedCommit(log)).toBe('4f2a9c1b8e3d7a6f5c0b1e2d3a4f5c6b7d8e9f0a');
  });

  it('returns the last occurrence when the marker appears more than once', () => {
    const log = ['Deployed commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Deployed commit: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'].join(
      '\n',
    );
    expect(parseDeployedCommit(log)).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('returns null when the line is absent', () => {
    expect(parseDeployedCommit('some unrelated output')).toBeNull();
  });
});
