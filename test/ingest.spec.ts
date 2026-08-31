import { describe, expect, it } from 'vitest';
import { classifyPath, buildContentItemData, MOVIE_CATEGORIES } from '../src/lib/ingest';

describe('classifyPath', () => {
  it('accepts a movie under an allowlisted category', () => {
    expect(classifyPath('bollywood/2021/Haseen Dillruba (2021)/Haseen.Dillruba.2021.1080p.mp4')).toEqual({
      ok: true,
      kind: 'MOVIE',
      category: 'bollywood',
      parsed: { name: 'Haseen Dillruba', year: 2021 },
    });
  });

  it('accepts every allowlisted movie category', () => {
    for (const category of MOVIE_CATEGORIES) {
      const result = classifyPath(`${category}/2021/Some Film (2021)/some.film.mp4`);
      expect(result.ok, `${category} should be ingestable`).toBe(true);
    }
  });

  it('is case-insensitive about the category directory', () => {
    expect(classifyPath('Bollywood/2021/Some Film (2021)/some.mp4').ok).toBe(true);
  });

  it.each([
    'torrent/whatever/file.mp4',
    'ffmpeg/output.mp4',
    'ffmpeg-encoded/output.mp4',
    'downloads/thing.mp4',
    'games/setup.mp4',
    'software/installer.mp4',
    'Subtitles/movie.mp4',
    'lancache/blob.mp4',
    'watch2/clip.mp4',
    'watch3/clip.mp4',
    '.hls/segment.mp4',
    '.sync/file.mp4',
    'Emby Backup - 2022-12-12 00.10.0 - Auto/data.mp4',
    'ftp/upload.mp4',
    'FTP/upload.mp4',
  ])('rejects the non-content directory %s', (path) => {
    const result = classifyPath(path);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-video file even inside a content category', () => {
    expect(classifyPath('bollywood/2021/Haseen Dillruba (2021)/poster.jpg').ok).toBe(false);
    expect(classifyPath('bollywood/2021/Haseen Dillruba (2021)/subtitles.srt').ok).toBe(false);
  });

  it('accepts the common video containers', () => {
    for (const ext of ['mp4', 'mkv', 'avi', 'm4v', 'mov']) {
      expect(classifyPath(`bollywood/2021/Film (2021)/film.${ext}`).ok, ext).toBe(true);
    }
  });

  it('rejects a file sitting directly in a category with no title folder', () => {
    expect(classifyPath('bollywood/loose-file.mp4').ok).toBe(false);
  });

  it('reports series categories as not yet supported rather than mis-ingesting them as movies', () => {
    const result = classifyPath('tv-series/Some Show/Season 1/S01E01.mkv');
    expect(result).toEqual({ ok: false, reason: 'series-not-supported' });
  });

  it('rejects a path that escapes the root', () => {
    expect(classifyPath('bollywood/../../etc/passwd.mp4').ok).toBe(false);
    expect(classifyPath('/absolute/bollywood/2021/Film (2021)/f.mp4').ok).toBe(false);
  });
});

describe('buildContentItemData', () => {
  const parsed = { name: 'Haseen Dillruba', year: 2021 };
  const sourcePath = 'bollywood/2021/Haseen Dillruba (2021)/Haseen.Dillruba.2021.1080p.mp4';

  const meta = {
    tmdbId: 550,
    name: 'Haseen Dillruba',
    year: 2021,
    synopsis: 'A wife becomes the prime suspect.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
    genreNames: ['Crime', 'Mystery'],
    confident: true,
  };

  it('uses TMDB name, year and artwork on a confident match, and publishes it', () => {
    expect(buildContentItemData(sourcePath, parsed, meta)).toEqual({
      kind: 'MOVIE',
      name: 'Haseen Dillruba',
      year: 2021,
      streamPath: sourcePath,
      sourcePath,
      tmdbId: 550,
      synopsis: 'A wife becomes the prime suspect.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      genreNames: ['Crime', 'Mystery'],
      isPublished: true,
    });
  });

  it('keeps the enrichment but withholds publication on an unconfident match', () => {
    const data = buildContentItemData(sourcePath, parsed, { ...meta, confident: false });
    expect(data.isPublished).toBe(false);
    expect(data.tmdbId).toBe(550);
  });

  it('keeps the parsed name and year when the match is unconfident', () => {
    // Trusting a doubtful TMDB title would rename the film on every customer's site.
    const data = buildContentItemData(sourcePath, parsed, {
      ...meta,
      name: 'Some Other Film',
      year: 1998,
      confident: false,
    });
    expect(data.name).toBe('Haseen Dillruba');
    expect(data.year).toBe(2021);
  });

  it('falls back to the parsed values and stays unpublished when TMDB found nothing', () => {
    expect(buildContentItemData(sourcePath, parsed, null)).toEqual({
      kind: 'MOVIE',
      name: 'Haseen Dillruba',
      year: 2021,
      streamPath: sourcePath,
      sourcePath,
      tmdbId: null,
      synopsis: null,
      posterUrl: null,
      backdropUrl: null,
      genreNames: [],
      isPublished: false,
    });
  });

  it('uses the source path verbatim as the stream path', () => {
    // The FTP tree maps directly onto Flussonic stream paths — no translation.
    const data = buildContentItemData(sourcePath, parsed, meta);
    expect(data.streamPath).toBe(sourcePath);
  });
});
