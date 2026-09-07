import { prisma } from './prisma';

export interface ContentStatus {
  total: number;
  success: number;
  pending: number;
  failed: number;
  /** ContentItems with no PushAttempt row for this deployment at all — see the module comment
   *  on syncMissingContent() for why this can happen and isn't just "pending". */
  missing: number;
}

/**
 * A ContentItem only ever gets a PushAttempt row for the deployments that were ACTIVE at the
 * exact moment it was submitted (POST /api/content and the watcher ingest route both do this
 * fan-out once, at creation time — see either route). A deployment that becomes ACTIVE later
 * (first activation, or re-activation after PAUSED/DECOMMISSIONED) never retroactively gets rows
 * for content submitted before that moment, so it silently drifts further behind every deployment
 * that was already active. This is the only place that gap is closed: find every ContentItem with
 * zero PushAttempt rows for a given deployment and create them PENDING, for the worker to pick up
 * on its next tick exactly like a fresh submission.
 */
export async function syncMissingContent(deploymentId: string): Promise<number> {
  const missing = await prisma.contentItem.findMany({
    where: { pushAttempts: { none: { deploymentId } } },
    select: { id: true },
  });
  if (missing.length === 0) return 0;

  await prisma.pushAttempt.createMany({
    data: missing.map((item) => ({ contentItemId: item.id, deploymentId })),
    // Defensive, not load-bearing: a concurrent sync (the auto-trigger firing while someone also
    // clicks the manual button) could otherwise violate the [contentItemId, deploymentId] unique
    // constraint on the second insert of the same row.
    skipDuplicates: true,
  });
  return missing.length;
}

/**
 * One grouped query for every deployment's push status, rather than looping per-deployment — the
 * deployments list page needs this for every row it renders. `total` is deployment-independent
 * (every ContentItem that exists, published or not) and `missing` is derived from it rather than
 * queried directly, since PushAttempt has exactly one row per (item, deployment) pair
 * (@@unique([contentItemId, deploymentId])): missing = total - (success + pending + failed).
 */
export async function getContentStatusSummary(deploymentIds: string[]): Promise<Map<string, ContentStatus>> {
  const result = new Map<string, ContentStatus>();
  if (deploymentIds.length === 0) return result;

  const total = await prisma.contentItem.count();
  const grouped = await prisma.pushAttempt.groupBy({
    by: ['deploymentId', 'status'],
    where: { deploymentId: { in: deploymentIds } },
    _count: { _all: true },
  });

  const counted = new Map<string, { success: number; pending: number; failed: number }>();
  for (const id of deploymentIds) counted.set(id, { success: 0, pending: 0, failed: 0 });
  for (const row of grouped) {
    const bucket = counted.get(row.deploymentId);
    if (!bucket) continue;
    if (row.status === 'SUCCESS') bucket.success = row._count._all;
    else if (row.status === 'PENDING') bucket.pending = row._count._all;
    else if (row.status === 'FAILED') bucket.failed = row._count._all;
  }

  for (const id of deploymentIds) {
    const { success, pending, failed } = counted.get(id)!;
    result.set(id, { total, success, pending, failed, missing: total - (success + pending + failed) });
  }
  return result;
}
