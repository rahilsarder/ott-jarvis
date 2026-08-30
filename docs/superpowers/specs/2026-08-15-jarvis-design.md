# Jarvis — Design Spec

Status: approved for implementation planning
Date: 2026-08-15

Mirrored from the OTT platform repo (`docs/superpowers/specs/2026-08-15-jarvis-design.md`
at commit `5092bd2`), where it was originally brainstormed and approved, since Jarvis
lives in its own repo going forward.

## 1. Purpose

The OTT platform is deployed as several independently-branded instances (3-4 initially, more later), each running its own Postgres, Redis, and app stack on its own VPS, all reachable only over a private network/tunnel. Two operational problems this project solves:

1. **Manual content entry doesn't scale.** New titles need to be added once and appear on every branded instance, without an admin re-entering them per server.
2. **Manual server setup doesn't scale.** Standing up branded instance #5 currently means SSHing in and running `ops/deploy.sh` by hand.

Jarvis is the control-plane service that owns both: a registry of every deployed instance, a pipeline that pushes new content to all of them, and a "Deploy" action that provisions a fresh instance by driving `ops/deploy.sh` remotely.

## 2. Scope

**In scope (v1):**
- Deployment registry (add/edit/view/remove a branded instance)
- Content fan-out: ingest a new title/episode once, push it to every registered deployment's admin API, track success/failure per deployment, retry on failure
- Provisioning: trigger `ops/deploy.sh` on a registered (but not-yet-deployed) server over SSH, with live log output visible in the UI
- A minimal web UI covering all of the above

**Explicitly out of scope (future phases):**
- Licensing/entitlement tracking per deployment — separate spec, built after this exists
- The FTP watcher that detects new content and calls Jarvis — separate small project; once built, it's just another API-key holder calling Jarvis's ingest endpoint
- Multi-user roles/permissions inside Jarvis — v1 has one admin role

**Prerequisite changes in the existing OTT repo** (not part of Jarvis's own codebase, but Jarvis depends on both):
- `apps/api`: a real API-key auth mechanism, so Jarvis authenticates to each deployment's admin API without holding a human admin's password
- `ops/deploy.sh`: a non-interactive mode (flags/env vars in place of `read -rp`/`select` prompts), so Jarvis can drive it programmatically over SSH

These two are scoped and planned as part of this same effort, since Jarvis can't do its job without them, but they land as PRs against the OTT repo, not the Jarvis repo. **Status: shipped** — merged to the OTT repo's `main` (`docs/superpowers/plans/2026-08-15-jarvis-prereqs.md`).

## 3. Architecture

**Repository**: separate from the OTT platform repo. Jarvis's coupling to it is shallow (it calls a stable HTTP contract, `POST /admin/titles` and friends), and it has a different audience (an internal ops tool, not a customer-facing app) and its own release cadence.

**Stack**: single Next.js app (App Router, route handlers for the backend) with Prisma + Postgres for its own dedicated database. No separate API service — the CRUD-plus-orchestration surface here doesn't justify the NestJS split the OTT platform uses. Deployed the same way as every other service in this project: one VPS, PM2, nginx, no containers.

**Network placement**: Jarvis must itself sit on the same private network/tunnel as the branded deployments — it can't reach any of them otherwise, including for SSH provisioning.

**Fan-out execution model**: a simple in-process polling loop (checks for pending `PushAttempt` rows every few seconds and processes them), not a job-queue framework like BullMQ. At the expected scale — a handful of deployments, occasional new titles — that's unneeded infrastructure.

**Provisioning execution model**: Jarvis holds **one** SSH keypair for itself (not a distinct key per deployment), generated automatically on first use rather than requiring an operator to create one out-of-band. Jarvis stores only `sshHost` + `sshUser` + `sshPort` per deployment, never a private key or password. This keeps the credential-storage surface small: one key to rotate, not N.

Getting that key trusted on a target is self-serve, in one of two ways: an operator pastes Jarvis's public key (shown in the UI) into the target's `authorized_keys` themselves, or — for a server that starts out password-only, e.g. a freshly created VPS — Jarvis uses a password submitted once through the UI to install its own key via `sshpass`, then immediately discards the password and verifies the key with a fresh key-only connection. Either way, no password is ever persisted; the credential Jarvis holds long-term is always just its own keypair.

`ops/deploy.sh` calls bare `ssh`/`scp` directly and has no flags for a non-default port or a specific identity, since it assumes the invoking user's default SSH setup already works — true for a human operator, not for an unattended process connecting to a server it has never spoken to before. Two problems follow from that: first, a brand-new target's host key isn't in any known_hosts file yet, and deploy.sh has no terminal to answer the interactive "are you sure?" prompt, so the very first deploy to any new server fails outright without a fix. Second, the port and identity Jarvis needs to use are per-deployment, but deploy.sh's `ssh`/`scp` calls are fixed. Since this repo doesn't own `ops/deploy.sh`, Jarvis handles both by generating throwaway `ssh`/`scp` wrapper scripts (`src/lib/ssh-shim.ts`) that inject `StrictHostKeyChecking=accept-new` (trust-on-first-use, into a Jarvis-owned known_hosts file, never the operator's own `~/.ssh/known_hosts`), `BatchMode=yes`, the deployment's port, and Jarvis's identity — then puts that directory first on `PATH` for the one child process `deploy.sh` runs in. Every deploy goes through this, not only password-bootstrapped ones.

