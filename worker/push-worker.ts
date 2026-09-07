import { prisma } from '../src/lib/prisma';
import { createGenreCache, GenreCache, pushEpisode, pushMovie, PushError } from '../src/lib/deployment-client';
import { MAX_RETRIES, nextRetryDelayMs } from '../src/lib/retry';

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 20;
/** A 429's own Retry-After is honored as-is above this, but never below it — protects against a
 * degenerate `Retry-After: 0` (or a buggy target) causing a tight retry loop. */
const MIN_RATE_LIMIT_RETRY_MS = 5000;
/** See reconcileStaleProvisionRuns() for why this is 2 minutes. */
const STALE_PROVISION_RUN_MS = 2 * 60 * 1000;

async function tick(): Promise<void> {
  // The deployment eligibility filter lives in the query, not in the loop: a `continue` on an
  // ineligible row leaves it PENDING and first in line forever, so once BATCH_SIZE permanently
  // ineligible rows accumulate (a deployment paused or decommissioned with a content backlog, or
  // "Retry failed" resetting attempts whose deployment is no longer active) every batch is poison
  // and nothing else is ever pushed again, silently. orderBy makes the batch deterministic —
  // oldest-first — rather than whatever order the planner happens to return when `take` caps a
  // large PENDING set.
  const due = await prisma.pushAttempt.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      deployment: { status: 'ACTIVE', contentApiKey: { not: null } },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
    include: { contentItem: true, deployment: true },
  });

  // Scoped to one tick's batch, keyed by deployment: several items pushed to the same box in the
  // same batch share one genre-list fetch instead of repeating it per title.
  const genreCaches = new Map<string, GenreCache>();

  for (const attempt of due) {
    // Non-null by construction — the query filters on contentApiKey: { not: null }, which Prisma's
    // generated row type has no way to narrow through.
    const target = { baseUrl: attempt.deployment.baseUrl, contentApiKey: attempt.deployment.contentApiKey! };
    try {
      let genreCache = genreCaches.get(attempt.deploymentId);
      if (!genreCache) {
        genreCache = createGenreCache();
        genreCaches.set(attempt.deploymentId, genreCache);
      }
      if (attempt.contentItem.kind === 'MOVIE') {
        await pushMovie(
          target,
          {
            name: attempt.contentItem.name,
            year: attempt.contentItem.year,
            streamPath: attempt.contentItem.streamPath,
            synopsis: attempt.contentItem.synopsis ?? undefined,
            posterUrl: attempt.contentItem.posterUrl,
            backdropUrl: attempt.contentItem.backdropUrl,
            logoUrl: attempt.contentItem.logoUrl,
            trailerYoutubeId: attempt.contentItem.trailerYoutubeId,
            rating: attempt.contentItem.rating,
            durationSec: attempt.contentItem.durationSec,
            genreNames: attempt.contentItem.genreNames,
            isPublished: attempt.contentItem.isPublished,
          },
          genreCache,
        );
      } else {
        await pushEpisode(
          target,
          {
            name: attempt.contentItem.name,
            year: attempt.contentItem.year,
            streamPath: attempt.contentItem.streamPath,
            seasonNumber: attempt.contentItem.seasonNumber!,
            episodeNumber: attempt.contentItem.episodeNumber!,
            synopsis: attempt.contentItem.synopsis ?? undefined,
            posterUrl: attempt.contentItem.posterUrl,
            backdropUrl: attempt.contentItem.backdropUrl,
            logoUrl: attempt.contentItem.logoUrl,
            trailerYoutubeId: attempt.contentItem.trailerYoutubeId,
            rating: attempt.contentItem.rating,
            creditsLeadSec: attempt.contentItem.creditsLeadSec,
            genreNames: attempt.contentItem.genreNames,
            isPublished: attempt.contentItem.isPublished,
          },
          genreCache,
        );
      }
      await prisma.pushAttempt.update({
        where: { id: attempt.id },
        data: { status: 'SUCCESS', httpStatus: 200, attemptedAt: new Date(), errorMessage: null },
      });
      await prisma.deployment.update({ where: { id: attempt.deploymentId }, data: { lastPushAt: new Date() } });
    } catch (err) {
      const retryCount = attempt.retryCount + 1;
      const failed = retryCount > MAX_RETRIES;
      // A 429 means "you personally are going too fast right now" — a data/logic problem it is not,
      // so it gets the server's own requested wait instead of being lumped in with a genuine failure
      // and given the same fixed backoff tier a broken push would get.
      const rateLimitedMs =
        err instanceof PushError && err.status === 429 && err.retryAfterMs !== undefined
          ? Math.max(err.retryAfterMs, MIN_RATE_LIMIT_RETRY_MS)
          : undefined;
      await prisma.pushAttempt.update({
        where: { id: attempt.id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          retryCount,
          httpStatus: err instanceof PushError ? err.status : null,
          errorMessage: err instanceof Error ? err.message : String(err),
          attemptedAt: new Date(),
          // nextRetryDelayMs's tiers are 0-indexed (tier 0 = 30s), so the delay is computed from the
          // pre-increment attempt number: the first failure (retryCount 0) waits 30s, the second 120s,
          // the third 600s. `retryCount` above is the post-increment running total that gets stored;
          // passing that in here skipped the 30s tier entirely on every first retry.
          nextRetryAt: failed ? null : new Date(Date.now() + (rateLimitedMs ?? nextRetryDelayMs(attempt.retryCount))),
        },
      });
    }
  }
}

