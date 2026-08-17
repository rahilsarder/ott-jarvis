import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushEpisode, pushMovie, slugify } from '../src/lib/deployment-client';

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

  it('POSTs the movie with the X-Api-Key header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 201 }));
    await pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
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

  it('throws on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('bad request', { status: 400 }));
    await expect(
      pushMovie(target, { name: 'Some Movie', year: 2024, streamPath: 'vod/some-movie.mp4' }),
    ).rejects.toThrow();
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
});