**TLS**: none of the branded deployments get real TLS — the network path is already encrypted by the tunnel, and none of them are publicly reachable for a Let's Encrypt HTTP-01 challenge to even work. Every deployment Jarvis provisions uses `ops/deploy.sh`'s existing http mode; the https/certbot branch is never invoked by Jarvis.

## 4. Data model

```
Deployment
  id, name, brandName, baseUrl, sshHost, sshUser, sshPort  // sshPort defaults to 22
  sshKeyInstalledAt    // set once a Test connection or password bootstrap has verified Jarvis's key works
  contentApiKey        // credential Jarvis uses to call this deployment's admin API
  adminEmail            // passed to deploy.sh at provision time
  flussonicBaseUrl
  flussonicSecurelinkKey
  status                // REGISTERED | PROVISIONING | ACTIVE | FAILED | PAUSED | DECOMMISSIONED
  lastProvisionedAt
  lastPushAt
  createdAt, updatedAt

ContentItem
  id, kind              // MOVIE | EPISODE
  name, year
  streamPath
  seasonNumber, episodeNumber   // set only for EPISODE; identifies the parent series by name+year
  sourcePath             // original FTP path, for traceability back to the file
  submittedAt
  submittedByApiKeyId    // nullable — set when submitted by the watcher
  submittedByUserId      // nullable — set when submitted manually via the UI

PushAttempt
  id, contentItemId, deploymentId
  status                 // PENDING | SUCCESS | FAILED
  httpStatus, errorMessage
  attemptedAt, retryCount, nextRetryAt

ProvisionRun
  id, deploymentId
  status                 // RUNNING | SUCCESS | FAILED
  logText                // appended to as output streams in
  startedAt, finishedAt

JarvisUser
  id, email, passwordHash, createdAt

JarvisApiKey
  id, label, keyHash, createdAt, lastUsedAt, revokedAt
```

`PushAttempt` is one row per (ContentItem × active Deployment), which is what makes "deployment #3 was down when this went out" visible and independently retryable without re-pushing to the ones that already succeeded.

## 5. Auth model

Four distinct relationships, each with its own credential:

| Who | Talks to | Credential |
|---|---|---|
| You (browser) | Jarvis UI | `JarvisUser` session (email/password login) |
| FTP watcher (future) | Jarvis ingest API | `JarvisApiKey` (bearer header) |
| Jarvis | Each deployment's admin API | `Deployment.contentApiKey` (requires the new API-key mechanism in `apps/api`) |
| Jarvis | Each deployment's OS, for provisioning | Jarvis's own SSH keypair — either pre-authorized on the target by an operator, or self-installed once via a password submitted through the UI (never persisted) |

## 6. Core flows

