'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

interface ProvisionRunStatus {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  logText: string;
  startedAt: string;
  finishedAt: string | null;
}

export function DeployLogView({
  deploymentId,
  runId,
  onSettled,
}: {
  deploymentId: string;
  runId: string;
  onSettled?: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['provision-run', runId],
    queryFn: () =>
      fetch(`/api/deployments/${deploymentId}/provision-runs/${runId}`).then(
        (r) => r.json() as Promise<ProvisionRunStatus>,
      ),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 1500 : false),
  });

  const settledRef = useRef(false);
  useEffect(() => {
    if (data?.status && data.status !== 'RUNNING' && !settledRef.current) {
      settledRef.current = true;
      onSettled?.();
    }
  }, [data?.status, onSettled]);

  return (
    <div className="mt-2 rounded border border-neutral-800 bg-black p-3">
      <p className="mb-2 text-xs text-neutral-400">Status: {data?.status ?? 'starting…'}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-neutral-300">{data?.logText}</pre>
    </div>
  );
}
