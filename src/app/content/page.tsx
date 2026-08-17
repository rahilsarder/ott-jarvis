'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface PushAttemptRow {
  id: string;
  status: string;
  errorMessage: string | null;
  deployment: { id: string; name: string };
}

interface ContentItemRow {
  id: string;
  kind: 'MOVIE' | 'EPISODE';
  name: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  submittedAt: string;
  pushAttempts: PushAttemptRow[];
}

const emptyForm = {
  kind: 'MOVIE' as 'MOVIE' | 'EPISODE',
  name: '',
  year: '',
  streamPath: '',
  seasonNumber: '',
  episodeNumber: '',
};

export default function ContentPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const { data: items } = useQuery({
    queryKey: ['content'],
    queryFn: () => fetch('/api/content').then((r) => r.json() as Promise<ContentItemRow[]>),
    // Push status is advanced by the worker out-of-band, so without this a freshly submitted item's
    // badges never move without a manual reload. Flat interval rather than the deployments page's
    // conditional polling: there is no clean "stop" signal here (something may always be pending),
    // and continuous lightweight polling while the page is open matches the design's
    // "simple polling, not websockets" approach.
    refetchInterval: 3000,
  });

  const submit = useMutation({
    mutationFn: () =>
      fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: form.kind,
          name: form.name,
          year: form.year ? Number(form.year) : undefined,
          streamPath: form.streamPath,
          seasonNumber: form.kind === 'EPISODE' ? Number(form.seasonNumber) : undefined,
          episodeNumber: form.kind === 'EPISODE' ? Number(form.episodeNumber) : undefined,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['content'] });
      setForm(emptyForm);
    },
  });

  const retry = useMutation({
    mutationFn: (id: string) => fetch(`/api/content/${id}/retry`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['content'] }),
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Content</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
        className="space-y-2 rounded border border-neutral-800 p-4"
      >
        <div className="flex gap-2">
          <select
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'MOVIE' | 'EPISODE' }))}
            className="rounded bg-neutral-900 px-3 py-2 text-sm"
          >
            <option value="MOVIE">Movie</option>
            <option value="EPISODE">Episode</option>
          </select>
          <input
            required
            placeholder={form.kind === 'MOVIE' ? 'Movie name' : 'Series name'}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            placeholder="Year"
            value={form.year}
            onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
            className="w-24 rounded bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <input
          required
          placeholder="Stream path (e.g. vod/some-movie.mp4)"
          value={form.streamPath}
          onChange={(e) => setForm((f) => ({ ...f, streamPath: e.target.value }))}
          className="w-full rounded bg-neutral-900 px-3 py-2 text-sm"
        />
        {form.kind === 'EPISODE' && (
          <div className="flex gap-2">
            <input
              required
              placeholder="Season #"
              value={form.seasonNumber}
              onChange={(e) => setForm((f) => ({ ...f, seasonNumber: e.target.value }))}
              className="w-28 rounded bg-neutral-900 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Episode #"
              value={form.episodeNumber}
              onChange={(e) => setForm((f) => ({ ...f, episodeNumber: e.target.value }))}
              className="w-28 rounded bg-neutral-900 px-3 py-2 text-sm"
            />
          </div>
        )}
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium">
          Push
        </button>
      </form>

      <div className="space-y-3">
        {items?.map((item) => (
          <div key={item.id} className="rounded border border-neutral-800 p-3">
            <p className="text-sm font-medium">
              {item.name}
              {item.year ? ` (${item.year})` : ''}
              {item.kind === 'EPISODE' ? ` — S${item.seasonNumber}E${item.episodeNumber}` : ''}
            </p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {item.pushAttempts.map((pa) => (
                <span
                  key={pa.id}
                  className={
                    'rounded px-2 py-0.5 ' +
                    (pa.status === 'SUCCESS'
                      ? 'bg-emerald-900 text-emerald-300'
                      : pa.status === 'FAILED'
                        ? 'bg-red-900 text-red-300'
                        : 'bg-neutral-800 text-neutral-300')
                  }
                  title={pa.errorMessage ?? undefined}
                >
                  {pa.deployment.name}: {pa.status}
                </span>
              ))}
              {item.pushAttempts.some((pa) => pa.status === 'FAILED') && (
                <button
                  onClick={() => retry.mutate(item.id)}
                  className="rounded bg-amber-700 px-2 py-0.5 text-xs font-medium"
                >
                  Retry failed
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
