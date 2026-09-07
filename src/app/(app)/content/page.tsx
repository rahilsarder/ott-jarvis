'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TmdbSearchPanel, type TitleDetail } from '@/components/TmdbSearchPanel';
import { MATURITY_RATINGS } from '@/lib/content-schema';

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
  streamPath: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  trailerYoutubeId: string | null;
  rating: string | null;
  durationSec: number | null;
  creditsLeadSec: number | null;
  genreNames: string[];
  isPublished: boolean;
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
  synopsis: '',
  posterUrl: '',
  backdropUrl: '',
  logoUrl: '',
  trailerYoutubeId: '',
  rating: '',
  // MOVIE only — shown/edited in minutes, stored on the wire in seconds.
  durationMinutes: '',
  // EPISODE only (series-level).
  creditsLeadSec: '',
  genreNames: [] as string[],
  isPublished: true,
};

type FormState = typeof emptyForm;

function toFormState(item: ContentItemRow): FormState {
  return {
    kind: item.kind,
    name: item.name,
    year: item.year ? String(item.year) : '',
    streamPath: item.streamPath,
    seasonNumber: item.seasonNumber ? String(item.seasonNumber) : '',
    episodeNumber: item.episodeNumber ? String(item.episodeNumber) : '',
    synopsis: item.synopsis ?? '',
    posterUrl: item.posterUrl ?? '',
    backdropUrl: item.backdropUrl ?? '',
    logoUrl: item.logoUrl ?? '',
    trailerYoutubeId: item.trailerYoutubeId ?? '',
    rating: item.rating ?? '',
    durationMinutes: item.durationSec ? String(Math.round(item.durationSec / 60)) : '',
    creditsLeadSec: item.creditsLeadSec !== null ? String(item.creditsLeadSec) : '',
    genreNames: item.genreNames,
    isPublished: item.isPublished,
  };
}

function toRequestBody(form: FormState) {
  return {
    kind: form.kind,
    name: form.name,
    year: form.year ? Number(form.year) : undefined,
    streamPath: form.streamPath,
    seasonNumber: form.kind === 'EPISODE' ? Number(form.seasonNumber) : undefined,
    episodeNumber: form.kind === 'EPISODE' ? Number(form.episodeNumber) : undefined,
    synopsis: form.synopsis || undefined,
    posterUrl: form.posterUrl || undefined,
    backdropUrl: form.backdropUrl || undefined,
    logoUrl: form.logoUrl || undefined,
    trailerYoutubeId: form.trailerYoutubeId || undefined,
    rating: form.rating || undefined,
    durationSec: form.kind === 'MOVIE' && form.durationMinutes ? Number(form.durationMinutes) * 60 : undefined,
    creditsLeadSec: form.kind === 'EPISODE' && form.creditsLeadSec ? Number(form.creditsLeadSec) : undefined,
    genreNames: form.genreNames.length > 0 ? form.genreNames : undefined,
    isPublished: form.isPublished,
  };
}

// Deliberately no width utility here — every call site supplies its own (flex-1, w-24, w-full,
// etc). Baking w-full in here once caused every sized input in a flex row to collapse to
// padding-only width, since Tailwind v4 generates w-full's rule after flex-1/w-24/w-28's in the
// cascade, so it silently won regardless of which class appeared first in the JSX string.
const inputClass =
  'rounded bg-neutral-900 px-3 py-2 text-sm outline-none ring-1 ring-transparent transition-shadow focus:ring-blue-500';

