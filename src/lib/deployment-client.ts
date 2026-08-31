export interface DeploymentTarget {
  baseUrl: string;
  contentApiKey: string;
}

export interface MovieForPush {
  name: string;
  year?: number | null;
  streamPath: string;
  synopsis?: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  logoUrl?: string | null;
  genreNames?: string[];
  /** Defaults to true so every pre-existing caller (manual /content submissions) keeps
   *  publishing immediately; the FTP watcher is the one caller that passes false. */
  isPublished?: boolean;
}

export interface EpisodeForPush {
  name: string; // series name
  year?: number | null;
  streamPath: string;
  seasonNumber: number;
  episodeNumber: number;
}

export class PushError extends Error {
  constructor(
    public status: number,
    public body: string,
    /** Parsed from a 429's Retry-After header (seconds → ms). Undefined for every other case. */
    public retryAfterMs?: number,
  ) {
    super(`Push failed with status ${status}: ${body}`);
  }
}

export function slugify(name: string, year?: number | null): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return year ? `${base}-${year}` : base;
}

function headers(target: DeploymentTarget): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Api-Key': target.contentApiKey };
}

/** Retry-After is defined in seconds by RFC 9110; not all servers send it. */
function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res) : undefined;
  throw new PushError(res.status, await res.text(), retryAfterMs);
}

interface AdminTitleRow {
  id: string;
  name: string;
  year: number | null;
  type: 'MOVIE' | 'SERIES';
}

interface AdminTitleDetail {
  id: string;
  seasons: { id: string; number: number; episodes: { id: string; number: number }[] }[];
}

// --- genres --------------------------------------------------------------

/**
 * genreIds on a title are deployment-local cuids, not portable names — this
 * resolves human-readable names to a specific box's ids, creating any that
 * don't exist yet there. Scope the cache to one worker tick (or one manual
 * push) via createGenreCache(); reusing it across pushes to the same
 * deployment avoids re-fetching the whole genre list per title.
 */
export interface GenreCache {
  loaded: boolean;
  byName: Map<string, string>;
}

export function createGenreCache(): GenreCache {
  return { loaded: false, byName: new Map() };
}

async function ensureGenreCacheLoaded(target: DeploymentTarget, cache: GenreCache): Promise<void> {
  if (cache.loaded) return;
  const res = await fetch(`${target.baseUrl}/api/admin/genres`, { headers: headers(target) });
  await assertOk(res);
  const genres = (await res.json()) as { id: string; name: string }[];
  for (const g of genres) cache.byName.set(g.name, g.id);
  cache.loaded = true;
}

export async function resolveGenreIds(
  target: DeploymentTarget,
  genreNames: string[],
  cache: GenreCache,
): Promise<string[]> {
  if (genreNames.length === 0) return [];
  await ensureGenreCacheLoaded(target, cache);

  const ids: string[] = [];
  for (const name of genreNames) {
    let id = cache.byName.get(name);
    if (!id) {
      const res = await fetch(`${target.baseUrl}/api/admin/genres`, {
        method: 'POST',
        headers: headers(target),
        body: JSON.stringify({ name, slug: slugify(name) }),
      });
      await assertOk(res);
      const created = (await res.json()) as { id: string };
      id = created.id;
      cache.byName.set(name, id);
    }
    ids.push(id);
  }
  return ids;
}

// --- movies ----------------------------------------------------------------

async function findMovie(target: DeploymentTarget, name: string, year?: number | null): Promise<{ id: string } | null> {
  const res = await fetch(`${target.baseUrl}/api/admin/titles?perPage=50&q=${encodeURIComponent(name)}`, {
    headers: headers(target),
  });
  await assertOk(res);
  const page = (await res.json()) as { items: AdminTitleRow[] };
  const match = page.items.find((row) => row.type === 'MOVIE' && row.name === name && row.year === (year ?? null));
  return match ? { id: match.id } : null;
}

/**
 * POST /admin/titles is create-only — assertSlugFree rejects a repeat slug
 * with a 400 that never clears. A watcher rescan, a retry after a partial
 * push, or simply pushing the same title twice would 400 forever without
 * this find-first-then-PUT step (pushEpisode already does the equivalent
 * for series/season below; movies were the one inconsistent path).
 */
