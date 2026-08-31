import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/lib/crypto';

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();
const findFirst = vi.fn();
const groupBy = vi.fn();

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
    contentItem: {
      get groupBy() {
        return groupBy;
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
  groupBy.mockReset().mockResolvedValue([]);
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
    expect(rows).toEqual([
      { id: 'k1', label: 'watcher', createdAt: null, lastUsedAt: null, revokedAt: null, contentItemCount: 0 },
    ]);
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('keyHash');
  });

  it('merges each key with how many ContentItems it submitted', async () => {
    findMany.mockResolvedValue([
      { id: 'k1', label: 'cdn', createdAt: new Date(), lastUsedAt: null, revokedAt: null },
      { id: 'k2', label: 'cdn2', createdAt: new Date(), lastUsedAt: null, revokedAt: null },
    ]);
    groupBy.mockResolvedValue([
      { submittedByApiKeyId: 'k1', _count: { _all: 7 } },
      { submittedByApiKeyId: 'k2', _count: { _all: 0 } },
    ]);

    const rows = await listApiKeys();
    expect(rows.find((r) => r.id === 'k1')?.contentItemCount).toBe(7);
    expect(rows.find((r) => r.id === 'k2')?.contentItemCount).toBe(0);
  });

  it('defaults to zero for a key groupBy never returned a row for', async () => {
    findMany.mockResolvedValue([{ id: 'k1', label: 'cdn', createdAt: new Date(), lastUsedAt: null, revokedAt: null }]);
    groupBy.mockResolvedValue([]); // no ContentItem has ever been submitted by any key

    const rows = await listApiKeys();
    expect(rows[0].contentItemCount).toBe(0);
  });

  it('skips the groupBy call entirely when there are no keys', async () => {
    findMany.mockResolvedValue([]);
    expect(await listApiKeys()).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
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
