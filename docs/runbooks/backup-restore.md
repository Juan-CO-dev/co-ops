# Backup & Restore Runbook

**Audience:** future you at 2am after a bad migration, a dropped table, or a ransomware/leak scare.
**Last updated:** 2026-07-29 (Ops guardrails mini-arc).
**Owner:** Juan (CGS).

---

## The one-paragraph mental model

CO-OPS is **one Supabase Postgres database** (project ref `bgcvurheqzylyfehqgzh`, us-east-1)
plus **one Supabase Storage bucket** (the private photos bucket, migration 0164) plus the
**Vercel app + env vars** (secrets, not data). Supabase's managed backups (daily snapshots
and, on paid tiers, Point-in-Time Recovery) cover the **Postgres data only**. They do **NOT**
cover Storage objects, and they do **NOT** cover your env vars / JWT signing keys. A "restore"
is therefore always three questions at once: *is the Postgres data back? are the photos back?
do the app's secrets still line up with the restored DB?* This runbook keeps those three
straight so a restore doesn't trade one outage for another.

---

## What is (and isn't) backed up

| Asset | Covered by Supabase PG backups? | How it's actually protected |
|---|---|---|
| Postgres data (all tables, RLS policies, functions, enums) | **Yes** — daily snapshot + PITR (plan-dependent, VERIFY below) | Supabase managed backups |
| Migrations lineage | Indirectly (the applied DDL is in the DB) + **in git** (`supabase/migrations/`) | git is the source of truth for schema history |
| **Storage bucket objects (photos)** | **NO** — a named gap | see "The storage-bucket backup gap" below |
| JWT signing keys / `AUTH_JWT_SECRET` | **NO** | Vercel env + Supabase signing-keys; see `jwt-rotation.md` |
| Service-role & anon keys | **NO** | Supabase project settings (rotatable) |
| Vercel env vars (all `*_SECRET`, `NEXT_PUBLIC_*`, Toast creds, Resend key) | **NO** | Vercel dashboard; keep an offline encrypted copy |

**The trap:** a project-level Postgres restore brings the DATA back but does not touch Storage
or env. If you restore to a fresh project (or a branch), the JWT signing key, service keys, and
Storage contents are all *different or empty* — and the app will 500 or serve broken image links
until you reconcile them. That reconciliation is the hard part of any restore; the data is the
easy part.

---

## VERIFY THIS FIRST (do not assume the plan tier)

Backup capability is **plan-dependent** and changes over time. Before you rely on any of the
below, open the dashboard and confirm — do not trust this document's memory of the tier:

- [ ] **Supabase dashboard → Project → Database → Backups.** Confirm:
    - Whether **daily backups** are enabled and how many days are retained.
    - Whether **Point-in-Time Recovery (PITR)** is enabled (a paid add-on — Pro plan and
      up historically; confirm on the billing/add-ons page). PITR is what lets you restore
      to a *specific second* (e.g. "the moment before the bad migration ran"), vs a
      daily snapshot's coarser granularity.
    - The **recovery window** (how far back PITR can go) and the **RPO** (how much data
      you could lose — with daily-only backups, up to ~24h; with PITR, seconds).
- [ ] If PITR is NOT enabled and this is a real production business (it is), **that is a
      finding** — enabling PITR is the single highest-leverage backup upgrade. Note it in
      the RADAR/DEBT list and get Juan's decision. Do not silently accept daily-only.
- [ ] Confirm **who has the access** to perform a restore (Supabase org owner/admin). If
      only one person does, that is the bus-factor/SPOF risk already named on the ROADMAP
      RADAR — a restore at 2am must not block on one unreachable human.

---

## Restore procedure

There are two shapes of restore. **Pick the least destructive one that solves the problem.**

### Shape A — Restore in place (project-level restore / PITR to the same project)

Use when: the production DB itself is corrupt/wrong (bad migration, mass delete) and you
accept overwriting current data back to the restore point. **This is destructive to
everything written after the restore point.**

1. **STOP writes if you can.** Put the app in a maintenance posture or accept that writes
   between now and the restore point are lost (that's the point of a restore, but be
   deliberate). Note the exact UTC timestamp you're restoring TO.
2. **Take a fresh backup of the current (bad) state first** if the dashboard allows — you
   may need forensic access to what happened, and a restore is one-way.