**Registering + provisioning a deployment**
1. Admin adds a `Deployment` in Jarvis (name, brand, SSH host/user/port, admin email, Flussonic params). Status: `REGISTERED`.
2. Admin establishes SSH trust for the target, either by pasting Jarvis's public key into its `authorized_keys` themselves, or by submitting the server's password once so Jarvis installs its own key via `sshpass` and discards the password (§3, Provisioning execution model) — then confirms with Test connection, which sets `sshKeyInstalledAt`.
3. Admin clicks Deploy. Jarvis sets `Deployment.status = PROVISIONING`, creates a `ProvisionRun`, and spawns `ops/deploy.sh` as a local child process (from a checkout of the OTT repo on Jarvis's own box) targeting the deployment's `sshUser@sshHost` non-interactively (protocol forced to `http`) — `deploy.sh` itself does the SSH/SCP to the target, Jarvis never holds or uses an SSH library directly. Stdout/stderr streams into `ProvisionRun.logText` as it arrives.
4. Browser polls the run's log endpoint (~every 1-2s) to show live output. Simple polling, not a websocket — matches the "no unneeded infrastructure" approach elsewhere in this design; revisit only if polling proves too laggy in practice.
5. On success: `Deployment.status = ACTIVE`, `contentApiKey` generated and stored (via the new admin API-key mechanism), `lastProvisionedAt` set. On failure: `status = FAILED`, log retained for diagnosis. Retry safety is more nuanced than "the script is idempotent" (see §8) — `deploy.sh` re-run against an already-set-up target takes a different, non-equivalent code path that prints no fresh admin credential, so a clean retry only works once a `contentApiKey` is already on file for that deployment.

**Content fan-out**
1. New content arrives via `POST /api/content` — either the watcher (once built) or the manual form — creating one `ContentItem`.
2. Jarvis creates one `PushAttempt` per `Deployment` with `status = ACTIVE`.
3. The polling worker picks up `PENDING` attempts, calls the deployment's `POST /admin/titles` (or the episode-equivalent) with `contentApiKey`, records the result.
4. Failures retry with backoff up to a small fixed limit, then sit visibly failed for manual retry from the UI.

## 7. UI pages

1. Login
2. Deployments — list (name, brand, status, last push, last provisioned) + add/edit form + a per-row "Deploy" action with a live log view, plus an SSH access panel (Jarvis's public key, Test connection, password-bootstrap form)
3. Content log — every `ContentItem` with per-deployment push status; retry action on failures
4. Manual push — form to submit a title by hand

## 8. Error handling

- Provisioning failures leave the deployment in `FAILED` with the full log retained. Re-running Deploy is the recovery path **only when this deployment already has a `contentApiKey` on file** — `deploy.sh` detects the `.env` it wrote on the first run and takes a different "update" path (pull/build/migrate/reload) that never re-seeds an admin account or prints a credential, so Jarvis reuses the stored key rather than trying to mint a new one, and this correctly covers "some later step failed after `deploy.sh` itself succeeded" (nginx reload, `pm2 start`, or Jarvis's own key-minting call — the single most likely failure, since it runs the instant `deploy.sh` exits). If provisioning never got far enough to mint a key on any prior attempt, retrying just repeats the same dead end forever — `deploy.sh`'s update path can't produce a credential Jarvis doesn't already have, and clicking Deploy again is not a working recovery path for that case. That deployment needs a human to intervene once (recover the seeded admin password from the target's own `.env`, or reset it, then mint a key by hand) — Jarvis surfaces this distinction and a concrete runbook in the failure log rather than silently retrying forever. Building Jarvis's own rollback/reset logic for the initial-failure case remains out of scope for v1.
- Content push failures retry automatically (bounded), then require a manual retry click — no silent infinite retry loops.
- A deployment that's `PAUSED` or `DECOMMISSIONED` is skipped entirely by new content fan-out (no `PushAttempt` rows created for it).

## 9. Testing approach

- Unit tests for fan-out retry/backoff logic and for the new `deploy.sh` flag-parsing (in the OTT repo) — these are pure logic, cheap to test in isolation.
- The actual SSH provisioning flow depends on real remote infrastructure and is impractical to fully automate; verified manually against a real (throwaway, per the earlier plan) box as part of implementation, not via an automated test suite.
- Standard typecheck/lint/build gates matching the conventions already used in the OTT repo.

## 10. Open items carried into implementation planning

- Exact non-interactive flag/env-var interface for `deploy.sh` (shape is implied by its current prompts; finalized during planning) — **resolved**, see the OTT repo's `ops/deploy.sh --non-interactive` usage comment.
- Exact shape of the new `apps/api` API-key model/guard — **resolved**, see the OTT repo's `apps/api/src/auth/api-key.service.ts` and `jwt-auth.guard.ts`.
- How Jarvis actually drives `ops/deploy.sh` (SSH-to-target vs. local invocation) and how it obtains a deployment's freshly-seeded admin credentials to mint its own `contentApiKey` — **resolved during v1 implementation planning**, see `docs/superpowers/plans/2026-08-17-jarvis-v1.md` §Provisioning.