/**
 * executeProvisioning runs fire-and-forget inside the *web* process. If that process restarts mid-run
 * (deploy, crash, `pm2 reload`) — realistic, since deploy.sh takes minutes — nothing is left to finish
 * the run: the ProvisionRun stays RUNNING and its Deployment stays PROVISIONING forever, and because
 * the deploy route only re-provisions from REGISTERED/FAILED, the UI's Deploy button never comes back
 * for that row. This sweep runs once at worker startup and lands those orphans in FAILED, which is the
 * state the design already treats as "safe to click Deploy again".
 *
 * The threshold matters because the worker and the web process restart independently: `pm2 reload all`
 * bounces the worker too, and a genuinely healthy run driven by an untouched web process must not be
 * killed just because the worker came back. 2 minutes is comfortably longer than any worker restart,
 * and comfortably shorter than a real deploy.sh run (apt/pnpm install/build on a fresh box is many
 * minutes), so a run older than that which is still RUNNING at worker startup is either genuinely
 * orphaned or — worst case — a very slow live run that the operator can simply re-Deploy. Sweeping
 * only at startup (not every tick) keeps that worst case bounded to restart time.
 */
async function reconcileStaleProvisionRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PROVISION_RUN_MS);
  const stale = await prisma.provisionRun.findMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    select: { id: true, deploymentId: true, logText: true, startedAt: true },
  });
  if (stale.length === 0) return;

  console.log(`Reconciling ${stale.length} stale provision run(s) left RUNNING by a previous process`);
  for (const run of stale) {
    await prisma.provisionRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        logText:
          run.logText +
          `\n[jarvis] This run was still marked RUNNING when the worker started, having begun at ` +
          `${run.startedAt.toISOString()} — more than ${Math.round(STALE_PROVISION_RUN_MS / 60000)} minutes ` +
          `earlier. deploy.sh is driven fire-and-forget by the web process, so a web restart (deploy, crash, ` +
          `pm2 reload) mid-run leaves nothing behind to finish it and the log above is however far it got. ` +
          `Marking it FAILED so the deployment leaves PROVISIONING and Deploy becomes clickable again. ` +
          `deploy.sh is idempotent: re-running it is the intended recovery path.`,
      },
    });
    // Scoped to PROVISIONING so a deployment that has since been moved on by something else
    // (another run that completed, a manual status change) is left exactly as it is.
    await prisma.deployment.updateMany({
      where: { id: run.deploymentId, status: 'PROVISIONING' },
      data: { status: 'FAILED' },
    });
  }
}

async function main() {
  console.log('Jarvis push worker started');
  // Never let a startup DB hiccup here take the whole worker down (main() is called with `void`, so a
  // rejection would be fatal). The sweep is best-effort; the poll loop is the thing that must survive.
  try {
    await reconcileStaleProvisionRuns();
  } catch (err) {
    console.error('stale provision run reconciliation failed', err);
  }
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error('push-worker tick failed', err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

void main();
