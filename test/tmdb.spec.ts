import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTitleDetail, lookupMovie, lookupSeries, posterUrl, backdropUrl, searchTitles } from '../src/lib/tmdb';

const config = { apiKey: 'test-key', language: 'en-US' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const SEARCH_HIT = {
  id: 550,
  title: 'Haseen Dillruba',
  release_date: '2021-07-02',
};

const DETAIL = {
  id: 550,
  title: 'Haseen Dillruba',
  release_date: '2021-07-02',
  overview: 'A wife becomes the prime suspect in her husband’s murder.',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  genres: [
    { id: 80, name: 'Crime' },
    { id: 9648, name: 'Mystery' },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image URL helpers', () => {
  it('builds absolute CDN URLs at the same sizes the OTT app uses', () => {
    expect(posterUrl('/poster.jpg')).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
    expect(backdropUrl('/backdrop.jpg')).toBe('https://image.tmdb.org/t/p/w1280/backdrop.jpg');
  });

  it('returns null for a missing path rather than a broken URL', () => {
    expect(posterUrl(null)).toBeNull();
    expect(backdropUrl(undefined)).toBeNull();
  });
});

describe('lookupMovie', () => {
  it('returns confident metadata when the title and year both match', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(DETAIL));

    const result = await lookupMovie(config, 'Haseen Dillruba', 2021);

    expect(result).toEqual({
      tmdbId: 550,
      name: 'Haseen Dillruba',
      year: 2021,
      synopsis: 'A wife becomes the prime suspect in her husband’s murder.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
      genreNames: ['Crime', 'Mystery'],
      confident: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not constrain the search by year, which silently destroys recall', async () => {
    // Verified against the live API: a folder-year/TMDB-year mismatch of even one year makes a
    // primary_release_year-filtered search return zero results for titles that do exist
    // ("Cinemaa Zindabad" is 2021 on TMDB but 2022 on disk). The year is for ranking, not filtering.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(DETAIL));

    await lookupMovie(config, 'Haseen Dillruba', 2021);

    const [url] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain('primary_release_year');
  });

  it('prefers a lower-ranked result whose title and year both match over the top hit', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: 1, title: 'Haseen Dillruba', release_date: '1975-01-01' },
            { id: 2, title: 'Haseen Dillruba', release_date: '2021-07-02' },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, id: 2 }));

    const result = await lookupMovie(config, 'Haseen Dillruba', 2021);

    expect(result?.tmdbId).toBe(2);
    expect(result?.confident).toBe(true);
    const [detailUrl] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(String(detailUrl)).toContain('/movie/2');
  });

  it('falls back to a title match when no candidate year is close', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: 1, title: 'Completely Different', release_date: '2021-01-01' },
            { id: 2, title: 'Haseen Dillruba', release_date: '1975-01-01' },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, id: 2, release_date: '1975-01-01' }));

    const result = await lookupMovie(config, 'Haseen Dillruba', 2021);

    expect(result?.tmdbId).toBe(2);
    // Title matched but the year is far off, so this must not be trusted as live content.
    expect(result?.confident).toBe(false);
  });

  it('sends the v3 key as a query parameter and never in a header', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(DETAIL));

    await lookupMovie(config, 'Haseen Dillruba', 2021);

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('api_key=test-key');
    expect((init?.headers as Record<string, string>)?.authorization).toBeUndefined();
  });

  it('sends a v4 token as a bearer header, keeping it out of the URL', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(DETAIL));

    await lookupMovie({ apiKey: 'eyJhbGciOi.test.token' }, 'Haseen Dillruba', 2021);

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain('eyJhbGciOi');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer eyJhbGciOi.test.token');
  });

  it('matches titles that differ only by punctuation, case, or diacritics', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, title: 'Your Fault: London' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, title: 'Your Fault: London' }));

    // Folder name lacks the colon; TMDB has it.
    const result = await lookupMovie(config, 'Your Fault London', 2021);
    expect(result?.confident).toBe(true);
  });

  it('matches titles that differ only in how initials are punctuated', async () => {
    // Real case: the folder is "BA Pass 3", TMDB has "B.A. Pass 3" — the same film.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, title: 'B.A. Pass 3' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, title: 'B.A. Pass 3' }));

    const result = await lookupMovie(config, 'BA Pass 3', 2021);
    expect(result?.confident).toBe(true);
  });

  it('still rejects a genuinely different title of similar shape', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, title: 'Tribhanga' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, title: 'Tribhanga' }));

    // Real case: folder carries a subtitle TMDB does not — too different to trust blindly.
    const result = await lookupMovie(config, 'Tribhanga Tedhi Medhi Crazy', 2021);
    expect(result?.confident).toBe(false);
  });

  it('accepts a release year one off from the folder year', async () => {
    // Festival/regional release dates routinely differ from the library's year.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, release_date: '2020-12-20' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, release_date: '2020-12-20' }));

    const result = await lookupMovie(config, 'Haseen Dillruba', 2021);
    expect(result?.confident).toBe(true);
    expect(result?.year).toBe(2020);
  });

  it('is unconfident when the year is far off, but still returns the metadata', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, release_date: '1998-01-01' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, release_date: '1998-01-01' }));

    const result = await lookupMovie(config, 'Haseen Dillruba', 2021);
    expect(result?.confident).toBe(false);
    expect(result?.tmdbId).toBe(550);
  });

  it('is unconfident when the top result is a different title', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, title: 'Something Else Entirely' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...DETAIL, title: 'Something Else Entirely' }));

    const result = await lookupMovie(config, 'Haseen Dillruba', 2021);
    expect(result?.confident).toBe(false);
  });

  it('is confident on an exact title match when the folder had no year at all', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(DETAIL));

    const result = await lookupMovie(config, 'Haseen Dillruba', null);
    expect(result?.confident).toBe(true);
  });

  it('returns null when TMDB has no results at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ results: [] }));

    expect(await lookupMovie(config, 'No Such Film', 2021)).toBeNull();
  });

  it('throws on a rejected API key rather than silently degrading', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ status_message: 'Invalid key' }, 401));

    await expect(lookupMovie(config, 'Haseen Dillruba', 2021)).rejects.toThrow(/401/);
  });

  it('throws when TMDB rate-limits the lookup', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({}, 429));

    await expect(lookupMovie(config, 'Haseen Dillruba', 2021)).rejects.toThrow(/429/);
  });
});

