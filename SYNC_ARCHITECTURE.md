# Cross-Device Synchronization Architecture Specification

## 1. Current Deployment Assessment

Dark Forest Finance is architected as a **zero-dependency, local-first static web application** (`index.html`, `finance.js`, `app.js`, `sw.js`, `manifest.webmanifest`) using `localStorage` (`dark-forest-finance.v1`, schema `version: 2`).

Because no backend server, managed database, or environment credentials are provisioned in this workspace:
- **No fake cloud endpoints or hardcoded API keys** are embedded in client code.
- **Cross-device data portability works today** via deterministic **Backup JSON** (`F.createBackup`) and **Restore Backup** (`F.validateBackup` + `F.restoreBackup`) with pre-restore safety snapshots.
- **The local data model is sync-ready**: every entity (`transactions`, `budgets`, `goals`, `contributions`, `recurring`) uses collision-resistant string IDs (`createId()`), integer-cent amounts (`toCents`), strict ISO-8601 dates (`YYYY-MM-DD`), and deterministic recurring occurrence keys (`recurringId` + `occurrenceDate`).

---

## 2. Proposed Backend & Authentication Architecture

To enable optional real-time or background cross-device synchronization without sacrificing local-first speed or privacy, the following architecture is recommended:

### 2.1 Stack & Infrastructure
- **Database**: Managed PostgreSQL (e.g., Supabase, Neon, or self-hosted Postgres) with **Row-Level Security (RLS)** enabled on all tables.
- **Auth**: OAuth 2.0 with PKCE / Passkeys (WebAuthn) / Magic Link issuing short-lived JWT access tokens (`15m` TTL) and rotating refresh tokens.
- **Transport**: HTTPS/TLS 1.3 only; REST/PostgREST or lightweight JSON sync endpoint (`POST /api/v1/sync/pull`, `POST /api/v1/sync/push`).

### 2.2 Database Schema & Row-Level Security (RLS)

All tables include `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, and `deleted_at TIMESTAMPTZ NULL` (soft-delete tombstone for multi-device deletion propagation).

```sql
CREATE TABLE finance_transactions (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 100000000000),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  account TEXT NOT NULL,
  date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recurring_id TEXT NULL,
  occurrence_date DATE NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  PRIMARY KEY (user_id, id)
);

-- Prevent duplicate recurring materialization across multiple devices
CREATE UNIQUE INDEX idx_unique_recurring_occurrence
  ON finance_transactions (user_id, recurring_id, occurrence_date)
  WHERE recurring_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_isolation_policy ON finance_transactions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Equivalent RLS policies (`USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`) apply to `finance_budgets`, `finance_goals`, `finance_goal_contributions`, `finance_recurring_rules`, and `finance_user_settings`.

---

## 3. Conflict Resolution & Multi-Device Idempotency

1. **Cursor-Based Delta Sync**:
   - Each client stores `lastSyncCursor` (server `updated_at` high-water mark) and a local `pendingMutations` outbox queue.
   - On reconnect or app foregrounding, the client pushes queued mutations and pulls rows where `updated_at > lastSyncCursor`.
2. **Last-Write-Wins (LWW) per Record with Tombstones**:
   - Concurrent edits to the same record ID resolve via server-assigned monotonic `updated_at` (or Hybrid Logical Clock timestamp), preserving the latest edit.
   - Deletions write `deleted_at = now()` instead of hard-deleting rows immediately, ensuring offline devices learn about deletions when they next sync.
3. **Cross-Device Recurring Transaction Idempotency**:
   - When Device A and Device B both open the app on the 1st of the month while offline, both run `F.materializeRecurring(txs, recurring, today)`.
   - Because each materialized transaction carries `(recurringId, occurrenceDate)` and deterministic ID `tx_${recurringId}_${occurrenceDate}`, syncing both devices to the server (or merging locally) deduplicates on `(user_id, recurring_id, occurrence_date)`—guaranteeing **zero duplicate recurring postings**.

---

## 4. Non-Destructive Local-to-Cloud Migration Plan

When a user with existing local data signs in to a cloud account for the first time:

1. **Automatic Pre-Sync Snapshot**:
   - Before any network call, write the current local envelope to `localStorage['dark-forest-finance.v1.backup.pre-sync']` and offer a one-click JSON download.
2. **Initial Sync Strategy Selection**:
   - **Case A — New Cloud Account (Empty Remote)**: Upload all local transactions, budgets, goals, contributions, recurring schedules, and settings in a single atomic transaction.
   - **Case B — Existing Cloud Account + Existing Local Data**: Present a clear reconciliation dialog showing record counts on both sides:
     - **Merge by ID (Recommended)**: Union records by `id` (and `(category)` for budgets, `(recurringId, occurrenceDate)` for recurring postings). Neither device's unique records are lost.
     - **Keep Cloud Only**: Replace local cache after saving the pre-sync local backup.
     - **Replace Cloud with Local**: Overwrite remote state only after explicit confirmation.

---

## 5. Costs, Dependencies & Privacy Trade-offs

| Aspect | Local-First Only (Current) | Optional Cloud Sync (Proposed) |
| :--- | :--- | :--- |
| **External Dependencies** | Zero (runs from static files / offline) | Auth + Postgres/API provider (e.g., Supabase / Cloudflare) |
| **Hosting Cost** | $0 (static hosting / GitHub Pages / local) | Free tier up to ~50k MAU / 500 MB DB; ~$5–$25/mo at scale |
| **Privacy Model** | Data never leaves the browser | Server stores user-scoped rows (or optional client-side AES-GCM encryption before upload) |
| **Offline Capability** | 100% read/write offline (`localStorage` + `sw.js`) | 100% read/write offline via `localStorage` + background outbox sync when online |
