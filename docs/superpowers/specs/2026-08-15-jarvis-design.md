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

**Provisioning execution model**: Jarvis holds **one** SSH keypair for itself (not a distinct key per deployment). An admin authorizes Jarvis's public key on a target box's `authorized_keys` before registering it (out-of-band — however that box was provisioned, e.g. at VM creation via cloud-init, or manually once). Jarvis stores only `sshHost` + `sshUser` per deployment, never a private key. This keeps the credential-storage surface small: one key to rotate, not N.

**TLS**: none of the branded deployments get real TLS — the network path is already encrypted by the tunnel, and none of them are publicly reachable for a Let's Encrypt HTTP-01 challenge to even work. Every deployment Jarvis provisions uses `ops/deploy.sh`'s existing http mode; the https/certbot branch is never invoked by Jarvis.

## 4. Data model

```
Deployment
  id, name, brandName, baseUrl, sshHost, sshUser
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
| Jarvis | Each deployment's OS, for provisioning | Jarvis's own SSH keypair, pre-authorized on the target |

## 6. Core flows

**Registering + provisioning a deployment**
1. Admin adds a `Deployment` in Jarvis (name, brand, SSH host/user, admin email, Flussonic params). Status: `REGISTERED`.
2. Admin has already put Jarvis's public key in that box's `authorized_keys`.
3. Admin clicks Deploy. Jarvis sets `Deployment.status = PROVISIONING`, creates a `ProvisionRun`, SSHes in, and runs `ops/deploy.sh` non-interactively with the stored params (protocol forced to `http`), streaming stdout/stderr into `ProvisionRun.logText` as it arrives.
4. Browser polls the run's log endpoint (~every 1-2s) to show live output. Simple polling, not a websocket — matches the "no unneeded infrastructure" approach elsewhere in this design; revisit only if polling proves too laggy in practice.
5. On success: `Deployment.status = ACTIVE`, `contentApiKey` generated and stored (via the new admin API-key mechanism), `lastProvisionedAt` set. On failure: `status = FAILED`, log retained for diagnosis, safe to retry (the script itself is written to be idempotent).

**Content fan-out**
1. New content arrives via `POST /api/content` — either the watcher (once built) or the manual form — creating one `ContentItem`.
2. Jarvis creates one `PushAttempt` per `Deployment` with `status = ACTIVE`.
3. The polling worker picks up `PENDING` attempts, calls the deployment's `POST /admin/titles` (or the episode-equivalent) with `contentApiKey`, records the result.
4. Failures retry with backoff up to a small fixed limit, then sit visibly failed for manual retry from the UI.

## 7. UI pages

1. Login
2. Deployments — list (name, brand, status, last push, last provisioned) + add/edit form + a per-row "Deploy" action with a live log view
3. Content log — every `ContentItem` with per-deployment push status; retry action on failures
4. Manual push — form to submit a title by hand

## 8. Error handling

- Provisioning failures leave the deployment in `FAILED` with the full log retained — re-running Deploy is the recovery path, relying on `deploy.sh`'s existing idempotency rather than Jarvis building its own rollback logic.
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
