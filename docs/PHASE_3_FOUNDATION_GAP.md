# Phase 3 — Foundation Gap Audit

**Date:** 2026-05-01
**Branch:** `claude/gracious-boyd-8f8583` (worktree from `main`)
**Scope:** Read-only audit of foundation state vs CO-OPS Foundation Spec v1.2 §16 (build phases) and §17 (acceptance criteria), to inform Module #1 (Daily Operations) kickoff.
**Method:** Direct inspection of every `lib/`, `app/api/`, `app/`, `components/` file plus migration trail in `docs/PHASE_1_*` and runtime confirmation per `AGENTS.md`. Where a file exists, contents were read; "stub" labels are confirmed by file body, not inferred from filename.

---

## TL;DR

Foundation is **further from spec completion than the file tree suggests**. Phase 0 scaffolded `PlaceholderCard`-rendering pages, `export {}` lib stubs, `return null` components, and 501 API routes for nearly every spec item — so a `Glob` shows full coverage, but only the **Phase 0/1/2 auth surfaces are functional**.

Specifically:
- ✅ DB schema, RLS, auth lib, auth API, auth UI, login/verify/reset/dashboard pages, `proxy.ts`, CI gate — **real**
- 🟡 Every other component, page, and API route — **scaffold only** (PlaceholderCard / `return null` / 501)
- ❌ Every Phase 5–6 lib (`checklists`, `prep`, `handoff`, `photos`, `notifications`, `inventory`, `ai-prompts` body) — **`export {}` stubs** with docstring headers
- ❌ Module #1's **direct dependencies** (lib/checklists, /api/checklist/*, ChecklistItem, /admin/checklist-templates) are entirely **unbuilt**

The good news: scaffolding is **consistent** — file paths, naming, and stub docstrings already encode the spec's intent. Building Module #1 fills in the bodies; we don't have to relocate files or rewrite imports.

The decision Juan needs to make: **build foundation gaps fully before Module #1, or build Module #1 components that fill in the strictly-required foundation pieces along the way?** Recommendation at the bottom.

---

## (a) What's built and matches spec

### A.1 Database schema + RLS + seed

**Spec ref:** §4 (53-table schema), §5 (RLS policies + helpers), §16 Phase 1.
**State:** Built. 53 tables in `public` schema on Supabase project `bgcvurheqzylyfehqgzh`. 28 named migrations applied via Supabase MCP. RLS enabled on every table; Phase 1 Session B audit at 124/124 (`docs/PHASE_1_RLS_AUDIT.md`).
**Module #1 dep:** Yes — checklist tables, audit_log, users, sessions, report_photos.
**Notes:** Schema deviations from spec are intentional and locked: PG17 (spec said PG15), 53 tables (spec said ~45 — diff covers v1.2 additions: 11 new tables for the artifact model). v1.2 renames complete: `daily_reports → shift_overlays`, `par_levels.item_key → vendor_item_id`. Code grep confirms zero live references to either old name (only doc-comments).

### A.2 Auth library + session

**Spec ref:** §6 (auth flows), §15 lib/auth.ts, lib/session.ts, lib/auth-flows.ts.
**State:** Built. `lib/auth.ts` (8 stateless primitives — bcrypt PIN/password with peppers, JWT sign/verify via jose, hex-decoded `AUTH_JWT_SECRET`, token generate/hash). `lib/session.ts` (`createSession`, `requireSession`, `requireSessionFromHeaders`, `revokeSession`, `unlockStepUp`/`clearStepUp`, dual JWT + token_hash verification, step-up auto-clear). `lib/auth-flows.ts` (lockout state, countable failure reasons, `recordFailedAttempt` / `recordSuccessfulAuth`).
**Module #1 dep:** Yes — Closing Checklist confirmation uses PIN re-entry against `pin_hash`.

### A.3 Auth API routes

