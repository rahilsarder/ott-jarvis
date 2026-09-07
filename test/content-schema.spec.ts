import { describe, expect, it } from 'vitest';
import { contentItemSchema, extractYoutubeId } from '../src/lib/content-schema';

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

  it('accepts logoUrl, rating, durationSec and a bare trailer id', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      logoUrl: 'https://image.tmdb.org/t/p/w300/l.png',
      rating: 'PG_13',
      durationSec: 7200,
      trailerYoutubeId: 'dQw4w9WgXcQ',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.trailerYoutubeId).toBe('dQw4w9WgXcQ');
  });

  it('extracts a trailer id from a pasted youtube.com/watch URL', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      trailerYoutubeId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(result.success && result.data.trailerYoutubeId).toBe('dQw4w9WgXcQ');
  });

  it('extracts a trailer id from a youtu.be short link', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      trailerYoutubeId: 'https://youtu.be/dQw4w9WgXcQ',
    });
    expect(result.success && result.data.trailerYoutubeId).toBe('dQw4w9WgXcQ');
  });

  it('rejects an unrecognizable trailer value', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      trailerYoutubeId: 'not a youtube link',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a rating outside the known maturity ratings', () => {
    const result = contentItemSchema.safeParse({
      kind: 'MOVIE',
      name: 'Some Movie',
      streamPath: 'vod/some-movie.mp4',
      rating: 'XXX',
    });
    expect(result.success).toBe(false);
  });

  it('accepts creditsLeadSec on an episode', () => {
    const result = contentItemSchema.safeParse({
      kind: 'EPISODE',
      name: 'Some Series',
      streamPath: 'vod/some-series-s01e01.mp4',
      seasonNumber: 1,
      episodeNumber: 1,
      creditsLeadSec: 45,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a creditsLeadSec outside the sane bounds', () => {
    const result = contentItemSchema.safeParse({
      kind: 'EPISODE',
      name: 'Some Series',
      streamPath: 'vod/some-series-s01e01.mp4',
      seasonNumber: 1,
      episodeNumber: 1,
      creditsLeadSec: 9999,
    });
    expect(result.success).toBe(false);
  });
});

describe('extractYoutubeId', () => {
  it('passes a bare id through unchanged', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from a watch URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from a youtu.be short link', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from an embed URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from a shorts URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns the input unchanged when nothing recognizable is found', () => {
    expect(extractYoutubeId('not a link at all')).toBe('not a link at all');
  });
});
