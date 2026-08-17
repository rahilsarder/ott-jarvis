import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/lib/crypto';

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();
const findFirst = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    jarvisApiKey: {
      get findMany() {
        return findMany;
      },
      get create() {
        return create;
      },
      get update() {
        return update;
      },
      get findFirst() {
        return findFirst;
      },
    },
  },
}));

const { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } = await import('../src/lib/api-key.service');

beforeEach(() => {
  findMany.mockReset();
  create.mockReset();
  update.mockReset();
  findFirst.mockReset();
});

describe('createApiKey', () => {
  it('returns the raw key once and never persists it', async () => {
    create.mockImplementation(({ data }: { data: { label: string; keyHash: string } }) =>
      Promise.resolve({ id: 'k1', label: data.label, keyHash: data.keyHash }),
    );
    const result = await createApiKey('watcher');
    expect(result.label).toBe('watcher');
    expect(result.key).toHaveLength(43); // 32 random bytes, base64url
    expect(create).toHaveBeenCalledWith({ data: { label: 'watcher', keyHash: hashOpaqueToken(result.key) } });
  });
});

describe('listApiKeys', () => {
  it('never exposes keyHash', async () => {
    findMany.mockImplementation(({ select }: { select: Record<string, boolean> }) =>
      Promise.resolve([
        Object.fromEntries(
          Object.keys(select).map((k) => [k, k === 'id' ? 'k1' : k === 'label' ? 'watcher' : null]),
        ),
      ]),
    );
    const rows = await listApiKeys();
    expect(rows).toEqual([{ id: 'k1', label: 'watcher', createdAt: null, lastUsedAt: null, revokedAt: null }]);
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('keyHash');
  });
});

describe('revokeApiKey', () => {
  it('sets revokedAt', async () => {
    await revokeApiKey('k1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { revokedAt: expect.any(Date) } });
  });
});

describe('verifyApiKey', () => {
  it('returns the id for a valid, unrevoked key', async () => {
    findFirst.mockResolvedValue({ id: 'k1' });
    const result = await verifyApiKey('rawkey');
    expect(result).toEqual({ id: 'k1' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { keyHash: hashOpaqueToken('rawkey'), revokedAt: null },
      select: { id: true },
    });
  });

  it('returns null when no match', async () => {
    findFirst.mockResolvedValue(null);
    expect(await verifyApiKey('bad')).toBeNull();
  });

  it('touches lastUsedAt on a valid key', async () => {
    findFirst.mockResolvedValue({ id: 'k1' });
    await verifyApiKey('rawkey');
    expect(update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { lastUsedAt: expect.any(Date) } });
  });
});
