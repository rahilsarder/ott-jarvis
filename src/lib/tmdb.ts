const TMDB_API = 'https://api.themoviedb.org/3';
const IMAGE_CDN = 'https://image.tmdb.org/t/p';
const REQUEST_TIMEOUT_MS = 10_000;

/** Sizes match the OTT app's own TmdbService so artwork looks identical however a title was imported. */
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';

/** A folder's year and TMDB's primary release date legitimately differ by a year
 *  (festival vs. wide release, regional staggering), so one year of slack still counts as a match. */
const YEAR_TOLERANCE = 1;

export interface TmdbConfig {
  apiKey: string;
  language?: string;
}

export interface MovieMetadata {
  tmdbId: number;
  name: string;
  year: number | null;
  synopsis: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  genreNames: string[];
  /** False when the match is doubtful — the caller submits those unpublished rather than
   *  fanning a possible mis-identification out to every customer as live content. */
  confident: boolean;
}

interface TmdbSearchResult {
  id: number;
  title: string;
  release_date?: string;
}

interface TmdbMovieDetail {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
}

interface TmdbTvSearchResult {
  id: number;
  name: string;
  first_air_date?: string;
}

interface TmdbTvDetail {
  id: number;
  name: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
}

function imageUrl(path: string | null | undefined, size: string): string | null {
  return path ? `${IMAGE_CDN}/${size}${path}` : null;
}

export function posterUrl(path: string | null | undefined): string | null {
  return imageUrl(path, POSTER_SIZE);
}

export function backdropUrl(path: string | null | undefined): string | null {
  return imageUrl(path, BACKDROP_SIZE);
}

/** Folder titles and TMDB titles differ in punctuation and case far more often than in words. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Same as normalizeTitle but with separators removed entirely, so punctuated
 * initials match their unpunctuated form ("B.A. Pass 3" ≡ "BA Pass 3" — a real
 * case). Compared only as a fallback: dropping separators can only ever merge
 * titles that already agree on every letter and digit in order.
 */
function compactTitle(title: string): string {
  return normalizeTitle(title).replace(/ /g, '');
}

function titlesMatch(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b) || compactTitle(a) === compactTitle(b);
}

function releaseYear(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

function yearMatches(candidateYear: number | null, wantedYear: number | null): boolean {
  if (wantedYear === null || candidateYear === null) return true;
  return Math.abs(candidateYear - wantedYear) <= YEAR_TOLERANCE;
}

/**
 * TMDB ranks by popularity, so the top hit for a search is often a better-known
 * film than the one actually on disk — a remake, or an unrelated title sharing a
 * word. Prefer an exact title match at the right year, then any exact title
 * match, and only then fall back to TMDB's own ranking.
 */
function pickCandidate(
  results: TmdbSearchResult[],
  name: string,
  year: number | null,
): TmdbSearchResult | undefined {
  const titleMatches = results.filter((r) => titlesMatch(r.title, name));
  return (
    titleMatches.find((r) => yearMatches(releaseYear(r.release_date), year)) ?? titleMatches[0] ?? results[0]
  );
}

async function get<T>(config: TmdbConfig, path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ language: config.language ?? 'en-US', ...params });

  // TMDB takes either a v4 read token (a JWT, always "ey…") as a bearer header or a v3 key as a
  // query parameter. Preferring the header for v4 keeps the credential out of URLs and logs.
  const isV4Token = config.apiKey.startsWith('ey');
  if (!isV4Token) query.set('api_key', config.apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${TMDB_API}${path}?${query.toString()}`, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(isV4Token ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`TMDB request failed (${res.status}) for ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves a parsed folder title to TMDB metadata, reporting whether the match
 * is trustworthy. Returns null only when TMDB knows of nothing by that name;
 * a doubtful match still comes back (with `confident: false`) so the caller can
 * ingest it unpublished instead of dropping it on the floor.
 */
export async function lookupMovie(
  config: TmdbConfig,
  name: string,
  year: number | null,
): Promise<MovieMetadata | null> {
  // Deliberately unfiltered by year. Verified against the live API: constraining with
  // primary_release_year returns *zero* results whenever the library's folder year and TMDB's
  // release year differ by even one ("Cinemaa Zindabad" is 2021 on TMDB, 2022 on disk), which is
  // common enough to lose real titles. The year is used to rank candidates below instead.
  const search = await get<{ results?: TmdbSearchResult[] }>(config, '/search/movie', {
    query: name,
    include_adult: 'false',
  });

  const candidate = pickCandidate(search.results ?? [], name, year);
  if (!candidate) return null;

  const detail = await get<TmdbMovieDetail>(config, `/movie/${candidate.id}`, {});
  const matchedYear = releaseYear(detail.release_date);

  return {
    tmdbId: detail.id,
    name: detail.title,
    year: matchedYear,
    synopsis: detail.overview ?? '',
    posterUrl: posterUrl(detail.poster_path),
    backdropUrl: backdropUrl(detail.backdrop_path),
    genreNames: detail.genres?.map((g) => g.name) ?? [],
    confident: titlesMatch(detail.title, name) && yearMatches(matchedYear, year),
  };
}

/**
 * TV counterpart to lookupMovie, applied at the series level — episode
 * pushes carry the series' own artwork/synopsis/genres, not per-episode
 * TMDB data. Same candidate-picking and confidence rules; only the TMDB
 * field names differ (name/first_air_date instead of title/release_date),
 * normalized here so the shared helpers don't need to know about that.
 */
export async function lookupSeries(
  config: TmdbConfig,
  name: string,
  year: number | null,
): Promise<MovieMetadata | null> {
  const search = await get<{ results?: TmdbTvSearchResult[] }>(config, '/search/tv', {
    query: name,
    include_adult: 'false',
  });

  const normalized = (search.results ?? []).map((r) => ({ id: r.id, title: r.name, release_date: r.first_air_date }));
  const candidate = pickCandidate(normalized, name, year);
  if (!candidate) return null;

  const detail = await get<TmdbTvDetail>(config, `/tv/${candidate.id}`, {});
  const matchedYear = releaseYear(detail.first_air_date);

  return {
    tmdbId: detail.id,
    name: detail.name,
    year: matchedYear,
    synopsis: detail.overview ?? '',
    posterUrl: posterUrl(detail.poster_path),
    backdropUrl: backdropUrl(detail.backdrop_path),
    genreNames: detail.genres?.map((g) => g.name) ?? [],
    confident: titlesMatch(detail.name, name) && yearMatches(matchedYear, year),
  };
}
