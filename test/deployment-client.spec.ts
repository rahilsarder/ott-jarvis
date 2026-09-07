import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenreCache, pushEpisode, pushMovie, PushError, resolveGenreIds, slugify } from '../src/lib/deployment-client';

describe('slugify', () => {
  it('lowercases, hyphenates, and appends the year', () => {
    expect(slugify('The Great Movie!', 2024)).toBe('the-great-movie-2024');
  });

  it('omits the year suffix when absent', () => {
    expect(slugify('No Year Here', undefined)).toBe('no-year-here');
  });
});

describe('pushMovie', () => {
  const target = { baseUrl: 'http://dep.local', contentApiKey: 'key123' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the movie with the X-Api-Key header, after searching and finding nothing', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 201 }));
    });
    await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' });

    const createCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
    const [url, init] = createCall!;
    expect(url).toBe('http://dep.local/api/admin/titles');
    expect(init?.headers).toMatchObject({ 'X-Api-Key': 'key123' });
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      type: 'MOVIE',
      slug: 'some-movie-2024',
      name: 'Some Movie',
      year: 2024,
      streamPath: 'vod/some-movie.mp4',
      isPublished: true,
    });
  });

  it('sends isPublished: false when the caller passes it, instead of always defaulting true', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 201 }));
    });
    await pushMovie(target, {
      name: 'Some Movie',
      year: 2024,
      streamPath: 'vod/some-movie.mp4',
      isPublished: false,
    });

    const createCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(createCall![1]?.body as string);
    expect(body.isPublished).toBe(false);
  });

  it('throws on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('bad request', { status: 400 }));
    await expect(
      pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' }),
    ).rejects.toThrow();
  });

  it('searches first, and PUTs the existing movie instead of creating a duplicate', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [{ id: 'movie1', name: 'Some Movie', year: 2024, type: 'MOVIE' }] }),
            { status: 200 },
          ),
        );
      }
      if (u.endsWith('/api/admin/titles/movie1') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie-v2.mp4' });

    const createCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([u, init]) => init?.method === 'POST' && String(u).endsWith('/api/admin/titles'));
    expect(createCalls).toHaveLength(0);
  });

  it('re-pushing the same movie twice succeeds both times (idempotent)', async () => {
    let created = false;
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: created ? [{ id: 'movie1', name: 'Some Movie', year: 2024, type: 'MOVIE' }] : [] }), {
            status: 200,
          }),
        );
      }
      if (u.endsWith('/api/admin/titles') && init?.method === 'POST') {
        created = true;
        return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 201 }));
      }
      if (u.endsWith('/api/admin/titles/movie1') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const item = { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' };
    await expect(pushMovie(target, item)).resolves.not.toThrow();
    await expect(pushMovie(target, item)).resolves.not.toThrow();
  });

  it('forwards optional metadata when provided', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 201 }));
    });

    await pushMovie(target, {
      name: 'Some Movie',
      year: 2024,
      streamPath: 'vod/some-movie.mp4',
      synopsis: 'A movie about things.',
      posterUrl: 'https://example.com/poster.jpg',
      backdropUrl: 'https://example.com/backdrop.jpg',
      logoUrl: 'https://example.com/logo.png',
      trailerYoutubeId: 'dQw4w9WgXcQ',
      rating: 'PG_13',
      durationSec: 7200,
    });

    const createCall = vi.mocked(fetch).mock.calls.find(([u, init]) => init?.method === 'POST');
    const body = JSON.parse((createCall![1]?.body as string) ?? '{}');
    expect(body).toMatchObject({
      synopsis: 'A movie about things.',
      posterUrl: 'https://example.com/poster.jpg',
      backdropUrl: 'https://example.com/backdrop.jpg',
      logoUrl: 'https://example.com/logo.png',
      trailerYoutubeId: 'dQw4w9WgXcQ',
      rating: 'PG_13',
      durationSec: 7200,
    });
  });

  it('omits metadata fields that were not provided, rather than sending them as undefined/null', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'movie1' }), { status: 201 }));
    });

    await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' });

    const createCall = vi.mocked(fetch).mock.calls.find(([u, init]) => init?.method === 'POST');
    const body = JSON.parse((createCall![1]?.body as string) ?? '{}');
    expect(body).not.toHaveProperty('synopsis');
    expect(body).not.toHaveProperty('posterUrl');
    expect(body).not.toHaveProperty('genreIds');
    expect(body).not.toHaveProperty('trailerYoutubeId');
    expect(body).not.toHaveProperty('rating');
    expect(body).not.toHaveProperty('durationSec');
  });
});

