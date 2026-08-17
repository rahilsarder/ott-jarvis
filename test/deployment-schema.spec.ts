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
