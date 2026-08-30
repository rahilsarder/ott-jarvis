# Jarvis

Control-plane service for the OTT platform's branded deployments: a
deployment registry, content fan-out, and remote provisioning via the OTT
repo's `ops/deploy.sh`. Design: `docs/superpowers/specs/2026-08-15-jarvis-design.md`.

## Local development

1. `cp .env.example .env` and fill in `JARVIS_SESSION_SECRET` (`openssl rand
   -base64 48`), `DATABASE_URL` for a local Postgres, and `OTT_REPO_PATH`
   (a local checkout of the OTT platform repo — required only for the
   Deploy action).
2. `pnpm install`
3. `pnpm exec prisma migrate dev`
4. `pnpm seed` — creates the bootstrap admin from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.
5. `pnpm dev` — web app on `:3100`.
6. `pnpm worker` — in a second terminal, the content fan-out polling loop.

## Deploying

Same pattern as the OTT repo: one VPS, PM2, nginx (plain HTTP — see the
design doc's TLS section for why), no containers.

Unlike the OTT repo, Jarvis has no `ops/deploy.sh` that writes `.env` for
you — create it on the box yourself before starting the app: `cp
.env.example .env`, then fill in real production values for
`DATABASE_URL`, `JARVIS_SESSION_SECRET`, `OTT_REPO_PATH`, and the
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` vars. Both processes read this
file at startup, but by different mechanisms: `jarvis-web` via `next
start`'s built-in `.env` auto-loading, and `jarvis-worker` via Node's own
`--env-file=.env` flag, passed as `node_args` in
`ops/ecosystem.config.js` (and baked into the `worker` and `seed` scripts
in `package.json` for local dev and one-off runs).

`tsx` does *not* load `.env` files itself — that is what the flag is for.
In practice this hasn't caused a gap: both `worker/push-worker.ts` and
`prisma/seed.ts` import the Prisma client, and instantiating it loads the
*entire* `.env` into `process.env` as a side effect (it resolves
`DATABASE_URL` and everything else `.env` defines) before either script's
own code runs — so `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` and every
other var have always been visible, not just `DATABASE_URL`. The
`--env-file` flag makes that guarantee explicit and independent of
Prisma's side effect rather than incidental to it, and turns a missing
`.env` into a loud startup failure instead of a silent one. Without
`.env` on the box at all, neither process can find `DATABASE_URL` and
both fail either way.

```bash
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm build
pm2 start ops/ecosystem.config.js
pm2 save
```

## Registering a new server

Every deploy shells out to the OTT repo's `ops/deploy.sh`, which does its own
SSH/SCP to the target — so the target must trust Jarvis's identity
(`JARVIS_SSH_KEY_PATH`, generated automatically on first use) before it can
be deployed to. On the deployment's row in the UI, either:

- **Paste Jarvis's public key** (shown there, also available at `GET
  /api/ssh-identity`) into the target's `~/.ssh/authorized_keys` yourself,
  then click **Test connection**; or
- **Enter the server's SSH password** once — Jarvis uses it to install its
  own key, verifies the key works, then discards the password. This path
  needs `sshpass` installed on the Jarvis host (`apt install sshpass`); it is
  never required for the first option.

Either way, the very first connection to a never-before-seen host is
trust-on-first-use (`StrictHostKeyChecking=accept-new`) into a Jarvis-owned
known_hosts file (`JARVIS_SSH_KNOWN_HOSTS_PATH`) — not the operator's own
`~/.ssh/known_hosts`. A non-standard SSH port is set per-deployment
(`sshPort`, default 22); `ops/deploy.sh` itself has no `-p` flag of its own,
so this is delivered by wrapping `ssh`/`scp` for the duration of that one
deploy rather than by editing a script this repo doesn't own — see
`src/lib/ssh-shim.ts`.
