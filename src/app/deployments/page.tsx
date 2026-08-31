'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeployLogView } from '@/components/DeployLogView';
import { SshAccessPanel } from '@/components/SshAccessPanel';
import { getLicenseStatus } from '@/lib/license';

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
  deployedCommit: string | null;
  licenseExpiresAt: string | null;
  lastProvisionedAt: string | null;
  lastPushAt: string | null;
}

const LICENSE_LABEL: Record<ReturnType<typeof getLicenseStatus>, (date: string) => string> = {
  none: () => '—',
  ok: (date) => `Expires ${date}`,
  soon: (date) => `Expires ${date} (soon)`,
  expired: (date) => `Expired ${date}`,
};

const LICENSE_COLOR: Record<ReturnType<typeof getLicenseStatus>, string> = {
  none: 'text-neutral-500',
  ok: 'text-emerald-400',
  soon: 'text-amber-400',
  expired: 'text-red-400',
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * deploy.sh itself decides fresh-install vs. update by checking whether
 * .env already exists on the target — there's no separate script or route
 * for the two. This just labels the same action honestly: "Deploy" only
 * for a box that's never been successfully provisioned (REGISTERED, or
 * FAILED with no prior successful run to fall back to); "Update" once
 * there's a real deployment to pull new code onto, including a FAILED
 * retry that has a deployedCommit on file from before.
 */
function deployButtonLabel(d: Deployment): 'Deploy' | 'Update' | null {
  if (d.status === 'REGISTERED') return 'Deploy';
  if (d.status === 'FAILED') return d.deployedCommit ? 'Update' : 'Deploy';
  if (d.status === 'ACTIVE') return 'Update';
  return null;
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
  licenseExpiresAt: '',
};

type FormState = typeof emptyForm;

const FORM_FIELDS = [
  ['name', 'Internal name', 'text'],
  ['brandName', 'Brand name', 'text'],
  ['baseUrl', 'Base URL (http://…)', 'text'],
  ['sshHost', 'SSH host', 'text'],
  ['sshUser', 'SSH user', 'text'],
  ['sshPort', 'SSH port', 'text'],
  ['adminEmail', 'Admin email', 'text'],
  ['flussonicBaseUrl', 'Flussonic base URL', 'text'],
  ['flussonicSecurelinkKey', 'Flussonic securelink key', 'text'],
  ['licenseExpiresAt', 'License expires', 'date'],
] as const;

const REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'brandName',
  'baseUrl',
  'sshHost',
  'sshUser',
  'sshPort',
  'adminEmail',
  'flussonicBaseUrl',
]);

function toFormState(d: Deployment): FormState {
  return {
    name: d.name,
    brandName: d.brandName,
    baseUrl: d.baseUrl,
    sshHost: d.sshHost,
    sshUser: d.sshUser,
    sshPort: String(d.sshPort),
    adminEmail: d.adminEmail,
    flussonicBaseUrl: d.flussonicBaseUrl,
    flussonicSecurelinkKey: d.flussonicSecurelinkKey,
    // Native date inputs need YYYY-MM-DD; the API returns a full ISO timestamp.
    licenseExpiresAt: d.licenseExpiresAt ? d.licenseExpiresAt.slice(0, 10) : '',
  };
}

