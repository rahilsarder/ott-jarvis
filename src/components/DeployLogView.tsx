'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

interface ProvisionRunStatus {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  logText: string;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Always shows the deployment's most recent run, not a specific runId the
 * browser has to remember — so this keeps working after a page reload, and
 * doubles as a "what happened last time" viewer for a deployment that's
 * sitting FAILED, not just a live-run tracker.
 */
export function DeployLogView({ deploymentId, onSettled }: { deploymentId: string; onSettled?: () => void }) {
  const { data } = useQuery({
    queryKey: ['provision-run-latest', deploymentId],
    queryFn: async () => {
      const res = await fetch(`/api/deployments/${deploymentId}/provision-runs/latest`);
      if (res.status === 404) return null;
      return (await res.json()) as ProvisionRunStatus;
    },
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 1500 : false),
  });

  const settledRef = useRef(false);
  useEffect(() => {
    if (data?.status && data.status !== 'RUNNING' && !settledRef.current) {
      settledRef.current = true;
      onSettled?.();
    }
    if (data?.status === 'RUNNING') settledRef.current = false;
  }, [data?.status, onSettled]);

  // Auto-follow new output as it streams in, but only while the viewer
  // hasn't scrolled up to read earlier lines — the same "stick to bottom"
  // convention terminals and chat logs use, so a failure at the end of a
  // long install log is visible without the viewer having to go find it.
  const preRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  const onScroll = () => {
    const el = preRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = preRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [data?.logText]);

  if (data === null) {
    return (
      <div className="mt-2 rounded border border-neutral-800 bg-black p-3">
        <p className="text-xs text-neutral-400">No provisioning runs yet for this deployment.</p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded border border-neutral-800 bg-black p-3">
      <p className="mb-2 text-xs text-neutral-400">Status: {data?.status ?? 'loading…'}</p>
      <pre
        ref={preRef}
        onScroll={onScroll}
        className="max-h-[420px] overflow-auto whitespace-pre-wrap text-xs text-neutral-300"
      >
        {data?.logText}
      </pre>
    </div>
  );
}
