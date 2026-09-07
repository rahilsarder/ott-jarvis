import type { MaturityRatingValue } from './content-schema';

const TMDB_API = 'https://api.themoviedb.org/3';
const IMAGE_CDN = 'https://image.tmdb.org/t/p';
const REQUEST_TIMEOUT_MS = 10_000;

/** Sizes match the OTT app's own TmdbService so artwork looks identical however a title was imported. */
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';
const LOGO_SIZE = 'w300';

/** A folder's year and TMDB's primary release date legitimately differ by a year
 *  (festival vs. wide release, regional staggering), so one year of slack still counts as a match. */
const YEAR_TOLERANCE = 1;

/** Certification is genuinely per-country on TMDB; US is the one every release/content-ratings
 *  response reliably carries, and OTT's own MaturityRating enum is US-shaped (PG_13, TV_MA, ...). */
const CERTIFICATION_COUNTRY = 'US';

const CERTIFICATION_MAP: Record<string, MaturityRatingValue> = {
  G: 'G',
  PG: 'PG',
  'PG-13': 'PG_13',
  R: 'R',
  'NC-17': 'NC_17',
  'TV-Y': 'TV_Y',
  'TV-G': 'TV_G',
  'TV-PG': 'TV_PG',
  'TV-14': 'TV_14',
  'TV-MA': 'TV_MA',
};

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
  logoUrl: string | null;
  trailerYoutubeId: string | null;
  /** One of Jarvis's own MaturityRating enum values (packages/shared's shape, mirrored — see
   *  content-schema.ts), or null when TMDB has no certification for CERTIFICATION_COUNTRY or it
   *  doesn't map to a known value (e.g. "NR"/"Unrated"). Always safe to leave unset — the manual
   *  form's own rating dropdown covers the gap. */
  rating: MaturityRatingValue | null;
  /** MOVIE only — null for a lookupSeries/tv result, matching ContentItem.durationSec's own
   *  movie-only scope (see the Prisma field comment). */
  durationSec: number | null;
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

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official?: boolean;
}

interface TmdbLogo {
  file_path: string;
  iso_639_1: string | null;
}

interface TmdbReleaseDatesResult {
  iso_3166_1: string;
  release_dates: { certification: string }[];
}

interface TmdbContentRatingsResult {
  iso_3166_1: string;
  rating: string;
}

interface TmdbMovieDetail {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
  runtime?: number | null;
  videos?: { results: TmdbVideo[] };
  images?: { logos: TmdbLogo[] };
  release_dates?: { results: TmdbReleaseDatesResult[] };
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
  videos?: { results: TmdbVideo[] };
  images?: { logos: TmdbLogo[] };
  content_ratings?: { results: TmdbContentRatingsResult[] };
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
  trailerYoutubeId: string | null;
  logoPath: string | null;
  durationSec: number | null;
  rating: MaturityRatingValue | null;
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

export function logoUrl(path: string | null | undefined): string | null {
  return imageUrl(path, LOGO_SIZE);
}

/** Prefers the "official" trailer TMDB flags when there is one, else the first YouTube trailer
 *  in whatever order TMDB returned them. Non-YouTube trailers (rare) are skipped — the player
 *  only knows how to embed YouTube. */
function pickTrailer(videos: TmdbVideo[] | undefined): string | null {
  const trailers = (videos ?? []).filter((v) => v.site === 'YouTube' && v.type === 'Trailer');
  return (trailers.find((v) => v.official) ?? trailers[0])?.key ?? null;
}

/** Prefers an English-language logo, then a language-agnostic one (iso_639_1: null — common for
 *  wordmark-only logos), then whatever TMDB has, in that order. */
function pickLogo(logos: TmdbLogo[] | undefined): string | null {
  const list = logos ?? [];
  return (list.find((l) => l.iso_639_1 === 'en') ?? list.find((l) => l.iso_639_1 === null) ?? list[0])?.file_path ?? null;
}

function mapCertification(raw: string | undefined): MaturityRatingValue | null {
  return raw ? (CERTIFICATION_MAP[raw] ?? null) : null;
}

function pickMovieCertification(results: TmdbReleaseDatesResult[] | undefined): MaturityRatingValue | null {
  const country = results?.find((r) => r.iso_3166_1 === CERTIFICATION_COUNTRY);
  return mapCertification(country?.release_dates.find((rd) => rd.certification)?.certification);
}

function pickTvCertification(results: TmdbContentRatingsResult[] | undefined): MaturityRatingValue | null {
  return mapCertification(results?.find((r) => r.iso_3166_1 === CERTIFICATION_COUNTRY)?.rating);
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

/**
 * One detail request per title, not four — TMDB's append_to_response bundles videos/images/
 * certification data onto the same /movie or /tv call trailer/logo/rating/duration all need,
 * rather than each needing its own round trip.
 */
async function rawDetail(config: TmdbConfig, kind: TmdbKind, tmdbId: number): Promise<NormalizedDetail> {
  if (kind === 'movie') {
    const d = await get<TmdbMovieDetail>(config, `/movie/${tmdbId}`, { append_to_response: 'videos,images,release_dates' });
    return {
      id: d.id,
      title: d.title,
      releaseDate: d.release_date,
      overview: d.overview,
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      genreNames: d.genres?.map((g) => g.name) ?? [],
      trailerYoutubeId: pickTrailer(d.videos?.results),
      logoPath: pickLogo(d.images?.logos),
      durationSec: d.runtime ? d.runtime * 60 : null,
      rating: pickMovieCertification(d.release_dates?.results),
    };
  }
  const d = await get<TmdbTvDetail>(config, `/tv/${tmdbId}`, { append_to_response: 'videos,images,content_ratings' });
  return {
    id: d.id,
    title: d.name,
    releaseDate: d.first_air_date,
    overview: d.overview,
    posterPath: d.poster_path,
    backdropPath: d.backdrop_path,
    genreNames: d.genres?.map((g) => g.name) ?? [],
    trailerYoutubeId: pickTrailer(d.videos?.results),
    logoPath: pickLogo(d.images?.logos),
    // Not meaningful at the series level — pushEpisode never sends a series-wide duration (see
    // the Prisma field comment on ContentItem.durationSec).
    durationSec: null,
    rating: pickTvCertification(d.content_ratings?.results),
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
    logoUrl: logoUrl(detail.logoPath),
    trailerYoutubeId: detail.trailerYoutubeId,
    rating: detail.rating,
    durationSec: detail.durationSec,
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
    logoUrl: logoUrl(detail.logoPath),
    trailerYoutubeId: detail.trailerYoutubeId,
    rating: detail.rating,
    durationSec: detail.durationSec,
    genreNames: detail.genreNames,
  };
}
