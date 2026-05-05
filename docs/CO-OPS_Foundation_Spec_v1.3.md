# CO-OPS Foundation Spec v1.3
## Compliments Only Operations Platform — Foundation Layer
### May 2026

> **v1.3 is the first committed version of the Foundation Spec.** v1.0–v1.2 existed as working documents but were never committed to the repo. v1.3 mechanically folds amendments C.16–C.47 from `docs/SPEC_AMENDMENTS.md` into the v1.2 base. All changes are traceable to their amendment entry. No editorial rewrites — surgical edits only.
>
> For the diff summary vs v1.2, see `docs/SPEC_AMENDMENTS.md` entries C.16–C.47.

---

## Diff Summary vs v1.1

This section exists at the top of v1.2 so the reader (Juan, Pete, Cristian, or Claude Code) can see exactly what changed from v1.1 before reading the full document. Every change is intentional and traceable to a design decision made during the v1.2 design session.

### Conceptual model changes

**Artifact model fundamentally restructured.** v1.1 had one `daily_reports` table holding everything. v1.2 splits the day's operational data into multiple distinct artifact types:

- **Opening Checklist** — completion-tracked, role-leveled line items, multi-submission allowed
- **Prep Sheet** — generated dynamically, single-submission, locks on submit
- **Closing Checklist** — completion-tracked, role-leveled line items, multi-submission allowed
- **Shift Overlay** — the management overlay (was `daily_reports`), captures voids/comps/vendor/people/strategic by role tier
- **Written Reports** — free-form, any level 3+ user, optional
- **Announcements** — top-down, AGM+, with acknowledgement tracking
- **Training Reports** — already in v1.1, refined in v1.2

**Synthesis is computed, not stored.** Daily / weekly / monthly "reports" are read-only aggregation views over the underlying granular artifacts. Drill-down works at every level. Optional caching via the existing `weekly_rollups` table for performance and AI snapshots.

**Per-item completion model.** Checklist line items are completed individually, each stamped with `completed_by_user_id` and `completed_at`. "Is this shift complete?" = "Are all required items completed by qualified users?"

**Role-leveled item visibility.** Each checklist item has `min_role_level`. A user sees and can complete items at or below their level. Short-staffed scenarios (SL working alone) work naturally — the SL sees KH-level + SL-level items and fills both.

**Multi-submission events.** Opening and closing artifacts can be submitted multiple times by multiple submitters. Each submission is an event recording what was completed. Prep is single-submission only — locks on submit.

**Soft block on incomplete required items.** At confirmation time, if required items remain incomplete, user can still confirm but must provide written reasons for each unfinished item. PIN re-entry required for confirmation regardless.

**Vendor catalog as the inventory backbone.** v1.1's static `lib/inventory.ts` (24 items) becomes a starter seed. The real registry is `vendor_items` — a per-vendor item catalog populated through the Vendor admin tool. Aggregated inventory = union of active items across active vendors.

### Schema additions (10 new tables)

1. `checklist_templates` — opening/prep/closing/extensible templates, per-location, with `single_submission_only` flag
2. `checklist_template_items` — line items per template, with `min_role_level`, `required`, `expects_count`, `expects_photo`
3. `checklist_instances` — runtime: one per (location, date, shift, type)
4. `checklist_completions` — per-line completion records
5. `checklist_submissions` — event log of submission events
6. `checklist_confirmations` — final PIN-confirm with optional incomplete-items reasons
7. `prep_list_resolutions` — for prep instances, resolved target/current/needed values per item at generation time
8. `written_reports` — free-form author posts
9. `announcements` — top-down directives
10. `announcement_acknowledgements` — per-recipient ack tracking
11. `vendor_items` — vendor item catalog

