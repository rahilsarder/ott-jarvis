import { describe, expect, it } from 'vitest';
import { buildDeployInvocation, parseAdminPassword } from '../src/lib/deploy-command';

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
