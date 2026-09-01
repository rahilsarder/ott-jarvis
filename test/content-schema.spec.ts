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

  it('accepts the TMDB-enrichment fields the manual search-and-apply flow fills in', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      year: 2024,
      streamPath: 'vod/some-movie.mp4',
      synopsis: 'A synopsis.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      genreNames: ['Drama', 'Thriller'],
      isPublished: false,
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a bare submission with none of the enrichment fields', () => {
    // The old manual-form shape (name/year/streamPath only) must keep working unchanged.
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a posterUrl that is not a plausible URL', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      posterUrl: 'not a url',
    });
    expect(result.success).toBe(false);
  });

  it('allows posterUrl and backdropUrl to be explicitly null', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      posterUrl: null,
      backdropUrl: null,
    });
    expect(result.success).toBe(true);
  });
});
