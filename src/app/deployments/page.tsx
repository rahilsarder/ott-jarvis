'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Deployment {
  id: string;
  name: string;
  brandName: string;
  baseUrl: string;
  sshHost: string;
  sshUser: string;
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
  adminEmail: '',
  flussonicBaseUrl: '',
  flussonicSecurelinkKey: '',
};

export default function DeploymentsPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

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
            <th>Last provisioned</th>
            <th>Last push</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {deployments?.map((d) => (
            <tr key={d.id}>
              <td className="py-2">{d.name}</td>
              <td>{d.brandName}</td>
              <td>{d.status}</td>
              <td>{d.lastProvisionedAt ?? '—'}</td>
              <td>{d.lastPushAt ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
