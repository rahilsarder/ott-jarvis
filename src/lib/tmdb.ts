const TMDB_API = 'https://api.themoviedb.org/3';
const IMAGE_CDN = 'https://image.tmdb.org/t/p';
const REQUEST_TIMEOUT_MS = 10_000;

/** Sizes match the OTT app's own TmdbService so artwork looks identical however a title was imported. */
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';

/** A folder's year and TMDB's primary release date legitimately differ by a year
 *  (festival vs. wide release, regional staggering), so one year of slack still counts as a match. */
const YEAR_TOLERANCE = 1;

export type TmdbKind = 'movie' | 'tv';

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

/** List-view result for a human-driven search (the manual /content search panel) — cheaper than
 *  MovieMetadata since it's built entirely from one search request, no per-result detail fetch. */
export interface SearchHit {
  tmdbId: number;
  name: string;
  year: number | null;
  posterUrl: string | null;
  overview: string;
}

/** Full detail for a title a human has already picked — same shape as MovieMetadata minus
 *  `confident`, since a human selecting a specific result *is* the confidence signal. */
export type TitleDetail = Omit<MovieMetadata, 'confident'>;

interface TmdbSearchResult {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
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
  poster_path?: string | null;
  overview?: string;
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

/** Normalized shape both movie and tv search/detail responses are mapped into, so everything
 *  downstream (candidate-picking, the public search/detail exports) is kind-agnostic. */
interface NormalizedResult {
  id: number;
  title: string;
  releaseDate?: string;
  posterPath?: string | null;
  overview?: string;
}

interface NormalizedDetail extends NormalizedResult {
  backdropPath?: string | null;
  genreNames: string[];
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
function pickCandidate(results: NormalizedResult[], name: string, year: number | null): NormalizedResult | undefined {
  const titleMatches = results.filter((r) => titlesMatch(r.title, name));
  return (
    titleMatches.find((r) => yearMatches(releaseYear(r.releaseDate), year)) ?? titleMatches[0] ?? results[0]
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

async function rawSearch(config: TmdbConfig, kind: TmdbKind, query: string): Promise<NormalizedResult[]> {
  if (kind === 'movie') {
    const res = await get<{ results?: TmdbSearchResult[] }>(config, '/search/movie', { query, include_adult: 'false' });
    return (res.results ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      releaseDate: r.release_date,
      posterPath: r.poster_path,
      overview: r.overview,
    }));
  }
  const res = await get<{ results?: TmdbTvSearchResult[] }>(config, '/search/tv', { query, include_adult: 'false' });
  return (res.results ?? []).map((r) => ({
    id: r.id,
    title: r.name,
    releaseDate: r.first_air_date,
    posterPath: r.poster_path,
    overview: r.overview,
  }));
}

async function rawDetail(config: TmdbConfig, kind: TmdbKind, tmdbId: number): Promise<NormalizedDetail> {
  if (kind === 'movie') {
    const d = await get<TmdbMovieDetail>(config, `/movie/${tmdbId}`, {});
    return {
      id: d.id,
      title: d.title,
      releaseDate: d.release_date,
      overview: d.overview,
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      genreNames: d.genres?.map((g) => g.name) ?? [],
    };
  }
  const d = await get<TmdbTvDetail>(config, `/tv/${tmdbId}`, {});
  return {
    id: d.id,
    title: d.name,
    releaseDate: d.first_air_date,
    overview: d.overview,
    posterPath: d.poster_path,
    backdropPath: d.backdrop_path,
    genreNames: d.genres?.map((g) => g.name) ?? [],
  };
}

async function lookupTitle(config: TmdbConfig, kind: TmdbKind, name: string, year: number | null): Promise<MovieMetadata | null> {
  // Deliberately unfiltered by year. Verified against the live API: constraining with
  // primary_release_year returns *zero* results whenever the library's folder year and TMDB's
  // release year differ by even one ("Cinemaa Zindabad" is 2021 on TMDB but 2022 on disk), which is
  // common enough to lose real titles. The year is used to rank candidates below instead.
  const results = await rawSearch(config, kind, name);
  const candidate = pickCandidate(results, name, year);
  if (!candidate) return null;

  const detail = await rawDetail(config, kind, candidate.id);
  const matchedYear = releaseYear(detail.releaseDate);

  return {
    tmdbId: detail.id,
    name: detail.title,
    year: matchedYear,
    synopsis: detail.overview ?? '',
    posterUrl: posterUrl(detail.posterPath),
    backdropUrl: backdropUrl(detail.backdropPath),
    genreNames: detail.genreNames,
    confident: titlesMatch(detail.title, name) && yearMatches(matchedYear, year),
  };
}

/**
 * Resolves a parsed folder title to TMDB metadata, reporting whether the match
 * is trustworthy. Returns null only when TMDB knows of nothing by that name;
 * a doubtful match still comes back (with `confident: false`) so the caller can
 * ingest it unpublished instead of dropping it on the floor.
 */
export function lookupMovie(config: TmdbConfig, name: string, year: number | null): Promise<MovieMetadata | null> {
  return lookupTitle(config, 'movie', name, year);
}

/**
 * TV counterpart to lookupMovie, applied at the series level — episode
 * pushes carry the series' own artwork/synopsis/genres, not per-episode
 * TMDB data. Same candidate-picking and confidence rules; only the TMDB
 * field names differ (name/first_air_date instead of title/release_date),
 * normalized in rawSearch/rawDetail so this doesn't need to know about that.
 */
export function lookupSeries(config: TmdbConfig, name: string, year: number | null): Promise<MovieMetadata | null> {
  return lookupTitle(config, 'tv', name, year);
}

/**
 * Human-driven search for the manual /content upload form — the OTT admin panel's "search TMDB,
 * pick a result" flow, adapted for Jarvis. No confidence heuristic: the admin picking a specific
 * result *is* the confidence signal, so this returns every candidate for them to choose from
 * rather than picking one automatically.
 */
export async function searchTitles(config: TmdbConfig, kind: TmdbKind, query: string): Promise<SearchHit[]> {
  const results = await rawSearch(config, kind, query);
  return results.map((r) => ({
    tmdbId: r.id,
    name: r.title,
    year: releaseYear(r.releaseDate),
    posterUrl: posterUrl(r.posterPath),
    overview: r.overview ?? '',
  }));
}

/** Full metadata for a title the admin has already picked from searchTitles — genre names in
 *  particular require this second call, since TMDB's search results only carry genre ids. */
export async function getTitleDetail(config: TmdbConfig, kind: TmdbKind, tmdbId: number): Promise<TitleDetail> {
  const detail = await rawDetail(config, kind, tmdbId);
  return {
    tmdbId: detail.id,
    name: detail.title,
    year: releaseYear(detail.releaseDate),
    synopsis: detail.overview ?? '',
    posterUrl: posterUrl(detail.posterPath),
    backdropUrl: backdropUrl(detail.backdropPath),
    genreNames: detail.genreNames,
  };
}