const TV_SEARCH_HIT = { id: 1668, name: 'Friends', first_air_date: '1994-09-22' };
const TV_DETAIL = {
  id: 1668,
  name: 'Friends',
  first_air_date: '1994-09-22',
  overview: 'Six young people, on their own and struggling to survive in the real world...',
  poster_path: '/tv-poster.jpg',
  backdrop_path: '/tv-backdrop.jpg',
  genres: [{ id: 35, name: 'Comedy' }],
};

describe('lookupSeries', () => {
  it('returns confident metadata when the title and year both match, using TV field names', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [TV_SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(TV_DETAIL));

    const result = await lookupSeries(config, 'Friends', 1994);

    expect(result).toEqual({
      tmdbId: 1668,
      name: 'Friends',
      year: 1994,
      synopsis: 'Six young people, on their own and struggling to survive in the real world...',
      posterUrl: 'https://image.tmdb.org/t/p/w500/tv-poster.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/tv-backdrop.jpg',
      genreNames: ['Comedy'],
      confident: true,
    });
  });

  it('searches /search/tv and fetches /tv/:id, not the movie endpoints', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [TV_SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(TV_DETAIL));

    await lookupSeries(config, 'Friends', 1994);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/search/tv');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/tv/1668');
  });

  it('is unconfident when the top result is a different series', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...TV_SEARCH_HIT, name: 'Something Else' }] }))
      .mockResolvedValueOnce(jsonResponse({ ...TV_DETAIL, name: 'Something Else' }));

    const result = await lookupSeries(config, 'Friends', 1994);
    expect(result?.confident).toBe(false);
  });

  it('returns null when TMDB has no results at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ results: [] }));
    expect(await lookupSeries(config, 'No Such Show', 2024)).toBeNull();
  });

  it('is confident on an exact title match when the series folder had no year at all', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [TV_SEARCH_HIT] }))
      .mockResolvedValueOnce(jsonResponse(TV_DETAIL));

    const result = await lookupSeries(config, 'Friends', null);
    expect(result?.confident).toBe(true);
  });
});

describe('searchTitles', () => {
  it('returns a normalized list for a movie search, without a second request', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ ...SEARCH_HIT, poster_path: '/poster.jpg', overview: 'A synopsis.' }] }));

    const results = await searchTitles(config, 'movie', 'Haseen Dillruba');

    expect(results).toEqual([
      {
        tmdbId: 550,
        name: 'Haseen Dillruba',
        year: 2021,
        posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        overview: 'A synopsis.',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/search/movie');
  });

  it('returns a normalized list for a tv search using TV field names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ results: [{ ...TV_SEARCH_HIT, poster_path: '/tv.jpg', overview: 'Six friends.' }] }),
    );

    const results = await searchTitles(config, 'tv', 'Friends');

    expect(results).toEqual([
      { tmdbId: 1668, name: 'Friends', year: 1994, posterUrl: 'https://image.tmdb.org/t/p/w500/tv.jpg', overview: 'Six friends.' },
    ]);
  });

  it('returns an empty list rather than throwing when TMDB has no results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ results: [] }));
    expect(await searchTitles(config, 'movie', 'Nothing Like This Exists')).toEqual([]);
  });

  it('handles a missing poster and overview without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ results: [{ id: 1, title: 'Bare Result' }] }),
    );
    const results = await searchTitles(config, 'movie', 'Bare Result');
    expect(results).toEqual([{ tmdbId: 1, name: 'Bare Result', year: null, posterUrl: null, overview: '' }]);
  });
});

describe('getTitleDetail', () => {
  it('returns full metadata for a movie, with no confidence field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(DETAIL));

    const detail = await getTitleDetail(config, 'movie', 550);

    expect(detail).toEqual({
      tmdbId: 550,
      name: 'Haseen Dillruba',
      year: 2021,
      synopsis: 'A wife becomes the prime suspect in her husband’s murder.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
      genreNames: ['Crime', 'Mystery'],
    });
    expect(detail).not.toHaveProperty('confident');
  });

  it('returns full metadata for a tv series, fetching /tv/:id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(TV_DETAIL));

    const detail = await getTitleDetail(config, 'tv', 1668);

    expect(detail.name).toBe('Friends');
    expect(detail.genreNames).toEqual(['Comedy']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/tv/1668');
  });

  it('throws on a non-ok response, same as lookupMovie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(getTitleDetail(config, 'movie', 999999)).rejects.toThrow(/404/);
  });
});