(Yes, that's actually 11 — the list above said 10 but I miscounted. v1.2 adds 11 tables.)

### Schema changes (modifications to existing tables)

- `daily_reports` **renamed** to `shift_overlays`. Same column structure, same role-leveling, same RLS pattern. Just no longer the catch-all.
- `par_levels.item_key` (TEXT) **replaced** with `par_levels.vendor_item_id` (UUID FK to `vendor_items`). Pars now attach to specific catalog items.
- `training_reports` **adds** `is_observational` BOOLEAN. True when submitter is not the trainee's assigned trainer.
- `vendors` **adds** ordering days, payment terms, ordering contact email/phone (richer profile).

### Permission changes

- **Training write** — was role-exception (trainer/gm/moo/owner/cgs). Now level 3+ across the board. Anyone can write a training report; trainees are formally assigned only to designated `trainer` role users; others write `is_observational=true` reports.
- **Vendor management** split into tiers:
  - GM+ (level 6): full vendor lifecycle (add/remove, activate/deactivate, full profile edit, par values)
  - AGM+ (level 5): item catalog edits on existing vendors, trivial profile edits (contact person, phone, notes)
- **Checklist template management** — new permissions:
  - GM+ (level 6): define and edit checklist templates and items
  - MoO+ (level 6.5): enable/disable templates per location
- **Checklist confirmations** — PIN re-entry at all levels for shift attestation. Not destructive, doesn't require step-up password.

### New admin tools in foundation

In addition to v1.1's User Management, Location Management, Par Levels Config, and Audit Log Viewer:

5. **Vendor Management** — vendor profiles, item catalogs per vendor, par assignment, vendor lifecycle
6. **Checklist Template Management** — define line items per template type per location, with role-leveling and required flags

### Module #1 reshape

The first module, formerly "Daily Report," is renamed **Daily Operations** and includes:

- Opening Checklist UI
- Prep Sheet UI (with auto-generated prep_list_resolutions, par-minus-on_hand math, no forecasting)
- Closing Checklist UI
- Shift Overlay UI (management overlay, role-scoped sections)
- Synthesis View (read-only, aggregates the day's artifacts)

**Written Reports** and **Announcements** become their own modules, promoted to high priority on the build order (modules #2 and #3, ahead of Report Review which becomes module #4).

### Module priority list update

| # (v1.1) | # (v1.2) | Module |
|---|---|---|
| 1 | 1 | Daily Operations (was Daily Report; expanded) |
| — | 2 | **Written Reports** (new) |
| — | 3 | **Announcements** (new) |
| 2 | 4 | Report Review (now reviews all artifact types via synthesis view) |
| 3 | 5 | AI Insights |
| 4 | 6 | Vendor Module (mostly built in foundation; module is UI/workflow polish) |
| 5 | 7 | Inventory Ordering |
| 6 | 8 | Internal Comms |
| 7 | 9 | Maintenance Log |
| 8 | 10 | Cash Deposit Confirmation |
| 9 | 11 | Tip Pool Calculator |
| 10 | 12 | Catering Pipeline + Customers |
| 11 | 13 | Recipe Flash Cards |
| 12 | 14 | AOR / Training Module |
| 13 | 15 | Deep Cleaning Rotation |
| 14 | 16 | Customer Feedback |
| 15 | 17 | LTO Performance Tracking |
| 16 | 18 | Weekly + Monthly Rollups (with forecasting) |

### What did NOT change from v1.1

- Auth model (PIN + email/password tiering, idle timeout, step-up auth)
- Role hierarchy (9 roles, levels 3 through 8)
- RLS philosophy and helper functions
- Notification infrastructure
- Photo upload service
- AI integration layer
- Toast / 7shifts / Twilio adapter scaffolding
- Audit log structure
- Design system (dark theme, CO Gold, DM Sans, mobile-first)
- Stack and deployment topology
- Self-edit window (3 hours) for shift_overlays — applies the same way it did to daily_reports in v1.1
- Append-only correction model after self-edit window expires
- Append-only audit logging

End of diff summary. Full v1.2 specification follows.

---

## 1. Purpose & Scope

### 1.1 What CO-OPS is

CO-OPS is a single-tenant, role-based daily operations platform built specifically for **Compliments Only**, a 2-location chef-inspired sub shop in Washington DC. The app digitizes operational data at the source — every shift, every location, every role — so management can forecast at granular levels and use that data to make better operational decisions.

CO-OPS is a tool for management and employees. It is **not** a product, not multi-tenant, not for sale. It is purpose-built for CO and only CO.

### 1.2 What CO-OPS is NOT

CO-OPS is explicitly distinct from **BLOC OS** — the multi-tenant agentic operations platform Juan is building separately. BLOC OS is the **autonomy layer** that replaces management tasks with AI agents. CO-OPS is the **digitization layer** that gives management better data. They are different products serving different purposes.

This document is about CO-OPS only.

### 1.3 Foundation-first principle

CO-OPS is built in two layers:

- **Foundation Layer (this document)** — Every table, every permission, every RLS policy, every integration adapter, every shared service, every admin tool that future modules depend on.
- **Module Layer (future documents)** — 18 feature modules built sequentially, each adding UI, business logic, and writes/reads against foundation tables that already exist.

Once foundation ships, schema is locked, auth is locked, RBAC is locked, the artifact model is locked. Modules bolt on without requiring schema migrations, auth changes, or model rewrites. Exception: schema additions for new modules land at implementation time (e.g., `time_punches` for Time Clock in Wave 8, per C.47/A13). The foundation-lock rule means modules do not alter existing tables; new module-specific tables are additive.

### 1.4 The artifact model — the heart of CO-OPS

Every operational shift produces a set of artifacts:

- **Opening Checklist** — verifies the prior closing + validates the AM Prep List estimate; not count inventory collection (C.20)
- **AM Prep List** — closer's estimate of tomorrow's prep needs, generated at end of closing shift (`triggered_by: 'closing'`); also **Mid-day Prep** — operator-initiated when mid-shift depletion surfaces (`triggered_by: 'manual'`) — both reuse `checklist_instances` infrastructure with different trigger paths (C.18)
- **Closing Checklist** — what we ended the day with *(two phases: Phase 1 = cleanliness checklist + 50 items; Phase 2 = AM Prep List generation — both under one PIN attestation, C.19)*
- **Shift Overlay** — management's view of how the shift went (voids, comps, vendor, people, strategic)
- **Written Reports** (optional) — anything noteworthy that doesn't fit the structured artifacts
- **Announcements** (when applicable) — top-down directives requiring acknowledgement
- **Training Reports** (when applicable) — observations on a trainee
- **Time Clock Punch** — clock-in/clock-out record where login = clock-in candidate and logout = clock-out candidate; geofence at A2 default 500ft determines actual punch timestamp; feeds 7shifts → Toast Payroll *(Wave 8 / C.47; schema deferred to implementation)*

Each artifact has its own table, its own RLS, its own UI in Module #1+. They co-exist for a given shift. **Synthesis** — the "daily report" you read at the end of the day, the "weekly report" Pete reviews on Monday — is a read-only computed view over these granular artifacts, drillable to source. The dashboard surfaces today's actionable artifacts as tiles (what to do right now); the Reports hub provides historical browse across all artifact types (what happened before). Two distinct surfaces, two distinct visibility models — see C.42.

This model is the central architectural decision of v1.2 and everything else flows from it.

---

## 2. Architectural Decisions (Locked)

### 2.1 Auth model: dual-mode, role-tiered

- **Level 5+ (AGM, Catering Manager, GM, MoO, Owner, CGS):** Email+password AND PIN. Either authenticates into the same identity. One user record per person.
- **Level 4 and below (Shift Lead, Key Holder, Trainer):** PIN only.
- All sessions: 10-minute idle timeout.
- Step-up auth: password re-entry required for destructive actions (level 5+ only).
- Checklist confirmations: PIN re-entry at all levels (not destructive, just attestation).
- PINs are admin-set, not user-chosen.
- PIN length is **4 digits for all role levels** — including level 5+ roles that also have email+password auth (locked Phase 2 Session 1; matches Toast/7shifts punch-in convention so frontline staff don't mode-switch between systems).
- PIN length is **4 digits for all role levels** — including level 5+ roles that also have email+password auth (locked Phase 2 Session 1; matches Toast/7shifts punch-in convention so frontline staff don't mode-switch between systems).

### 2.2 Role hierarchy: 9 roles

| Role | Code | Level |
|---|---|---|
| Chief Growth Strategist | `cgs` | 8 |
| Owner | `owner` | 7 |
| Manager of Operations | `moo` | 6.5 |
| General Manager | `gm` | 6 |
| Asst. General Manager | `agm` | 5 |
| Catering Manager | `catering_mgr` | 5 |
| Shift Lead | `shift_lead` | 4 |
| Key Holder | `key_holder` | 3 |
| Trainer | `trainer` | 3 |

MoO is location-scoped (assigned via `user_locations`), scales horizontally. All Locations view stays Owner+ (level 7+).

Note (C.45): `trainer` is architecturally intended as a capability tag rather than a role in the long-term model; refactor deferred to Module #2. Until Module #2 ships, `trainer` as a RoleCode at level 3 remains operational. Additionally, C.41 reconciliation confirmed the closing finalize gate sits at level ≥ 3 (KH / Trainer) rather than the prior level ≥ 4 (KH only) — see §6.1 for the full three-layer gate model.

Note (C.45): `trainer` is architecturally intended as a capability tag rather than a role in the long-term model; refactor deferred to Module #2. Until Module #2 ships, `trainer` as a RoleCode at level 3 remains operational. Additionally, C.41 reconciliation confirmed the closing finalize gate sits at level ≥ 3 (KH / Trainer) rather than the prior level ≥ 4 (KH only) — see §6.1 for the full three-layer gate model.

### 2.3 Permission model: role-based only

Foundation ships with role-based permissions. No scoped per-user permission grants. Simple lookup: role → permission set.

### 2.4 Artifact model: per-item completion, multi-submission, role-leveled visibility

- One artifact instance per (location, date, shift_type, checklist_type).
- Items on the artifact have `min_role_level`. A user with level X sees and can complete items at levels ≤ X.
- Completions are per-item, stamped with user + timestamp.
- Submissions are events recording a batch of completions.
- "Complete" = all required items completed by qualified users.
- Multi-submission, multi-submitter is normal for opening and closing.
- **AM Prep instances are single-submission** — first submission locks that instance. Mid-day prep instances are also single-submission per instance, but multiple mid-day prep instances can be created at the same location on the same date (C.18, C.43). The `(template_id, location_id, date)` uniqueness constraint applies to single-per-day templates (closing, opening, AM prep) but is relaxed for mid-day prep.
- Soft block on incomplete required items at confirmation: user can still confirm but must provide written reason for each incomplete required item.
- Confirmation requires PIN re-entry.
- **Closing finalization gates on two conditions** (C.26): (1) Walk-Out Verification station fully complete — all 5 Walk-Out Verification items have live, non-superseded completions (operational "last-out" signal); AND (2) actor level ≥ 3 (KH+). Both must hold. The actor who completes the 5th Walk-Out Verification item is the expected finalizer; the finalize affordance appears for that actor. See §6.1 for the full three-layer gate model.

### 2.5 Reports: append-only, time-windowed self-edit

- Artifacts are **never** deleted.
- Self-edit window: **3 hours from `submitted_at`** for shift_overlays and written_reports.
- Checklist completions are append-only for the `completed_by` field — the operational truth of who tapped is never modified. To correct an accidental completion, the revocation columns (`revoked_at`, `revoked_by`, `revocation_reason`) record the correction event (C.28). To correct accountability attribution (wrong person credited), the `actual_completer_id` columns record who actually did the work while `completed_by` is preserved as the tap record. Tag replacement enforces lateral-and-upward only at the lib layer. The supersede-by-recency pattern (new completion event) remains the path for correcting completion *state* (e.g., item re-opened after close).
- After 3 hours: original is locked. **Submitted reports support post-submission updates** with capped chained attribution (C.46): the original submitter (regardless of role) and KH+ users can update a submitted report's values; the chain is capped at 3 total updates (original + 3 = 4 entries max). Each update is itself immutable once written; the chain preserves full history and renders chained attribution (`"Submitted by X at T, updated by Y at T+1, updated by Z at T+2"`). `report.update` audit event on each update. After the cap is reached, the form locks permanently for all users.

### 2.6 Step-up auth: idle-bound, scope-bound

When a level 5+ user enters admin tools and unlocks step-up, the unlock persists until either (a) 10-minute idle, (b) logout, or (c) navigation away from admin tools.

Destructive actions list lives in `lib/destructive-actions.ts`. Modules cannot decide for themselves what is destructive.

### 2.7 Report scoping rules

**Writing artifacts:**
- Locked to user's assigned location.
- Multi-location users explicitly select "Reporting from: [location]" at the start of each artifact.

**Reading artifacts:**
- Single-location view: all artifacts at that location.
- All-Locations view (Owner/CGS only): everything in one stream.

### 2.8 Integration philosophy: adapter-scaffolded, integration-deferred

- **Toast POS:** Adapter built, no live calls. Activation = Phase 2.
- **7shifts:** Same pattern.
- **Twilio SMS:** Adapter built, queue table, consent capture in onboarding. Activation pending A2P 10DLC clearance. In-app notifications work day one.
- **7shifts Time Clock (Wave 8, C.47):** Live-write integration — CO-OPS writes time punch records to 7shifts POST /time_punches on clock-in/clock-out. First integration where CO-OPS actively pushes operational records to an external system rather than just reading schedule data. Adapter requires implementation before Wave 8 Time Clock ships. 7shifts feeds Toast Payroll CSV (that hop is 7shifts' domain).
- **7shifts Time Clock (Wave 8, C.47):** Live-write integration — CO-OPS writes time punch records to 7shifts POST /time_punches on clock-in/clock-out. First integration where CO-OPS actively pushes operational records to an external system rather than reading schedule data. Adapter must be in place before Wave 8 Time Clock ships. 7shifts feeds Toast Payroll CSV (that hop is 7shifts' domain).

### 2.9 Vendor catalog as inventory backbone

`vendor_items` is the source of truth for what items exist. Each vendor's profile holds their item catalog. Aggregated inventory = union of active items across active vendors.

`par_levels` references `vendor_items.id`. Daily checklist line items can reference `vendor_items.id` for auto-population of unit, weekend par, etc.

### 2.10 Foundation-only-empty-tables rule

Foundation creates every table empty. Modules add the writes and reads. Exceptions are seed data (locations, initial admin users) and configuration tables (par levels, vendor catalog, checklist templates) that get populated post-foundation through the foundation admin tools.

### 2.11 Time Clock: login = clock-in; logout = clock-out; geofence-gated

CO-OPS treats session start (login) as a clock-in candidate and session end (logout) as a clock-out candidate. No separate punch interface exists — the login tile IS the punch interface. The geofence (500ft default per location, tunable by GM+) determines the actual punch timestamp:

- **Login inside geofence:** clock-in = login moment
- **Login outside geofence:** clock-in deferred to geofence-entry moment; dashboard shows "not yet clocked in" banner until entry detected via foreground `watchPosition`
- **Logout inside geofence:** clock-out = logout moment
- **Logout outside geofence:** clock-out = most recent geofence-enter timestamp with no subsequent exit (`sessions.last_inside_geofence_at`)

Manager gap reconciliation (KH+ initiates; MoO+ approval required for corrections > 15 min delta or spanning two calendar days) is the primary corrective mechanism for edge cases. Employee attestation on next login acknowledges auto-corrected punches.

Punches sync to 7shifts POST /time_punches; 7shifts feeds Toast Payroll CSV. CO-OPS retains the richer forensic record (geofence metadata, correction chain, attestation history).

DC compliance: second precision, no rounding, 3-year retention, TWWFAA quarterly reporting shape (§3.4, C.47).

**Implementation deferred to Wave 8.** Schema migrations (`time_punches` table, `locations` geofence columns, `sessions.last_inside_geofence_at`) land at implementation time (C.47/A13).

---

## 3. Stack & Infrastructure

### 3.1 Stack

- **Framework:** Next.js 16.2.4 (App Router, Turbopack stable). Note: `proxy.ts` replaces `middleware.ts` — Next 16 deprecation; same export shape, same `config.matcher` role.
- **React:** 19.2.4
- **Runtime:** Node.js 22.20.0 LTS (pinned in `.nvmrc` and `package.json` `engines`)
- **Database:** Supabase (Postgres 17.6.1.111, us-east-1, ref `bgcvurheqzylyfehqgzh`)
- **Storage:** Supabase Storage (photos)
- **Auth:** Custom auth layer on top of Supabase (custom JWT, HS256)
- **AI:** Claude API (`claude-sonnet-4-6`, constant `AI_MODEL` in `lib/ai-prompts.ts`) via server-side proxy
- **SMS:** Twilio (deferred activation)
- **Styling:** Tailwind CSS v4 (CSS-first config in `app/globals.css` via `@theme inline` blocks; no `tailwind.config.ts`)
- **i18n:** Custom (`lib/i18n/` — `en.json`/`es.json`, `useTranslation` hook for client components, `serverT` helper for Server Components, `Language` type; canonical helpers `formatTime`/`formatDateLabel`/`formatChainAttribution` in `lib/i18n/format.ts`; system-key-vs-display-string resolver in `lib/i18n/content.ts`) — see C.31, C.37, C.38, C.39
- **Hosting:** Vercel (auto-deploy from GitHub `main`; CI build gate via `.github/workflows/build.yml` required on all PRs to `main`)
- **Source control:** GitHub repo `co-ops` (`https://github.com/Juan-CO-dev/co-ops`, private)
- **Domain:** `co-ops-ashy.vercel.app` (current production alias); custom domain `ops.complimentsonlysubs.com` pending Pete's DNS approval

### 3.2 Environment variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Custom auth
AUTH_JWT_SECRET=xxx
AUTH_PIN_PEPPER=xxx
AUTH_PASSWORD_PEPPER=xxx

# Email
RESEND_API_KEY=xxx
EMAIL_FROM=onboarding@resend.dev  # pending: swap to ops@complimentsonlysubs.com once Resend domain verified

# Claude
ANTHROPIC_API_KEY=xxx

# Twilio (deferred)
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=xxx
TWILIO_ENABLED=false

# Toast (Phase 2)
TOAST_CLIENT_ID=xxx
TOAST_CLIENT_SECRET=xxx
TOAST_ENABLED=false

# 7shifts (Phase 2)
SEVENSHIFTS_API_KEY=xxx
SEVENSHIFTS_ENABLED=false

# App config
NEXT_PUBLIC_APP_URL=https://co-ops-ashy.vercel.app
SESSION_IDLE_MINUTES=10
SELF_EDIT_WINDOW_HOURS=3
```

### 3.3 Deployment topology

- **GitHub** → push to `main` → **Vercel** auto-deploy
- **Vercel** runs Next.js (server components, API routes, edge proxy via `proxy.ts`)
- **Supabase** hosts Postgres, Storage
- **Claude API** called server-side only
- **Twilio** called server-side only
- **CI gate:** `.github/workflows/build.yml` runs `npm run build` on every PR to `main`; branch protection requires the `build` check to pass before merge

No client ever holds service role key, JWT secret, or any provider API key.

### 3.4 DC Labor Compliance

CO operates in the District of Columbia and is subject to the Tipped Wage Workers Fairness Amendment Act (TWWFAA). CO-OPS schema and time-clock behavior are designed for DC compliance from day one (see C.47):

- **Second precision:** all punch timestamps stored as `TIMESTAMPTZ` with full second precision. No rounding. DC law prohibits rounding.
- **3-year retention:** `time_punches` and all `audit_log` time-clock events are permanent (append-only philosophy). DC requires 3-year records; CO-OPS retains indefinitely.
- **TWWFAA quarterly reporting shape:** `time_punches` carries the fields needed to produce the TWWFAA quarterly wage report (employee ID, location, punch-in/out timestamps, role-level at punch time, correction chain) without additional joins. Quarterly export admin tool lands in Phase 5+; schema supports it from Wave 8 implementation day.
- **Implementation timing:** Time Clock is Wave 8 (C.47); schema migrations land at that time. The compliance shape is locked here so Wave 8 implementation does not re-debate it.

---

## 4. Database Schema

All tables in the `public` schema. Every table has RLS enabled (Section 5). Schema is presented grouped by domain.

### 4.1 Auth & Access

#### `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  email_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  phone TEXT,
  pin_hash TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('cgs','owner','moo','gm','agm','catering_mgr','shift_lead','key_holder','trainer')),
  active BOOLEAN DEFAULT true,
  sms_consent BOOLEAN DEFAULT false,
  sms_consent_at TIMESTAMPTZ,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id),
  last_login_at TIMESTAMPTZ,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_active ON users(active);
CREATE INDEX idx_users_role ON users(role);
```

App-layer constraints (not enforceable cleanly in CHECK):
- Role level ≥ 5 → `email` + `password_hash` required, `email_verified` must be true after onboarding
- Role level < 5 → `email`/`password_hash` may be null

Note (C.45): future Module #2 work introduces a capability-tag layer (`is_trainer`, `is_trainee`) — implemented as either a separate `user_tags` table or a JSONB/text-array column on `users`. Decision deferred to Module #2 design conversation. Until then, `trainer` and `trainee` remain RoleCode values.

Note (C.31): `language` was added at Build #1.5 PR 5a as part of i18n infrastructure. Read fresh per Server Component render via `requireSession`; NOT embedded in the session JWT (avoids stale-language UX after toggle). PATCH `/api/users/me/language` is the update path; no audit row emitted (routine UI preference, mirrors `phone`/`sms_consent` self-update convention).

#### `user_locations`
```sql
CREATE TABLE user_locations (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX idx_user_locations_user ON user_locations(user_id);
CREATE INDEX idx_user_locations_location ON user_locations(location_id);
```

#### `locations`
```sql
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('permanent', 'dark_kitchen')),
  active BOOLEAN DEFAULT true,
  address TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

INSERT INTO locations (name, code, type) VALUES
  ('Capitol Hill', 'MEP', 'permanent'),
  ('P Street', 'EM', 'permanent');
```

Note (C.23): `locations.timezone` was referenced in early Module #1 design but is NOT in v1.3 schema. Both CO locations are in DC (`America/New_York`); `OPERATIONAL_TZ` is hardcoded at the consumer (`app/dashboard/page.tsx`, others). When CO expands beyond DC, add `timezone TEXT NOT NULL DEFAULT 'America/New_York'` and update consumers; until then the constant is correct.

Note (C.47, Wave 8 deferred): three columns are added to `locations` at Wave 8 implementation, NOT in v1.3 schema:
```sql
-- Added at Wave 8 implementation (C.47); not in v1.3:
ALTER TABLE locations ADD COLUMN geofence_radius_ft INTEGER NOT NULL DEFAULT 500;
ALTER TABLE locations ADD COLUMN latitude DECIMAL(10,7) NULL;
ALTER TABLE locations ADD COLUMN longitude DECIMAL(10,7) NULL;
```
Documented here as the locked target shape so Wave 8 doesn't re-debate.

#### `sessions`
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('pin', 'password')),
  step_up_unlocked BOOLEAN DEFAULT false,
  step_up_unlocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_active ON sessions(user_id, revoked_at, expires_at);
```

Note (C.47, Wave 8 deferred): `sessions.last_inside_geofence_at TIMESTAMPTZ NULL` is added at Wave 8 implementation as the server-side high-water mark for geofence-enter events (used to compute clock-out timestamp when logout fires outside the geofence). NOT in v1.3 schema; documented here as the locked target shape.

#### `email_verifications`
```sql
CREATE TABLE email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX idx_email_verifications_token ON email_verifications(token_hash);
```

#### `password_resets`
```sql
CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
```

### 4.2 Vendors & Inventory

#### `vendors`
```sql
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,                       -- protein, produce, bread, dairy, dry, beverage, paper, cleaning, smallwares, other
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  ordering_email TEXT,                 -- where orders are sent
  ordering_url TEXT,                   -- portal URL if applicable
  ordering_days TEXT,                  -- free-form: "Sun-Fri", "Mon/Wed/Fri", etc.
  payment_terms TEXT,
  account_number TEXT,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_vendors_active ON vendors(active);
CREATE INDEX idx_vendors_category ON vendors(category);
```

#### `vendor_items`
```sql
CREATE TABLE vendor_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,                  -- "Turkey", "Sweet Peppers", "Quart Container"
  category TEXT,                       -- protein, produce, dairy, dry, beverage, paper, cleaning, etc.
  unit TEXT NOT NULL,                  -- "2/cs", "bundle", "gallon", "case", "each"
  unit_size TEXT,                      -- optional descriptive: "24-pack", "10# bag"
  item_number TEXT,                    -- vendor's SKU or item code
  source_url TEXT,                     -- direct link to ordering
  lead_time_days INTEGER,              -- e.g. 1, 2, 7, 42
  weekday_par DECIMAL(10,2),           -- default par for weekdays
  weekend_par DECIMAL(10,2),           -- default par for weekends
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_vendor_items_vendor ON vendor_items(vendor_id);
CREATE INDEX idx_vendor_items_active ON vendor_items(active);
CREATE INDEX idx_vendor_items_category ON vendor_items(category);
```

#### `par_levels`
```sql
CREATE TABLE par_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  vendor_item_id UUID REFERENCES vendor_items(id) NOT NULL,
  par_value DECIMAL(10,2) NOT NULL,
  day_of_week INTEGER,                 -- NULL = all days; 0=Sun..6=Sat
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(location_id, vendor_item_id, day_of_week)
);

CREATE INDEX idx_par_levels_location ON par_levels(location_id);
CREATE INDEX idx_par_levels_item ON par_levels(vendor_item_id);
```

#### `vendor_deliveries`
```sql
CREATE TABLE vendor_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) NOT NULL,
  location_id UUID REFERENCES locations(id) NOT NULL,
  delivery_date DATE NOT NULL,
  invoice_number TEXT,
  invoice_total DECIMAL(10,2),
  notes TEXT,
  received_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deliveries_vendor_date ON vendor_deliveries(vendor_id, delivery_date DESC);
CREATE INDEX idx_deliveries_location_date ON vendor_deliveries(location_id, delivery_date DESC);
```

#### `vendor_orders`
```sql
CREATE TABLE vendor_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) NOT NULL,
  location_id UUID REFERENCES locations(id) NOT NULL,
  order_date DATE NOT NULL,
  expected_delivery DATE,
  status TEXT CHECK (status IN ('draft','sent','confirmed','delivered','cancelled')),
  total_estimated DECIMAL(10,2),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vendor_orders_vendor ON vendor_orders(vendor_id);
CREATE INDEX idx_vendor_orders_status ON vendor_orders(status);
```

#### `vendor_price_history`
```sql
CREATE TABLE vendor_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_item_id UUID REFERENCES vendor_items(id) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  recorded_by UUID REFERENCES users(id)
);

CREATE INDEX idx_price_history_item ON vendor_price_history(vendor_item_id, effective_date DESC);
```

### 4.3 Checklists

#### `checklist_templates`
```sql
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('opening', 'prep', 'closing')),
  name TEXT NOT NULL,                  -- e.g. "Standard Opening", "Saturday Closing"
  description TEXT,
  active BOOLEAN DEFAULT true,
  single_submission_only BOOLEAN NOT NULL DEFAULT false,
  -- For 'prep' templates this is true. For 'opening' / 'closing' this is false.
  -- Enforcement: lib/checklist-submissions.ts rejects 2nd submission when true.
  reminder_time TIME,                  -- optional: time-of-day to notify shift to start this checklist
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, type, name)
);

CREATE INDEX idx_checklist_templates_location_type ON checklist_templates(location_id, type) WHERE active;
```

#### `checklist_template_items`
```sql
CREATE TABLE checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES checklist_templates(id) ON DELETE CASCADE NOT NULL,
  station TEXT,                        -- visual UI grouping only: "Crunchy Boi", "Walk Ins", "Expo", etc.
  display_order INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,                 -- "Wipe down burners"
  description TEXT,                    -- optional longer explanation
  min_role_level NUMERIC NOT NULL DEFAULT 3,  -- KH+ by default; can be 4, 5, 6, 6.5, 7, 8
  required BOOLEAN NOT NULL DEFAULT true,
  expects_count BOOLEAN NOT NULL DEFAULT false,  -- e.g. "Turkey 3rd pans: ___"
  expects_photo BOOLEAN NOT NULL DEFAULT false,
  vendor_item_id UUID REFERENCES vendor_items(id),  -- optional link for inventory count items
  active BOOLEAN DEFAULT true
);

CREATE INDEX idx_checklist_template_items_template ON checklist_template_items(template_id) WHERE active;
CREATE INDEX idx_checklist_template_items_station ON checklist_template_items(template_id, station, display_order);
```

#### `checklist_instances`
```sql
CREATE TABLE checklist_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES checklist_templates(id) NOT NULL,
  location_id UUID REFERENCES locations(id) NOT NULL,
  date DATE NOT NULL,
  shift_start_at TIMESTAMPTZ,          -- when the instance was created
  status TEXT NOT NULL CHECK (status IN ('open', 'confirmed', 'incomplete_confirmed')) DEFAULT 'open',
  -- 'open' = items can still be completed
  -- 'confirmed' = PIN-confirmed, all required items done
  -- 'incomplete_confirmed' = PIN-confirmed but some required items missed (with reasons)
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id),
  confirmation_note TEXT,                                -- C.16: denormalized from removed checklist_confirmations table
  triggered_by TEXT CHECK (triggered_by IN ('closing', 'opening', 'manual')),  -- C.18: prep trigger path
  triggered_by_user_id UUID REFERENCES users(id),                              -- C.18
  triggered_at TIMESTAMPTZ,                                                    -- C.18
  walk_out_verification_complete BOOLEAN NOT NULL DEFAULT FALSE,               -- C.26: closing finalize gate signal
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(template_id, location_id, date)
);

CREATE INDEX idx_checklist_instances_location_date ON checklist_instances(location_id, date DESC);
CREATE INDEX idx_checklist_instances_status ON checklist_instances(status, date);
CREATE INDEX idx_checklist_instances_template_date ON checklist_instances(template_id, date DESC);
```

Notes:

- **C.16 (denormalized confirmations):** there is no `checklist_confirmations` table. Confirmation state lives on `checklist_instances` via `status` + `confirmed_at` + `confirmed_by` + `confirmation_note`. The PIN-confirm event itself is logged via `checklist_submissions` with `is_final_confirmation = true` plus an `audit_log` row. Incomplete-item reasons captured at confirmation go into `checklist_incomplete_reasons`.
- **C.18 (prep trigger paths):** prep instances carry `triggered_by ∈ {'closing', 'opening', 'manual'}` to disambiguate closer-initiated AM Prep, opener-initiated prep (rare, fires on disagreement per C.20), and mid-day prep (per C.21). `triggered_by_user_id` is the actor who initiated the instance — patterns over time become operational signal in Synthesis View.
- **C.43 (mid-day prep multiple instances per day):** the `UNIQUE (template_id, location_id, date)` constraint applies to single-per-day templates (closing, opening, AM prep). Mid-day prep is the exception — multiple instances per day are operationally normal, disambiguated by `triggered_at` and presented to staff as numbered ("Mid-day Prep #1 (12:30 PM)", "Mid-day Prep #2 (3:15 PM)"). Implementation enforces the constraint conditionally by template type, or drops it generally and enforces single-per-day at the lib layer for non-mid-day templates. Decision deferred to Mid-day Prep design time per C.43.
- **C.26 (Walk-Out Verification gate):** `walk_out_verification_complete` is denormalized from completion-row state (all 5 Walk-Out Verification station items have live, non-superseded completions). UI gate uses this flag to surface the finalize affordance only to the actor who completes the 5th Walk-Out Verification item. Maintained reactively by `lib/checklists.ts` on completion mutations.

#### `checklist_completions`
```sql
CREATE TABLE checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES checklist_instances(id) ON DELETE CASCADE NOT NULL,
  template_item_id UUID REFERENCES checklist_template_items(id) NOT NULL,
  completed_by UUID REFERENCES users(id) NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  count_value DECIMAL(10,2),           -- if template_item.expects_count
  photo_id UUID REFERENCES report_photos(id),  -- if template_item.expects_photo
  notes TEXT,
  superseded_at TIMESTAMPTZ,           -- non-null = a later completion replaced this one
  superseded_by UUID REFERENCES checklist_completions(id),
  -- C.28: revocation columns (operational-error correction)
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  revocation_reason TEXT CHECK (revocation_reason IN ('error_tap', 'not_actually_done', 'other')),
  revocation_note TEXT,                -- required at lib layer when revocation_reason = 'other'
  -- C.28: accountability-tag columns (correction of who actually did the work)
  actual_completer_id UUID REFERENCES users(id),
  actual_completer_tagged_at TIMESTAMPTZ,
  actual_completer_tagged_by UUID REFERENCES users(id),
  -- C.46: post-submission edit chain (chained attribution; cap = 3 updates)
  original_completion_id UUID REFERENCES checklist_completions(id),
  edit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_checklist_completions_instance ON checklist_completions(instance_id) WHERE superseded_at IS NULL;
CREATE INDEX idx_checklist_completions_user ON checklist_completions(completed_by);
CREATE INDEX idx_checklist_completions_history ON checklist_completions(template_item_id, instance_id, completed_at DESC);
```

Notes:

- **C.28 (revoke + accountability tag, two-window architecture):** within 60s of completion, the actor who tapped sees a silent-undo affordance (`revoked_at` + `revoked_by` + `revocation_reason='error_tap'`, no note required, self-only). After 60s, the same actor can revoke with reason (`not_actually_done`, `other` with required `revocation_note`) OR tag the actual completer (`actual_completer_id` annotated; `completed_by` preserved as the tap record). KH+ peer correction (level ≥ 4) can tag any non-revoked completion at any time, with picker scope computed server-side (users with at least one non-revoked completion on this instance, OR users with sign-in audit rows at this location today, filtered by item's `min_role_level`). Tag replacement enforces lateral-and-upward only at the lib layer (`replacement_actor.level >= current_tagger.level`).
- **C.28 architectural separation:** `completed_by` is **operational truth** — the append-only record of who tapped — and is never modified. `actual_completer_id` is **accountability truth** — annotated retrospectively when the wrong person was credited. The two columns answer different questions and intentionally diverge.
- **C.46 (post-submission edit chain):** when a submitted report is updated, a new completion row is written linked to the original via `original_completion_id`. `edit_count` increments per chain (cap = 3 updates per chain head; original + 3 = 4 entries max enforced by the submit RPC). Chain rendering reads all rows linked to the head and emits chained attribution at the UI layer.
- **C.44 (prep snapshot fields):** prep completions carry denormalized fields capturing template state at submission time (item name, PAR target, unit, section, on_hand/back_up/total raw values). These live on `checklist_completions` via existing extension columns or a JSONB `prep_snapshot` field. Historical prep reports remain accurate to their submission moment regardless of subsequent template edits. Exact column shape implemented at Build #2 PR 1; documented here so future template-item admin tooling preserves the snapshot pattern.

#### `checklist_submissions`
```sql
CREATE TABLE checklist_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES checklist_instances(id) ON DELETE CASCADE NOT NULL,
  submitted_by UUID REFERENCES users(id) NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  completion_ids UUID[] NOT NULL,      -- IDs of checklist_completions added in this submission event
  is_final_confirmation BOOLEAN DEFAULT false,  -- true when this is the PIN-confirm submission
  -- C.46: post-submission edit chain
  original_submission_id UUID REFERENCES checklist_submissions(id),
  edit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_checklist_submissions_instance ON checklist_submissions(instance_id);
CREATE INDEX idx_checklist_submissions_user ON checklist_submissions(submitted_by);
```

Note (C.46): chain head is identified by `original_submission_id IS NULL`. Updates link via `original_submission_id` to the head; `edit_count` increments per chain (1, 2, 3 — capped at 3 by submit RPC). Chained attribution rendered at UI from these rows.

#### `checklist_incomplete_reasons`
```sql
CREATE TABLE checklist_incomplete_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES checklist_instances(id) ON DELETE CASCADE NOT NULL,
  template_item_id UUID REFERENCES checklist_template_items(id) NOT NULL,
  reason TEXT NOT NULL,
  reported_by UUID REFERENCES users(id) NOT NULL,
  reported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_incomplete_reasons_instance ON checklist_incomplete_reasons(instance_id);
```

#### `prep_list_resolutions`
```sql
CREATE TABLE prep_list_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES checklist_instances(id) ON DELETE CASCADE NOT NULL,
  vendor_item_id UUID REFERENCES vendor_items(id) NOT NULL,
  par_target DECIMAL(10,2) NOT NULL,
  on_hand DECIMAL(10,2) NOT NULL,
  needed DECIMAL(10,2) NOT NULL,       -- max(par_target - on_hand, 0)
  resolved_at TIMESTAMPTZ DEFAULT now(),
  source_opening_count_at TIMESTAMPTZ, -- when the on_hand value was last counted
  notes TEXT
);

CREATE INDEX idx_prep_resolutions_instance ON prep_list_resolutions(instance_id);
CREATE INDEX idx_prep_resolutions_item ON prep_list_resolutions(vendor_item_id);
```

### 4.4 Shift Overlay (renamed from `daily_reports`)

#### `shift_overlays`
```sql
CREATE TABLE shift_overlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  submitted_by UUID REFERENCES users(id) NOT NULL,
  submitted_by_role TEXT NOT NULL,
  date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('open', 'lunch', 'close')),
  submitted_at TIMESTAMPTZ DEFAULT now(),
  last_edited_at TIMESTAMPTZ,
  edit_count INTEGER DEFAULT 0,

  -- Revenue (close shift; can also be filled later from Toast adapter)
  total_sales DECIMAL(10,2),
  transaction_count INTEGER,
  avg_ticket DECIMAL(10,2),
  walk_in_sales DECIMAL(10,2),
  online_sales DECIMAL(10,2),
  catering_sales DECIMAL(10,2),

  -- Cash
  cash_drawer_start DECIMAL(10,2),
  cash_drawer DECIMAL(10,2),
  cash_deposit DECIMAL(10,2),
  cash_over_short DECIMAL(10,2),
  cash_tips DECIMAL(10,2),

  -- Voids/Comps/Waste
  void_count INTEGER DEFAULT 0,
  void_amount DECIMAL(10,2) DEFAULT 0,
  comp_count INTEGER DEFAULT 0,
  comp_amount DECIMAL(10,2) DEFAULT 0,
  comp_reason TEXT,
  waste_amount DECIMAL(10,2) DEFAULT 0,
  waste_reason TEXT,

  -- Customer
  complaint_count INTEGER DEFAULT 0,
  complaint_type TEXT,

  -- Delivery
  delivery_orders INTEGER DEFAULT 0,
  avg_delivery_time INTEGER,
  dd_orders INTEGER DEFAULT 0,
  ue_orders INTEGER DEFAULT 0,
  toast_orders INTEGER DEFAULT 0,
  delivery_complaints INTEGER DEFAULT 0,
  driver_hours DECIMAL(5,2),

  -- Staffing
  callout_name TEXT,
  callout_reason TEXT,
  callout_covered_by TEXT,
  callout_created_ot BOOLEAN DEFAULT false,
  additional_callouts TEXT,
  ot_employees TEXT,
  sent_home_early TEXT,

  -- Context
  weather TEXT,
  external_event TEXT,
  event_detail TEXT,

  -- Vendor / cost
  vendor_deliveries TEXT,
  invoice_total DECIMAL(10,2),
  price_flags TEXT,
  portion_notes TEXT,

  -- People
  employee_highlight TEXT,
  employee_concern TEXT,
  negative_reviews INTEGER DEFAULT 0,
  review_response_needed BOOLEAN DEFAULT false,
  schedule_adherence TEXT,
  cross_shift_notes TEXT,
  follow_up_items TEXT,

  -- Strategic
  weekly_inventory_notes TEXT,
  pl_notes TEXT,
  maintenance_needed TEXT,
  strategic_notes TEXT,
  cross_location_notes TEXT,

  -- Executive
  owner_directive TEXT,
  market_observation TEXT,
  forecast_notes TEXT,

  -- Journal
  shift_notes TEXT,

  -- Auto-calculated
  par_flags JSONB DEFAULT '[]',
  handoff_flags JSONB DEFAULT '[]'
);

CREATE INDEX idx_shift_overlays_location_date ON shift_overlays(location_id, date DESC);
CREATE INDEX idx_shift_overlays_submitted_by ON shift_overlays(submitted_by);
CREATE INDEX idx_shift_overlays_date ON shift_overlays(date DESC);
CREATE INDEX idx_shift_overlays_shift_date_loc ON shift_overlays(date DESC, shift, location_id);
```

#### `shift_overlay_corrections`
```sql
CREATE TABLE shift_overlay_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_overlay_id UUID REFERENCES shift_overlays(id) NOT NULL,
  submitted_by UUID REFERENCES users(id) NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  field_corrections JSONB NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX idx_overlay_corrections_original ON shift_overlay_corrections(original_overlay_id);
CREATE INDEX idx_overlay_corrections_submitted_by ON shift_overlay_corrections(submitted_by);
```

### 4.5 Written Reports & Announcements

#### `written_reports`
```sql
CREATE TABLE written_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  submitted_by UUID REFERENCES users(id) NOT NULL,
  submitted_by_role TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  last_edited_at TIMESTAMPTZ,
  edit_count INTEGER DEFAULT 0,
  category TEXT,                       -- e.g. 'incident', 'observation', 'request', 'feedback', 'other'
  title TEXT,
  body TEXT NOT NULL,
  visibility_min_level NUMERIC NOT NULL DEFAULT 3,  -- who can read this; default = anyone level 3+
  related_table TEXT,                  -- optional: link to another artifact
  related_id UUID
);

CREATE INDEX idx_written_reports_location_date ON written_reports(location_id, submitted_at DESC);
CREATE INDEX idx_written_reports_author ON written_reports(submitted_by, submitted_at DESC);
CREATE INDEX idx_written_reports_category ON written_reports(category);
```

#### `announcements`
```sql
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),  -- NULL = all locations
  posted_by UUID REFERENCES users(id) NOT NULL,
  posted_by_role TEXT NOT NULL,
  posted_at TIMESTAMPTZ DEFAULT now(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT CHECK (priority IN ('info', 'standard', 'urgent', 'critical')) DEFAULT 'standard',
  requires_acknowledgement BOOLEAN DEFAULT true,
  target_min_role_level NUMERIC NOT NULL DEFAULT 3,
  target_max_role_level NUMERIC,       -- NULL = no upper bound
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true
);

CREATE INDEX idx_announcements_location_active ON announcements(location_id, active, posted_at DESC);
CREATE INDEX idx_announcements_priority ON announcements(priority) WHERE active;
```

#### `announcement_acknowledgements`
```sql
CREATE TABLE announcement_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  acknowledged_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

CREATE INDEX idx_announcement_acks_announcement ON announcement_acknowledgements(announcement_id);
CREATE INDEX idx_announcement_acks_user ON announcement_acknowledgements(user_id);
```

### 4.6 Training

#### `training_reports`
```sql
CREATE TABLE training_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  submitted_by UUID REFERENCES users(id) NOT NULL,
  submitted_by_role TEXT NOT NULL,
  date DATE NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  last_edited_at TIMESTAMPTZ,
  edit_count INTEGER DEFAULT 0,
  trainee_name TEXT NOT NULL,
  trainee_user_id UUID REFERENCES users(id),
  is_observational BOOLEAN NOT NULL DEFAULT false,
  -- true when submitter is NOT the trainee's assigned trainer; just an observation
  skills_practiced TEXT,
  hours_logged DECIMAL(4,1),
  progress_rating TEXT CHECK (progress_rating IN ('ahead','on_track','behind','concern')),
  readiness_notes TEXT,
  trainer_notes TEXT
);

CREATE INDEX idx_training_location_date ON training_reports(location_id, date DESC);
CREATE INDEX idx_training_trainee ON training_reports(trainee_user_id);
CREATE INDEX idx_training_observational ON training_reports(is_observational, date DESC);
```

#### `positions`
```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `position_responsibilities`
```sql
CREATE TABLE position_responsibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES positions(id) ON DELETE CASCADE NOT NULL,
  responsibility TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);

CREATE INDEX idx_responsibilities_position ON position_responsibilities(position_id);
```

#### `training_modules`
```sql
CREATE TABLE training_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  position_id UUID REFERENCES positions(id),
  display_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `training_progress`
```sql
CREATE TABLE training_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES training_modules(id) NOT NULL,
  status TEXT CHECK (status IN ('not_started','in_progress','completed','signed_off')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  signed_off_at TIMESTAMPTZ,
  signed_off_by UUID REFERENCES users(id),
  notes TEXT,
  UNIQUE(user_id, module_id)
);

CREATE INDEX idx_training_progress_user ON training_progress(user_id);
CREATE INDEX idx_training_progress_status ON training_progress(status);
```

### 4.7 Catering

#### `catering_customers`
```sql
CREATE TABLE catering_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  primary_location_id UUID REFERENCES locations(id),
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_catering_customers_location ON catering_customers(primary_location_id);
CREATE INDEX idx_catering_customers_active ON catering_customers(active);
```

#### `catering_orders`
```sql
CREATE TABLE catering_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES catering_customers(id) NOT NULL,
  location_id UUID REFERENCES locations(id) NOT NULL,
  order_date DATE NOT NULL,
  amount DECIMAL(10,2),
  headcount INTEGER,
  items TEXT,
  rating TEXT CHECK (rating IN ('great','good','issue','problem')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_catering_orders_customer ON catering_orders(customer_id);
CREATE INDEX idx_catering_orders_location_date ON catering_orders(location_id, order_date DESC);
```

#### `catering_pipeline`
```sql
CREATE TABLE catering_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES catering_customers(id),
  contact_name TEXT NOT NULL,
  company TEXT,
  event_date DATE,
  headcount INTEGER,
  estimated_revenue DECIMAL(10,2),
  stage TEXT NOT NULL CHECK (stage IN ('inquiry','quote_sent','confirmed','completed','lost')),
  lead_source TEXT,
  location_id UUID REFERENCES locations(id),
  notes TEXT,
  follow_up_date DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pipeline_stage ON catering_pipeline(stage);
CREATE INDEX idx_pipeline_follow_up ON catering_pipeline(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX idx_pipeline_location ON catering_pipeline(location_id);
```

### 4.8 Recipes

#### `recipes`
```sql
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  yield_quantity TEXT,
  prep_time_minutes INTEGER,
  active BOOLEAN DEFAULT true,
  video_url TEXT,
  photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_recipes_active ON recipes(active);
CREATE INDEX idx_recipes_category ON recipes(category);
```

#### `recipe_ingredients`
```sql
CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE NOT NULL,
  ingredient_name TEXT NOT NULL,
  quantity TEXT,
  unit TEXT,
  notes TEXT,
  display_order INTEGER DEFAULT 0
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
```

#### `recipe_steps`
```sql
CREATE TABLE recipe_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE NOT NULL,
  step_number INTEGER NOT NULL,
  instruction TEXT NOT NULL,
  photo_url TEXT,
  UNIQUE(recipe_id, step_number)
);

CREATE INDEX idx_recipe_steps_recipe ON recipe_steps(recipe_id);
```

### 4.9 Maintenance & Cleaning

#### `deep_clean_tasks`
```sql
CREATE TABLE deep_clean_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  frequency_days INTEGER NOT NULL,
  estimated_minutes INTEGER,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `deep_clean_assignments`
```sql
CREATE TABLE deep_clean_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES deep_clean_tasks(id) NOT NULL,
  location_id UUID REFERENCES locations(id) NOT NULL,
  assigned_to UUID REFERENCES users(id),
  scheduled_date DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  verification_photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deep_clean_assignments_location_date ON deep_clean_assignments(location_id, scheduled_date);
CREATE INDEX idx_deep_clean_assignments_assigned_to ON deep_clean_assignments(assigned_to);
```

#### `maintenance_tickets`
```sql
CREATE TABLE maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  reported_by UUID REFERENCES users(id) NOT NULL,
  reported_at TIMESTAMPTZ DEFAULT now(),
  category TEXT,
  priority TEXT CHECK (priority IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  photo_urls TEXT[],
  status TEXT CHECK (status IN ('open','in_progress','resolved','wont_fix')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_notes TEXT
);

CREATE INDEX idx_maintenance_location_status ON maintenance_tickets(location_id, status);
CREATE INDEX idx_maintenance_priority ON maintenance_tickets(priority);
```

### 4.10 Tip Pools

#### `tip_pools`
```sql
CREATE TABLE tip_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  pool_period_start DATE NOT NULL,
  pool_period_end DATE NOT NULL,
  total_tips DECIMAL(10,2) NOT NULL,
  total_hours DECIMAL(10,2),
  rate_per_hour DECIMAL(10,4),
  status TEXT CHECK (status IN ('draft','calculated','distributed')),
  calculated_by UUID REFERENCES users(id),
  calculated_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX idx_tip_pools_location_period ON tip_pools(location_id, pool_period_end DESC);
```

#### `tip_pool_distributions`
```sql
CREATE TABLE tip_pool_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_pool_id UUID REFERENCES tip_pools(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  hours_worked DECIMAL(10,2) NOT NULL,
  tip_amount DECIMAL(10,2) NOT NULL,
  notes TEXT
);

CREATE INDEX idx_tip_distributions_pool ON tip_pool_distributions(tip_pool_id);
CREATE INDEX idx_tip_distributions_user ON tip_pool_distributions(user_id);
```

### 4.11 Customer & LTO

#### `customer_feedback`
```sql
CREATE TABLE customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  submitted_at TIMESTAMPTZ DEFAULT now(),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  category TEXT,
  comment TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  follow_up_needed BOOLEAN DEFAULT false,
  follow_up_assigned_to UUID REFERENCES users(id),
  follow_up_completed_at TIMESTAMPTZ,
  follow_up_notes TEXT
);

CREATE INDEX idx_feedback_location_date ON customer_feedback(location_id, submitted_at DESC);
CREATE INDEX idx_feedback_follow_up ON customer_feedback(follow_up_needed) WHERE follow_up_needed = true;
```

#### `lto_performance`
```sql
CREATE TABLE lto_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  lto_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  units_sold INTEGER DEFAULT 0,
  revenue DECIMAL(10,2) DEFAULT 0,
  food_cost_pct DECIMAL(5,2),
  customer_rating DECIMAL(3,2),
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lto_location_active ON lto_performance(location_id, active);
```

### 4.12 Rollups & AI

#### `weekly_rollups`
```sql
CREATE TABLE weekly_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_sales DECIMAL(12,2),
  total_transactions INTEGER,
  avg_ticket DECIMAL(10,2),
  total_labor_hours DECIMAL(10,2),
  labor_cost_pct DECIMAL(5,2),
  food_cost_pct DECIMAL(5,2),
  total_voids DECIMAL(10,2),
  total_comps DECIMAL(10,2),
  total_waste DECIMAL(10,2),
  data_completeness_pct DECIMAL(5,2),
  generated_at TIMESTAMPTZ DEFAULT now(),
  generated_data JSONB,
  UNIQUE(location_id, week_start)
);

CREATE INDEX idx_weekly_rollups_location_week ON weekly_rollups(location_id, week_start DESC);
```

#### `ai_reports`
```sql
CREATE TABLE ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID,
  requested_by UUID REFERENCES users(id),
  role_level NUMERIC NOT NULL,
  prompt_used TEXT,
  report_text TEXT NOT NULL,
  report_data JSONB,
  model_used TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_reports_user_date ON ai_reports(requested_by, created_at DESC);
CREATE INDEX idx_ai_reports_location_date ON ai_reports(location_id, created_at DESC);
```

### 4.13 Notifications

#### `notifications`
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  category TEXT,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  related_table TEXT,
  related_id UUID,
  location_id UUID REFERENCES locations(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_location ON notifications(location_id);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
```

#### `notification_recipients`
```sql
CREATE TABLE notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  delivery_method TEXT CHECK (delivery_method IN ('in_app','sms','email')),
  delivered_at TIMESTAMPTZ,
  delivery_status TEXT CHECK (delivery_status IN ('pending','sent','failed','disabled')),
  delivery_error TEXT,
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_notif_recipients_user_unread ON notification_recipients(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notif_recipients_notification ON notification_recipients(notification_id);
```

#### `user_notification_prefs`
```sql
CREATE TABLE user_notification_prefs (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
  in_app_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,
  email_enabled BOOLEAN DEFAULT false,
  alert_categories TEXT[] DEFAULT ARRAY['handoff_flag','par_breach','callout','critical_maintenance','announcement'],
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `sms_queue`
```sql
CREATE TABLE sms_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_recipient_id UUID REFERENCES notification_recipients(id),
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT CHECK (status IN ('queued','sent','failed','disabled')),
  twilio_sid TEXT,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sms_queue_status ON sms_queue(status);
```

### 4.14 Photos & Read Receipts

#### `report_photos`
```sql
CREATE TABLE report_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_table TEXT NOT NULL,
  related_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  category TEXT CHECK (category IN ('quality_issue','cleanliness','equipment','inventory','staff_handoff','checklist_verification','other')),
  caption TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER
);

CREATE INDEX idx_photos_related ON report_photos(related_table, related_id);
CREATE INDEX idx_photos_uploaded_by ON report_photos(uploaded_by);
```

#### `report_views`
```sql
CREATE TABLE report_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_table TEXT NOT NULL,
  related_id UUID NOT NULL,
  viewed_by UUID REFERENCES users(id) NOT NULL,
  viewed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_views_related ON report_views(related_table, related_id);
CREATE INDEX idx_views_user ON report_views(viewed_by);
CREATE UNIQUE INDEX idx_views_unique ON report_views(related_table, related_id, viewed_by);
```

### 4.15 Audit Log

#### `audit_log`
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ DEFAULT now(),
  actor_id UUID REFERENCES users(id),
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_table TEXT NOT NULL,
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB,
  destructive BOOLEAN DEFAULT false
);

CREATE INDEX idx_audit_actor ON audit_log(actor_id, occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_table, resource_id);
CREATE INDEX idx_audit_occurred ON audit_log(occurred_at DESC);
CREATE INDEX idx_audit_destructive ON audit_log(destructive, occurred_at DESC) WHERE destructive = true;
```

### 4.16 Integration Adapter Targets

#### `toast_daily_data`
```sql
CREATE TABLE toast_daily_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  business_date DATE NOT NULL,
  raw_payload JSONB NOT NULL,
  total_sales DECIMAL(10,2),
  transaction_count INTEGER,
  void_count INTEGER,
  void_amount DECIMAL(10,2),
  comp_count INTEGER,
  comp_amount DECIMAL(10,2),
  labor_hours DECIMAL(10,2),
  labor_cost DECIMAL(10,2),
  product_mix JSONB,
  channel_mix JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, business_date)
);

CREATE INDEX idx_toast_data_location_date ON toast_daily_data(location_id, business_date DESC);
```

#### `shifts_daily_data`
```sql
CREATE TABLE shifts_daily_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) NOT NULL,
  business_date DATE NOT NULL,
  raw_payload JSONB NOT NULL,
  scheduled_hours DECIMAL(10,2),
  actual_hours DECIMAL(10,2),
  ot_hours DECIMAL(10,2),
  attendance JSONB,
  schedule_adherence_pct DECIMAL(5,2),
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, business_date)
);

CREATE INDEX idx_shifts_data_location_date ON shifts_daily_data(location_id, business_date DESC);
```

### 4.17 Time Clock *(C.47, Wave 8 deferred — schema migration lands at implementation, not in v1.3)*

This section documents the locked target shape for the Wave 8 Time Clock module. The migration is NOT applied in v1.3; schema additions land when 7shifts and Toast integration adapters are operationally stable (Wave 8 per `docs/MODULE_PRIORITY_LIST.md`). Documented here so Wave 8 implementation does not re-debate.

#### `time_punches` *(deferred)*

```sql
-- Wave 8 / C.47 — DO NOT migrate until Wave 8 implementation kickoff
CREATE TABLE time_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES users(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  punch_in_at TIMESTAMPTZ NOT NULL,
  punch_out_at TIMESTAMPTZ NULL,             -- NULL until clock-out
  punch_out_source TEXT NULL                 -- 'logout_inside' | 'logout_auto_corrected' | 'manager' | 'manual'
    CHECK (punch_out_source IN (
      'logout_inside', 'logout_auto_corrected', 'manager', 'manual'
    )),
  late_reason_category TEXT NULL             -- C.47/A8; NULL on clean in-geofence paths
    CHECK (late_reason_category IN (
      'stayed_late_shift_need', 'stayed_late_manager_request', 'stayed_late_personal',
      'forgot_to_clock_out', 'device_issue', 'other'
    )),
  late_reason_free_text TEXT NULL,           -- required at lib layer when category = 'other'
  role_level_at_punch NUMERIC(4,1) NOT NULL, -- snapshot for tipped/non-tipped TWWFAA classification
  seven_shifts_punch_id TEXT NULL,           -- populated on successful 7shifts sync
  seven_shifts_synced_at TIMESTAMPTZ NULL,
  seven_shifts_sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (seven_shifts_sync_status IN ('pending', 'synced', 'failed', 'retry')),
  original_punch_id UUID NULL REFERENCES time_punches(id), -- correction chain head; NULL for originals
  correction_count INTEGER NOT NULL DEFAULT 0,
  manager_correction_by UUID NULL REFERENCES users(id),
  employee_attested_at TIMESTAMPTZ NULL,     -- C.47/A7 next-login attestation
  employee_attestation_disposition TEXT NULL
    CHECK (employee_attestation_disposition IN ('confirmed', 'flagged'))
);

CREATE INDEX time_punches_user_date ON time_punches(user_id, punch_in_at DESC);
CREATE INDEX time_punches_location_date ON time_punches(location_id, punch_in_at DESC);
CREATE INDEX time_punches_sync_status ON time_punches(seven_shifts_sync_status)
  WHERE seven_shifts_sync_status IN ('pending', 'failed', 'retry');
```

Companion deferred migrations on `locations` (`geofence_radius_ft`, `latitude`, `longitude`) and `sessions` (`last_inside_geofence_at`) are documented at §4.1 and on the `sessions` table respectively.

DC compliance shape (§3.4, C.47/A12): second precision; no rounding; permanent retention; TWWFAA quarterly export shape complete without joins. RLS at §5 (employee read-own, KH+ read-location, MoO+ read-all, service-role write-only).

---

## 5. Row-Level Security Policies

RLS enabled on every table. Helper functions read modern PostgREST claim format (`request.jwt.claims` JSONB; the singular `request.jwt.claim.<name>` form was removed in PostgREST v12+ and silently returns NULL — see migration `0032_helpers_modern_claim_format`):

```sql
-- All three helpers are SECURITY DEFINER with locked search_path (Phase 1 Session B audit lock).
-- EXECUTE explicitly REVOKED from anon so anonymous mis-routing fails loudly with
-- insufficient-privilege rather than recursing infinitely on RLS-self-reference.

CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID
SECURITY DEFINER SET search_path = pg_catalog, public
LANGUAGE SQL STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'user_id')::UUID
$$;

CREATE OR REPLACE FUNCTION current_user_role_level() RETURNS NUMERIC
SECURITY DEFINER SET search_path = pg_catalog, public
LANGUAGE SQL STABLE AS $$
  SELECT CASE role
    WHEN 'cgs' THEN 8
    WHEN 'owner' THEN 7
    WHEN 'moo' THEN 6.5
    WHEN 'gm' THEN 6
    WHEN 'agm' THEN 5
    WHEN 'catering_mgr' THEN 5
    WHEN 'shift_lead' THEN 4
    WHEN 'key_holder' THEN 3
    WHEN 'trainer' THEN 3
    ELSE 0
  END FROM users WHERE id = current_user_id()
$$;

CREATE OR REPLACE FUNCTION current_user_locations() RETURNS UUID[]
SECURITY DEFINER SET search_path = pg_catalog, public
LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(location_id), ARRAY[]::UUID[])
  FROM user_locations WHERE user_id = current_user_id()
$$;

REVOKE EXECUTE ON FUNCTION current_user_id()         FROM anon;
REVOKE EXECUTE ON FUNCTION current_user_role_level() FROM anon;
REVOKE EXECUTE ON FUNCTION current_user_locations()  FROM anon;
```

**RLS architectural rules (Phase 1 Session A/B locks — read before writing any new policy):**

1. **Append-only philosophy.** Every table carries an explicit `<table>_no_user_delete USING (false)` policy. Configuration tables (`vendors`, `vendor_items`, `par_levels`, `checklist_templates`, etc.) are deactivated via `active = false`, never deleted. The audit trail relies on rows persisting.
2. **Never use `FOR ALL` for writes.** Permissive policies OR-stack per operation, so `FOR ALL USING (level >= N) OR FOR DELETE USING (false)` resolves to `level >= N` for DELETE — silently permits deletes. Always split writes into explicit `FOR INSERT` + `FOR UPDATE` paired with explicit `FOR DELETE USING (false)`.
3. **UPDATE denials are silent.** UPDATE filters out the row and returns `UPDATE 0` with no exception (sqlstate 42501 fires only on INSERT). Every UPDATE route must check `result.rowCount === 0` and return 404 / 403 explicitly rather than silently succeeding.
4. **Column-level enforcement is app-layer, not RLS.** Postgres can't do per-column RLS cleanly. RLS allows the row write; the API layer rejects payloads touching restricted columns. Documented sites: `shift_overlays.forecast_notes` (CGS-only), `vendors_update_trivial` (AGM+ trivial vs GM+ full), `notification_recipients_update_self` (only `read_at`/`acknowledged_at` user-editable), `users_update_self` vs `users_update_admin` (sensitive fields admin-only). Exception: `training_progress` self-signoff prevention IS in RLS via `signed_off_by != current_user_id()` in WITH CHECK — use RLS when the constraint is row-shaped, app-layer when column-shaped or cross-row.
5. **`canActOn` (admin cannot act on peer/senior) is app-layer.** Strict-greater target check (`admin.level > target.level`) lives in the admin API. RLS gates "can this user touch the table?"; the API enforces "can this admin act on this specific target?".
6. **Naming convention.** Permissive policies: `<table>_<action>` (e.g., `users_read_self`, `vendor_items_insert`). Explicit denies: `<table>_no_user_<operation>` (e.g., `audit_no_user_insert`, `users_no_user_delete`). Service-role bypasses RLS entirely; the `_no_user_*` policies block end-user clients while letting `lib/audit.ts`, `lib/notifications.ts`, integration adapters continue to write via service-role.

### 5.1 Auth tables

Same as v1.1 — `users`, `user_locations`, `locations`, `sessions`, `email_verifications`, `password_resets`. See v1.1 Section 5.

### 5.2 Checklist tables (NEW in v1.2)

```sql
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_templates_read ON checklist_templates FOR SELECT USING (
  location_id = ANY(current_user_locations())
  OR current_user_role_level() >= 7
);

CREATE POLICY checklist_templates_write ON checklist_templates FOR ALL USING (
  current_user_role_level() >= 6
) WITH CHECK (
  current_user_role_level() >= 6
);


ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_template_items_read ON checklist_template_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM checklist_templates t
    WHERE t.id = template_id
    AND (t.location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
  )
);

CREATE POLICY checklist_template_items_write ON checklist_template_items FOR ALL USING (
  current_user_role_level() >= 6
) WITH CHECK (
  current_user_role_level() >= 6
);


ALTER TABLE checklist_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_instances_read ON checklist_instances FOR SELECT USING (
  location_id = ANY(current_user_locations())
  OR current_user_role_level() >= 7
);

CREATE POLICY checklist_instances_insert ON checklist_instances FOR INSERT WITH CHECK (
  location_id = ANY(current_user_locations())
  AND current_user_role_level() >= 3
);

-- Updates limited to status transitions; full edit blocked. Module enforces field-level rules.
CREATE POLICY checklist_instances_update ON checklist_instances FOR UPDATE USING (
  location_id = ANY(current_user_locations())
  AND current_user_role_level() >= 3
);

CREATE POLICY checklist_instances_no_delete ON checklist_instances FOR DELETE USING (false);


ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_completions_read ON checklist_completions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM checklist_instances i
    WHERE i.id = instance_id
    AND (i.location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
  )
);

-- Insert: must be by current user, and template item's min_role_level <= user's level
CREATE POLICY checklist_completions_insert ON checklist_completions FOR INSERT WITH CHECK (
  completed_by = current_user_id()
  AND EXISTS (
    SELECT 1 FROM checklist_template_items ti
    WHERE ti.id = template_item_id
    AND ti.min_role_level <= current_user_role_level()
  )
  AND EXISTS (
    SELECT 1 FROM checklist_instances i
    WHERE i.id = instance_id
    AND i.location_id = ANY(current_user_locations())
    AND i.status = 'open'
  )
);

-- Updates: only system can mark a completion as superseded; no direct user edits
CREATE POLICY checklist_completions_no_user_update ON checklist_completions FOR UPDATE USING (false);
CREATE POLICY checklist_completions_no_delete ON checklist_completions FOR DELETE USING (false);


ALTER TABLE checklist_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_submissions_read ON checklist_submissions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM checklist_instances i
    WHERE i.id = instance_id
    AND (i.location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
  )
);

CREATE POLICY checklist_submissions_insert ON checklist_submissions FOR INSERT WITH CHECK (
  submitted_by = current_user_id()
);

CREATE POLICY checklist_submissions_no_modify ON checklist_submissions FOR UPDATE USING (false);
CREATE POLICY checklist_submissions_no_delete ON checklist_submissions FOR DELETE USING (false);


ALTER TABLE checklist_incomplete_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_incomplete_reasons_read ON checklist_incomplete_reasons FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM checklist_instances i
    WHERE i.id = instance_id
    AND (i.location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
  )
);

CREATE POLICY checklist_incomplete_reasons_insert ON checklist_incomplete_reasons FOR INSERT WITH CHECK (
  reported_by = current_user_id()
);

CREATE POLICY checklist_incomplete_reasons_no_modify ON checklist_incomplete_reasons FOR UPDATE USING (false);


ALTER TABLE prep_list_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY prep_list_resolutions_read ON prep_list_resolutions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM checklist_instances i
    WHERE i.id = instance_id
    AND (i.location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
  )
);

-- Insert through service-role only (resolutions computed at instance generation time)
CREATE POLICY prep_list_resolutions_no_direct_write ON prep_list_resolutions FOR INSERT WITH CHECK (false);
CREATE POLICY prep_list_resolutions_no_modify ON prep_list_resolutions FOR UPDATE USING (false);
```

### 5.3 Shift Overlay (renamed) and corrections

Same patterns as v1.1's `daily_reports` and `report_corrections`, with table names updated:

```sql
ALTER TABLE shift_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY overlays_read ON shift_overlays FOR SELECT USING (
  location_id = ANY(current_user_locations())
  OR current_user_role_level() >= 7
);

CREATE POLICY overlays_insert ON shift_overlays FOR INSERT WITH CHECK (
  submitted_by = current_user_id()
  AND location_id = ANY(current_user_locations())
  AND current_user_role_level() >= 3
);

CREATE POLICY overlays_update_self ON shift_overlays FOR UPDATE USING (
  submitted_by = current_user_id()
  AND submitted_at > now() - interval '3 hours'
) WITH CHECK (
  submitted_by = current_user_id()
  AND submitted_at > now() - interval '3 hours'
);

CREATE POLICY overlays_no_delete ON shift_overlays FOR DELETE USING (false);


ALTER TABLE shift_overlay_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY overlay_corrections_read ON shift_overlay_corrections FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM shift_overlays r
    WHERE r.id = original_overlay_id
    AND (r.location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
  )
);

CREATE POLICY overlay_corrections_insert ON shift_overlay_corrections FOR INSERT WITH CHECK (
  submitted_by = current_user_id()
  AND current_user_role_level() >= 4
  AND EXISTS (
    SELECT 1 FROM shift_overlays r
    WHERE r.id = original_overlay_id
    AND r.location_id = ANY(current_user_locations())
  )
);

CREATE POLICY overlay_corrections_no_modify ON shift_overlay_corrections FOR UPDATE USING (false);
CREATE POLICY overlay_corrections_no_delete ON shift_overlay_corrections FOR DELETE USING (false);
```

### 5.4 Written Reports & Announcements

```sql
ALTER TABLE written_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY written_reports_read ON written_reports FOR SELECT USING (
  current_user_role_level() >= visibility_min_level
  AND (location_id IS NULL OR location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
);

CREATE POLICY written_reports_insert ON written_reports FOR INSERT WITH CHECK (
  submitted_by = current_user_id()
  AND current_user_role_level() >= 3
);

CREATE POLICY written_reports_update_self ON written_reports FOR UPDATE USING (
  submitted_by = current_user_id()
  AND submitted_at > now() - interval '3 hours'
);

CREATE POLICY written_reports_no_delete ON written_reports FOR DELETE USING (false);


ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY announcements_read ON announcements FOR SELECT USING (
  active
  AND current_user_role_level() >= target_min_role_level
  AND (target_max_role_level IS NULL OR current_user_role_level() <= target_max_role_level)
  AND (location_id IS NULL OR location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7)
);

CREATE POLICY announcements_write ON announcements FOR ALL USING (
  current_user_role_level() >= 5
) WITH CHECK (
  current_user_role_level() >= 5
  AND posted_by = current_user_id()
);


ALTER TABLE announcement_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY announcement_acks_read ON announcement_acknowledgements FOR SELECT USING (
  user_id = current_user_id()
  OR current_user_role_level() >= 5
);

CREATE POLICY announcement_acks_insert ON announcement_acknowledgements FOR INSERT WITH CHECK (
  user_id = current_user_id()
);

CREATE POLICY announcement_acks_no_modify ON announcement_acknowledgements FOR UPDATE USING (false);
CREATE POLICY announcement_acks_no_delete ON announcement_acknowledgements FOR DELETE USING (false);
```

### 5.5 Vendor tables

```sql
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_read ON vendors FOR SELECT USING (
  current_user_role_level() >= 3
);

-- Trivial profile updates allowed at AGM+
CREATE POLICY vendors_update_trivial ON vendors FOR UPDATE USING (
  current_user_role_level() >= 5
) WITH CHECK (
  current_user_role_level() >= 5
);

-- Inserts (new vendors) and full lifecycle (active flag changes) require GM+
-- Enforced at API layer: app distinguishes trivial vs full edits
CREATE POLICY vendors_insert ON vendors FOR INSERT WITH CHECK (
  current_user_role_level() >= 6
);

CREATE POLICY vendors_no_delete ON vendors FOR DELETE USING (false);


ALTER TABLE vendor_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_items_read ON vendor_items FOR SELECT USING (
  current_user_role_level() >= 3
);

-- AGM+ can add/remove items and edit them
CREATE POLICY vendor_items_write ON vendor_items FOR ALL USING (
  current_user_role_level() >= 5
) WITH CHECK (
  current_user_role_level() >= 5
);

-- Par values (par_levels) require GM+ — enforced via separate par_levels RLS
ALTER TABLE par_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY par_levels_read ON par_levels FOR SELECT USING (
  location_id = ANY(current_user_locations())
  OR current_user_role_level() >= 7
);

CREATE POLICY par_levels_write ON par_levels FOR ALL USING (
  current_user_role_level() >= 6
) WITH CHECK (
  current_user_role_level() >= 6
);
```

### 5.6 Other location-scoped tables

Identical pattern to v1.1 Section 5.8 — applied to: `vendor_deliveries`, `vendor_orders`, `catering_customers`, `catering_orders`, `catering_pipeline`, `maintenance_tickets`, `tip_pools`, `tip_pool_distributions`, `customer_feedback`, `lto_performance`, `weekly_rollups`, `deep_clean_assignments`, `training_reports`, `toast_daily_data`, `shifts_daily_data`.

### 5.7 Global tables

Identical pattern to v1.1 Section 5.9 — applied to: `recipes`, `recipe_ingredients`, `recipe_steps`, `positions`, `position_responsibilities`, `training_modules`, `deep_clean_tasks`, `vendor_price_history`.

### 5.8 Audit log

```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_read ON audit_log FOR SELECT USING (
  actor_id = current_user_id()
  OR current_user_role_level() >= 7
);

CREATE POLICY audit_no_direct_write ON audit_log FOR INSERT WITH CHECK (false);
CREATE POLICY audit_no_update ON audit_log FOR UPDATE USING (false);
CREATE POLICY audit_no_delete ON audit_log FOR DELETE USING (false);
```

### 5.9 `checklist_completions` revoke + tag policies (C.28)

Three additional UPDATE policies for the C.28 revoke-and-tag model. Lib enforces the 60s quick-window distinction, the lateral-and-upward hierarchy, and the picker-scope check; RLS gates "can this user touch the row at all?":

```sql
-- Self-revoke (silent within 60s; with-reason after 60s — distinction enforced at lib)
CREATE POLICY checklist_completions_update_revoke_self ON checklist_completions
  FOR UPDATE
  USING (completed_by = current_user_id() AND superseded_at IS NULL)
  WITH CHECK (completed_by = current_user_id());

-- KH+ peer correction: tag actual completer (lib enforces lateral-and-upward hierarchy)
CREATE POLICY checklist_completions_update_tag_actual_completer ON checklist_completions
  FOR UPDATE
  USING (current_user_role_level() >= 4 AND superseded_at IS NULL);
```

### 5.10 `time_punches` policies *(C.47, Wave 8 deferred — not applied in v1.3)*

```sql
-- Wave 8 / C.47 — DO NOT apply until Wave 8 implementation kickoff
CREATE POLICY time_punches_read_self ON time_punches FOR SELECT
  USING (user_id = current_user_id());

CREATE POLICY time_punches_read_location ON time_punches FOR SELECT
  USING (current_user_role_level() >= 3 AND location_id = ANY(current_user_locations()));

CREATE POLICY time_punches_read_all ON time_punches FOR SELECT
  USING (current_user_role_level() >= 6.5);

-- All writes service-role only (CO-OPS lib writes punches; clients never write directly)
CREATE POLICY time_punches_no_user_insert ON time_punches FOR INSERT WITH CHECK (false);
CREATE POLICY time_punches_no_user_update ON time_punches FOR UPDATE USING (false);
CREATE POLICY time_punches_no_user_delete ON time_punches FOR DELETE USING (false);
```

---

## 6. Auth System

Identical to v1.1 Section 6 in all behavior. See v1.1 for full flow specs:

- Flow A: PIN sign-in (all users)
- Flow B: Email+password sign-in (level 5+)
- Session JWT structure
- 10-minute idle timeout
- Step-up auth flow
- Email verification flow
- Password reset flow
- PIN reset (admin only, step-up required)
- Account lockout (5 failures → 15-minute lockout)

The only **new auth flow** in v1.2 is **checklist confirmation PIN re-entry**:

### 6.1 Checklist confirmation PIN re-entry

When a user finalizes a checklist instance (sets `status='confirmed'` or `'incomplete_confirmed'`):

1. UI presents the confirmation summary: which items are completed, which are not, who completed each.
2. If any required items are not completed, UI presents an "Incomplete Items" section requiring a written reason for each.
3. User taps "Confirm". Modal appears asking for PIN re-entry.
4. POST `/api/checklist/confirm` with `{instance_id, pin, incomplete_reasons: [...]}`.
5. Server validates: PIN matches user's `pin_hash`; user's role level is sufficient to confirm this checklist (≥ all min_role_levels of completed items, OR equal to highest completed item level).
6. **On success (C.16 — there is no `checklist_confirmations` table):**
   - Transition `checklist_instances.status` to `'confirmed'` or `'incomplete_confirmed'`
   - Set `confirmed_at = now()`, `confirmed_by = actor.user_id`
   - Optionally set `confirmation_note`
   - Insert `checklist_submissions` with `is_final_confirmation = true` and the completion IDs from this confirmation event
   - Insert `checklist_incomplete_reasons` rows for any required-and-incomplete items (one per item, with reason text)
   - Insert `audit_log` row (`action: 'checklist.confirm'`, destructive auto-derived via `lib/destructive-actions.ts`)

PIN re-entry is **not** step-up auth. It's attestation. It requires the PIN even for level 5+ users (who would normally use password). The reason: the confirmation is a record of "the person physically present and authenticated as themselves attests to this." PIN is the on-the-floor auth method and confirmation is an on-the-floor act.

**Three layers of finalization gating** (C.26 — applies to closing-style artifacts; future Opening / Prep finalize flows inherit the pattern):

1. **Item completion** — open to actors whose level satisfies each item's `min_role_level` (lib + RLS).
2. **Operational finalize-ready** — for closing: Walk-Out Verification station fully complete (all 5 Walk-Out Verification items have live, non-superseded completions). UI gate via `checklist_instances.walk_out_verification_complete`. The actor who completes the 5th Walk-Out Verification item is the expected finalizer. Future closing-style artifacts (Opening verification handshake per C.20, Prep submission gates) define their own operational signal but follow the same "operational signal triggers finalize affordance" pattern.
3. **Finalize attestation** — PIN re-entry by the finalizer; role check `actor.level >= max(completed_items.min_role_level)` AND `actor.level >= 3` (KH+; per C.41 reconciliation, was `>= 4` in earlier drafts).

All three must hold. The combined gate prevents premature finalize affordances and preserves the operational signal that "the shift is actually wrapping up, this person is the one locking up."

---

## 7. Roles & Permissions Engine

### 7.1 `lib/roles.ts`

```typescript
export type RoleCode =
  | 'cgs' | 'owner' | 'moo' | 'gm'
  | 'agm' | 'catering_mgr'
  | 'shift_lead' | 'key_holder' | 'trainer';

export interface RoleDefinition {
  code: RoleCode;
  label: string;
  shortLabel: string;
  level: number;
  color: string;
  hasEmailAuth: boolean;
  canAdmin: boolean;
}

export const ROLES: Record<RoleCode, RoleDefinition> = {
  cgs:          { code: 'cgs',          label: 'Chief Growth Strategist', shortLabel: 'CGS', level: 8,   color: '#D4A843', hasEmailAuth: true,  canAdmin: true  },
  owner:        { code: 'owner',        label: 'Owner',                   shortLabel: 'OWN', level: 7,   color: '#6B7280', hasEmailAuth: true,  canAdmin: true  },
  moo:          { code: 'moo',          label: 'Manager of Operations',   shortLabel: 'MOO', level: 6.5, color: '#1F4E79', hasEmailAuth: true,  canAdmin: true  },
  gm:           { code: 'gm',           label: 'General Manager',         shortLabel: 'GM',  level: 6,   color: '#2E75B6', hasEmailAuth: true,  canAdmin: false },
  agm:          { code: 'agm',          label: 'Asst. General Manager',   shortLabel: 'AGM', level: 5,   color: '#2D7D46', hasEmailAuth: true,  canAdmin: false },
  catering_mgr: { code: 'catering_mgr', label: 'Catering Manager',        shortLabel: 'CTR', level: 5,   color: '#E67E22', hasEmailAuth: true,  canAdmin: false },
  shift_lead:   { code: 'shift_lead',   label: 'Shift Lead',              shortLabel: 'SL',  level: 4,   color: '#8B5CF6', hasEmailAuth: false, canAdmin: false },
  key_holder:   { code: 'key_holder',   label: 'Key Holder',              shortLabel: 'KH',  level: 3,   color: '#F59E0B', hasEmailAuth: false, canAdmin: false },
  trainer:      { code: 'trainer',      label: 'Trainer',                 shortLabel: 'TR',  level: 3,   color: '#EC4899', hasEmailAuth: false, canAdmin: false },
};

export function getRoleLevel(code: RoleCode): number {
  return ROLES[code]?.level ?? 0;
}

export function isRoleAtOrAbove(actor: RoleCode, threshold: number): boolean {
  return getRoleLevel(actor) >= threshold;
}

export function canActOn(actor: RoleCode, target: RoleCode): boolean {
  return getRoleLevel(actor) > getRoleLevel(target);
}
```

Notes:

- `minPinLength()` returns `4` for every role (Phase 2 Session 1 lock; matches Toast/7shifts punch-in convention so frontline staff don't mode-switch). Do not reintroduce role-conditional length logic.
- `RoleCode` includes `trainer` and `trainee` as values today; per C.45, these are architecturally intended as capability tags rather than roles in the long-term model. Refactor deferred to Module #2 — until then, the enum stays as shipped.
- C.41 reconciliation: closing finalize gate sits at `level >= 3` (KH / Trainer), not `level >= 4`. Implemented in `lib/checklists.ts` and reflected in UI gates per the three-layer gate model in §6.1.

### 7.2 `lib/permissions.ts`

```typescript
import { RoleCode, getRoleLevel } from './roles';

export type PermissionKey =
  // Shift overlay (was daily report)
  | 'overlay.write.cash'
  | 'overlay.write.voids_comps_waste'
  | 'overlay.write.customer'
  | 'overlay.write.delivery'
  | 'overlay.write.staffing'
  | 'overlay.write.context'
  | 'overlay.write.vendor'
  | 'overlay.write.people'
  | 'overlay.write.strategic'
  | 'overlay.write.executive'
  | 'overlay.write.forecast'
  | 'overlay.read'
  | 'overlay.correct'

  // Checklists
  | 'checklist.complete'                // mark items done at <= my level
  | 'checklist.confirm'                 // PIN-confirm finalization
  | 'checklist.template.write'          // edit templates and items
  | 'checklist.template.enable'         // enable/disable templates per location

  // Written reports & announcements
  | 'written_report.write'
  | 'announcement.post'
  | 'announcement.acknowledge'

  // Training
  | 'training_report.write'

  // Catering
  | 'catering.pipeline.write'
  | 'catering.customers.write'

  // Vendors
  | 'vendor.profile.full_edit'
  | 'vendor.profile.trivial_edit'
  | 'vendor.lifecycle'                  // add/remove/activate/deactivate
  | 'vendor.items.write'
  | 'par_levels.write'

  // AI / admin
  | 'ai.insights.run'
  | 'admin.locations'
  | 'admin.users'
  | 'view.all_locations';

const PERMISSION_MIN_LEVEL: Record<PermissionKey, number> = {
  // Shift overlay
  'overlay.write.cash':              3,
  'overlay.write.voids_comps_waste': 4,
  'overlay.write.customer':          4,
  'overlay.write.delivery':          4,
  'overlay.write.staffing':          4,
  'overlay.write.context':           4,
  'overlay.write.vendor':            5,
  'overlay.write.people':            5,
  'overlay.write.strategic':         6,
  'overlay.write.executive':         7,
  'overlay.write.forecast':          8,
  'overlay.read':                    4,
  'overlay.correct':                 4,

  // Checklists
  'checklist.complete':              3,
  'checklist.confirm':               3,
  'checklist.template.write':        6,
  'checklist.template.enable':       6.5,

  // Written reports
  'written_report.write':            3,
  'announcement.post':               5,
  'announcement.acknowledge':        3,

  // Training
  'training_report.write':           3,  // anyone level 3+

  // Catering
  'catering.pipeline.write':         5,
  'catering.customers.write':        5,

  // Vendors
  'vendor.profile.full_edit':        6,
  'vendor.profile.trivial_edit':     5,
  'vendor.lifecycle':                6,
  'vendor.items.write':              5,
  'par_levels.write':                6,

  // AI / admin
  'ai.insights.run':                 6,
  'admin.locations':                 7,
  'admin.users':                     6.5,
  'view.all_locations':              7,

  // Prep trigger paths (C.21 — mid-day prep open to anyone level 3+)
  'prep.trigger.manual':             3,

  // Post-submission report edit (C.46 — KH+ override; per-report rules layered in lib)
  'report.update':                   3,

  // Time Clock reconciliation (C.47, Wave 8 deferred)
  'time_clock.reconcile.initiate':       3,    // KH+ initiates reconciliation
  'time_clock.reconcile.approve_large':  6.5,  // MoO+ approves > 15 min delta or two-day-spanning corrections
  'time_clock.manual_punch':             3,    // KH+ manual punch entry on behalf of employee
};

export function hasPermission(role: RoleCode, key: PermissionKey): boolean {
  const minLevel = PERMISSION_MIN_LEVEL[key];
  if (minLevel === undefined) return false;
  return getRoleLevel(role) >= minLevel;
}

export function permissionsForRole(role: RoleCode): PermissionKey[] {
  return (Object.keys(PERMISSION_MIN_LEVEL) as PermissionKey[])
    .filter(k => hasPermission(role, k));
}
```

### 7.3 Destructive actions

```typescript
// lib/destructive-actions.ts

export const DESTRUCTIVE_ACTIONS = [
  // User lifecycle
  'user.create',
  'user.activate',
  'user.deactivate',
  'user.promote',
  'user.demote',
  'user.change_locations',
  'user.reset_pin',
  'user.change_email',

  // Location lifecycle
  'location.create',
  'location.activate',
  'location.deactivate',
  'location.change_type',

  // Configuration
  'pars.update',
  'system.config_update',

  // Vendor lifecycle (NEW in v1.2)
  'vendor.create',
  'vendor.activate',
  'vendor.deactivate',
  'vendor.full_profile_edit',  // non-trivial fields

  // Checklist template lifecycle (NEW in v1.2)
  'checklist_template.create',
  'checklist_template.delete_or_deactivate',
  'checklist_template_item.delete',  // adding/editing items is non-destructive; deleting is

  // Bulk / sensitive
  'reports.bulk_export',
  'reports.bulk_correct',
  'audit.retention_change',

  // Checklist completion correction (C.28 — revoke + accountability tag)
  'checklist_completion.revoke',
  'checklist_completion.tag_actual_completer',

  // Post-submission report edit (C.46 — chained attribution)
  'report.update',

  // Audit trail self-correction (Build #2 PR 1 incident pattern)
  'audit.metadata_correction',

  // Time Clock (C.47, Wave 8 deferred — codes locked here for forward compatibility)
  'time_clock.punch_corrected',
  'time_clock.punch_voided',
  'time_clock.punch_added',
  'time_clock.attestation_flagged',

  // v2 placeholder
  'permissions.grant',
  'permissions.revoke',
] as const;

export type DestructiveAction = typeof DESTRUCTIVE_ACTIONS[number];

export function isDestructive(action: string): action is DestructiveAction {
  return DESTRUCTIVE_ACTIONS.includes(action as DestructiveAction);
}
```

### 7.4 JWT claim shape (Phase 2 Session 2 lock)

The session JWT signed by `lib/auth.ts` carries:

```ts
{ user_id, app_role, role_level, locations, session_id, role: 'authenticated', iat, exp }
```

Notes:

- **`role` is reserved by PostgREST** for the database role and must be one of `'authenticated'` / `'anon'` / `'service_role'`. CO-OPS app role lives in **`app_role`**, never in `role`. `proxy.ts` attaches `x-co-role` from `app_role`, `x-co-role-level` from `role_level`, etc.
- **Dual verification.** `sessions.token_hash` stores `hashToken(jwt)` (SHA-256). `requireSession` validates BOTH the JWT signature/exp AND that `hashToken(rawCookieJwt) === sessions.token_hash` for the row identified by `session_id`. On mismatch: 401 + cleared cookie + `audit_log` row tagged `session_token_mismatch` (possible `AUTH_JWT_SECRET` leak forgery).
- **HS256 secret is hex-decoded.** Supabase Management API hex-decodes HS256 secrets on key creation (a 64-char hex string becomes a 32-byte key). `lib/auth.ts` consumes `AUTH_JWT_SECRET` via `Buffer.from(secret, 'hex')` so signatures match. Surfaced Phase 2 Session 2 standby-key smoke test.
- **Refresh latency.** `app_role`, `role_level`, `locations` only refresh on session rotation (re-login or 12-hour exp). Admin mutations affecting authorization (deactivate, role change, location add/remove) MUST also `revokeSession()` for every active session of the affected user inside the same transaction. Session revocation also fires on password reset.

### 7.5 i18n primitives (C.31, C.37, C.38, C.39, C.40)

`lib/i18n/` provides the translation infrastructure shared across all UI surfaces:

- **`en.json` / `es.json`** — translation tables, dot-namespaced semantic keys (`auth.*`, `dashboard.*`, `closing.*`, `prep.*`, `common.*`, `role.*`). Spanish style is operational/practical, not formal — audience is restaurant frontline staff. Verb commands tú-form (`Pon`, `Toca`, `Elige`).
- **`useTranslation()`** — client hook returning `t(key, params?)` and current `language`. Provider context populated from `users.language` server-side at render boundary, never from the JWT (avoids stale-language UX after toggle).
- **`serverT(language, key, params?)`** — Server Components.
- **`Language` type** — `'en' | 'es'`.
- **`lib/i18n/format.ts`** — canonical helpers `formatTime(iso, language)`, `formatDateLabel(yyyymmdd, language)`, `formatChainAttribution(chain, language, t)`. Every time/date formatting site uses these — never `toLocaleTimeString(undefined, ...)` (browser locale leaks; produces inconsistent UX when device locale differs from app preference).
- **`lib/i18n/content.ts resolveTemplateItemContent`** — system-key vs display-string resolver. Original English columns stay system source-of-truth + match key; resolver returns display string from `translations.es.*` blob with fallback to original. NEVER use translated strings for matching keys (canonical example: `it.station === "Walk-Out Verification"` — match against English; render via resolver). C.38 architectural rule.
- **C.37 translate-from-day-one:** every new UI surface in Build #2+ ships with translation keys (not literal strings) + Spanish translations in the same PR. English-only string literals are scope-incomplete.

---

## 8. Location Scoping Engine

Identical to v1.1 Section 8 in mechanism. `lib/locations.ts` exports `ALL_LOCATIONS_THRESHOLD = 7`: levels ≥ 7 (Owner, CGS) sit above location authority and get all-locations override at both app and DB layers. Levels below 7 (MoO 6.5, GM 6, AGM 5, Catering Manager 5, Shift Lead 4, KH 3, Trainer 3) get access through `user_locations` join rows. MoO is location-scoped despite being "operationally unscoped" in CO's org model — Cristian gets explicit `user_locations` rows at provision time.

The threshold is load-bearing in RLS: matched by `current_user_role_level() >= 7` clauses in 20+ location-scoped policies. Lifting it is not a one-line change (touches `lib/locations.ts` + every policy + a Phase 1-style RLS audit re-run). Future regional MoO splits work via `user_locations` without code change.

---

## 9. Navigation Shell

### 9.1 Nav structure (updated for v1.2)

```
Top bar (sticky) — `(authed)` layout shell
├── Logo (CO)
├── Location selector (or location name if single-loc)
├── Role badge + notification bell
└── UserMenu (avatar-style initial circle — language toggle, account, logout) — Build #1.5 PR 5b

Dashboard (/)
├── Greeting + date + location (date format via formatDateLabel — language-aware)
├── Active announcements (unacknowledged)
├── Handoff flag card (if flags exist)
├── Today's actionable artifacts as TILES (C.42 dashboard-as-action-hub model)
│   ├── Closing Checklist tile
│   ├── AM Prep tile (KH+ default; assignable down to trainer/employee per C.42)
│   ├── Mid-day Prep tile (level 3+ — anyone on shift can trigger per C.21)
│   ├── Cash Report tile (SL+/KH+)
│   ├── Opening Report tile (SL+/KH+)
│   ├── Special Report tile (anyone)
│   └── Training Report tile (trainer-tagged)
├── Stat cards
└── Module grid (gated by permissions)

Reports hub (/reports) — C.42 reports-hub-as-library
└── Historical browse across all artifact types; read-oriented; role-scoped read map distinct
    from dashboard tile visibility map (two surfaces, two visibility models).

Module entries (foundation built / placeholder / external)
├── Daily Operations              FOUNDATION-PLACEHOLDER (Module #1)
│   ├── Opening Checklist
│   ├── Prep Sheet
│   ├── Closing Checklist
│   ├── Shift Overlay
│   └── Today's Synthesis View
├── Written Reports               FOUNDATION-PLACEHOLDER (Module #2)
├── Announcements                 FOUNDATION-PLACEHOLDER (Module #3)
├── Reports (review/synthesis)    FOUNDATION-PLACEHOLDER (Module #4)
├── AI Insights                   FOUNDATION-PLACEHOLDER (Module #5)
├── Vendor Module                 FOUNDATION-PLACEHOLDER (Module #6 — extends admin tool)
├── Inventory Ordering            FOUNDATION-PLACEHOLDER (Module #7)
├── Internal Comms                FOUNDATION-PLACEHOLDER (Module #8)
├── Maintenance Log               FOUNDATION-PLACEHOLDER (Module #9)
├── Cash Deposit                  FOUNDATION-PLACEHOLDER (Module #10)
├── Tip Pool                      FOUNDATION-PLACEHOLDER (Module #11)
├── Catering                      FOUNDATION-PLACEHOLDER (Module #12)
├── Recipes                       FOUNDATION-PLACEHOLDER (Module #13)
├── Training Modules              FOUNDATION-PLACEHOLDER (Module #14)
├── Deep Cleaning                 FOUNDATION-PLACEHOLDER (Module #15)
├── Customer Feedback             FOUNDATION-PLACEHOLDER (Module #16)
├── LTO Performance               FOUNDATION-PLACEHOLDER (Module #17)
├── Weekly/Monthly Rollups        FOUNDATION-PLACEHOLDER (Module #18)

Admin tools (level 6.5+ for users; level 7+ for locations)
├── Users                         FOUNDATION-BUILT
├── Locations                     FOUNDATION-BUILT
├── Vendors                       FOUNDATION-BUILT (NEW in v1.2)
├── Checklist Templates           FOUNDATION-BUILT (NEW in v1.2)
├── Par Levels                    FOUNDATION-BUILT
└── Audit Log                     FOUNDATION-BUILT (level 7+)
```

### 9.2 Placeholder pattern

Same as v1.1 — every unbuilt module renders a "Coming Soon" card with description and feature list.

### 9.3 Admin routes

```
/admin/users
/admin/locations
/admin/vendors                    (NEW)
/admin/vendors/[id]               (NEW — vendor detail with item catalog)
/admin/checklist-templates        (NEW)
/admin/checklist-templates/[id]   (NEW — template detail with items)
/admin/pars
/admin/audit
```

Step-up unlock applies to entire `/admin/*` namespace.

**Known limitation (deferred fix):** the `(authed)` layout calls `requireSessionFromHeaders("/dashboard")` for the auth boundary. On auth denial, all routes in the group redirect to `/?next=/dashboard` regardless of original target — loses deep-link intent. Acceptable for v1.3 (deep-link auth scenarios are rare in current usage). Clean fix when revisited: `requireSessionThrows()` variant + error-boundary catch in the layout, page-level auth handles `?next=` with correct path. Schedule when notifications, deep links from external sources (email confirm flows, Slack/SMS link-outs) become common.

---

## 10. Shared Infrastructure Services

Identical to v1.1 Section 10 in all of:

- Photo upload service (`lib/photos.ts`)
- Notification infrastructure (`lib/notifications.ts`)
- SMS adapter (`lib/sms-adapter.ts`)
- AI integration layer (`/api/ai/route.ts`, `lib/ai-prompts.ts`)
- Search/filter/read-receipts (`components/RecordList.tsx`)
- Audit logging (`lib/audit.ts`)
- Expand/collapse card pattern

### 10.2 Auto-completion mechanic (C.19, C.42)

When an operational report (AM Prep, Cash, Opening, etc.) is submitted for the current operational date, a paired `checklist_completions` row writes for the corresponding closing template item. The closing item carries `auto_complete_meta` linking back to the report submission ID. Closing-page renders read the live chain (per C.46) for chained attribution display.

The closing's auto-complete row is NOT superseded on report edits — preserves FK integrity and avoids cascade complexity. Closing-side rendering reads the report submission chain dynamically at render time (Server Component); one extra query, cached at the render boundary. Future report types (Cash, Opening, Mid-day Prep) inherit the same pattern.

### 10.3 Two-surface model (C.42)

**Dashboard tile visibility map** (role-based + assignment-aware) and **Reports hub read-scope map** (role-based) are two distinct visibility models. Dashboard answers "can I do this today"; reports hub answers "can I see this in history."

`report_assignments` schema (assigner_id, assignee_id, report_type, operational_date, optional note) supports the assignment-down mechanic — any user with creation scope on a report type can assign that report to someone of equal-or-lower role level for an operational date. Common patterns: KH+ assigns AM Prep to trainer/employee for training value; AGM+ assigns Cash Report to KH for training cash-handling responsibility; trainer assigns Training Report to themselves OR AGM+ assigns specific trainer to specific trainee.

Two-layer enforcement: UI tile rendering (dashboard conditional on role + assignments) AND API access (RLS policies). UI-only enforcement is insufficient — RLS is the source of truth.

### 10.4 Revoke + tag accountability (C.28)

Two-window architecture for completion correction:

1. **Within 60s** of completion — actor sees silent self-undo affordance on their own row. Revokes with `revocation_reason: 'error_tap'`, no note required, self-only.
2. **After 60s (self)** — three chips: `wrong_user_credited` (opens picker; original tap preserved, `actual_completer_id` annotated), `not_actually_done` (revokes; row reopens), `other` (revokes with required free-form note).
3. **KH+ peer correction (any time post-60s)** — any KH+ actor (level ≥ 4) viewing any completed row sees "Tag actual completer." Picker scope (computed server-side): users with at least one non-revoked completion on this instance, OR users with sign-in audit rows at this location today, filtered by item's `min_role_level`.

**Architectural separation of two truths:** `completed_by` is **operational truth** — append-only record of who tapped — never modified. `actual_completer_id` is **accountability truth** — annotated retrospectively when wrong person credited. Tag replacement is lateral-and-upward only at lib layer (`replacement_actor.level >= current_tagger.level`); original tagger can self-correct any time.

Future signal for Reports Console: patterns of `actual_completer_id != completed_by` rows surface as data-quality signals (volume + role distribution over time) — diagnostic, not punitive.

### 10.5 Chained attribution rendering (C.46)

Post-submission edit chain renders as `"Submitted by X at T, updated by Y at T+1, updated by Z at T+2"` via `formatChainAttribution(chain, language, t)` from `lib/i18n/format.ts`. Cap = 3 updates per chain head (4 entries total — original + 3 updates). After cap, form locks permanently for all users.

**Generalization commitment:** schema additions (`original_*_id` + `edit_count`), RPC pattern (`is_update` parameter; chain-link + edit-cap enforcement; preserve auto-complete artifacts), audit shape (`report.update` action with `report_type` discriminator), and UI affordance pattern (Edit button on tile + closing-ref item; "Editing..." banner; "Update X" CTA; chained attribution rendering) are reused for every report type. Per-report rules vary (Cash Report's edit access may differ from AM Prep's) — each report type defines its own access predicate in lib code, but the architectural primitives are shared infrastructure.

### 10.6 i18n infrastructure

See §7.5 for `lib/i18n/` primitives. Translate-from-day-one (C.37) is a shared-infrastructure convention — every new UI surface in Build #2+ ships with translation keys (not literal strings) + Spanish translations in the same PR. System-key vs display-string discipline (C.38) applies to all DB content with translation needs: original English columns stay system source-of-truth + match key; resolver returns display string with English fallback. Language-aware time/date formatting (C.40, `lib/i18n/format.ts`) is the canonical pattern — never `toLocaleTimeString(undefined, ...)`.

### 10.7 Notes inline rendering (C.29)

`ChecklistItem` renders `completion.notes` inline below the row meta when non-null and the completion is live. Notes are stored on `checklist_completions.notes` (single nullable text field). C.27 multi-tier visibility architecture (public vs managerial, multi-note per completion) deferred pending real-usage feedback from operators.

### 10.8 Station header treatment (C.30)

Station headers across operational surfaces use `text-lg` / `font-semibold` with Mustard-deep accent line beneath each header (~1px, full width of header text). Closing-style operations are physical-first: closer is moving between equipment, prep stations, and back to the screen — needs quick scan-ability that subdued headers don't support. Future Opening / Prep / Cash Report surfaces inherit the same treatment for consistency.

### 10.9 Migration-driven audit emission convention

Precedent set by migration `0045_flip_v1_closing_inactive`. SQL-side audit emissions use:

- `actor_id` = the human invoker
- `metadata.actor_context = "migration_apply"`
- `metadata.migration = "<filename without .sql>"`
- `metadata.phase` + `metadata.reason` per the existing seed-script convention
- `before_state` / `after_state` JSONB carrying field-level transition for forensic clarity (matches `audit_log` physical column shape)
- `metadata.ip_address` / `metadata.user_agent` set to `null` (no request context for migrations)
- Top-level `destructive` set explicitly — don't rely on `isDestructive()` auto-derive (that's JS-side only; SQL-side INSERTs must set the column directly)

Distinguishes migration-direct audit rows from seed-script-emitted (`metadata.creation_method = "seed_script"`) and RPC-emitted rows. Sibling discipline: **RPC-side `audit_log` INSERTs must mirror the actual table column shape, NOT the JS-side `audit()` helper's argument shape.** `ip_address`/`user_agent` go inside `metadata` JSONB, not as top-level columns — `audit_log` does not have those columns. Migration-writes-to-shared-table failures surface as sqlstate 42703 ("column does not exist") at first call (caught Build #2 PR 3). Verification step now mandatory: enumerate `information_schema.columns` for the target table BEFORE writing the INSERT.

**Audit-the-audit pattern (`audit.metadata_correction`):** when a seed re-run or RPC emits an audit row with stale attribution, append-only philosophy forbids UPDATE on existing audit_log rows. Corrective rows reference the stale row IDs in `metadata.corrected_audit_ids` and capture the correct phase/reason. Canonical use: Build #2 PR 1 C.41 reconciliation incident — the seed re-run carried forward stale phase/reason strings from a prior PR; resolved via a single `audit.metadata_correction` row referencing both stale rows.

### 10.10 Time Clock services *(C.47, Wave 8 deferred)*

Documented here so Wave 8 doesn't re-debate. Implementation does not land in v1.3.

- **Geofence enter/exit event model** — foreground `watchPosition` callbacks transition the session between inside-geofence and outside-geofence states. `last_inside_geofence_at` (server-side high-water mark on `sessions`) updated on each inside-geofence callback via heartbeat-style PATCH or extension of existing `/api/auth/heartbeat`. Exact wire-up at implementation time.
- **Time-punch sync-retry queue** — local-first model: punch recorded in `time_punches` immediately; worker pushes to 7shifts; failures retry. Persistent failures surface in manager reconciliation queue.
- **Manager reconciliation queue** — KH+ initiates (add punch / correct / void / manual entry); MoO+ approves corrections > 15 min delta or spanning two calendar days (DC pay-period boundary concern). All reconciliation mutations write through CO-OPS → 7shifts.
- **Employee attestation flow** — next-login modal: "Your [clock-in/clock-out] on [date] was recorded as [time]. Confirm?" Two affordances: Confirm (proceeds normally) / Flag for review (queues second reconciliation review with optional note; MoO+ escalation on flag). Non-blocking on flag.

### 10.1 Updated handoff flag library

`lib/handoff.ts` reworked to draw from the new artifact model. Source of handoff data: most recent confirmed closing checklist instance + most recent shift_overlay for that location.

```typescript
import type { ChecklistInstance, ShiftOverlay, ParLevel, VendorItem } from './types';

export interface HandoffResult {
  lastClosingInstance: ChecklistInstance | null;
  lastOverlay: ShiftOverlay | null;
  flags: HandoffFlag[];
}

export interface HandoffFlag {
  severity: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  source: { table: string; id: string; field?: string };
}

export async function getHandoffForLocation(
  locationId: string,
  supabase: SupabaseClient
): Promise<HandoffResult> {
  // 1. Most recent confirmed closing checklist instance for this location
  // 2. Most recent shift_overlay for this location
  // 3. Active par_levels for this location
  // 4. vendor_items used in checklist completions

  // Generate flags from:
  //  - Closing instance: incomplete_confirmed status, incomplete_reasons
  //  - Overlay: cash O/S, comps, complaints, voids, employee_concern, equipment notes
  //  - Par breaches from latest closing inventory counts (checklist_completions with vendor_item_id)
  //  - Pending maintenance tickets at this location (priority high/critical, status open)

  // Return flags grouped by severity, with source pointers for drill-down
}

export function generateOverlayFlags(overlay: ShiftOverlay): HandoffFlag[] {
  // Same logic as v1.1's generateHandoffFlags but operating on shift_overlay
}

export function generateClosingChecklistFlags(
  instance: ChecklistInstance,
  completions: ChecklistCompletion[],
  reasons: ChecklistIncompleteReason[]
): HandoffFlag[] {
  // Flags raised from closing checklist:
  //  - status === 'incomplete_confirmed'
  //  - any required item with no completion
  //  - any incomplete_reason with critical-keyword content (equipment, safety)
}
```

Stored on shift_overlays.handoff_flags JSONB at submit time, regenerated from closing checklist on confirm.

---

## 11. Integration Adapters (Scaffolded, Deferred)

§11.1 Toast, §11.2 7shifts (read-only schedule data), §11.3 Twilio — all identical to v1.1. Adapters scaffolded; activation deferred per §2.8.

### 11.4 7shifts Time Clock *(C.47, Wave 8 deferred — first live-write integration)*

First CO-OPS integration where the platform actively pushes operational records to an external system rather than just reading scheduled data. Adapter exposes:

- `POST /time_punches` — clock-in / clock-out / manual punch
- `PATCH /time_punches/:id` — corrections (timestamp shifts, reason category updates)
- `DELETE /time_punches/:id` — voids

Sync strategy is **local-first**: CO-OPS records the punch in `time_punches` immediately with `seven_shifts_sync_status = 'pending'`. A sync worker pushes to 7shifts and updates status to `'synced'` (with `seven_shifts_punch_id` populated) or `'failed'` / `'retry'` on error. Retry queue surfaces persistent failures in the manager reconciliation queue (§10.10).

7shifts → Toast Payroll CSV is 7shifts' domain; CO-OPS does not touch Toast directly for time data. CO-OPS `time_punches` is the richer forensic record (geofence metadata, correction chain, attestation history); 7shifts is the authoritative payroll sink.

Adapter implementation lands in Wave 8 alongside the rest of the Time Clock module (§4.17, §3.4 compliance, C.47).

---

## 12. Inventory Item Registry (REWORKED FOR v1.2)

### 12.1 Source of truth

`vendor_items` table is the source of truth. The legacy `lib/inventory.ts` from v1.1 becomes a **starter seed list** loaded into the database on first deploy and managed thereafter through the Vendor Management admin tool.

### 12.2 `lib/inventory.ts` (refactored)

```typescript
import { SupabaseClient } from '@supabase/supabase-js';

export interface InventoryItemView {
  id: string;
  vendorId: string;
  vendorName: string;
  name: string;
  category: string;
  unit: string;
  unitSize?: string;
  itemNumber?: string;
  weekdayPar?: number;
  weekendPar?: number;
  active: boolean;
}

/**
 * The aggregated inventory view: union of all active items from all active vendors,
 * grouped and ordered by category and name.
 */
export async function getAggregatedInventory(
  supabase: SupabaseClient,
  options?: { categories?: string[]; includeInactive?: boolean }
): Promise<InventoryItemView[]> {
  // Query vendor_items joined to vendors, filter active, group by category
}

/**
 * For a given location, returns inventory items with the resolved par values
 * (location-specific overrides via par_levels, falling back to vendor_items defaults).
 */
export async function getInventoryWithPars(
  supabase: SupabaseClient,
  locationId: string,
  dayOfWeek?: number
): Promise<InventoryItemViewWithPar[]> {
  // 1. Get aggregated inventory
  // 2. Join with par_levels for this location
  // 3. Resolve par for each item: day-specific override > all-days override > vendor weekday/weekend default
}
```

### 12.3 Starter seed for foundation

On first deploy, foundation seeds the database with the v1.1 24-item registry as starter data, attached to a placeholder "TBD" vendor that admins are expected to remap. This is so the system is not empty on first login. Real vendor + item entry happens through admin tools post-deploy.

---

## 13. Admin Tools

### 13.1 Location Management (`/admin/locations`)

Same as v1.1 Section 13.1. Foundation builds fully.

### 13.2 User Management (`/admin/users`)

Same as v1.1 Section 13.2. Foundation builds fully.

### 13.3 Par Levels Config (`/admin/pars`)

Updated for v1.2: pars now reference `vendor_items.id` instead of free-floating item_keys.

**Per-location view:**
- Location selector
- Items grouped by category (matching vendor_item categories)
- Each row: item name + vendor name + unit, par columns (all-days, weekend override if any, day-specific overrides)
- Inline edit, save per row

**Destructive action:** updating any par triggers step-up.

### 13.4 Vendor Management (`/admin/vendors`) — NEW

**List view:**
- All vendors, columns: name, category, active, item count, last delivery date
- Add Vendor button (level 6+, step-up)
- Filter by category, active status

**Vendor detail view (`/admin/vendors/[id]`):**
- Tab 1: Profile (name, category, contact, ordering details, payment terms, account number, notes, active)
- Tab 2: Items (the vendor's catalog) — table with name, category, unit, unit_size, item_number, source_url, weekday_par, weekend_par, lead_time, active
- Tab 3: Recent deliveries (read-only, links to vendor_deliveries)
- Tab 4: Price history (read-only, links to vendor_price_history)

**Profile edits:**
- Trivial fields (contact_person, contact_phone, contact_email, notes): AGM+ inline edit
- Full edits (name, category, ordering_email, ordering_url, ordering_days, payment_terms, account_number, active): GM+ + step-up

**Item catalog:**
- Add item: AGM+ + step-up
- Edit item (any field): AGM+ + step-up
- Deactivate item: AGM+ + step-up
- Delete item: GM+ + step-up

**Workflow rule:** when an item is deactivated or deleted, par_levels referencing it are automatically deactivated. Existing checklist completions that reference it remain in place — historical data isn't broken.

### 13.5 Checklist Template Management (`/admin/checklist-templates`) — NEW

**List view:**
- All templates, columns: location, type, name, item count, active, single_submission_only
- Filter by location, type
- Add Template button

**Template detail view (`/admin/checklist-templates/[id]`):**
- Header: location, type, name, description, active toggle, single_submission_only flag (system-set for type=prep, can't be overridden)
- Items table: station, display_order, label, description, min_role_level, required, expects_count, expects_photo, vendor_item_id (if any)
- Add Item / Edit Item / Delete Item / Reorder

**Permissions:**
- Create template: GM+ + step-up
- Edit template metadata: GM+
- Add/edit/reorder items: GM+
- Delete item: GM+ + step-up
- Enable/disable template per location: MoO+ + step-up

**Cloning:** "Clone to another location" button to copy a template + items to another location.

**Prep template editing (C.44):** GM+ admin tooling adds/edits/deactivates/reorders prep template items (sections, PAR values, units, special instructions) plus their `translations.es.*` blob — Spanish translation editing alongside English source-of-truth per C.37. Save handler updates English + Spanish atomically. Items are soft-deleted via `active = false`; historical references resolve through the denormalized snapshot fields on completion rows.

**Whole-template versioning (C.19, Path A):** GM+ admin tooling can supersede a template wholesale (mark v1 inactive, ship v2). All future fresh submissions resolve to v2 via the most-recent-active selector; in-progress instances on v1 carry to completion against v1. Stranded v1 instances (open at flip moment) stay at `status='open'` indefinitely; document them in the deactivation audit row's metadata for forensic clarity.

**Per-submission snapshot universe (C.44 + C.46 sub-finding):** each submission freezes its item-universe at the moment of chain-head submission. Subsequent admin additions of items to the template appear ONLY on fresh submissions, NOT retroactively in any existing chain (whether the chain is on v1 or v2). For C.46 post-submission edits, the form filters template items to the chain head's universe via `completion_ids`. Small info banner surfaces the divergence count to operators: "{N} items added since this report was submitted — they'll appear on tomorrow's report." Filter + banner pattern lands when C.44 admin tooling ships.

### 13.6 Audit Log Viewer (`/admin/audit`)

Same as v1.1 — read-only, level 7+, with filter by actor, resource_table, action, time range.

### 13.7 User capability management *(C.45 — Module #2 deferred)*

Module #2 user lifecycle work introduces capability-tag management (`is_trainer`, `is_trainee` per C.45). Admin UI surfaces tag assignment / revocation alongside role management. Tag grants are append-only with audit (`granted_at`, `granted_by`); deactivation handled via `active BOOLEAN` on the tag row. Tag removal on `is_trainee` is automatic when user is promoted to level ≥ 3, OR via explicit operational action (supervisor decision); once removed, never re-applied. `is_trainer` is granted by appropriate authority (Module #2 locks the threshold; likely MoO+).

Until Module #2 ships, `trainer` and `trainee` remain RoleCode values managed via the existing user-role admin paths.

### 13.8 Time Clock admin *(C.47, Wave 8 deferred)*

Wave 8 admin tooling, NOT in v1.3:

- **Per-location geofence configuration** — GM+ adjusts radius (default 500ft), sets latitude/longitude
- **Manager reconciliation queue UI** — KH+ initiates add/correct/void/manual; MoO+ approves > 15 min delta or two-day-spanning corrections; full audit trail per A6
- **TWWFAA quarterly export** — Phase 5+ admin path; pulls from `time_punches` schema fields without joins (per §3.4 / A12)

---

## 14. Design System

Identical to v1.1 Section 14 in structure. Phase 2 Session 4 repointed design tokens to brand-book values:

**Token names are load-bearing across modules — do not rename without a coordinated migration.** Values updated to brand-book primary palette while names stayed stable:

```css
--co-bg:    #FFF9E4;  /* Mayo (was dark-theme #0A0A0B in v1.1) */
--co-text:  #141414;  /* Diet Coke (was light gray #E5E5E5) */
--co-gold:  #FFE560;  /* Mustard (was muted gold #D4A843) */
--co-cta:   #FF3A44;  /* brand Red — semantically distinct from Mustard
                          per brand-book "use sparingly — only as CTA text" rule */
--role-moo: #1F4E79;  /* darker blue, distinct from gm */
```

Status tokens (`--co-success`, `--co-danger`, `--co-info`) shifted to brand-book secondary palette where applicable. Tailwind v4 CSS-first config lives in `app/globals.css` via `@theme inline` blocks — there is **no `tailwind.config.ts`** (Tailwind v3 file pattern; v4 dropped it). Adding new tokens means extending the `@theme inline` block.

**Email templates** use a typography-only header (Mustard band + "COMPLIMENTS ONLY" set in bold system-font ALL CAPS, 28px, `letter-spacing: -0.02em`). The image-based wordmark variant was tried first and dropped — Gmail blocks `http://localhost` image sources (anti-tracking), and image-proxying behavior varies even for production HTTPS sources. Typography renders identically across Gmail / iOS / Apple Mail / Outlook. The image variant returns to email as a refinement once the production domain is verified and HTTPS image serving is reliable across clients; the typographic header stays as the fallback either way.

Email CTA buttons: Diet Coke fill, brand Red text, ALL CAPS, ≥48px tap target, 18px font, 36px horizontal padding — meets brand-book "Red used most sparingly — only as CTA text" rule.

---

## 15. File & Folder Structure

Captured from the actual repo state at v1.3 commit (2026-05-05). Reflects all foundation phases (0–2.5), Build #1, Build #1.5, and Build #2 PRs 1–3 plus cleanup.

```
co-ops/
├── app/
│   ├── (authed)/                              # auth boundary route group (Build #1.5 PR 5b)
│   │   ├── layout.tsx                         # requireSessionFromHeaders wrapper
│   │   ├── dashboard/page.tsx                 # FOUNDATION + Module #1
│   │   └── operations/
│   │       ├── am-prep/page.tsx               # Build #2 (AM Prep)
│   │       ├── closing/
│   │       │   ├── page.tsx                   # Build #1
│   │       │   └── closing-client.tsx         # client island
│   │       ├── opening/page.tsx               # placeholder
│   │       ├── overlay/page.tsx               # placeholder
│   │       ├── prep/page.tsx                  # placeholder (Mid-day Prep — C.43)
│   │       └── synthesis/page.tsx             # placeholder
│   ├── admin/
│   │   ├── layout.tsx                         # step-up gate
│   │   ├── audit/page.tsx
│   │   ├── checklist-templates/{page.tsx, [id]/page.tsx}
│   │   ├── locations/page.tsx
│   │   ├── pars/page.tsx
│   │   ├── users/page.tsx
│   │   └── vendors/{page.tsx, [id]/page.tsx}
│   ├── api/
│   │   ├── admin/
│   │   │   ├── checklist-templates/{route.ts, [id]/route.ts, [id]/items/route.ts}
│   │   │   ├── locations/route.ts
│   │   │   ├── pars/route.ts
│   │   │   ├── users/route.ts
│   │   │   └── vendors/{route.ts, [id]/route.ts, [id]/items/route.ts}
│   │   ├── ai/route.ts
│   │   ├── auth/
│   │   │   ├── heartbeat/route.ts             # session keepalive (no audit row)
│   │   │   ├── logout/route.ts
│   │   │   ├── password/route.ts
│   │   │   ├── password-reset/route.ts
│   │   │   ├── password-reset-request/route.ts
│   │   │   ├── pin/route.ts
│   │   │   ├── step-up/route.ts
│   │   │   └── verify/route.ts
│   │   ├── checklist/
│   │   │   ├── _helpers.ts
│   │   │   ├── completions/route.ts
│   │   │   ├── completions/[id]/picker-candidates/route.ts    # C.28 picker scope
│   │   │   ├── completions/[id]/revoke/route.ts               # C.28 revoke (60s silent)
│   │   │   ├── completions/[id]/revoke-with-reason/route.ts   # C.28 revoke (post-60s)
│   │   │   ├── completions/[id]/tag-actual-completer/route.ts # C.28 KH+ peer correction
│   │   │   ├── confirm/route.ts
│   │   │   ├── instances/{route.ts, [id]/route.ts}
│   │   │   ├── prep/generate/route.ts
│   │   │   └── submissions/route.ts
│   │   ├── locations/route.ts
│   │   ├── notifications/route.ts
│   │   ├── photos/route.ts
│   │   ├── prep/
│   │   │   ├── _helpers.ts
│   │   │   └── submit/route.ts                # C.46 is_update parameter
│   │   ├── shifts/route.ts                    # 501
│   │   ├── sms/process-queue/route.ts
│   │   ├── toast/route.ts                     # 501
│   │   ├── users/login-options/route.ts       # public; tile-flow login UX
│   │   ├── users/me/language/route.ts         # C.31 language toggle
│   │   └── views/mark-read/route.ts
│   ├── ai/page.tsx                            # placeholder
│   ├── announcements/page.tsx                 # placeholder
│   ├── cash/page.tsx                          # placeholder
│   ├── catering/{customers,pipeline}/page.tsx # placeholder
│   ├── comms/page.tsx                         # placeholder
│   ├── deep-cleaning/page.tsx                 # placeholder
│   ├── feedback/page.tsx                      # placeholder
│   ├── globals.css                            # Tailwind v4 @theme inline tokens
│   ├── layout.tsx
│   ├── lto/page.tsx                           # placeholder
│   ├── maintenance/page.tsx                   # placeholder
│   ├── ordering/page.tsx                      # placeholder
│   ├── page.tsx                               # login (tile flow)
│   ├── recipes/page.tsx                       # placeholder
│   ├── reports/page.tsx                       # Module #4 — placeholder; reports hub lands here
│   ├── reset-password/page.tsx
│   ├── rollups/page.tsx                       # placeholder
│   ├── tips/page.tsx                          # placeholder
│   ├── training/page.tsx                      # placeholder
│   ├── verify/page.tsx
│   └── written-reports/page.tsx               # placeholder
├── components/
│   ├── auth/                                  # auth surface components
│   │   ├── AuthShell.tsx
│   │   ├── IdleTimeoutWarning.tsx
│   │   ├── LocationTile.tsx
│   │   ├── LogoutButton.tsx
│   │   ├── ManagerLoginForm.tsx
│   │   ├── NameTile.tsx
│   │   ├── PasswordModal.tsx                  # scaffold for Phase 5+ admin step-up
│   │   ├── PinConfirmModal.tsx                # scaffold; Phase 4 wires /api/auth/pin-confirm
│   │   ├── PinKeypad.tsx
│   │   ├── RoleTile.tsx
│   │   └── SetPasswordForm.tsx
│   ├── prep/                                  # Build #2 prep UI primitives
│   │   ├── AmPrepForm.tsx
│   │   ├── PrepNumericCell.tsx
│   │   ├── PrepRow.tsx
│   │   ├── PrepSection.tsx
│   │   ├── sections/{CooksSection,MiscSection,SaucesSection,SidesSection,SlicingSection,VegSection}.tsx
│   │   └── types.ts
│   ├── AnnouncementBanner.tsx
│   ├── ChecklistItem.tsx                      # core completable-item primitive
│   ├── ExpandableCard.tsx
│   ├── FormFields.tsx
│   ├── HandoffCard.tsx
│   ├── LocationSelector.tsx
│   ├── Nav.tsx
│   ├── NotificationBell.tsx
│   ├── PhotoUploader.tsx
│   ├── PlaceholderCard.tsx
│   ├── RecordList.tsx
│   ├── ReportReferenceItem.tsx                # closing-side auto-completion render (C.42)
│   └── UserMenu.tsx                           # Build #1.5 PR 5b
├── lib/
│   ├── ai-prompts.ts                          # AI_MODEL = 'claude-sonnet-4-6'
│   ├── api-helpers.ts                         # jsonError, jsonOk, extractIp, parseJsonBody
│   ├── audit.ts
│   ├── auth-flows.ts                          # isLocked, recordFailedAttempt, recordSuccessfulAuth
│   ├── auth.ts
│   ├── checklists.ts                          # core artifact lifecycle primitives
│   ├── destructive-actions.ts
│   ├── email-templates/{_layout.ts, password-reset.ts, verification.ts}
│   ├── email.ts                               # Resend wrapper
│   ├── handoff.ts
│   ├── i18n/                                  # C.31, C.37, C.38, C.39, C.40
│   │   ├── content.ts                         # resolveTemplateItemContent
│   │   ├── en.json
│   │   ├── es.json
│   │   ├── format.ts                          # formatTime, formatDateLabel, formatChainAttribution
│   │   ├── provider.tsx
│   │   ├── server.ts                          # serverT
│   │   └── types.ts                           # Language, TranslationKey
│   ├── inventory.ts                           # starter-seed registry (legacy)
│   ├── locations.ts                           # ALL_LOCATIONS_THRESHOLD = 7
│   ├── notifications.ts
│   ├── permissions.ts
│   ├── photos.ts
│   ├── prep.ts                                # AM Prep + mid-day prep lifecycle
│   ├── report-assignments.ts                  # assignment-down mechanic (C.42)
│   ├── roles.ts
│   ├── session.ts                             # createSession, requireSession, requireSessionFromHeaders
│   ├── shifts-adapter.ts                      # 501
│   ├── sms-adapter.ts
│   ├── supabase-server.ts
│   ├── supabase.ts
│   ├── toast-adapter.ts                       # 501
│   └── types.ts
├── scripts/
│   ├── correct-c41-seed-audit-attribution.ts  # audit.metadata_correction precedent
│   ├── generate-secrets.{ps1,sh}
│   ├── phase-2-audit-harness.ts               # auth regression harness
│   ├── phase-2-juan-dogfood-issue.ts
│   ├── phase-2.5-provision-temp-users.ts
│   ├── seed-am-prep-template.ts
│   ├── seed-closing-template.ts
│   ├── seed-standard-closing-v2.ts            # Path A v2 supersession
│   └── set-temp-pin.ts
├── public/
│   ├── brand/{co-icon.png, co-logomark.png, co-wordmark.png, co-wordmark-icon.png}
│   └── (next-defaults)
├── docs/
│   ├── BRAND_REFERENCE.md
│   ├── CO-OPS_Foundation_Spec_v1.3.md         # this document
│   ├── MODULE_PRIORITY_LIST.md
│   ├── MODULE_REPORTS_CONSOLE_VISION.md
│   ├── PHASE_*_HANDOFF.md (multiple)
│   ├── PHASE_1_RLS_AUDIT.md
│   ├── PHASE_2_AUTH_AUDIT.md
│   ├── PHASE_2.5_TEMP_USERS.md
│   ├── PHASE_3_FOUNDATION_GAP.md
│   ├── SPEC_AMENDMENTS.md                     # corrections log; consumed by future v1.4
│   └── runbooks/jwt-rotation.md
├── .github/workflows/build.yml                # CI build gate (PR-required)
├── .gitattributes                             # LF on *.sh
├── .nvmrc                                     # 22.20.0
├── .vercelignore                              # excludes .env*
├── AGENTS.md                                  # durable knowledge log
├── CLAUDE.md                                  # @AGENTS.md include
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── proxy.ts                                   # was middleware.ts (Next 16 deprecation)
├── README.md
└── tsconfig.json
```

Notable v1.2-vs-v1.3 differences in the tree:

- `middleware.ts` → `proxy.ts` (Next 16)
- No `tailwind.config.ts` (Tailwind v4 CSS-first; tokens in `app/globals.css`)
- `(authed)/` route group with shared layout; closing/AM Prep nest under it
- `lib/i18n/` whole subtree added (C.31)
- `components/auth/` and `components/prep/` subtrees added
- `scripts/` directory exists as canonical home for seeds, harnesses, and one-shot operational tools
- `.github/workflows/build.yml` CI gate
- `lib/email-templates/` + `lib/email.ts` (Resend wrapper)
- New API surfaces: revoke/tag (C.28), prep/submit (C.46), users/me/language (C.31), users/login-options, auth/heartbeat
- `lib/api-helpers.ts`, `lib/auth-flows.ts`, `lib/report-assignments.ts` are new since v1.2

---

## 16. Build Sequencing for Claude Code

v1.2 documented a hypothetical Phase 0–8 plan. v1.3 documents what actually happened (Phase 0 → Build #2 cleanup) and the wave-based model going forward (per `docs/MODULE_PRIORITY_LIST.md`).

### 16.1 Foundation phases — completed

**Phase 0 — Foundation Scaffold (complete 2026-04-28)**
- Next.js 16.2.4 + React 19.2.4 + Tailwind v4 + Node 22 LTS
- Stack deviations from v1.2 documented in §3.1
- `lib/roles.ts`, `lib/permissions.ts`, `lib/destructive-actions.ts`, `lib/types.ts` populated ahead of schedule from §4 + §7
- Vercel project + GitHub auto-deploy + 19 env-var records (10 with empty initial values later populated at Phase 2 production deploy)

**Phase 1 — Database (complete 2026-04-29; tag `phase-1-complete`)**
- 53 tables across §4.1–§4.16, 28 named migrations applied via Supabase MCP
- Helper functions `SECURITY DEFINER` with locked search_path; EXECUTE revoked from anon
- RLS audit: 124/124 pass (`docs/PHASE_1_RLS_AUDIT.md`)
- Seed: 2 locations (MEP, EM), Juan as CGS placeholder, TBD vendor, 24 starter items

**Phase 2 — Auth (complete 2026-04-30; tag `phase-2-complete`)**
- Custom JWT layer (HS256, hex-decoded) + dual JWT/token_hash session verification
- 7 auth API routes; 5 typed errors
- `proxy.ts` edge layer (matcher non-capturing groups required by Next 16)
- Email templates (typography-only header)
- JWT rotation runbook (`docs/runbooks/jwt-rotation.md`)
- Phase 2 audit harness (40/40 pass, `docs/PHASE_2_AUTH_AUDIT.md`)
- Hotfix `hotfix/phase-2-prerender` (Suspense wrappers on `useSearchParams()` pages)

**Phase 2.5 — Temp user provisioning (complete 2026-04-30)**
- Pete (Owner) and Cristian (MoO) provisioned via service-role direct insert (`scripts/phase-2.5-provision-temp-users.ts`)
- Documented bridge pattern; scrub procedure deferred to Phase 5+ admin tooling
- Email lowercase normalization lock (`/api/auth/password` lowercases at lookup; inserts must lowercase at write)

**Phase 3 housekeeping — CI build gate (2026-05-01)**
- `.github/workflows/build.yml` runs `npm run build` on every PR to `main`
- Branch protection requires `build` check; verified end-to-end with junk + clean PRs

**Build #1 — Daily Operations / Closing Checklist (complete 2026-05-01)**
- 50-item closing checklist across 10 stations, multi-author multi-hour
- Walk-Out Verification gate (C.26)
- PIN attestation finalize; read-only flip
- Production live; Cristian uses for real closings
- See `docs/PHASE_3_BUILD_1_HANDOFF.md`

**Build #1.5 — Polish + i18n (complete 2026-05-04)**
- PRs 1–2: revoke + tag accountability (C.28, C.29)
- PR 3: notes inline display
- PR 4: station header prominence (C.30)
- PRs 5a–5d: i18n infrastructure (C.31, C.37, C.38, C.39)
- PR 6: handoff doc
- See `docs/PHASE_3_BUILD_1.5_HANDOFF.md`

**Build #2 — AM Prep + post-submission edits (complete 2026-05-05)**
- PR 1: AM Prep vertical slice (`lib/prep.ts`, `app/(authed)/operations/am-prep/page.tsx`, `components/prep/*`); C.41 closing finalize gate reconciliation; C.42 reports architecture rendered as dashboard tiles + closing-side report-reference items; C.43 mid-day prep multi-instance schema caveat; C.44 PAR template editing deferred
- PR 2: TZ canonical lift; required-fields validation
- PR 3: C.46 post-submission edits with chained attribution; `submit_am_prep_atomic` RPC extended with `is_update` parameter; 2 new typed errors
- Cleanup PR: v1 closing template flipped inactive (Path A supersession per C.19); `formatDateLabel` lifted to `lib/i18n/format.ts` canonical helper
- See `docs/PHASE_3_BUILD_2_PR_3_HANDOFF.md`

### 16.2 Wave-based sequencing — going forward

Per `docs/MODULE_PRIORITY_LIST.md` (canonical priority list):

**Wave 1 — Spec v1.3 refresh (current).** Mechanical fold of C.16–C.47 into v1.2 → v1.3. No code changes. This document is the deliverable.

**Wave 2 — Module #1 remaining builds.**
- Build #3: Opening Report (verifies prior closing + validates AM Prep estimate per C.20)
- Build #4: Mid-day Prep (per C.21, C.43 multi-instance numbering)
- Build #5: Cash Report
- Build #6: Synthesis View (read-only aggregation; pattern signal for `actual_completer_id != completed_by`)
- Build #7: Shift Overlay (management overlay UI; foundation tables already exist)

**Wave 3 — Module #2 User Lifecycle (capability tags + Module #2 admin work).**
- C.45 trainer/trainee role-to-capability refactor (`is_trainer`, `is_trainee` tags)
- Resend domain verification + EMAIL_FROM swap to `ops@complimentsonlysubs.com`
- Phase 2.5 bridge-account scrub procedure
- Admin user-management UI extensions

**Wave 4 — Module #3 Content / Social Media.** Orthogonal domain per C.36; standalone module.

**Wave 5 — Reports Console module.** Per `docs/MODULE_REPORTS_CONSOLE_VISION.md`. Distinct from the in-app Reports hub (C.42); the Console is the management/Pete surface.

**Wave 6 — Module #4 (Report Review) + Module #5 (AI Insights).** AI Insights consumes the rich audit + completion + submission data accumulated by Modules #1–#3.

**Wave 7 — Modules #6–#18.** Vendor, Inventory Ordering, Internal Comms, Maintenance, Cash Deposit, Tip Pool, Catering, Recipes, Training, Deep Cleaning, Customer Feedback, LTO, Rollups. Sequencing per priority list; many extend foundation admin surfaces already built.

**Wave 8 — Time Clock + 7shifts/Toast integration adapters (C.47).**
- 7shifts adapter (POST /time_punches, PATCH, sync-retry queue)
- Toast adapter live-write activation (was scaffolded in Phase 7)
- `time_punches` schema migration + companion migrations on `locations` + `sessions` (per §4.17, §4.1, §4.2 deferred-schema notes)
- Geofence event model + foreground watchPosition + `last_inside_geofence_at` tracking
- Manager reconciliation queue + employee attestation flow
- TWWFAA quarterly export admin tool (Phase 5+ depending on Wave 8 scope)
- Estimated 6–12 months out from Wave 1; depends on operational stability of integration adapters

### 16.3 Working rhythm (preserved across builds)

Build #1 and Build #2 closed clean because the rhythm held:

1. **Surface design decisions before writing code.** Architectural conversations precede implementation. Amendments captured before code.
2. **Surface code before commit.** Review gate at end of implementation, not after.
3. **Commit per step, PR per step.** No bundling. Small focused PRs through CI gate.
4. **Reset to fresh `origin/main` between PRs from the same long-lived branch.** `git fetch origin main && git reset --hard origin/main` before next step.
5. **Push back on flawed assumptions in real-time.** Fix the foundation; don't build on it.
6. **Architecture follows operations, not spec.** When abstraction conflicts with how CO actually runs, capture in `docs/SPEC_AMENDMENTS.md` and build to operational reality.

The 32 amendments folded into v1.3 are operational wisdom translated into durable architectural decisions. The spec is the starting reference; SPEC_AMENDMENTS.md is the running corrections log; v1.4 will fold the next batch.

---

## 17. Acceptance Criteria

### 17.1 Foundation acceptance — verified at Phase 1–2 completion

**Database** ✅ Phase 1 (tag `phase-1-complete`)
- [x] 53 tables created (was ~45 estimate in v1.2)
- [x] All RLS policies in place; 124/124 audit pass
- [x] Seed data: 2 locations (MEP, EM), 1 admin (Juan), starter vendor (TBD - Reassign), 24 starter items
- [x] No anonymous access to any table; helpers REVOKE EXECUTE FROM anon

**Auth** ✅ Phase 2 (tag `phase-2-complete`)
- [x] Juan can sign in via PIN; Pete and Cristian also verified post-Phase 2.5
- [x] Juan can sign in via email + password
- [x] Sessions expire on 10-minute idle
- [x] 5 failed attempts → 15-minute lockout (countable failure reasons including `missing_pin_hash` defensive branch)
- [x] Logout revokes session (idempotent)
- [x] Email verification flow works (Resend → `onboarding@resend.dev` pending domain verification)
- [x] Password reset flow works (sessions revoked on reset)
- [x] PIN reset by admin works (step-up required)
- [x] Checklist confirmation PIN re-entry works (per §6.1; no separate confirmations table per C.16)

**RBAC** ✅ Phase 1 + Phase 2
- [x] Every role's permission set matches §7.2 matrix
- [x] RLS enforces location scoping for all location-scoped tables; level ≥ 7 override
- [x] Step-up unlock persists during admin session; clears on navigation away or idle
- [x] All destructive actions audit-logged via `lib/destructive-actions.ts`
- [x] Admin cannot promote/edit users at or above their own level (`canActOn` app-layer)
- [x] Checklist completion enforces `template_item.min_role_level <= user_level`

**Foundation admin tools** ⏳ Phase 5 (page placeholders only at v1.3 commit)
- [ ] User Management: full CRUD — UI deferred to Phase 5
- [ ] Location Management: full CRUD — UI deferred
- [ ] Vendor Management — UI deferred
- [ ] Vendor item catalog — UI deferred
- [ ] Checklist Template Management — UI deferred (admin tooling per C.44 lands with Module #1 prep)
- [ ] Par Levels Config — UI deferred
- [ ] Audit Log Viewer — UI deferred

**Infrastructure services** ✅ Phase 6
- [x] Photo upload end-to-end (`lib/photos.ts`, `/api/photos/route.ts`)
- [x] In-app notifications work
- [x] SMS adapter respects `TWILIO_ENABLED` (currently `false`)
- [x] AI proxy returns valid response (`claude-sonnet-4-6`)
- [x] Handoff flag generator runs against shift_overlays + closing checklist instances
- [x] Checklist API: instance creation, completion, submission, confirmation
- [x] Prep list resolution math (operator-supplied per refined C.18)

**Integration adapters** ✅ Scaffolded
- [x] Toast adapter: `isEnabled() === false`, route returns 501
- [x] 7shifts adapter: same
- [x] SMS adapter: `status='disabled'` when Twilio off

**Navigation shell** ✅ Phase 4
- [x] All module links visible per role-gating in §9
- [x] Unbuilt modules render PlaceholderCard
- [x] `(authed)` layout group with auth boundary

**Security** ✅ Phase 1 + Phase 2
- [x] No client code holds service role key or JWT secret
- [x] All API routes validate session before mutation
- [x] Audit log captures actor, action, before/after, IP, user_agent
- [x] Checklist instances cannot be deleted (RLS `_no_user_delete USING (false)`)
- [x] Checklist completions are append-only for `completed_by`; corrections via revoke / supersede / tag (C.28)
- [x] Shift overlays cannot be deleted

**Performance** — measured at Build #1 production smoke
- [x] Dashboard loads in <2s on 4G mobile
- [x] PIN sign-in completes in <500ms
- [x] Step-up modal appears in <100ms

### 17.2 Module #1 acceptance — Build #1 / Build #1.5 / Build #2 verified

**Build #1 — Closing Checklist** ✅
- [x] 50-item closing checklist; 10 stations; multi-author multi-hour
- [x] Walk-Out Verification gate (C.26): all 5 items + actor level ≥ 3
- [x] PIN attestation finalize; read-only flip
- [x] Cristian uses for real closings

**Build #1.5 — Polish + i18n** ✅
- [x] Revoke + tag accountability (C.28); two-window architecture
- [x] Notes inline display (C.29)
- [x] Station header prominence (C.30)
- [x] i18n infrastructure (C.31, C.37, C.38, C.39, C.40); EN + ES; toggle in UserMenu

**Build #2 — AM Prep + post-submission edits** ✅
- [x] AM Prep vertical slice; section-aware data model (PAR / ON HAND / BACK UP / TOTAL etc.)
- [x] Auto-completes closing's "AM Prep List submitted" item via C.42 mechanic
- [x] C.41 closing finalize gate reconciliation (level ≥ 3)
- [x] C.46 post-submission edits with chained attribution; cap = 3 updates
- [x] Path A v1 closing template flipped inactive (cleanup PR)
- [x] CI build gate verified end-to-end on PRs

### 17.3 Forward acceptance — Wave 2+

Acceptance criteria for Build #3 (Opening Report), Build #4 (Mid-day Prep), Build #5 (Cash Report), and beyond captured in their respective design conversations and handoff docs at the time of build kickoff. Wave 8 (Time Clock per C.47) acceptance: `time_punches` migrations applied; geofence event model live; 7shifts sync queue draining; manager reconciliation queue functional; employee attestation flow; TWWFAA quarterly export.

---

## 18. Glossary & References

**Glossary**

- **CO** — Compliments Only, the restaurant
- **CO-OPS** — this app, the operations platform
- **BLOC OS** — Juan's separate multi-tenant agentic platform; not this app
- **CGS** — Chief Growth Strategist (Juan)
- **MoO** — Manager of Operations (Cristian)
- **Foundation Layer** — what this document specifies; built first
- **Module Layer** — feature modules built sequentially after foundation
- **Artifact** — a primary operational record: opening checklist, prep sheet, closing checklist, shift overlay, written report, announcement, training report
- **Checklist instance** — one runtime occurrence of a checklist template, scoped to (location, date, shift_type)
- **Completion** — a single line item being marked done by a specific user at a specific time
- **Submission** — a batch of completions submitted as one event; an instance can have multiple submissions
- **Confirmation** — the final PIN-attestation that a checklist is closed; can be `confirmed` (all required done) or `incomplete_confirmed` (some required missed, with reasons)
- **Synthesis view** — read-only computed aggregation over the day's/week's/month's artifacts
- **Step-up auth** — additional password re-entry for destructive actions
- **Self-edit window** — 3-hour grace period during which a submitter can edit shift_overlay or written_report
- **Append-only correction** — supplementary record after self-edit window, supersedes original values without deleting

**References**

- CO-OPS Tech Spec v1.0 (April 2026) — original spec, superseded
- CO-OPS Foundation Spec v1.1 (April 2026) — superseded by this document
- CO-OPS Prototype (React, single-file) — design language reference, lift `getHandoff()` logic shape
- Compliments Only ordering guides (Boar's Head, Sysco, Baldor/US Foods, Smallwares) — seed data for vendor catalog
- Compliments Only closing checklist (paper) — seed structure for closing template
- Stack: Next.js 14, Supabase Postgres, Vercel, Twilio, Claude API
- Design tokens: see Section 14

---

*End of Document A: CO-OPS Foundation Spec v1.2.*

*Once locked, hand to Claude Code with the prototype as design reference. Claude Code builds Phase 0 through Phase 8 per Section 16. When acceptance criteria in Section 17 pass, foundation is done. Module #1 (Daily Operations) begins in a fresh chat with Claude.*

---

## Corrections log

- **2026-04-28:** Domain corrected from `complimentsonly.com` to `complimentsonlysubs.com` (Sections 3.1, 3.2). The correct CO domain is `complimentsonlysubs.com`. No architectural change.
