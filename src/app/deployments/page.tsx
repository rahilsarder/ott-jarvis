'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeployLogView } from '@/components/DeployLogView';
import { SshAccessPanel } from '@/components/SshAccessPanel';

interface Deployment {
  id: string;
  name: string;
  brandName: string;
  baseUrl: string;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  sshKeyInstalledAt: string | null;
  adminEmail: string;
  flussonicBaseUrl: string;
  flussonicSecurelinkKey: string;
  status: string;
  lastProvisionedAt: string | null;
  lastPushAt: string | null;
}

const emptyForm = {
  name: '',
  brandName: '',
  baseUrl: '',
  sshHost: '',
  sshUser: 'root',
  sshPort: '22',
  adminEmail: '',
  flussonicBaseUrl: '',
  flussonicSecurelinkKey: '',
};

export default function DeploymentsPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [activeRuns, setActiveRuns] = useState<Record<string, string>>({});
  const [sshPanelOpen, setSshPanelOpen] = useState<Record<string, boolean>>({});

  const { data: deployments } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => fetch('/api/deployments').then((r) => r.json() as Promise<Deployment[]>),
  });

  const create = useMutation({
    mutationFn: () =>
      fetch('/api/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['deployments'] });
      setForm(emptyForm);
      setShowForm(false);
    },
  });

  const deploy = useMutation({
    mutationFn: (deploymentId: string) =>
      fetch(`/api/deployments/${deploymentId}/deploy`, { method: 'POST' }).then((r) => r.json() as Promise<{ provisionRunId: string }>),
    onSuccess: (data, deploymentId) => {
      setActiveRuns((prev) => ({ ...prev, [deploymentId]: data.provisionRunId }));
    },
  });

  useQuery({
    queryKey: ['deployments-poll', Object.keys(activeRuns).join(',')],
    queryFn: async () => {
      await client.invalidateQueries({ queryKey: ['deployments'] });
      return null;
    },
    refetchInterval: Object.keys(activeRuns).length > 0 ? 2000 : false,
    enabled: Object.keys(activeRuns).length > 0,
  });

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deployments</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium"
        >
          {showForm ? 'Cancel' : 'Add deployment'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-2 rounded border border-neutral-800 p-4"
        >
          {(
            [
              ['name', 'Internal name'],
              ['brandName', 'Brand name'],
              ['baseUrl', 'Base URL (http://…)'],
              ['sshHost', 'SSH host'],
              ['sshUser', 'SSH user'],
              ['sshPort', 'SSH port'],
              ['adminEmail', 'Admin email'],
              ['flussonicBaseUrl', 'Flussonic base URL'],
              ['flussonicSecurelinkKey', 'Flussonic securelink key'],
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              required={key !== 'flussonicSecurelinkKey'}
              placeholder={label}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full rounded bg-neutral-900 px-3 py-2 text-sm outline-none"
            />
          ))}
          <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium">
            Register
          </button>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-neutral-400">
          <tr>
            <th className="py-2">Name</th>
            <th>Brand</th>
            <th>Status</th>
            <th>SSH</th>
            <th>Last provisioned</th>
            <th>Last push</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {deployments?.map((d) => (
            <Fragment key={d.id}>
              <tr>
                <td className="py-2">{d.name}</td>
                <td>{d.brandName}</td>
                <td>{d.status}</td>
                <td>
                  <button
                    onClick={() => setSshPanelOpen((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
                    className="rounded bg-neutral-700 px-2 py-1 text-xs font-medium"
                  >
                    {d.sshKeyInstalledAt ? 'Key installed' : 'Not verified'}
                  </button>
                </td>
                <td>{d.lastProvisionedAt ?? '—'}</td>
                <td>{d.lastPushAt ?? '—'}</td>
                <td>
                  {(d.status === 'REGISTERED' || d.status === 'FAILED') && (
                    <button
                      onClick={() => deploy.mutate(d.id)}
                      disabled={deploy.isPending}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium disabled:opacity-60"
                    >
                      Deploy
                    </button>
                  )}
                </td>
              </tr>
              {sshPanelOpen[d.id] && (
                <tr>
                  <td colSpan={7}>
                    <SshAccessPanel
                      deploymentId={d.id}
                      onInstalled={() => client.invalidateQueries({ queryKey: ['deployments'] })}
                    />
                  </td>
                </tr>
              )}
              {activeRuns[d.id] && (
                <tr>
                  <td colSpan={7}>
                    <DeployLogView
                      deploymentId={d.id}
                      runId={activeRuns[d.id]}
                      onSettled={() =>
                        setActiveRuns((prev) => {
                          const next = { ...prev };
                          delete next[d.id];
                          return next;
                        })
                      }
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </main>
  );
}