export async function pushMovie(
  target: DeploymentTarget,
  item: MovieForPush,
  genreCache: GenreCache = createGenreCache(),
): Promise<void> {
  const genreIds = item.genreNames?.length ? await resolveGenreIds(target, item.genreNames, genreCache) : undefined;

  const body = JSON.stringify({
    type: 'MOVIE',
    slug: slugify(item.name, item.year),
    name: item.name,
    year: item.year ?? null,
    streamPath: item.streamPath,
    isPublished: item.isPublished ?? true,
    ...(item.synopsis !== undefined && { synopsis: item.synopsis }),
    ...(item.posterUrl !== undefined && { posterUrl: item.posterUrl }),
    ...(item.backdropUrl !== undefined && { backdropUrl: item.backdropUrl }),
    ...(item.logoUrl !== undefined && { logoUrl: item.logoUrl }),
    ...(genreIds !== undefined && { genreIds }),
  });

  const existing = await findMovie(target, item.name, item.year);
  const res = existing
    ? await fetch(`${target.baseUrl}/api/admin/titles/${existing.id}`, { method: 'PUT', headers: headers(target), body })
    : await fetch(`${target.baseUrl}/api/admin/titles`, { method: 'POST', headers: headers(target), body });
  await assertOk(res);
}

// --- episodes ----------------------------------------------------------------

async function findOrCreateSeries(target: DeploymentTarget, name: string, year?: number | null): Promise<AdminTitleDetail> {
  const searchRes = await fetch(`${target.baseUrl}/api/admin/titles?perPage=50&q=${encodeURIComponent(name)}`, {
    headers: headers(target),
  });
  await assertOk(searchRes);
  const page = (await searchRes.json()) as { items: AdminTitleRow[] };
  const match = page.items.find((row) => row.type === 'SERIES' && row.name === name && row.year === (year ?? null));

  if (match) {
    const detailRes = await fetch(`${target.baseUrl}/api/admin/titles/${match.id}`, { headers: headers(target) });
    await assertOk(detailRes);
    return (await detailRes.json()) as AdminTitleDetail;
  }

  const createRes = await fetch(`${target.baseUrl}/api/admin/titles`, {
    method: 'POST',
    headers: headers(target),
    body: JSON.stringify({
      type: 'SERIES',
      slug: slugify(name, year),
      name,
      year: year ?? null,
      isPublished: true,
    }),
  });
  await assertOk(createRes);
  const created = (await createRes.json()) as { id: string };
  return { id: created.id, seasons: [] };
}

async function findOrCreateSeason(
  target: DeploymentTarget,
  seriesId: string,
  seasons: AdminTitleDetail['seasons'],
  number: number,
): Promise<{ id: string; episodes: { id: string; number: number }[] }> {
  const existing = seasons.find((s) => s.number === number);
  if (existing) return existing;

  const res = await fetch(`${target.baseUrl}/api/admin/titles/${seriesId}/seasons`, {
    method: 'POST',
    headers: headers(target),
    body: JSON.stringify({ number }),
  });
  await assertOk(res);
  const created = (await res.json()) as { id: string; number: number };
  return { id: created.id, episodes: [] };
}

export async function pushEpisode(target: DeploymentTarget, item: EpisodeForPush): Promise<void> {
  const series = await findOrCreateSeries(target, item.name, item.year);
  const season = await findOrCreateSeason(target, series.id, series.seasons, item.seasonNumber);
  const existingEpisode = season.episodes.find((e) => e.number === item.episodeNumber);

  const body = JSON.stringify({
    seasonId: season.id,
    number: item.episodeNumber,
    name: `Episode ${item.episodeNumber}`,
    streamPath: item.streamPath,
  });

  const res = existingEpisode
    ? await fetch(`${target.baseUrl}/api/admin/titles/${series.id}/episodes/${existingEpisode.id}`, {
        method: 'PUT',
        headers: headers(target),
        body,
      })
    : await fetch(`${target.baseUrl}/api/admin/titles/${series.id}/episodes`, {
        method: 'POST',
        headers: headers(target),
        body,
      });
  await assertOk(res);
}
