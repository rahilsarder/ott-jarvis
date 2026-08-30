'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

interface TestResult {
  ok: boolean;
  output: string;
}

export function SshAccessPanel({ deploymentId, onInstalled }: { deploymentId: string; onInstalled?: () => void }) {
  const [password, setPassword] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [lastResult, setLastResult] = useState<TestResult | null>(null);

  const { data: identity } = useQuery({
    queryKey: ['ssh-identity'],
    queryFn: () => fetch('/api/ssh-identity').then((r) => r.json() as Promise<{ publicKey: string }>),
    staleTime: Infinity,
  });

  const test = useMutation({
    mutationFn: () =>
      fetch(`/api/deployments/${deploymentId}/ssh/test`, { method: 'POST' }).then((r) => r.json() as Promise<TestResult>),
    onSuccess: setLastResult,
  });

  const bootstrap = useMutation({
    mutationFn: () =>
      fetch(`/api/deployments/${deploymentId}/ssh/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }).then((r) => r.json() as Promise<TestResult>),
    onSuccess: (result) => {
      setLastResult(result);
      if (result.ok) {
        setPassword('');
        setShowPasswordForm(false);
        onInstalled?.();
      }
    },
  });

  return (
    <div className="mt-2 space-y-3 rounded border border-neutral-800 p-3 text-xs">
      <div>
        <p className="mb-1 text-neutral-400">
          Option A — paste this into the target&apos;s <code>~/.ssh/authorized_keys</code>, then test:
        </p>
        <pre className="overflow-x-auto rounded bg-black p-2 text-neutral-300">{identity?.publicKey ?? 'loading…'}</pre>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className="rounded bg-neutral-700 px-2 py-1 font-medium disabled:opacity-60"
        >
          {test.isPending ? 'Testing…' : 'Test connection'}
        </button>

        <button
          onClick={() => setShowPasswordForm((s) => !s)}
          className="rounded bg-neutral-700 px-2 py-1 font-medium"
        >
          {showPasswordForm ? 'Cancel' : 'Option B — install key from password'}
        </button>
      </div>

      {showPasswordForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            bootstrap.mutate();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="password"
            required
            placeholder="Server SSH password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded bg-neutral-900 px-2 py-1 outline-none"
          />
          <button
            type="submit"
            disabled={bootstrap.isPending}
            className="rounded bg-emerald-700 px-2 py-1 font-medium disabled:opacity-60"
          >
            {bootstrap.isPending ? 'Installing…' : 'Install key'}
          </button>
          <p className="text-neutral-500">Used once, then discarded — never stored.</p>
        </form>
      )}

      {lastResult && (
        <div>
          <p className={lastResult.ok ? 'text-emerald-400' : 'text-red-400'}>{lastResult.ok ? 'OK' : 'Failed'}</p>
          {lastResult.output && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black p-2 text-neutral-400">
              {lastResult.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
