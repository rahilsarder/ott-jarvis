import { z } from 'zod';

export const MATURITY_RATINGS = ['G', 'PG', 'PG_13', 'R', 'NC_17', 'TV_Y', 'TV_G', 'TV_PG', 'TV_14', 'TV_MA'] as const;

/** Shared with tmdb.ts and ingest.ts so a TMDB-derived rating type-checks directly against
 *  Prisma's MaturityRating enum without a cast at the call site. */
export type MaturityRatingValue = (typeof MATURITY_RATINGS)[number];

/**
 * Pulls a bare 11-character video id out of whatever an admin pastes — the id
 * itself, a youtube.com/watch, youtu.be, or /embed/ URL — so only the id is
 * ever stored. Mirrors OTT's own extractYoutubeId (packages/shared/src/catalog.ts)
 * exactly; duplicated rather than shared since Jarvis has no code-sharing with
 * that repo. Returns the input unchanged when nothing recognisable is found, so
 * the schema below can reject it with a real error instead of this guessing.
 */
export function extractYoutubeId(value: string): string {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (/(^|\.)youtu\.be$/.test(url.hostname)) return url.pathname.slice(1) || trimmed;
    if (/(^|\.)youtube\.com$/.test(url.hostname)) {
      if (url.pathname === '/watch') return url.searchParams.get('v') ?? trimmed;
      const embed = url.pathname.match(/^\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (embed) return embed[1];
    }
  } catch {
    // Not a URL — fall through and let the id validation reject it.
  }
  return trimmed;
}

const youtubeIdSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() ? extractYoutubeId(value) : value),
  z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'Enter a YouTube video id or a youtube.com / youtu.be URL'),
);

export const contentItemSchema = z
  .object({
    kind: z.enum(['MOVIE', 'EPISODE']),
    name: z.string().min(1).max(200).trim(),
    year: z.number().int().min(1888).max(2100).nullable().optional(),
    streamPath: z.string().min(1).max(500).trim(),
    seasonNumber: z.number().int().min(0).max(100).optional(),
    episodeNumber: z.number().int().min(0).max(1000).optional(),
    sourcePath: z.string().max(1000).optional(),
    // Filled in by the manual TMDB search-and-apply flow on /content — all optional so the plain
    // hand-typed submission (no TMDB match applied) keeps working exactly as before.
    synopsis: z.string().max(4000).optional(),
    posterUrl: z.string().url().max(1000).nullable().optional(),
    backdropUrl: z.string().url().max(1000).nullable().optional(),
    logoUrl: z.string().url().max(1000).nullable().optional(),
    trailerYoutubeId: youtubeIdSchema.nullable().optional(),
    rating: z.enum(MATURITY_RATINGS).nullable().optional(),
    /** MOVIE only — see the Prisma field comment. */
    durationSec: z.number().int().min(0).nullable().optional(),
    /** EPISODE only (series-level) — see the Prisma field comment. */
    creditsLeadSec: z.number().int().min(0).max(600).nullable().optional(),
    genreNames: z.array(z.string().min(1).max(60)).max(20).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((v) => v.kind !== 'EPISODE' || (v.seasonNumber !== undefined && v.episodeNumber !== undefined), {
    message: 'seasonNumber and episodeNumber are required for an EPISODE',
  });
export type ContentItemInput = z.infer<typeof contentItemSchema>;