3. Supabase dashboard → Database → Backups → choose the daily snapshot OR (PITR) the exact
   timestamp → **Restore**. Confirm the destructive prompt.
4. **Reconcile the three assets** (see the checklist below) — even an in-place restore can
   desync Storage references (rows pointing at photos that were deleted after the restore
   point, or vice versa).
5. Run the **post-restore verification** section.

### Shape B — Restore to a BRANCH / separate project (the safe default for drills + partial recovery)

Use when: you want to inspect the backup, recover a single table/rows, or run the quarterly
drill WITHOUT touching production. **This is the default for anything that isn't a confirmed
"production is on fire" event.**

1. Create a Supabase **branch** (dashboard → Branches) or a throwaway project, and restore
   the snapshot/PITR point INTO it. Production is untouched.
2. Inspect / extract what you need (e.g. `pg_dump` a single table, or copy specific rows via
   SQL). For a targeted recovery, copy the recovered rows back into production with a normal,
   audited write path — never a blind table swap.
3. When done: **delete the branch/throwaway project** (a restored copy holds real customer
   data — treat it like production for its whole short life, then destroy it).

---

## The three-asset reconciliation checklist (the part that bites)

After ANY restore, walk all three. A green DB with red Storage or mismatched secrets is still
an outage.

### 1. Postgres data
- [ ] Spot-check row counts on the big tables (`checklist_instances`, `audit_log`,
      `catering_quotes`, `toast_sales_events`) against your expectation for the restore point.
- [ ] **Verify RLS survived.** RLS policies and `SECURITY DEFINER` helper functions are part
      of the schema, so a full restore brings them back — but VERIFY, don't assume. In the
      SQL editor:
    ```sql
    -- policy count sanity (should match your ~122-policy expectation, AGENTS.md)
    SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
    -- the RLS helper is SECURITY DEFINER with a pinned search_path (AGENTS.md law)
    SELECT proname, prosecdef, proconfig
    FROM pg_proc WHERE proname = 'current_user_role_level';
    -- anon must NOT be able to execute the RLS helpers (the hardening law)
    SELECT has_function_privilege('anon', 'current_user_role_level()', 'EXECUTE');
    ```
    Expect: a plausible policy count, `prosecdef = true` with `search_path` pinned, and anon
    EXECUTE = **false**. If a restore ever left a helper anon-executable, that's a Critical —
    see `docs/security/`.
- [ ] Confirm the migrations lineage matches git. If the restore point predates recent
      migrations, RE-APPLY the missing `supabase/migrations/NNNN_*.sql` in order (they're in
      git, the source of truth) rather than hand-editing schema.

### 2. Storage (photos) — the named gap
- [ ] The photos bucket is **NOT** in the PG backup. If you restored to a fresh project, the
      bucket is **empty**. Rows in the photos registry will point at objects that don't exist
      → broken image links (the app degrades to "no photo", it does not 500 — but the evidence
      is gone).
- [ ] If you have an independent Storage backup (see the gap section), restore objects into
      the bucket and verify a sample of registry rows resolve.
- [ ] If you do NOT have one, accept the photo loss for objects created after your last
      Storage export, and document which date range is affected.

### 3. App secrets / identity
- [ ] **JWT signing key alignment.** If you restored to a NEW project, the Supabase signing
      keys are different → the app's `AUTH_JWT_SECRET` won't verify. Follow `jwt-rotation.md`
      to add the app's key as the project's HS256 standby and promote it, OR point the app at
      the restored project's key. Until this is aligned, **every authenticated request 500s.**
- [ ] **Service-role / anon keys.** A new project has new keys → update Vercel env
      (`SUPABASE_SERVICE_ROLE_KEY`, anon key, `NEXT_PUBLIC_SUPABASE_*`) and redeploy.
- [ ] **Toast / Resend / other integration creds** are env, not DB — they survive a DB
      restore but must be re-set if you moved projects.
- [ ] After any env change: **redeploy** (env changes don't apply retroactively; `NEXT_PUBLIC_*`
      inline at build — repopulate then rebuild without cache; AGENTS.md build law).

---

## Post-restore verification

Same spirit as `jwt-rotation.md`'s verification — prove it, don't assume it.