export default function DeploymentsPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState<Record<string, boolean>>({});
  const [sshPanelOpen, setSshPanelOpen] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);

  const { data: deployments } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => fetch('/api/deployments').then((r) => r.json() as Promise<Deployment[]>),
    // Keeps status/lastProvisionedAt/etc. moving in the table itself while a
    // deploy is running, independent of whether that row's log panel is open.
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === 'PROVISIONING') ? 2000 : false),
  });

  const { data: mainHead } = useQuery({
    queryKey: ['main-head'],
    queryFn: () => fetch('/api/main-head').then((r) => r.json() as Promise<{ sha: string | null }>),
    staleTime: 60_000,
  });

  const staleDeployments =
    deployments?.filter((d) => d.status === 'ACTIVE' && mainHead?.sha && d.deployedCommit !== mainHead.sha) ?? [];

  const bulkDeploy = useMutation({
    mutationFn: () =>
      fetch('/api/deployments/bulk-deploy', { method: 'POST' }).then(
        (r) => r.json() as Promise<{ triggered: string[] }>,
      ),
    onSuccess: (data) => {
      client.invalidateQueries({ queryKey: ['deployments'] });
      setLogPanelOpen((prev) => {
        const next = { ...prev };
        for (const id of data.triggered) next[id] = true;
        return next;
      });
    },
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

  const update = useMutation({
    mutationFn: (deploymentId: string) =>
      fetch(`/api/deployments/${deploymentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      }).then((r) => {
        if (!r.ok) throw new Error('Update failed');
        return r.json();
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['deployments'] });
      setEditingId(null);
    },
  });

  const deploy = useMutation({
    mutationFn: (deploymentId: string) => fetch(`/api/deployments/${deploymentId}/deploy`, { method: 'POST' }),
    onSuccess: (_res, deploymentId) => {
      client.invalidateQueries({ queryKey: ['deployments'] });
      // Open (not toggle) — clicking Deploy should always bring the log into
      // view for what's about to happen, even if it was closed before.
      setLogPanelOpen((prev) => ({ ...prev, [deploymentId]: true }));
    },
  });

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deployments</h1>
        <div className="flex items-center gap-2">
          {staleDeployments.length > 0 && (
            <button
              onClick={() => bulkDeploy.mutate()}
              disabled={bulkDeploy.isPending}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
            >
              {bulkDeploy.isPending ? 'Updating…' : `Update all (${staleDeployments.length} stale)`}
            </button>
          )}
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium"
          >
            {showForm ? 'Cancel' : 'Add deployment'}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-2 rounded border border-neutral-800 p-4"
        >
          {FORM_FIELDS.map(([key, label, type]) => (
            <div key={key}>
              {/* Native date inputs don't render a text placeholder, so this is
                  the only field that needs an actual visible label. */}
              {type === 'date' && <label className="mb-1 block text-xs text-neutral-400">{label}</label>}
              <input
                required={REQUIRED_FIELDS.has(key)}
                type={type}
                placeholder={label}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded bg-neutral-900 px-3 py-2 text-sm outline-none"
              />
            </div>
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
            <th>Version</th>
            <th>License</th>
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
                  {d.status === 'ACTIVE' && d.deployedCommit ? (
                    mainHead?.sha && d.deployedCommit !== mainHead.sha ? (
                      <span className="text-amber-400" title={`deployed ${d.deployedCommit}, main is ${mainHead.sha}`}>
                        {shortSha(d.deployedCommit)} · stale
                      </span>
                    ) : (
                      <span className="text-emerald-400">{shortSha(d.deployedCommit)} · up to date</span>
                    )
                  ) : (
                    <span className="text-neutral-500">—</span>
                  )}
                </td>
                <td>
                  {(() => {
                    const status = getLicenseStatus(d.licenseExpiresAt);
                    return (
                      <span className={LICENSE_COLOR[status]}>
                        {LICENSE_LABEL[status](d.licenseExpiresAt?.slice(0, 10) ?? '')}
                      </span>
                    );
                  })()}
                </td>
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
                <td className="flex gap-2 py-2">
                  {deployButtonLabel(d) && (
                    <button
                      onClick={() => deploy.mutate(d.id)}
                      disabled={deploy.isPending}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium disabled:opacity-60"
                    >
                      {deployButtonLabel(d)}
                    </button>
                  )}
                  {d.status !== 'PROVISIONING' && (
                    <button
                      onClick={() => {
                        setEditingId((current) => (current === d.id ? null : d.id));
                        setEditForm(toFormState(d));
                      }}
                      className="rounded bg-neutral-700 px-2 py-1 text-xs font-medium"
                    >
                      {editingId === d.id ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                  <button
                    onClick={() => setLogPanelOpen((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
                    className="rounded bg-neutral-700 px-2 py-1 text-xs font-medium"
                  >
                    {logPanelOpen[d.id] ? 'Hide log' : 'View log'}
                  </button>
                </td>
              </tr>
              {editingId === d.id && (
                <tr>
                  <td colSpan={9}>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        update.mutate(d.id);
                      }}
                      className="mt-2 space-y-2 rounded border border-neutral-800 p-4"
                    >
                      {(d.sshHost !== editForm.sshHost ||
                        d.sshUser !== editForm.sshUser ||
                        d.sshPort !== Number(editForm.sshPort)) && (
                        <p className="text-xs text-amber-400">
                          SSH target changed — saving will mark this deployment unverified and reset it to
                          REGISTERED, so it needs Test connection (or a password install) and Deploy again.
                        </p>
                      )}
                      {FORM_FIELDS.map(([key, label, type]) => (
                        <div key={key}>
                          {type === 'date' && (
                            <label className="mb-1 block text-xs text-neutral-400">{label}</label>
                          )}
                          <input
                            required={REQUIRED_FIELDS.has(key)}
                            type={type}
                            placeholder={label}
                            value={editForm[key]}
                            onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                            className="w-full rounded bg-neutral-900 px-3 py-2 text-sm outline-none"
                          />
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={update.isPending}
                          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                        >
                          {update.isPending ? 'Saving…' : 'Save changes'}
                        </button>
                        {update.isError && <p className="text-xs text-red-400">Update failed — try again.</p>}
                      </div>
                    </form>
                  </td>
                </tr>
              )}
              {sshPanelOpen[d.id] && (
                <tr>
                  <td colSpan={9}>
                    <SshAccessPanel
                      deploymentId={d.id}
                      onInstalled={() => client.invalidateQueries({ queryKey: ['deployments'] })}
                    />
                  </td>
                </tr>
              )}
              {logPanelOpen[d.id] && (
                <tr>
                  <td colSpan={9}>
                    <DeployLogView
                      deploymentId={d.id}
                      onSettled={() => client.invalidateQueries({ queryKey: ['deployments'] })}
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
