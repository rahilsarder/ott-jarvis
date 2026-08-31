export interface ParsedMovie {
  name: string;
  year: number | null;
}

export interface ParsedEpisode {
  name: string;
  year: number | null;
  seasonNumber: number;
  episodeNumber: number;
}

// Tolerates whitespace inside the parens too — a real folder is literally "Territory ( 2024 )".
const YEAR_IN_PARENS = /^(.*?)\s*\(\s*(\d{4})\s*\)$/;

const SEASON_EPISODE = /(\d{1,3})x(\d{1,4})/i;

/** Shared by movie and episode parsing: a "Title (Year)" or "Title" folder name, trimmed. */
function parseTitleYear(segment: string): { name: string; year: number | null } | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  const match = trimmed.match(YEAR_IN_PARENS);
  if (match) {
    const name = match[1].trim();
    return name ? { name, year: Number(match[2]) } : null;
  }
  return { name: trimmed, year: null };
}

/**
 * Movie folders are named "Title (Year)" cleanly; release filenames are not
 * (dots for spaces, resolution/codec/group tags — e.g. "Aakhri.Sawal.2026.
 * 1080p.Hindi.AAC.h264.ESub.mp4"). The file's own parent folder, not the
 * filename and not the year-bucket grandparent above it, is the reliable
 * source for both name and year: real libraries land a title in the wrong
 * year bucket (upload time, not release year — "Cinemaa Zindabad (2022)"
 * sits inside a "2021/" bucket), but the folder's own name is accurate.
 */
export function parseMoviePath(relativePath: string): ParsedMovie | null {
  const segments = relativePath.split('/');
  if (segments.length < 2) return null;
  return parseTitleYear(segments[segments.length - 2]);
}

/**
 * TV layout is one level deeper than movies: .../Series (Year)/Season N/file.
 * The series folder (two levels above the file) is trusted for name/year, the
 * same rule as parseMoviePath. Season and episode both come from the
 * filename's own "SxE" marker (e.g. "Friends (1994) - 1x10.mp4") rather than
 * the "Season N" folder — a more specific, per-file signal, and the only one
 * that also carries the episode number.
 */
export function parseEpisodePath(relativePath: string): ParsedEpisode | null {
  const segments = relativePath.split('/');
  if (segments.length < 3) return null;

  const series = parseTitleYear(segments[segments.length - 3]);
  if (!series) return null;

  const filename = segments[segments.length - 1];
  const match = filename.match(SEASON_EPISODE);
  if (!match) return null;

  return {
    name: series.name,
    year: series.year,
    seasonNumber: Number(match[1]),
    episodeNumber: Number(match[2]),
  };
}
