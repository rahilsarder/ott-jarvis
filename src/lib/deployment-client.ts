export interface DeploymentTarget {
  baseUrl: string;
  contentApiKey: string;
}

export interface MovieForPush {
  name: string;
  year?: number | null;
  streamPath: string;
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

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) throw new PushError(res.status, await res.text());
}

export async function pushMovie(target: DeploymentTarget, item: MovieForPush): Promise<void> {
  const res = await fetch(`${target.baseUrl}/api/admin/titles`, {
    method: 'POST',
    headers: headers(target),
    body: JSON.stringify({
      type: 'MOVIE',
      slug: slugify(item.name, item.year),
      name: item.name,
      year: item.year ?? null,
      streamPath: item.streamPath,
      isPublished: true,
    }),
  });
  await assertOk(res);
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
