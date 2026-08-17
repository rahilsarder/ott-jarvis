import { describe, expect, it } from 'vitest';
import { contentItemSchema } from '../src/lib/content-schema';

describe('contentItemSchema', () => {
  it('accepts a movie with no season/episode numbers', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      year: 2024,
      streamPath: 'vod/some-movie.mp4',
    });
    expect(result.success).toBe(true);
  });

  it('requires seasonNumber and episodeNumber for an episode', () => {
    const result = contentItemSchema.safeParse({
      kind: 'EPISODE',
      name: 'Some Series',
      streamPath: 'vod/some-series-s01e01.mp4',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a fully-specified episode', () => {
    const result = contentItemSchema.safeParse({
      kind: 'EPISODE',
      name: 'Some Series',
      year: 2023,
      streamPath: 'vod/some-series-s01e01.mp4',
      seasonNumber: 1,
      episodeNumber: 1,
      sourcePath: '/ftp/incoming/some-series/s01e01.mp4',
    });
    expect(result.success).toBe(true);
  });
});
