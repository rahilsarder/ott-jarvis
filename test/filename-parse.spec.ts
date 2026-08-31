import { describe, expect, it } from 'vitest';
import { parseEpisodePath, parseMoviePath } from '../src/lib/filename-parse';

describe('parseMoviePath', () => {
  it('parses a clean title/year folder with a scene-release filename', () => {
    expect(
      parseMoviePath(
        "bollywood/2021/Haseen Dillruba (2021)/Haseen Dillruba 2021 1080p NF WEB-DL Hindi-Eng DDP5.1 Atmos H.264-TombDoc.mp4",
      ),
    ).toEqual({ name: 'Haseen Dillruba', year: 2021 });
  });

  it('parses a dotted scene-release filename the same way, from the folder', () => {
    expect(
      parseMoviePath('bollywood/2026/Aakhri Sawal (2026)/Aakhri.Sawal.2026.1080p.Hindi.AAC.h264.ESub.mp4'),
    ).toEqual({ name: 'Aakhri Sawal', year: 2026 });
  });

  it('preserves a colon in the title', () => {
    expect(
      parseMoviePath(
        'hollywood/2026/Your Fault: London (2026)/Your.Fault.London.2026.2160p.AMZN.WEB-DL.DDP5.1.Atmos.H.265-FLUX.mp4',
      ),
    ).toEqual({ name: 'Your Fault: London', year: 2026 });
  });

  it('trusts the folder year over the grandparent year-bucket when they disagree', () => {
    // Real case: sits inside .../hollywood/2021/ but the film is a 2022 release.
    expect(parseMoviePath('hollywood/2021/Cinemaa Zindabad (2022)/Cinemaa.Zindabad.2022.1080p.mp4')).toEqual({
      name: 'Cinemaa Zindabad',
      year: 2022,
    });
  });

  it('trims a trailing space left on the folder name', () => {
    // Real case: the FTP folder is literally "Mercy (2026) " with a trailing space.
    expect(parseMoviePath('hollywood/2026/Mercy (2026) /Mercy.2026.1080p.mp4')).toEqual({
      name: 'Mercy',
      year: 2026,
    });
  });

  it('trims a leading and trailing space and preserves a colon', () => {
    // Real case: " From the Ashes: The Pit (2026) " (leading + trailing space).
    expect(
      parseMoviePath(
        'hollywood/2026/ From the Ashes: The Pit (2026) /From.the.Ashes.The.Pit.2026.1080p.mp4',
      ),
    ).toEqual({ name: 'From the Ashes: The Pit', year: 2026 });
  });

  it('preserves an apostrophe in the title', () => {
    expect(parseMoviePath("hollywood/2026/Lee Cronin's The Mummy (2026)/movie.mp4")).toEqual({
      name: "Lee Cronin's The Mummy",
      year: 2026,
    });
  });

  it('does not mistake a numeric title for a bare year', () => {
    // Real case: the film is literally titled "83".
    expect(parseMoviePath('bollywood/2021/83 (2021)/83.2021.1080p.mp4')).toEqual({ name: '83', year: 2021 });
  });

  it('returns a null year when the folder has no year in parens at all', () => {
    // Real case: "Firebreak/" with no "(YYYY)" suffix.
    expect(parseMoviePath('hollywood/2026/Firebreak/Firebreak.2026.1080p.mp4')).toEqual({
      name: 'Firebreak',
      year: null,
    });
  });

  it('returns null when there is no parent folder to read a title from', () => {
    expect(parseMoviePath('movie.mp4')).toBeNull();
  });

  it('returns null when the folder segment is empty', () => {
    expect(parseMoviePath('hollywood/2026//movie.mp4')).toBeNull();
  });
});

describe('parseEpisodePath', () => {
  it('parses a real season of episodes', () => {
    // Real case: every file in tv-series/Friends (1994)/Season 1/.
    expect(parseEpisodePath('tv-series/Friends (1994)/Season 1/Friends (1994) - 1x10.mp4')).toEqual({
      name: 'Friends',
      year: 1994,
      seasonNumber: 1,
      episodeNumber: 10,
    });
  });

  it('parses a single-digit, non-zero-padded episode number', () => {
    // Real case: "Friends (1994) - 1x1.mp4", not "1x01".
    expect(parseEpisodePath('tv-series/Friends (1994)/Season 1/Friends (1994) - 1x1.mp4')).toEqual({
      name: 'Friends',
      year: 1994,
      seasonNumber: 1,
      episodeNumber: 1,
    });
  });

  it('reads a season into double digits correctly', () => {
    expect(parseEpisodePath('tv-series/Friends (1994)/Season 10/Friends (1994) - 10x5.mp4')).toEqual({
      name: 'Friends',
      year: 1994,
      seasonNumber: 10,
      episodeNumber: 5,
    });
  });

  it('tolerates whitespace inside the parens around the year', () => {
    // Real case: the folder is literally "Territory ( 2024 )".
    expect(parseEpisodePath('tv-series/Territory ( 2024 )/Season 1/Territory - 1x1.mp4')).toEqual({
      name: 'Territory',
      year: 2024,
      seasonNumber: 1,
      episodeNumber: 1,
    });
  });

  it('trims leading/trailing whitespace on the series folder and preserves a colon', () => {
    // Real case: " A Knight of the Seven Kingdoms (2026) ".
    expect(
      parseEpisodePath('tv-series/ A Knight of the Seven Kingdoms (2026) /Season 1/AKOTSK - 1x1.mp4'),
    ).toEqual({ name: 'A Knight of the Seven Kingdoms', year: 2026, seasonNumber: 1, episodeNumber: 1 });
  });

  it('handles a series folder with no year at all', () => {
    // Real case: "My Boss/" with no "(YYYY)" suffix.
    expect(parseEpisodePath('tv-series/My Boss/Season 1/My Boss - 1x1.mp4')).toEqual({
      name: 'My Boss',
      year: null,
      seasonNumber: 1,
      episodeNumber: 1,
    });
  });

  it('returns null when the filename has no SxE marker', () => {
    expect(parseEpisodePath('tv-series/Friends (1994)/Season 1/Friends (1994) - episode one.mp4')).toBeNull();
  });

  it('returns null when there is no series folder to read a title from', () => {
    expect(parseEpisodePath('Season 1/episode.mp4')).toBeNull();
  });
});
