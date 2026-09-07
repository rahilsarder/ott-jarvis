'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface SearchHit {
  tmdbId: number;
  name: string;
  year: number | null;
  posterUrl: string | null;
  overview: string;
}

export interface TitleDetail {
  tmdbId: number;
  name: string;
  year: number | null;
  synopsis: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  trailerYoutubeId: string | null;
  rating: string | null;
  durationSec: number | null;
  genreNames: string[];
}

interface Props {
  /** 'movie' searches TMDB movies; 'tv' searches TMDB series — for an EPISODE this searches the
   *  show itself, matching how the automated FTP pipeline enriches at the series level too. */
  kind: 'movie' | 'tv';
  onApply: (detail: TitleDetail) => void;
}

/**
 * Search TMDB, preview a match, and hand it to the parent form to apply — the same
 * search→preview→apply shape as the OTT admin panel's TmdbPanel, minus the parts that don't
 * transfer to Jarvis (no local Genre table to reconcile against, no cast/crew, no image upload —
 * Jarvis just carries TMDB's own URLs straight through).
 */
export function TmdbSearchPanel({ kind, onApply }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: status } = useQuery({
    queryKey: ['tmdb-status'],
    queryFn: () => fetch('/api/tmdb/status').then((r) => r.json() as Promise<{ configured: boolean }>),
    staleTime: 60_000,
  });

  const { data: detail, isFetching: loadingDetail } = useQuery({
    queryKey: ['tmdb-detail', kind, selectedId],
    queryFn: () =>
      fetch(`/api/tmdb/detail?kind=${kind}&tmdbId=${selectedId}`).then((r) => r.json() as Promise<TitleDetail>),
    enabled: selectedId !== null,
  });

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSelectedId(null);
    try {
      const res = await fetch(`/api/tmdb/search?kind=${kind}&q=${encodeURIComponent(query.trim())}`);
      setResults(res.ok ? await res.json() : []);
    } finally {
      setSearching(false);
    }
  };

  if (status && !status.configured) {
    return (
      <div className="rounded border border-neutral-800 p-4 text-sm text-neutral-500">
        TMDB is not configured on this Jarvis instance — set <code className="text-neutral-400">TMDB_API_KEY</code>{' '}
        in its <code className="text-neutral-400">.env</code> to enable search.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded border border-neutral-800 p-4">
      <p className="text-xs font-medium text-neutral-400">Search TMDB</p>
      <div className="flex gap-2">
        <input
          placeholder={kind === 'movie' ? 'e.g. Haseen Dillruba' : 'e.g. Friends'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())}
          className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm outline-none ring-1 ring-transparent transition-shadow focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching || query.trim().length < 2}
          className="rounded bg-neutral-700 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-600 disabled:opacity-60"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {results.map((hit) => (
            <button
              key={hit.tmdbId}
              type="button"
              onClick={() => setSelectedId(hit.tmdbId)}
              className={
                'flex gap-2 rounded border p-2 text-left text-xs transition-colors ' +
                (selectedId === hit.tmdbId
                  ? 'border-blue-500 bg-blue-950/40'
                  : 'border-neutral-800 hover:border-neutral-700')
              }
            >
              {hit.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hit.posterUrl} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-20 w-14 shrink-0 rounded bg-neutral-800" />
              )}
              <div className="min-w-0">
                <p className="font-medium text-neutral-200">
                  {hit.name}
                  {hit.year ? ` (${hit.year})` : ''}
                </p>
                <p className="mt-0.5 line-clamp-3 text-neutral-500">{hit.overview || 'No overview available.'}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId !== null && (
        <div className="rounded border border-blue-900 bg-blue-950/20 p-3">
          {loadingDetail && <p className="text-xs text-neutral-500">Loading preview…</p>}
          {detail && (
            <div className="flex gap-3">
              {detail.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.posterUrl} alt="" className="h-32 w-24 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-32 w-24 shrink-0 rounded bg-neutral-800" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">
                  {detail.name}
                  {detail.year ? ` (${detail.year})` : ''}
                </p>
                {(detail.genreNames.length > 0 || detail.rating || detail.durationSec || detail.trailerYoutubeId) && (
                  <div className="flex flex-wrap gap-1">
                    {detail.rating && (
                      <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{detail.rating}</span>
                    )}
                    {detail.durationSec && (
                      <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                        {Math.round(detail.durationSec / 60)} min
                      </span>
                    )}
                    {detail.trailerYoutubeId && (
                      <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">Trailer found</span>
                    )}
                    {detail.genreNames.map((g) => (
                      <span key={g} className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                        {g}
                      </span>
                    ))}
                  </div>
                )}
                <p className="line-clamp-3 text-xs text-neutral-400">{detail.synopsis || 'No synopsis available.'}</p>
                <button
                  type="button"
                  onClick={() => onApply(detail)}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-emerald-600"
                >
                  Apply to this submission
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