export default function ContentPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [genreInput, setGenreInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [editGenreInput, setEditGenreInput] = useState('');

  const { data: items, isLoading } = useQuery({
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
        body: JSON.stringify(toRequestBody(form)),
      }).then((r) => {
        if (!r.ok) throw new Error('Push failed');
        return r.json();
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['content'] });
      setForm(emptyForm);
      setGenreInput('');
    },
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toRequestBody(editForm)),
      }).then((r) => {
        if (!r.ok) throw new Error('Save failed');
        return r.json();
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['content'] });
      setEditingId(null);
    },
  });

  const retry = useMutation({
    mutationFn: (id: string) => fetch(`/api/content/${id}/retry`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['content'] }),
  });

  const applyTmdb = (detail: TitleDetail) => {
    setForm((f) => ({
      ...f,
      name: detail.name,
      year: detail.year ? String(detail.year) : f.year,
      synopsis: detail.synopsis,
      posterUrl: detail.posterUrl ?? '',
      backdropUrl: detail.backdropUrl ?? '',
      logoUrl: detail.logoUrl ?? '',
      trailerYoutubeId: detail.trailerYoutubeId ?? '',
      rating: detail.rating ?? '',
      durationMinutes: detail.durationSec ? String(Math.round(detail.durationSec / 60)) : f.durationMinutes,
      genreNames: detail.genreNames,
    }));
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Content</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Push a title by hand — the same TMDB metadata and confidence the FTP watcher applies
          automatically, and a fallback path if it's down.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
        className="space-y-3 rounded border border-neutral-800 p-4"
      >
        <select
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'MOVIE' | 'EPISODE' }))}
          className={`w-full ${inputClass}`}
        >
          <option value="MOVIE">Movie</option>
          <option value="EPISODE">Episode</option>
        </select>

        <TmdbSearchPanel key={form.kind} kind={form.kind === 'MOVIE' ? 'movie' : 'tv'} onApply={applyTmdb} />

        <ContentFields form={form} setForm={setForm} genreInput={genreInput} setGenreInput={setGenreInput} />

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submit.isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-60"
          >
            {submit.isPending ? 'Pushing…' : 'Push'}
          </button>
          {submit.isError && <p className="text-xs text-red-400">Push failed — check the fields and try again.</p>}
        </div>
      </form>

      {isLoading && <p className="text-sm text-neutral-500">Loading content…</p>}
      {!isLoading && items?.length === 0 && (
        <p className="text-sm text-neutral-500">
          No content submitted yet — use the form above to push a movie or episode to every active deployment.
        </p>
      )}

      <div className="space-y-3">
        {items?.map((item) => {
          const failedAttempts = item.pushAttempts.filter((pa) => pa.errorMessage);
          return (
            <div key={item.id} className="rounded border border-neutral-800 transition-colors hover:border-neutral-700">
              <div className="flex gap-3 p-3">
                {item.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.posterUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-16 w-11 shrink-0 rounded bg-neutral-900" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {item.name}
                    {item.year ? ` (${item.year})` : ''}
                    {item.kind === 'EPISODE' ? ` — S${item.seasonNumber}E${item.episodeNumber}` : ''}
                    <span
                      className={
                        'ml-2 rounded px-1.5 py-0.5 text-xs font-normal ' +
                        (item.isPublished ? 'bg-emerald-950 text-emerald-400' : 'bg-neutral-800 text-neutral-400')
                      }
                    >
                      {item.isPublished ? 'Published' : 'Unpublished'}
                    </span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
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
                      >
                        {pa.deployment.name}: {pa.status}
                      </span>
                    ))}
                    {item.pushAttempts.some((pa) => pa.status === 'FAILED') && (
                      <button
                        onClick={() => retry.mutate(item.id)}
                        disabled={retry.isPending}
                        className="rounded bg-amber-700 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-amber-600 disabled:opacity-60"
                      >
                        Retry failed
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditingId((current) => (current === item.id ? null : item.id));
                        setEditForm(toFormState(item));
                        setEditGenreInput('');
                      }}
                      className="rounded bg-neutral-700 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-neutral-600"
                    >
                      {editingId === item.id ? 'Cancel' : 'Edit'}
                    </button>
                  </div>
                  {/* Visible, not just a hover tooltip — a push failure (or a stale error from
                      before a retry that hasn't landed yet) should be readable at a glance. */}
                  {failedAttempts.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {failedAttempts.map((pa) => (
                        <p key={pa.id} className="text-xs text-red-400">
                          <span className="font-medium">{pa.deployment.name}:</span> {pa.errorMessage}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {editingId === item.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    update.mutate(item.id);
                  }}
                  className="space-y-3 border-t border-neutral-800 p-4"
                >
                  <p className="text-xs text-neutral-500">
                    Editing resets every push attempt below back to pending, so the corrected fields go out
                    to every deployment again — including ones that had already succeeded.
                  </p>
                  <ContentFields
                    form={editForm}
                    setForm={setEditForm}
                    genreInput={editGenreInput}
                    setGenreInput={setEditGenreInput}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={update.isPending}
                      className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-60"
                    >
                      {update.isPending ? 'Saving…' : 'Save & retry'}
                    </button>
                    {update.isError && <p className="text-xs text-red-400">Save failed — check the fields and try again.</p>}
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

/** Shared by the create form and each item's inline edit form — everything except the
 *  kind selector and TMDB search panel, which only make sense at creation time. */
function ContentFields({
  form,
  setForm,
  genreInput,
  setGenreInput,
}: {
  form: FormState;
  setForm: (update: (f: FormState) => FormState) => void;
  genreInput: string;
  setGenreInput: (value: string) => void;
}) {
  const addGenre = () => {
    const name = genreInput.trim();
    if (name && !form.genreNames.includes(name)) {
      setForm((f) => ({ ...f, genreNames: [...f.genreNames, name] }));
    }
    setGenreInput('');
  };

  return (
    <>
      <div className="flex gap-2">
        <input
          required
          placeholder={form.kind === 'MOVIE' ? 'Movie name' : 'Series name'}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={`flex-1 ${inputClass}`}
        />
        <input
          placeholder="Year"
          value={form.year}
          onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
          className={`w-24 ${inputClass}`}
        />
      </div>

      <textarea
        placeholder="Synopsis"
        value={form.synopsis}
        onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
        rows={3}
        className={`w-full ${inputClass}`}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-2">
          {form.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.posterUrl} alt="" className="h-20 w-14 shrink-0 rounded bg-neutral-900 object-cover" />
          ) : (
            <div className="h-20 w-14 shrink-0 rounded border border-dashed border-neutral-700" />
          )}
          <input
            placeholder="Poster URL"
            value={form.posterUrl}
            onChange={(e) => setForm((f) => ({ ...f, posterUrl: e.target.value }))}
            className={`flex-1 ${inputClass}`}
          />
        </div>
        <div className="flex gap-2">
          {form.backdropUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.backdropUrl} alt="" className="h-20 w-14 shrink-0 rounded bg-neutral-900 object-cover" />
          ) : (
            <div className="h-20 w-14 shrink-0 rounded border border-dashed border-neutral-700" />
          )}
          <input
            placeholder="Backdrop URL"
            value={form.backdropUrl}
            onChange={(e) => setForm((f) => ({ ...f, backdropUrl: e.target.value }))}
            className={`flex-1 ${inputClass}`}
          />
        </div>
        <div className="flex gap-2">
          {form.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logoUrl} alt="" className="h-20 w-14 shrink-0 rounded bg-neutral-900 object-contain p-1" />
          ) : (
            <div className="h-20 w-14 shrink-0 rounded border border-dashed border-neutral-700" />
          )}
          <input
            placeholder="Logo URL"
            value={form.logoUrl}
            onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
            className={`flex-1 ${inputClass}`}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <input
          placeholder="Trailer — YouTube id or link"
          value={form.trailerYoutubeId}
          onChange={(e) => setForm((f) => ({ ...f, trailerYoutubeId: e.target.value }))}
          className={`flex-1 ${inputClass}`}
        />
        <select
          value={form.rating}
          onChange={(e) => setForm((f) => ({ ...f, rating: e.target.value }))}
          className={`w-32 ${inputClass}`}
        >
          <option value="">Rating</option>
          {MATURITY_RATINGS.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', '-')}
            </option>
          ))}
        </select>
        {form.kind === 'MOVIE' && (
          <input
            placeholder="Duration (min)"
            value={form.durationMinutes}
            onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
            className={`w-32 ${inputClass}`}
          />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {form.genreNames.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setForm((f) => ({ ...f, genreNames: f.genreNames.filter((x) => x !== g) }))}
              className="rounded bg-blue-950 px-2 py-0.5 text-xs text-blue-200 transition-colors hover:bg-blue-900"
              title="Remove"
            >
              {g} ×
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            placeholder="Add a genre and press Enter"
            value={genreInput}
            onChange={(e) => setGenreInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGenre())}
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="button"
            onClick={addGenre}
            className="rounded bg-neutral-700 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-600"
          >
            Add
          </button>
        </div>
      </div>

      <input
        required
        placeholder="Stream path (e.g. vod/some-movie.mp4)"
        value={form.streamPath}
        onChange={(e) => setForm((f) => ({ ...f, streamPath: e.target.value }))}
        className={`w-full ${inputClass}`}
      />

      {form.kind === 'EPISODE' && (
        <div className="flex gap-2">
          <input
            required
            placeholder="Season #"
            value={form.seasonNumber}
            onChange={(e) => setForm((f) => ({ ...f, seasonNumber: e.target.value }))}
            className={`w-28 ${inputClass}`}
          />
          <input
            required
            placeholder="Episode #"
            value={form.episodeNumber}
            onChange={(e) => setForm((f) => ({ ...f, episodeNumber: e.target.value }))}
            className={`w-28 ${inputClass}`}
          />
          <input
            placeholder="Credits lead time (sec)"
            title="Series-level — seconds before an episode's own end when this show's credits typically start."
            value={form.creditsLeadSec}
            onChange={(e) => setForm((f) => ({ ...f, creditsLeadSec: e.target.value }))}
            className={`flex-1 ${inputClass}`}
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={form.isPublished}
          onChange={(e) => setForm((f) => ({ ...f, isPublished: e.target.checked }))}
        />
        Published (visible to viewers immediately)
      </label>
    </>
  );
}