describe('resolveGenreIds', () => {
  const target = { baseUrl: 'http://dep.local', contentApiKey: 'key123' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves names already present on the target to their existing ids', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (String(url).endsWith('/api/admin/genres') && (!init || init.method === undefined)) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 'g1', name: 'Drama' }, { id: 'g2', name: 'Thriller' }]), {
            status: 200,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${String(url)} ${init?.method}`);
    });

    const ids = await resolveGenreIds(target, ['Drama', 'Thriller'], createGenreCache());
    expect(ids).toEqual(['g1', 'g2']);
  });

  it('creates a genre that does not exist yet on the target', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith('/api/admin/genres') && init?.method !== 'POST') {
        return Promise.resolve(new Response(JSON.stringify([{ id: 'g1', name: 'Drama' }]), { status: 200 }));
      }
      if (u.endsWith('/api/admin/genres') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'g-new', name: 'Sci-Fi' }), { status: 201 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const ids = await resolveGenreIds(target, ['Drama', 'Sci-Fi'], createGenreCache());
    expect(ids).toEqual(['g1', 'g-new']);
  });

  it('only fetches the genre list once across multiple calls sharing a cache', async () => {
    const listFetches: string[] = [];
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith('/api/admin/genres') && init?.method !== 'POST') {
        listFetches.push(u);
        return Promise.resolve(new Response(JSON.stringify([{ id: 'g1', name: 'Drama' }]), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const cache = createGenreCache();
    await resolveGenreIds(target, ['Drama'], cache);
    await resolveGenreIds(target, ['Drama'], cache);
    expect(listFetches).toHaveLength(1);
  });

  it('returns an empty array without any fetch when given no genre names', async () => {
    vi.mocked(fetch).mockImplementation(() => {
      throw new Error('should not fetch');
    });
    expect(await resolveGenreIds(target, [], createGenreCache())).toEqual([]);
  });
});

describe('PushError / rate limiting', () => {
  const target = { baseUrl: 'http://dep.local', contentApiKey: 'key123' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('captures Retry-After (seconds) as retryAfterMs on a 429', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('slow down', { status: 429, headers: { 'Retry-After': '5' } }));
    });

    try {
      await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' });
      expect.unreachable('expected pushMovie to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PushError);
      expect((err as PushError).status).toBe(429);
      expect((err as PushError).retryAfterMs).toBe(5000);
    }
  });

  it('leaves retryAfterMs undefined when there is no Retry-After header', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('slow down', { status: 429 }));
    });

    try {
      await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' });
      expect.unreachable('expected pushMovie to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PushError);
      expect((err as PushError).status).toBe(429);
      expect((err as PushError).retryAfterMs).toBeUndefined();
    }
  });

  it('leaves retryAfterMs undefined for a non-429 error', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('bad', { status: 400 }));
    });
    try {
      await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' });
      expect.unreachable('expected pushMovie to throw');
    } catch (err) {
      expect((err as PushError).retryAfterMs).toBeUndefined();
    }
  });
});

describe('pushEpisode', () => {
  const target = { baseUrl: 'http://dep.local', contentApiKey: 'key123' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates the series, season, and episode when none exist', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
      }
      if (u.endsWith('/api/admin/titles') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'series1' }), { status: 201 }));
      }
      if (u.endsWith('/series1/seasons')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'season1', number: 1 }), { status: 201 }));
      }
      if (u.endsWith('/series1/episodes')) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    await pushEpisode(target, {
      name: 'Some Series',
      year: 2023,
      streamPath: 'vod/some-series-s01e01.mp4',
      seasonNumber: 1,
      episodeNumber: 1,
    });

    const episodeCall = vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith('/series1/episodes'));
    expect(episodeCall).toBeDefined();
    const body = JSON.parse((episodeCall![1]?.body as string) ?? '{}');
    expect(body).toMatchObject({ seasonId: 'season1', number: 1, streamPath: 'vod/some-series-s01e01.mp4' });
  });

  it('reuses an existing series and season', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [{ id: 'series1', name: 'Some Series', year: 2023, type: 'SERIES' }] }),
            { status: 200 },
          ),
        );
      }
      if (u.endsWith('/api/admin/titles/series1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'series1', seasons: [{ id: 'season1', number: 1, episodes: [] }] }), {
            status: 200,
          }),
        );
      }
      if (u.endsWith('/series1/episodes')) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    await pushEpisode(target, {
      name: 'Some Series',
      year: 2023,
      streamPath: 'vod/some-series-s01e02.mp4',
      seasonNumber: 1,
      episodeNumber: 2,
    });

    const createCalls = vi.mocked(fetch).mock.calls.filter(([u, init]) => init?.method === 'POST' && String(u).endsWith('/api/admin/titles'));
    expect(createCalls).toHaveLength(0);
  });

  it('sends series-level metadata and resolved genreIds when creating a new series', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
      }
      if (u.endsWith('/api/admin/genres') && (!init || init.method === undefined)) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (u.endsWith('/api/admin/genres') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'genre-comedy' }), { status: 201 }));
      }
      if (u.endsWith('/api/admin/titles') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'series1' }), { status: 201 }));
      }
      if (u.endsWith('/series1/seasons')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'season1', number: 1 }), { status: 201 }));
      }
      if (u.endsWith('/series1/episodes')) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    await pushEpisode(target, {
      name: 'Friends',
      year: 1994,
      streamPath: 'tv-series/Friends (1994)/Season 1/Friends (1994) - 1x1.mp4',
      seasonNumber: 1,
      episodeNumber: 1,
      synopsis: 'Six young people...',
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      genreNames: ['Comedy'],
      isPublished: false,
    });

    const seriesCreateCall = vi
      .mocked(fetch)
      .mock.calls.find(([u, init]) => String(u).endsWith('/api/admin/titles') && init?.method === 'POST');
    const body = JSON.parse(seriesCreateCall![1]?.body as string);
    expect(body).toMatchObject({
      type: 'SERIES',
      synopsis: 'Six young people...',
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      genreIds: ['genre-comedy'],
      isPublished: false,
    });
  });

  it('re-sends series-level metadata via PUT when reusing an existing series, instead of freezing it after creation', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/titles?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [{ id: 'series1', name: 'Friends', year: 1994, type: 'SERIES' }] }), {
            status: 200,
          }),
        );
      }
      if (u.endsWith('/api/admin/genres') && (!init || init.method === undefined)) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 'genre-comedy', name: 'Comedy' }]), { status: 200 }));
      }
      if (u.endsWith('/api/admin/titles/series1') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'series1' }), { status: 200 }));
      }
      if (u.endsWith('/api/admin/titles/series1') && (!init || init.method === undefined)) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'series1', seasons: [{ id: 'season1', number: 1, episodes: [] }] }), {
            status: 200,
          }),
        );
      }
      if (u.endsWith('/series1/episodes')) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    await pushEpisode(target, {
      name: 'Friends',
      year: 1994,
      streamPath: 'tv-series/Friends (1994)/Season 1/Friends (1994) - 1x2.mp4',
      seasonNumber: 1,
      episodeNumber: 2,
      genreNames: ['Comedy'],
      trailerYoutubeId: 'abc12345678',
      rating: 'TV_14',
      creditsLeadSec: 45,
    });

    // No title create — reusing an existing series only ever PUTs, never re-creates.
    const createCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([u, init]) => init?.method === 'POST' && String(u).endsWith('/api/admin/titles'));
    expect(createCalls).toHaveLength(0);

    const putCall = vi
      .mocked(fetch)
      .mock.calls.find(([u, init]) => String(u).endsWith('/api/admin/titles/series1') && init?.method === 'PUT');
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall![1]?.body as string);
    expect(body).toMatchObject({
      type: 'SERIES',
      genreIds: ['genre-comedy'],
      trailerYoutubeId: 'abc12345678',
      rating: 'TV_14',
      creditsLeadSec: 45,
    });
  });
});
