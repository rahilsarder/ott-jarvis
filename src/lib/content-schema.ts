import { z } from 'zod';

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
    genreNames: z.array(z.string().min(1).max(60)).max(20).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((v) => v.kind !== 'EPISODE' || (v.seasonNumber !== undefined && v.episodeNumber !== undefined), {
    message: 'seasonNumber and episodeNumber are required for an EPISODE',
  });
export type ContentItemInput = z.infer<typeof contentItemSchema>;
