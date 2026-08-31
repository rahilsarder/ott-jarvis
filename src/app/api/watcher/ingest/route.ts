import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { verifyApiKey } from '@/lib/api-key.service';
import { classifyPath, buildContentItemData } from '@/lib/ingest';
import { lookupMovie } from '@/lib/tmdb';

type Auth = { via: 'session'; userId: string } | { via: 'apikey'; apiKeyId: string };

async function authenticate(req: NextRequest): Promise<Auth | null> {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const result = await verifyApiKey(authHeader.slice(7));
    return result ? { via: 'apikey', apiKeyId: result.id } : null;
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  return session ? { via: 'session', userId: session.userId } : null;
}

const ingestSchema = z.object({ sourcePath: z.string().min(1).max(1000) });

/**
 * Ingest endpoint for the per-box scanner agents (Phase 3): each agent walks
 * its own local filesystem and reports one relative path per new, size-stable
 * file it finds — this route does everything from there (classification,
 * dedup, TMDB, fan-out). Kept separate from POST /api/content, which is the
 * manual-submission path the /content admin page uses and expects a
 * fully-formed ContentItemInput rather than a raw path to classify.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedBody = ingestSchema.safeParse(await req.json());
  if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  const { sourcePath } = parsedBody.data;

  const classification = classifyPath(sourcePath);
  if (!classification.ok) {
    if (classification.reason === 'unsafe-path') {
      return NextResponse.json({ error: 'unsafe path' }, { status: 400 });
    }
    // Not an error: the agent walks whole category trees and will legitimately encounter
    // things outside scope (a stray non-video file, tv-series content not yet supported).
    // 200 tells it to mark the path seen and move on rather than retry.
    return NextResponse.json({ skipped: true, reason: classification.reason }, { status: 200 });
  }

  // sourcePath is unique — an agent re-reporting a file it already sent (rescan, restart,
  // at-least-once retry) is a no-op rather than a second TMDB lookup and a duplicate fan-out.
  const existing = await prisma.contentItem.findUnique({ where: { sourcePath } });
  if (existing) return NextResponse.json(existing, { status: 200 });

  const tmdbApiKey = process.env.TMDB_API_KEY;
  let meta = null;
  if (tmdbApiKey) {
    try {
      meta = await lookupMovie({ apiKey: tmdbApiKey }, classification.parsed.name, classification.parsed.year);
    } catch {
      // Transient (network, rate limit, TMDB outage) — the agent only marks a path seen once
      // ingest succeeds, so a 502 here means it naturally retries on the next scan.
      return NextResponse.json({ error: 'TMDB lookup failed, retry later' }, { status: 502 });
    }
  }

  const item = await prisma.contentItem.create({
    data: {
      ...buildContentItemData(sourcePath, classification.parsed, meta),
      submittedByApiKeyId: auth.via === 'apikey' ? auth.apiKeyId : null,
      submittedByUserId: auth.via === 'session' ? auth.userId : null,
    },
  });

  const activeDeployments = await prisma.deployment.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  if (activeDeployments.length > 0) {
    await prisma.pushAttempt.createMany({
      data: activeDeployments.map((d) => ({ contentItemId: item.id, deploymentId: d.id })),
    });
  }

  return NextResponse.json(item, { status: 201 });
}
