import { parseEpisodePath, parseMoviePath, ParsedEpisode, ParsedMovie } from './filename-parse';
import type { MovieMetadata } from './tmdb';

/**
 * Allowlist, not a blocklist. Both production FTP roots keep real content
 * directories alongside operational ones (torrent, ffmpeg, ffmpeg-encoded,
 * downloads, games, software, Subtitles, lancache, watch2/3/4, .hls, .sync,
 * Emby backups, and literal ftp/FTP staging dirs). Naming what to walk means a
 * new junk directory appearing on either box is ignored by default, where a
 * blocklist would happily scan it and fan the contents out to every customer.
 */
export const MOVIE_CATEGORIES = [
  'animated',
  'bangladeshi movie',
  'bollywood',
  'dhallywood',
  'foreign',
  'hollywood',
  'indian bangla',
  'pakistani',
  'tamil',
] as const;

/** Present on both roots — real layout is .../Series (Year)/Season N/Series (Year) - SxE.ext. */
export const SERIES_CATEGORIES = ['tv', 'tv-series'] as const;

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'm4v', 'mov', 'ts', 'webm']);

export type Classification =
  | { ok: true; kind: 'MOVIE'; category: string; parsed: ParsedMovie }
  | { ok: true; kind: 'EPISODE'; category: string; parsed: ParsedEpisode }
  | {
      ok: false;
      reason: 'not-a-content-category' | 'not-a-video' | 'no-title-folder' | 'no-episode-marker' | 'unsafe-path';
    };

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
}

/**
 * Decides whether a watcher-reported path is something we ingest, and as what.
 * Paths arrive from agents on the media boxes, so they are untrusted input:
 * anything absolute or containing a traversal segment is refused outright
 * rather than normalized, since a path is only ever used verbatim as a
 * Flussonic stream path.
 */
export function classifyPath(relativePath: string): Classification {
  if (relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    return { ok: false, reason: 'unsafe-path' };
  }

  const segments = relativePath.split('/');
  const category = segments[0]?.toLowerCase();
  const isSeries = SERIES_CATEGORIES.some((c) => c === category);
  const isMovie = MOVIE_CATEGORIES.some((c) => c === category);
  if (!isSeries && !isMovie) return { ok: false, reason: 'not-a-content-category' };
  if (!VIDEO_EXTENSIONS.has(extensionOf(relativePath))) return { ok: false, reason: 'not-a-video' };

  if (isSeries) {
    // category/Series (Year)/Season N/file.ext — one level deeper than a movie.
    if (segments.length < 4) return { ok: false, reason: 'no-title-folder' };
    const parsed = parseEpisodePath(relativePath);
    if (!parsed) return { ok: false, reason: 'no-episode-marker' };
    return { ok: true, kind: 'EPISODE', category, parsed };
  }

  // A movie must live in its own "Title (Year)" folder; a file dropped straight into a
  // category directory has no folder to take a title from.
  if (segments.length < 3) return { ok: false, reason: 'no-title-folder' };
  const parsed = parseMoviePath(relativePath);
  if (!parsed) return { ok: false, reason: 'no-title-folder' };
  return { ok: true, kind: 'MOVIE', category, parsed };
}

export interface ContentItemData {
  kind: 'MOVIE' | 'EPISODE';
  name: string;
  year: number | null;
  streamPath: string;
  sourcePath: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  tmdbId: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  genreNames: string[];
  isPublished: boolean;
}

/**
 * Merges what the path told us with what TMDB told us (lookupMovie for a
 * MOVIE classification, lookupSeries — applied at the series level — for an
 * EPISODE one; the caller picks which one ran).
 *
 * The confidence flag governs two things at once: whether the title goes live,
 * and whose name wins. An unconfident match still carries its artwork and
 * synopsis through (useful to whoever reviews it) but keeps the *parsed* name
 * and year, because adopting a doubtful TMDB title would rename the film (or
 * show) on every customer's site at once.
 */
export function buildContentItemData(
  sourcePath: string,
  classification: Extract<Classification, { ok: true }>,
  meta: MovieMetadata | null,
): ContentItemData {
  const trusted = meta?.confident === true;
  const { parsed } = classification;
  return {
    kind: classification.kind,
    name: trusted ? meta.name : parsed.name,
    year: trusted ? meta.year : parsed.year,
    // The FTP tree maps directly onto Flussonic stream paths, so the path is used verbatim.
    streamPath: sourcePath,
    sourcePath,
    seasonNumber: classification.kind === 'EPISODE' ? classification.parsed.seasonNumber : null,
    episodeNumber: classification.kind === 'EPISODE' ? classification.parsed.episodeNumber : null,
    tmdbId: meta?.tmdbId ?? null,
    synopsis: meta?.synopsis || null,
    posterUrl: meta?.posterUrl ?? null,
    backdropUrl: meta?.backdropUrl ?? null,
    genreNames: meta?.genreNames ?? [],
    isPublished: trusted,
  };
}
