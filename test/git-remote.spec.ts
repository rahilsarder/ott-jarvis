import { describe, expect, it } from 'vitest';
import { parseLsRemoteOutput } from '../src/lib/git-remote';

describe('parseLsRemoteOutput', () => {
  it('extracts the sha for refs/heads/main', () => {
    const output = '4f2a9c1b8e3d7a6f5c0b1e2d3a4f5c6b7d8e9f0a\trefs/heads/main\n';
    expect(parseLsRemoteOutput(output)).toBe('4f2a9c1b8e3d7a6f5c0b1e2d3a4f5c6b7d8e9f0a');
  });

  it('ignores other refs that happen to be present', () => {
    const output = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/some-other-branch',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/main',
    ].join('\n');
    expect(parseLsRemoteOutput(output)).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('returns null when main is absent', () => {
    expect(parseLsRemoteOutput('')).toBeNull();
  });
});