1. Sign in as Juan (PIN + password). Confirm 200 + Set-Cookie (proves JWT alignment).
2. Load `/dashboard` and one authed page per major module (checklists, catering, admin) —
   confirm data renders and RLS isn't over- or under-permitting.
3. Open an item with a photo (if photos were in scope) — confirm the image resolves or
   degrades cleanly.
4. Run a trivial audited action (e.g. record a count) and confirm the `audit_log` row lands:
    ```sql
    SELECT action, occurred_at FROM audit_log
    ORDER BY occurred_at DESC LIMIT 5;
    ```
5. Confirm the nightly cron heartbeat still works (the admin hub's cron card, or a
   `cron.success` row) once its next run fires.

---

## The storage-bucket backup gap (named risk + options)

**Risk:** Supabase's Postgres backups do NOT include Storage bucket objects. The photos
bucket (checklist/receiving/report evidence, migration 0164) is therefore **unprotected by
the primary backup mechanism**. A project-level disaster, an accidental bucket wipe, or a
restore-to-new-project loses every photo with no recovery path from the PG backup.

**Options (get Juan's decision; do not silently accept):**

- **A. Accept the risk (interim).** Photos are corroborating evidence, not the operational
  record of record (the checklist/count/report ROWS are). Losing photos is bad, not fatal.
  Valid ONLY as an explicit, documented interim choice while photo volume is low.
- **B. Scheduled Storage export.** A periodic job (Supabase Storage → S3/other object store,
  or a `supabase storage` CLI sync) copies bucket objects to independent storage on a cadence
  (weekly?). Sets a real RPO for photos. Preferred once photo volume is operationally material.
- **C. Object-store-backed bucket with its own versioning/replication** (if/when the storage
  backend supports it). Highest durability, most setup.

**Recommendation:** move from A → B before photo capture sees real daily adoption (the opening
photo-capture UI + broad receiving photos will drive volume). Until then, this gap is a named
RADAR item; revisit at each quarterly drill.

---

## Quarterly restore drill (do NOT skip — an untested backup is a hope, not a backup)

Run once a quarter. Use **Shape B** (restore to a branch/throwaway) so production is never at
risk. Log each drill at the bottom.

- [ ] **Backups exist and are recent.** Dashboard → Backups: confirm the most recent daily
      snapshot is <24h old and PITR (if enabled) covers the expected window.
- [ ] **Restore succeeds.** Create a branch/throwaway project and restore a recent snapshot
      (or a PITR point ~1h ago) into it. Time how long it takes (that's your real RTO).
- [ ] **RLS/policies survive the restore.** In the restored copy, run the three RLS checks
      from the reconciliation checklist (policy count, SECURITY DEFINER + search_path, anon
      EXECUTE = false). A restore that silently drops or loosens RLS is the scariest failure —
      this drill exists mostly to catch it.
- [ ] **A representative query returns sane data** in the restored copy (row counts, a join
      across a few tables).
- [ ] **Storage gap re-checked.** Confirm the current status of the storage-bucket backup
      decision (A/B/C above) and whether photo volume has crossed the "move to B" line.
- [ ] **Env/secret reconciliation rehearsed** at least in prose: confirm you still know where
      the JWT key, service keys, and integration creds live and how you'd re-align them.
- [ ] **DESTROY the restored copy** when the drill is done (it holds real customer data).
- [ ] Append a row to the drill log below.

---

## Forbidden patterns

- **Never do a Shape-A in-place production restore for a problem a Shape-B targeted recovery
  can solve.** In-place restore is destructive to everything after the restore point — reach
  for it only when production itself is the thing that's wrong.
- **Never restore to a new project and declare victory on the green DB.** Storage is empty and
  the JWT key is different — the app is broken until you reconcile all three assets.
- **Never delete the current (bad) backup before you've captured its state** if forensics
  might matter (a leak, a suspected attack, an unexplained data change).
- **Never leave a drill's restored copy alive.** It's real customer data with production
  sensitivity and no operational purpose — destroy it.
- **Never treat "we have daily backups" as "we have backups."** Untested = unproven; Storage
  = uncovered; secrets = unaligned. The drill is the backup.

---

## Drill log

Append a row each quarter. Date, who ran it, shape used, RTO observed, RLS check result,
storage-gap status, anything that broke.

| Date | Ran by | Shape | RTO | RLS survived? | Storage gap status | Notes |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |
