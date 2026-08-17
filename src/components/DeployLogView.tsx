'use client';

import { useQuery } from '@tanstack/react-query';

interface ProvisionRunStatus {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  logText: string;
  startedAt: string;
  finishedAt: string | null;
}

export function DeployLogView({ deploymentId, runId }: { deploymentId: string; runId: string }) {
  const { data } = useQuery({
    queryKey: ['provision-run', runId],
    queryFn: () =>
      fetch(`/api/deployments/${deploymentId}/provision-runs/${runId}`).then(
        (r) => r.json() as Promise<ProvisionRunStatus>,
      ),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 1500 : false),
  });

  return (
    <div className="mt-2 rounded border border-neutral-800 bg-black p-3">
      <p className="mb-2 text-xs text-neutral-400">Status: {data?.status ?? 'starting…'}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-neutral-300">{data?.logText}</pre>
    </div>
  );
}
