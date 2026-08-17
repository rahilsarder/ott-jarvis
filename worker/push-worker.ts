import { prisma } from '../src/lib/prisma';
import { pushEpisode, pushMovie, PushError } from '../src/lib/deployment-client';
import { MAX_RETRIES, nextRetryDelayMs } from '../src/lib/retry';

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 20;

async function tick(): Promise<void> {
  const due = await prisma.pushAttempt.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    take: BATCH_SIZE,
    include: { contentItem: true, deployment: true },
  });

  for (const attempt of due) {
    if (attempt.deployment.status !== 'ACTIVE' || !attempt.deployment.contentApiKey) continue;

    const target = { baseUrl: attempt.deployment.baseUrl, contentApiKey: attempt.deployment.contentApiKey };
    try {
      if (attempt.contentItem.kind === 'MOVIE') {
        await pushMovie(target, {
          name: attempt.contentItem.name,
          year: attempt.contentItem.year,
          streamPath: attempt.contentItem.streamPath,
        });
      } else {
        await pushEpisode(target, {
          name: attempt.contentItem.name,
          year: attempt.contentItem.year,
          streamPath: attempt.contentItem.streamPath,
          seasonNumber: attempt.contentItem.seasonNumber!,
          episodeNumber: attempt.contentItem.episodeNumber!,
        });
      }
      await prisma.pushAttempt.update({
        where: { id: attempt.id },
        data: { status: 'SUCCESS', httpStatus: 200, attemptedAt: new Date(), errorMessage: null },
      });
      await prisma.deployment.update({ where: { id: attempt.deploymentId }, data: { lastPushAt: new Date() } });
    } catch (err) {
      const retryCount = attempt.retryCount + 1;
      const failed = retryCount > MAX_RETRIES;
      await prisma.pushAttempt.update({
        where: { id: attempt.id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          retryCount,
          httpStatus: err instanceof PushError ? err.status : null,
          errorMessage: err instanceof Error ? err.message : String(err),
          attemptedAt: new Date(),
          nextRetryAt: failed ? null : new Date(Date.now() + nextRetryDelayMs(retryCount)),
        },
      });
    }
  }
}

async function main() {
  console.log('Jarvis push worker started');
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
