'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface ApiKeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  contentItemCount: number;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export default function SourcesPage() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [mintedKey, setMintedKey] = useState<{ label: string; key: string } | null>(null);

  const { data: sources, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => fetch('/api/api-keys').then((r) => r.json() as Promise<ApiKeyRow[]>),
  });

  const register = useMutation({
    mutationFn: () =>
      fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: name }),
      }).then((r) => {
        if (!r.ok) throw new Error('Registration failed');
        return r.json() as Promise<{ id: string; label: string; key: string }>;
      }),
    onSuccess: (created) => {
      client.invalidateQueries({ queryKey: ['api-keys'] });
      setMintedKey({ label: created.label, key: created.key });
      setName('');
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => fetch(`/api/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">FTP Sources</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Each row is one scanner agent (one FTP box) authorized to report new content to Jarvis.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate();
        }}
        className="flex items-end gap-2 rounded border border-neutral-800 p-4"
      >
        <div className="flex-1">
          <label className="mb-1 block text-xs text-neutral-400">Source name</label>
          <input
            required
            placeholder="e.g. cdn (FTP-1)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded bg-neutral-900 px-3 py-2 text-sm outline-none ring-1 ring-transparent transition-shadow focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={register.isPending}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-60"
        >
          {register.isPending ? 'Registering…' : 'Register FTP source'}
        </button>
      </form>

      {mintedKey && (
        <div className="space-y-2 rounded border border-emerald-700 bg-emerald-950/40 p-4">
          <p className="text-sm font-medium text-emerald-300">
            API key for &quot;{mintedKey.label}&quot; — shown once, copy it now:
          </p>
          <code className="block overflow-x-auto rounded bg-neutral-900 px-3 py-2 text-xs text-emerald-200">
            {mintedKey.key}
          </code>
          <p className="text-xs text-neutral-400">
            Set this as <code className="text-neutral-300">JARVIS_API_KEY</code> in the scanner agent&apos;s
            environment on that box. It will not be shown again — revoke and re-register if it&apos;s lost.
          </p>
          <button
            onClick={() => setMintedKey(null)}
            className="rounded bg-neutral-700 px-2 py-1 text-xs font-medium transition-colors hover:bg-neutral-600"
          >
            Dismiss
          </button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-neutral-400">
          <tr>
            <th className="py-2">Name</th>
            <th>Status</th>
            <th>Items ingested</th>
            <th>Last seen</th>
            <th>Registered</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {isLoading && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-neutral-500">
                Loading FTP sources…
              </td>
            </tr>
          )}
          {!isLoading && sources?.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-neutral-500">
                No FTP sources registered yet — add one above to get a key for a scanner agent.
              </td>
            </tr>
          )}
          {sources?.map((s) => (
            <tr key={s.id} className="hover:bg-neutral-900/50">
              <td className="py-2">{s.label}</td>
              <td>
                {s.revokedAt ? (
                  <span className="text-neutral-500">Revoked</span>
                ) : (
                  <span className="text-emerald-400">Active</span>
                )}
              </td>
              <td>{s.contentItemCount}</td>
              <td>{formatDate(s.lastUsedAt)}</td>
              <td>{formatDate(s.createdAt)}</td>
              <td className="py-2">
                {!s.revokedAt && (
                  <button
                    onClick={() => revoke.mutate(s.id)}
                    disabled={revoke.isPending}
                    className="rounded bg-red-900 px-2 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-800 disabled:opacity-60"
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
