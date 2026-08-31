export interface ParsedMovie {
  name: string;
  year: number | null;
}

const YEAR_IN_PARENS = /^(.*?)\s*\((\d{4})\)$/;

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
  const folder = segments[segments.length - 2].trim();
  if (!folder) return null;

  const match = folder.match(YEAR_IN_PARENS);
  if (match) {
    const name = match[1].trim();
    return name ? { name, year: Number(match[2]) } : null;
  }
  return { name: folder, year: null };
}
