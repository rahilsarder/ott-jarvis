import { describe, expect, it } from 'vitest';
import { createDeploymentSchema } from '../src/lib/deployment-schema';

const valid = {
  name: 'brand-a',
  brandName: 'Brand A',
  baseUrl: 'http://10.0.0.5',
  sshHost: '10.0.0.5',
  sshUser: 'root',
  adminEmail: 'admin@branda.local',
  flussonicBaseUrl: 'http://cdn.branda.local:8082',
  flussonicSecurelinkKey: 'secret',
};

describe('createDeploymentSchema', () => {
  it('accepts a fully-specified deployment', () => {
    expect(createDeploymentSchema.parse(valid)).toMatchObject(valid);
  });

  it('defaults flussonicSecurelinkKey to empty string', () => {
    const { flussonicSecurelinkKey: _drop, ...rest } = valid;
    expect(createDeploymentSchema.parse(rest).flussonicSecurelinkKey).toBe('');
  });

  it('defaults sshPort to 22', () => {
    expect(createDeploymentSchema.parse(valid).sshPort).toBe(22);
  });

  it('coerces a form-submitted string sshPort to a number', () => {
    expect(createDeploymentSchema.parse({ ...valid, sshPort: '2222' }).sshPort).toBe(2222);
  });

  it('rejects an out-of-range sshPort', () => {
    expect(createDeploymentSchema.safeParse({ ...valid, sshPort: 70000 }).success).toBe(false);
    expect(createDeploymentSchema.safeParse({ ...valid, sshPort: 0 }).success).toBe(false);
  });

  it('rejects a missing name', () => {
    const { name: _drop, ...rest } = valid;
    expect(createDeploymentSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid baseUrl', () => {
    expect(createDeploymentSchema.safeParse({ ...valid, baseUrl: 'not-a-url' }).success).toBe(false);
  });

  it('rejects an invalid adminEmail', () => {
    expect(createDeploymentSchema.safeParse({ ...valid, adminEmail: 'not-an-email' }).success).toBe(false);
  });
});
