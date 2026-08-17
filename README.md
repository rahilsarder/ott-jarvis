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
Prisma Client separately loads `.env` on its own to resolve
`DATABASE_URL`, so DB access happens to work either way, but nothing
else does: run `pnpm seed` without the flag and it silently ignores
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` and seeds the hardcoded
`admin@jarvis.local` / `changeme123` fallback instead. Without `.env` on
the box at all, neither process can find `DATABASE_URL` and both fail.

```bash
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm build
pm2 start ops/ecosystem.config.js
pm2 save
```

Jarvis's own SSH keypair (the process user's default identity) must be
authorized on every deployment's target box before it's registered —
provisioning shells out to the OTT repo's `ops/deploy.sh`, which does its
own SSH/SCP to the target using that identity.
