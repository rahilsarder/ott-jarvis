import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const createMany = vi.fn();
const count = vi.fn();
const groupBy = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    contentItem: {
      get findMany() {
        return findMany;
      },
      get count() {
        return count;
      },
    },
    pushAttempt: {
      get createMany() {
        return createMany;
      },
      get groupBy() {
        return groupBy;
      },
    },
  },
}));

const { syncMissingContent, getContentStatusSummary } = await import('../src/lib/content-sync');

beforeEach(() => {
  findMany.mockReset();
  createMany.mockReset();
  count.mockReset();
  groupBy.mockReset();
});

describe('syncMissingContent', () => {
  it('creates a PENDING PushAttempt for every ContentItem missing one for this deployment', async () => {
    findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    const created = await syncMissingContent('dep1');

    expect(findMany).toHaveBeenCalledWith({
      where: { pushAttempts: { none: { deploymentId: 'dep1' } } },
      select: { id: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { contentItemId: 'c1', deploymentId: 'dep1' },
        { contentItemId: 'c2', deploymentId: 'dep1' },
      ],
      skipDuplicates: true,
    });
    expect(created).toBe(2);
  });

  it('does nothing and skips the createMany call when nothing is missing', async () => {
    findMany.mockResolvedValue([]);
    const created = await syncMissingContent('dep1');
    expect(created).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('getContentStatusSummary', () => {
  it('returns an empty map without any query when given no deployment ids', async () => {
    const result = await getContentStatusSummary([]);
    expect(result.size).toBe(0);
    expect(count).not.toHaveBeenCalled();
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('derives missing from total minus success/pending/failed', async () => {
    count.mockResolvedValue(10);
    groupBy.mockResolvedValue([
      { deploymentId: 'dep1', status: 'SUCCESS', _count: { _all: 6 } },
      { deploymentId: 'dep1', status: 'FAILED', _count: { _all: 1 } },
    ]);

    const result = await getContentStatusSummary(['dep1']);

    expect(result.get('dep1')).toEqual({ total: 10, success: 6, pending: 0, failed: 1, missing: 3 });
  });

  it('defaults every status to zero, and missing to the full total, for a deployment groupBy never returned a row for', async () => {
    count.mockResolvedValue(5);
    groupBy.mockResolvedValue([]);

    const result = await getContentStatusSummary(['dep1', 'dep2']);

    expect(result.get('dep1')).toEqual({ total: 5, success: 0, pending: 0, failed: 0, missing: 5 });
    expect(result.get('dep2')).toEqual({ total: 5, success: 0, pending: 0, failed: 0, missing: 5 });
  });

  it('ignores a groupBy row for a deployment id that was not asked for', async () => {
    count.mockResolvedValue(3);
    groupBy.mockResolvedValue([{ deploymentId: 'unrelated', status: 'SUCCESS', _count: { _all: 3 } }]);

    const result = await getContentStatusSummary(['dep1']);

    expect(result.get('dep1')).toEqual({ total: 3, success: 0, pending: 0, failed: 0, missing: 3 });
    expect(result.has('unrelated')).toBe(false);
  });
});
