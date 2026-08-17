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
  })
  .refine((v) => v.kind !== 'EPISODE' || (v.seasonNumber !== undefined && v.episodeNumber !== undefined), {
    message: 'seasonNumber and episodeNumber are required for an EPISODE',
  });
export type ContentItemInput = z.infer<typeof contentItemSchema>;