**Spec ref:** §6, §15 app/api/auth/*.
**State:** Built. 8 routes — `pin`, `password`, `password-reset`, `password-reset-request`, `verify`, `step-up`, `heartbeat`, `logout`. All Node runtime, all consume Session 2 lib primitives. End-to-end smoked Phase 2 Session 5 (40/40 audit harness pass).
**Module #1 dep:** Indirect — Module #1 doesn't add new auth routes; it consumes the existing primitives via `requireSessionFromHeaders` and a future `/api/auth/pin-confirm` (currently a stub on PinConfirmModal — see Gap C.5).

### A.4 Email + templates

**Spec ref:** §15 lib/email.ts, lib/email-templates/*.
**State:** Built. Resend wrapper with console-error-and-continue. Three templates: `_layout.ts` (typography-only header), `verification.ts`, `password-reset.ts`. Brand book primary palette baked in.
**Module #1 dep:** Probably not for Closing/Opening/Prep. Becomes a dep when Announcements (Module #3) or out-of-band notifications land.

### A.5 Foundation libs (roles, permissions, destructive actions, locations, types, audit)

**Spec ref:** §7 (RBAC), §15 lib/{roles,permissions,destructive-actions,locations,types,audit}.ts.
**State:** Built. `lib/roles.ts` 9-role registry with `getRoleLevel`, `isRoleAtOrAbove`, `canActOn`, `minPinLength()` (returns 4 for all roles per Phase 2 Session 1 lock). `lib/permissions.ts` 31-permission matrix matching spec §7.2. `lib/destructive-actions.ts` 22-action vocabulary including v1.2 vendor + checklist_template additions. `lib/locations.ts` `accessibleLocations()` + level-7+ all-locations override. `lib/types.ts` complete domain types for every artifact. `lib/audit.ts` single `audit()` helper, service-role only, console-error failure semantics, destructive auto-derivation.
**Module #1 dep:** Yes (heavily) — every Module #1 surface gates on roles, writes audit rows.

### A.6 Supabase clients + proxy

**Spec ref:** §3 (stack), §15 lib/supabase*.ts, proxy.ts.
**State:** Built. `lib/supabase.ts` (anon browser client). `lib/supabase-server.ts` (`createAuthedClient(jwt)`, `getServiceRoleClient()` cached). `proxy.ts` at root (renamed from middleware.ts per Next 16; matcher uses non-capturing groups; attaches `x-co-{user-id,app-role,role-level,session-id}` headers; defensive public-path bypass). Edge-runtime JWT signature/exp validation only — DB checks happen in Node-side `lib/session.ts`.
**Module #1 dep:** Yes — every Module #1 server component calls `requireSessionFromHeaders`; every API route calls `requireSession`.

### A.7 Auth UI components

**Spec ref:** §6 + §15 components/auth/*.
**State:** Built. AuthShell, ManagerLoginForm, SetPasswordForm, PinKeypad, PinConfirmModal, PasswordModal, LocationTile, RoleTile, NameTile, LogoutButton, IdleTimeoutWarning. Tile-flow login (location → role → name → PIN/password). PinConfirmModal scaffold-ready for Module #1 — shell + UX done, currently posts to nonexistent `/api/auth/pin-confirm` (see Gap C.5).
**Module #1 dep:** PinConfirmModal — yes (Closing confirmation reuses it).

### A.8 Foundation pages (login, verify, reset, dashboard)

**Spec ref:** §15 app/{page,verify,reset-password,dashboard}.
**State:** Built. `/` tile-flow login, `/verify` token consume + password set, `/reset-password` token consume + new password, `/dashboard` real Server Component (`requireSessionFromHeaders`, role badge, location chips, IdleTimeoutWarning) — though body is a "real dashboard lands in Phase 4" placeholder card. Phase 2 prerender hotfix wrapped each `useSearchParams()`-consuming page in `<Suspense>`.
**Module #1 dep:** Module #1 surfaces extend the dashboard concept (today's open artifacts, handoff card) — all that Phase 4-shaped work is currently text in the placeholder body.

### A.9 PlaceholderCard

**Spec ref:** §9.2.
**State:** Built. Renders title + description + feature list + "Coming in <phase>" strapline. Used by every unbuilt module page and admin tool page.
**Module #1 dep:** Indirect — gets *replaced* by real components in `/operations/*` as Module #1 ships.

### A.10 Adapter scaffolds (toast, shifts, sms)

**Spec ref:** §2.8 (integration philosophy: scaffolded, deferred), §11.
**State:** Built as `export {};` files with docstring headers. Spec explicitly defers activation; "scaffolded but not implemented" matches the spec contract.
**Module #1 dep:** No.

### A.11 Brand assets, scripts, secrets, CI gate

**Spec ref:** §3.1, AGENTS.md Phase 0 + Phase 3 housekeeping.
**State:** Built. `public/brand/{co-icon,co-logomark,co-wordmark,co-wordmark-icon}.png`. `scripts/generate-secrets.{ps1,sh}`. Phase 2 audit harness + Phase 2.5 provisioning scripts. CI build gate (`.github/workflows/build.yml`, branch protection on `main` requires `build` status check). Tested six ways through PR #1–#6.
**Module #1 dep:** CI gate — yes (every Module #1 PR will pass through it).

---

## (b) What's built but diverges from spec

These deviations are **intentional** and were signed off in Phase 0/1/2. Listed here for completeness — **not** items requiring rework.

### B.1 Stack version drift

| Spec (§3.1) | Actual | Why |
|---|---|---|
| Next.js 14 | Next.js 16.2.4 | Current stable; App Router model unchanged; `middleware.ts → proxy.ts` rename per Next 16 |
| Postgres 15 | Postgres 17.6.1.111 | What Supabase provisioned for new projects in 2026 |
| Node 20 | Node 22.20.0 LTS | Pinned in `.nvmrc` + `package.json` engines + GitHub Actions via `node-version-file: .nvmrc` |
| Tailwind v3 (`tailwind.config.ts`) | Tailwind v4 (CSS-first via `@theme inline` in `app/globals.css`) | v4 dropped `tailwind.config.ts`. Tokens live in `app/globals.css` |
| `claude-sonnet-4-20250514` | `claude-sonnet-4-6` (constant in `lib/ai-prompts.ts`) | Sonnet 4.6 is current; spec model ID is now retired |
| `EMAIL_FROM=ops@complimentsonlysubs.com` | `EMAIL_FROM=onboarding@resend.dev` | Domain not yet verified in Resend; default sender restricts deliverable recipients to Juan only — bridge for foundation phase |
| `middleware.ts` | `proxy.ts` | Next 16 rename (deprecation warning on `middleware.ts`) |

### B.2 Auth model — JWT claim shape

**Spec ref:** §6 (claim structure not specified in detail).
**Actual:** JWT carries `{ user_id, app_role, role_level, locations, session_id, role: 'authenticated', iat, exp }`. Spec implied `role: <our role code>`; reality reserves `role` for PostgREST's database-role contract (must be `authenticated`/`anon`/`service_role`). Our app role lives in `app_role`.
**Module #1 dep:** Implicit — Module #1 reads `auth.role`, `auth.level`, `auth.locations` from the resolved `AuthContext`, never the raw JWT.

### B.3 PIN length — uniform 4 digits

**Spec ref:** §6 (didn't specify; an earlier draft considered a 5/4 split).
**Actual:** 4 digits for every role, including level 5+. `lib/roles.ts` `minPinLength()` returns 4 always. Decision matches Toast/7shifts punch-in convention.
**Module #1 dep:** Yes — Closing confirmation PIN modal is 4-digit only.

### B.4 RLS policy split (spec verbatim policies had a `FOR ALL` bug)

**Spec ref:** §5.2 / §5.4 / §5.5 verbatim policies.
**Actual:** Spec policies used `FOR ALL` for writes paired with `FOR DELETE USING (false)`. That OR-stacks to "delete allowed when level ≥ N." Phase 1 Session B caught it; corrective migrations (`0021_rls_auth_corrections`, `0023_rls_verbatim_corrections`) split every write policy into explicit `FOR INSERT` + `FOR UPDATE` plus separate `_no_user_delete USING (false)`. **All checklist + announcement + vendor RLS policies were rewritten** from spec literal to corrected form. Append-only philosophy is intact and properly enforced.
**Module #1 dep:** Yes — Module #1 writes against checklist tables. Code paths that try to DELETE a checklist instance/completion will (correctly) fail.

### B.5 RLS helpers — `SECURITY DEFINER` + claim format

**Spec ref:** §5 helper function bodies use `current_setting('request.jwt.claim.user_id', true)`.
**Actual:** PostgREST v12+ deprecated `request.jwt.claim.<name>` (singular). Migration `0032_helpers_modern_claim_format` updated `current_user_id()` to read `current_setting('request.jwt.claims', true)::jsonb ->> 'user_id'`. Helpers are also `SECURITY DEFINER` with `SET search_path = pg_catalog, public`, with `REVOKE EXECUTE ... FROM anon` (Supabase default schema ACLs grant EXECUTE to anon by default; `REVOKE FROM PUBLIC` doesn't strip explicit role grants).
**Module #1 dep:** Indirect — Module #1 RLS reads succeed because helpers work. No code change required.

### B.6 Design tokens repointed to brand book

**Spec ref:** §14 referenced v1.1 dark-theme palette.
**Actual:** Phase 2 Session 4 repointed token *values* (kept token *names* stable per the load-bearing comment): `--co-bg: #FFF9E4` (Mayo, light), `--co-text: #141414` (Diet Coke, dark), `--co-gold: #FFE560` (Mustard), added `--co-cta: #FF3A44` (brand Red, CTA only).
**Module #1 dep:** Yes — Module #1 UIs render against current token values. Any "looks wrong on dark theme" memory is stale.

### B.7 Session storage — dual JWT + token_hash verification

**Spec ref:** §6 implied JWT-only verification.
**Actual:** `sessions.token_hash` stores `hashToken(jwt)`. `requireSession` validates BOTH JWT signature/exp AND `hashToken(rawCookieJwt) === sessions.token_hash` for the row identified by `session_id`. Defense against `AUTH_JWT_SECRET` leak. Mismatch emits `session_token_mismatch` audit row.
**Module #1 dep:** Indirect — Module #1 inherits this for free via `requireSession` / `requireSessionFromHeaders`.

### B.8 Foundation libs ship ahead of build phases

**Spec ref:** §16 puts `lib/roles.ts` etc. in Phase 3.
**Actual:** They were populated in Phase 0/1 from spec §4 + §7. Phase 3 doesn't need to write them — only runtime helpers (location scoping logic, step-up modal wiring, session cookie readers) which Phase 2 added.
**Module #1 dep:** Net positive — fewer libs to write.

---

## (c) What's specced but not built

This is the **active gap list**. Each item's "Module #1 dep" answers *Closing Checklist's specific need*, since Closing is the locked first build.

### C.1 lib/checklists.ts — instance lifecycle + completion validation

**Spec ref:** §15, Phase 6 step 45. `lib/checklists.ts`.
**Current state:** `export {};` with 14-line docstring header listing intended functions: `getOrCreateInstance`, `completeItem` (validates `min_role_level <= user level` + supersedes prior completion), `submitBatch`, `confirmInstance` (validates PIN, inserts incomplete reasons, transitions status), `rejectIfPrepLocked`.
**Module #1 dep:** **REQUIRED for Closing.** Every checklist UI calls these.
**Effort:** **L** (1 session) — five functions, two of them with non-trivial state transitions (completion supersession, confirmation with incomplete-reason capture) and PIN re-validation against `pin_hash`.

### C.2 /api/checklist/* routes — all five are 501 stubs

**Spec ref:** §15, Phase 6 step 47.
**Current state:** All five routes return 501:
- `app/api/checklist/instances/route.ts` (GET, POST)
- `app/api/checklist/instances/[id]/route.ts` (GET)
- `app/api/checklist/completions/route.ts` (POST)
- `app/api/checklist/submissions/route.ts` (POST)
- `app/api/checklist/confirm/route.ts` (POST)
- `app/api/checklist/prep/generate/route.ts` (POST) — Prep-only, can defer
**Module #1 dep:** **REQUIRED for Closing** — instances, completions, submissions, confirm. `prep/generate` deferred until build #3 (Prep Sheet).
**Effort:** **M** (half-day) — thin wrappers over `lib/checklists.ts` + `requireSession` + payload validation + audit. Pattern follows `/api/auth/*`.

### C.3 ChecklistItem component — `return null` stub

**Spec ref:** §15 components/ChecklistItem.tsx.
**Current state:** `export function ChecklistItem() { return null; }` plus a one-line docstring.
**Module #1 dep:** **REQUIRED for Closing.** Every Closing line is a ChecklistItem instance. Spec implies it handles count input (`expects_count`), photo capture (`expects_photo`), notes, role-locked disable state, completion checkmark, and supersession history toggle.
**Effort:** **M** (half-day) — generic component but has to handle all four artifact contexts cleanly.

### C.4 Checklist Template Management admin tool

**Spec ref:** §13.5.
**Current state:** Pages render PlaceholderCard. Routes return 501.
- `app/admin/checklist-templates/page.tsx` — list view
- `app/admin/checklist-templates/[id]/page.tsx` — template detail with items
- `app/api/admin/checklist-templates/route.ts` (GET, POST)
- `app/api/admin/checklist-templates/[id]/route.ts` (GET, PUT)
- `app/api/admin/checklist-templates/[id]/items/route.ts` (GET, POST)
**Module #1 dep:** **REQUIRED unless** we seed the Closing template via a one-shot script (the Phase 2.5 provisioning pattern). The admin UI is heavier than the seed script and isn't on Module #1's critical path. **Recommendation:** seed via script for first build; admin tool can land alongside Module #1 step 4/5 or as a separate Phase 5 effort. Decision needed from Juan.
**Effort:** **L** as admin UI (full CRUD with reorder + drag handles + role-level dropdowns + step-up gates + clone-to-location button); **S** (1–2 hrs) as a one-shot `scripts/seed-closing-template.ts` modeled after `phase-2.5-provision-temp-users.ts`.

### C.5 PinConfirmModal → /api/auth/pin-confirm wiring

**Spec ref:** §6.1 (checklist confirmation PIN re-entry).
**Current state:** PinConfirmModal scaffold is fully built (overlay, focus trap, error states, lockout banner) but its submit handler is stubbed with a TODO surfacing "PIN confirmation not yet wired (Phase 4)." The route `/api/auth/pin-confirm` does not exist.
**Module #1 dep:** **REQUIRED for Closing confirmation.** Spec §6.1 step 4 is `POST /api/checklist/confirm` with `{instance_id, pin, incomplete_reasons}` — meaning the PIN check happens inside `/api/checklist/confirm`, not a separate `/api/auth/pin-confirm`. The TODO message in PinConfirmModal predates that decision; the modal needs to be rewired to call `/api/checklist/confirm` directly (or a thin delegating route).
**Effort:** **S** (1–2 hrs) — modal rewire + the PIN-validation step inside `lib/checklists.ts` `confirmInstance()` (already in C.1's scope).

### C.6 lib/handoff.ts — handoff flag generator

**Spec ref:** §10.1.
**Current state:** `export {};` with 17-line docstring header listing source tables (closing checklist instances, shift_overlay, par_levels, maintenance_tickets) and emit format.
**Module #1 dep:** **DEFERRABLE** — handoff card surfaces in dashboard (Phase 4) and triggers from Closing confirmation. For Closing **build #1**, we can ship Closing confirmation that doesn't yet write handoff flags; the data is preserved on `checklist_instances`/`checklist_incomplete_reasons` and a later pass can backfill `shift_overlays.handoff_flags` JSONB. **Recommendation:** punt to Module #1 step 4 (Shift Overlay) or step 5 (Synthesis View) when handoff actually surfaces.
**Effort:** **M** (half-day) — query orchestration + flag-generation rules from spec.

### C.7 lib/photos.ts + /api/photos + Supabase Storage bucket

**Spec ref:** §10 (photo service), §15 lib/photos.ts, §4.14 report_photos table (built — A.1).
**Current state:** `lib/photos.ts` is `export {};`. `/api/photos/route.ts` returns 501. **Supabase Storage bucket `report-photos` does NOT exist** (Phase 1 carry-over note in AGENTS.md: "deferred to Phase 6 with the rest of the photo service").
**Module #1 dep:** **CONDITIONAL on the seeded Closing template.** If any Closing template item has `expects_photo: true` (cleanliness verification — likely per spec language "photo verification for cleanliness / equipment items"), then photos are needed for build #1. If we ship Closing v1 without `expects_photo` items and add them in v2, photos can defer to Module #1 step 4/5. **Decision needed from Juan when transcribing the closing template.**
**Effort:** **M** (half-day) for lib + API + bucket creation + Storage RLS; the `report_photos` table + `report_photos_read` RLS policy already exist (per AGENTS.md Phase 1 carry-over). Plus PhotoUploader component (currently `return null`) — another **M**.

### C.8 lib/notifications.ts + /api/notifications + NotificationBell + AnnouncementBanner

**Spec ref:** §10 (notification service), §15.
**Current state:** All four are stubs (`export {};` / `return null` / 501).
**Module #1 dep:** **NO** for Closing/Opening/Prep. Becomes a dep for Module #3 (Announcements). Skip for Module #1.
**Effort:** **L** (1 session) — but out of scope for Module #1.

### C.9 lib/ai-prompts.ts (body) + /api/ai/route.ts + @anthropic-ai/sdk dependency

**Spec ref:** §10 (AI integration), §15, §3.2 env var `ANTHROPIC_API_KEY`.
**Current state:** `lib/ai-prompts.ts` exports only `AI_MODEL = "claude-sonnet-4-6"`. `/api/ai/route.ts` returns 501. `@anthropic-ai/sdk` is **not in `package.json`** — installing it is a prerequisite. `ANTHROPIC_API_KEY` env var status is unknown (not visible in audit; need to check Vercel dashboard).
**Module #1 dep:** **NO** for any Module #1 build. Becomes a dep for Module #5 (AI Insights). Skip for Module #1.
**Effort:** **L** (1 session) — but out of scope for Module #1.

### C.10 lib/inventory.ts + lib/prep.ts

**Spec ref:** §12 (inventory), §15 lib/prep.ts.
**Current state:** Both `export {};` with docstring headers. `inventory.ts` lists `getAggregatedInventory`, `getInventoryWithPars`. `prep.ts` lists `generatePrepResolutions`.
**Module #1 dep:** **YES for Module #1 build #3 (Prep Sheet).** Prep math = par minus on-hand from latest opening counts. **NO for Closing (build #1) or Opening (build #2)**.
**Effort:** **M** (half-day each) — but defer until build #3.

### C.11 Vendor Management admin tool

**Spec ref:** §13.4.
**Current state:** Pages render PlaceholderCard. Routes 501. `lib/types.ts` has `Vendor` and `VendorItem` types. Database has `vendors`, `vendor_items`, `par_levels` tables (A.1).
**Module #1 dep:** **CONDITIONAL.** If the Closing template has items with `vendor_item_id` links (e.g., "Count remaining turkey 3rd pans" where turkey is a vendor_item), then we need vendor data seeded somewhere — but Phase 1 already seeded 24 vendor_items attached to the "TBD - Reassign" placeholder vendor. So Closing build #1 can use those without the admin UI existing. **Vendor Management admin tool is deferrable until Module #1 step 3 (Prep Sheet)** when real vendor catalog matters more, or until a separate Phase 5 effort.
**Effort:** **L** (1 session) — full CRUD with AGM/GM split for trivial vs full edits, item catalog tab, par-cascade logic on item deactivation.

### C.12 Other foundation admin tools (User Management, Location Management, Par Levels, Audit Log Viewer)

**Spec ref:** §13.1, §13.2, §13.3, §13.6.
**Current state:** All pages render PlaceholderCard. All admin API routes (admin/users, admin/locations, admin/pars) return 501.
**Module #1 dep:** **NO** for Module #1 directly, but:
- **User Management** — currently we provision users via service-role direct insert (Phase 2.5 bridge pattern). Adding a real Closing template that gets used by Pete/Cristian doesn't require new users; but ANY future user beyond Pete/Cristian/Juan needs the admin UI OR another bridge script. Deferrable.
- **Audit Log Viewer** — useful for testing Closing during Module #1 build (visibility into audit rows), but Juan can query Supabase directly in lieu of the UI. Deferrable.
- **Location Management** — locations are seeded; no new locations expected until expansion. Deferrable.
- **Par Levels Config** — needed for Prep Sheet (build #3) since pars drive the math. Currently we'd seed via script. Deferrable until build #3.
**Effort:** **L** each (1 session per tool, 4 sessions total).

### C.13 Foundation pages — Nav, LocationSelector, dashboard "real" body

**Spec ref:** §9 (nav structure), §15.
**Current state:** `Nav.tsx`, `LocationSelector.tsx` both `return null`. Dashboard renders inline role badge + location chips + a "real dashboard lands in Phase 4" placeholder card. There is **no top nav at all on any page** — every page is its own AuthShell with no consistent navigation chrome.
**Module #1 dep:** **YES indirectly.** Users need to navigate to `/operations/closing`. Currently no link from dashboard to operations exists. We'd either:
  - (a) Build minimal Nav + LocationSelector first (~M, half-day), or
  - (b) Hardcode a "Go to Closing Checklist" link on the dashboard for build #1, build Nav properly later.
**Effort:** **M** for minimal Nav (logo + location chip + role badge + logout); LocationSelector is a separate **M**.

### C.14 Module placeholder pages

**Spec ref:** §9.1, §15.
**Current state:** Every module page renders PlaceholderCard. Includes operations/{opening,prep,closing,overlay,synthesis} — Module #1's exact targets.
**Module #1 dep:** Module #1 *replaces* `/operations/closing/page.tsx`'s body when build #1 ships. The placeholder is fine until then.
**Effort:** N/A — overwritten by Module #1 builds.

### C.15 Other components — ExpandableCard, RecordList, FormFields, HandoffCard

**Spec ref:** §15.
**Current state:** All `return null` / `export {}` stubs.
**Module #1 dep:**
- **FormFields** — likely yes for Closing (text inputs, count fields, notes); **S–M**
- **ExpandableCard** — maybe (collapsible station groupings on Closing UI per spec §4.3 `station` field); **S**
- **RecordList** — no for Closing (more relevant to Synthesis View build #5); deferrable
- **HandoffCard** — no for Closing (surfaces in dashboard / overlay); deferrable
**Effort per usable item:** **S–M**.

### C.16 Database — checklist_confirmations table

**Spec ref:** §6.1 references "insert `checklist_confirmations` row" but §4.3 does NOT list that table. `lib/types.ts` does not export a `ChecklistConfirmation` type — confirmation state is denormalized onto `checklist_instances.confirmed_at` / `confirmed_by` / `status`.
**Current state:** **Spec internal contradiction.** The denormalized model on `checklist_instances` matches what's actually built. The spec §6.1 reference to a separate `checklist_confirmations` table appears to be a vestigial reference that didn't make it into §4.3.
**Module #1 dep:** **YES** — Closing confirmation. The denormalized model is sufficient (status + confirmed_at + confirmed_by + linked `checklist_submissions.is_final_confirmation` flag + linked `checklist_incomplete_reasons` rows).
**Action:** Confirm with Juan that the denormalized model is the intended interpretation (no schema change needed); annotate in the gap doc and proceed.
**Effort:** Zero (architecturally) — just a clarification.

### C.17 Database — `report_views` table

**Spec ref:** §4.14 (built per Phase 1 — A.1).
**Current state:** Table exists in DB; no `ReportView` type in `lib/types.ts`; `/api/views/mark-read` returns 501.
**Module #1 dep:** **NO.** Read-receipts are a Synthesis View / Reports concern (Module #1 build #5 / Module #4).
**Effort:** **S** for type + simple POST handler — but deferrable.

---

## Recommendation for Module #1 sequencing

Based on this gap audit and Juan's locked Module #1 build sequence (Closing → Opening → Prep → Overlay → Synthesis), I propose **Option B: incremental, build-as-needed**. Reasoning:

- Closing only requires 4 of the 17 unbuilt items (C.1, C.2 — minus prep/generate, C.3, C.5).
- A one-shot template seed script (C.4 alternative) costs **S** vs **L** for the admin UI — the UI matters more once the template structure is settled and Cristian needs to edit it; v1 ships with a template Juan transcribes from paper into a script.
- Photos (C.7) and Vendor Management (C.11) can be sequenced into the Module #1 build calendar where they actually surface (likely build #4 or #5, possibly never for Closing if no `expects_photo` items in the seed).
- A minimal Nav (C.13) is a small upfront tax that pays dividends across all 5 builds.

**Concrete proposed Closing build (build #1) work order:**

1. Seed: write `scripts/seed-closing-template.ts` with the transcribed paper checklist content (Juan provides photos + per-item `min_role_level` overrides). Produces one shared `checklist_templates` row + N `checklist_template_items` rows for both MEP and EM.
2. lib/checklists.ts (C.1) — full body
3. /api/checklist/* (C.2) — wire to lib/checklists, add audit
4. ChecklistItem component (C.3) — base completable item
5. PinConfirmModal rewire to /api/checklist/confirm (C.5)
6. Minimal Nav (C.13) — just enough to jump from /dashboard to /operations/closing
7. /operations/closing/page.tsx — replace PlaceholderCard with the real UI
8. End-to-end smoke against `co-ops-ashy.vercel.app` (Pete + Cristian as test users)

**Estimated wall-clock:** ~2 sessions for build #1 (Closing). Subsequent builds (#2–#5) get progressively cheaper as foundation pieces accumulate.

**Alternative: Option A — close every gap first.** Cost: ~4–6 additional sessions before any Module #1 UI ships. Benefit: clean foundation acceptance against §17 before module work begins. The trade-off is we don't see Closing in Pete's hands for ~3 weeks instead of ~1 week.

**Recommendation: Option B**, with the caveat that we close C.4/C.7/C.11/C.12 *during* Module #1 work as their dependencies arrive, not as a separate "Phase 3.5 cleanup" effort.

---

## Open questions for Juan

1. **C.4** — Seed Closing template via script, or build the admin tool first? (Recommendation: script)
2. **C.7** — Will Closing template v1 include any `expects_photo: true` items? (Determines if photos are blocking for build #1)
3. **C.13** — Minimal Nav now, or hardcode a "Go to Closing" link on dashboard for build #1?
4. **C.16** — Confirm that the denormalized `checklist_instances.confirmed_*` model is the intended interpretation (no separate `checklist_confirmations` table); spec §6.1 vestigial reference can be corrected in a future spec amendment.
5. **C.5** — PIN-validation lives inside `/api/checklist/confirm` (per spec §6.1 step 4) rather than a separate `/api/auth/pin-confirm`. Confirm that's the right interpretation; PinConfirmModal stub TODO referenced the latter.
6. **Sequencing decision** — Option A (close all gaps first) or Option B (incremental, build #1 first)?

---

## Inventory addendum — what the file tree shows vs what works

For grep-fu reference, here are categories of files that **exist on disk** but are **non-functional stubs**, so future audits don't get the same false positive the initial scan did:

**Lib files that are `export {};` with a docstring header:**
`lib/checklists.ts`, `lib/prep.ts`, `lib/handoff.ts`, `lib/photos.ts`, `lib/notifications.ts`, `lib/inventory.ts`, `lib/toast-adapter.ts`, `lib/sms-adapter.ts`, `lib/shifts-adapter.ts`, `lib/email-templates/_layout.ts` (real impl — exception), `components/FormFields.tsx`.

**Lib files with a single constant export and otherwise stub:**
`lib/ai-prompts.ts` (only `AI_MODEL`).

**Components that are `export function X() { return null; }`:**
`components/Nav.tsx`, `components/LocationSelector.tsx`, `components/HandoffCard.tsx`, `components/ExpandableCard.tsx`, `components/RecordList.tsx`, `components/PhotoUploader.tsx`, `components/NotificationBell.tsx`, `components/AnnouncementBanner.tsx`, `components/ChecklistItem.tsx`.

**Pages that render `<PlaceholderCard ... />`:**
All admin pages except none (i.e., all 8 admin pages are placeholders); all 18 module entry pages including `/operations/{opening,prep,closing,overlay,synthesis}`.

**API routes that return 501 Not Implemented:**
All admin routes (10), all checklist routes (6), `/api/photos`, `/api/notifications`, `/api/views/mark-read`, `/api/sms/process-queue`, `/api/ai`, `/api/toast`, `/api/shifts` (24 routes total).

**API routes that are real:**
The 8 `/api/auth/*` routes, `/api/users/login-options`, `/api/locations`. (10 functional routes.)

**Pages that are real (not placeholders):**
`/` (login), `/verify`, `/reset-password`, `/dashboard`. (4 functional pages out of 34.)

**Components that are real:**
All 11 `components/auth/*` files; `components/PlaceholderCard.tsx`. (12 functional components out of 22.)

The 90/10 rule: **~10% of the file tree is functional code; ~90% is scaffolding.** That's the spec-faithful Phase 0 outcome — files exist so future builds can fill in bodies without restructuring imports — but it makes the codebase appear more complete than it is to anyone scanning by `Glob`.
