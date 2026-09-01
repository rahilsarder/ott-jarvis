import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { searchTitles } from '@/lib/tmdb';

async function requireSession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireSession(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'TMDB is not configured — set TMDB_API_KEY' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind');
  const query = searchParams.get('q');
  if (kind !== 'movie' && kind !== 'tv') {
    return NextResponse.json({ error: 'kind must be "movie" or "tv"' }, { status: 400 });
  }
  if (!query || query.trim().length < 2) return NextResponse.json([]);

  const results = await searchTitles({ apiKey }, kind, query.trim());
  return NextResponse.json(results);
}
