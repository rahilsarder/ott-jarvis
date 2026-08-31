# License Expiration Tracking — Design

## 1. Purpose

Jarvis has no concept of a customer's licensing terms today — nothing distinguishes a deployment under an active agreement from one whose contract has lapsed. This adds the minimum needed to see that at a glance: an expiration date per deployment, visible and status-colored in the deployments list.

## 2. Scope

**In scope (v1):** a single expiration date per deployment, settable via the existing Edit form, shown in the deployments list color-coded by how close it is (or isn't).

**Explicitly out of scope for this pass:**
- Any enforcement — an expired license doesn't block Deploy/Update, doesn't pause content fan-out, doesn't affect the live site in any way. Purely informational.
- Subscriber/seat limits, feature entitlements, plan tiers — nothing beyond the date itself.
- License history (past renewal periods) — only the current expiration date is tracked; renewing means editing the existing value, with no record of what it was before.
- Notifications/reminders (email, alerts) when a license is expiring.

Both deferred deliberately — confirmed with the user (2026-08-31): start with tracking only, revisit technical enforcement as a separate decision once tracking is in use.

## 3. Data model

```
Deployment
  ...
  licenseExpiresAt   DateTime?   // null = no license tracked for this deployment
```

Nullable, no default. A deployment registered today, or any deployment that existed before this feature, has no value until an admin sets one via Edit — nothing requires it.

## 4. UI

**Edit form:** one new optional field, `licenseExpiresAt`, alongside the existing fields (Flussonic securelink key is already optional in the same form — same treatment). Not added to the Add-deployment form's required set for the same reason: license terms are often settled after a deployment already exists, not at registration time.

**Deployments list:** new "License" column, positioned near the existing "Version" column (same list, same row-level information density). Status derived purely from `licenseExpiresAt` compared to now, no separate stored status field:

| Condition | Display |
|---|---|
| `licenseExpiresAt` is null | `—`, neutral color |
| More than 14 days from now | `Expires <date>`, green |
| Within 14 days (inclusive), not yet past | `Expires <date> (soon)`, amber |
| Already past | `Expired <date>`, red |

The 14-day "soon" threshold is a constant, not a per-deployment or admin-configurable setting — matches the Version column's own approach of a fixed, non-configurable staleness check.

## 5. Non-goals recap

Nothing here talks to the target box, changes provisioning, or touches `ops/deploy.sh`. This is a Jarvis-only, database-and-UI change — the smallest version of "licensing" that's still meaningful to look at.
