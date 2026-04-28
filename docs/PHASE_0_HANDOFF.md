# Phase 0 → Phase 1 Handoff

**Snapshot date:** 2026-04-28
**Last commit on `main` at handoff:** see `git log --oneline -5`
**Audience:** the Phase 1 session (Claude Code, fresh chat)

This is a "you are here" snapshot, distinct from `AGENTS.md` (which is durable knowledge for all sessions). Read both before writing any Phase 1 code.

---

## Current state (verified 2026-04-28)

### Deployed
- Production alias: `https://co-ops-ashy.vercel.app`
- Vercel project: `juan-co-devs-projects/co-ops` (id `prj_i3iiXQUG6E0zywK8SbZi4ODCNEpq`)
- GitHub repo: `https://github.com/Juan-CO-dev/co-ops` (private)
- GitHub→Vercel auto-deploy: confirmed working — push to `main` triggers a production build

### Working / verified
- `npm run dev` serves all 53 routes locally
- `npm run build` passes clean (no warnings except Vercel's harmless `.env.production.local` injection notice)
- `npm run typecheck` passes (`strict` + `noUncheckedIndexedAccess`)
- All module pages render `<PlaceholderCard />` from `components/PlaceholderCard.tsx`
- All 22 API stubs return `501 Not Implemented` with phase-appropriate hint messages
- `proxy.ts` exists as a no-op (Phase 2 will populate it)
- Vercel env vars set across Production / Preview / Development (19 entries; `NEXT_PUBLIC_APP_URL` deferred until production domain is known)
- Supabase HS256 standby key configured, value matches `AUTH_JWT_SECRET`

### Built but not yet exercised
- `lib/roles.ts`, `lib/permissions.ts`, `lib/destructive-actions.ts`, `lib/types.ts` are complete from spec §4 + §7. Phase 1 will wire `lib/supabase.ts` / `lib/supabase-server.ts` and start using `lib/types.ts` for query results.

---

## Open questions Juan flagged for Phase 1

These are not blockers but need a decision before the relevant table or policy is committed.

### 1. Two-session expectation for Phase 1
Juan's expectation: **schema + seed lands in session A, RLS audit lands in session B.** Don't try to cram both into one session. The RLS audit is the security boundary — running every (role × table × policy) test case is slow, careful work, and bundling it with schema-write fatigue would compromise the audit.

If session A finishes early and you're tempted to start RLS audit, stop. End the session, give Juan a recap, start session B fresh.

### 2. Starter vendor seed naming
Spec says seed a placeholder vendor with the prototype's 24 inventory items. Juan wants the vendor named exactly **`TBD - Reassign`** (with the `- Reassign` suffix, not just `TBD`). The suffix makes it impossible for Cristian or Juan to miss when remapping items to real vendors post-foundation.

### 3. `NUMERIC` vs `INTEGER` for role levels (MoO at 6.5)
Spec §4 uses `NUMERIC` for `min_role_level`, `visibility_min_level`, `target_min_role_level`, `target_max_role_level`, and the helper `current_user_role_level()`. **This is correct and intentional.** MoO sits at 6.5. If you see anywhere in the schema where a role level is typed `INTEGER`, flag it before running the migration — it's a typo.

### 4. `weekday_par` / `weekend_par` nullable
Currently `DECIMAL(10,2)` without `NOT NULL`. That's intentional: a vendor item may not have an established par yet (admin sets it later via `/admin/pars`). Keep them nullable. Don't add `NOT NULL` defensively.

### 5. `forecast_notes` CGS-only — RLS gate or app-layer?
`shift_overlays.forecast_notes` is documented as level-8 (CGS) only via `permissions.ts` key `overlay.write.forecast`. Postgres can't do per-column RLS cleanly. Spec's pattern: app-layer enforcement at the API route — RLS allows writes to the row, but the API rejects payloads that include `forecast_notes` from non-CGS users. Document this in the API route comment when Phase 4+ wires it up. **Don't try to enforce at the column level via triggers — too brittle, breaks audit trails.**

---

## What Phase 1 covers (spec §16, steps 6–10)

### Schema
1. Run all `CREATE TABLE` statements from spec §4 against the `co-ops` Supabase project (us-east-1). ~45 tables.
2. Order matters where there are FK dependencies — `users` and `locations` first, then `user_locations`, then everything else. Vendors before vendor_items before par_levels before checklist_template_items (which can FK to vendor_items).
3. Use the Supabase MCP `apply_migration` tool with named migrations so the history is traceable. Example names: `0001_users_locations`, `0002_sessions_email_verifications`, `0003_vendors_vendor_items_par_levels`, etc.

### Helper functions + RLS policies
4. Create the three helper functions from spec §5 head: `current_user_id()`, `current_user_role_level()`, `current_user_locations()`.
5. Apply RLS policies. Spec §5 has explicit SQL for the new v1.2 tables (5.2–5.5). Sections 5.1, 5.6, 5.7 are noted as "same as v1.1 patterns" — derive inline per `AGENTS.md` and the rules below:
   - **5.1 Auth tables.** `users`/`user_locations`: read own row + level ≥6 reads all; write level ≥6.5 (admins). `sessions`/`email_verifications`/`password_resets`: user reads own row only; service role for inserts.
   - **5.6 Other location-scoped.** Pattern: `location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7`. Apply to: `vendor_deliveries`, `vendor_orders`, `catering_customers`, `catering_orders`, `catering_pipeline`, `maintenance_tickets`, `tip_pools`, `tip_pool_distributions`, `customer_feedback`, `lto_performance`, `weekly_rollups`, `deep_clean_assignments`, `training_reports`, `toast_daily_data`, `shifts_daily_data`.
   - **5.7 Global.** Pattern: read level ≥3, write level ≥6. Apply to: `recipes`, `recipe_ingredients`, `recipe_steps`, `positions`, `position_responsibilities`, `training_modules`, `deep_clean_tasks`, `vendor_price_history`.
   - Surface each derived policy SQL inline before applying — Juan signs off, then you run it.

### Seed
6. Insert the 2 locations: `Capitol Hill / MEP / permanent` and `P Street / EM / permanent`.
7. Insert Juan as the first `cgs` user (no PIN/password yet — those land in Phase 2). Actually — schema requires `pin_hash NOT NULL`. Insert with a placeholder bcrypt hash that won't validate until Phase 2 sets a real PIN via admin tool. Document this in the migration so it's not load-bearing.
8. Insert vendor `TBD - Reassign` (see open question #2).
9. Insert the 24 starter inventory items as `vendor_items` rows pointing at the TBD vendor. Source: prototype closing-count form (see `co-ops-tracker.jsx` `ReportForm` Closing Count section). Categories: proteins+lettuce 3rd pans, Italian meats bundles, cheese, prepped veg quarts, sauces big bottles, sauces small bottles.

### Verification (lightweight in session A; full in session B)
10. Confirm `relrowsecurity = true` on every table:
    ```sql
    SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace;
    ```
    Anything `false` is a failure — patch and re-run.

---

## What Phase 1 explicitly does NOT cover

- **Auth.** No `lib/auth.ts`, no JWT signing, no PIN/password hashing, no `/api/auth/*` implementation. Auth is Phase 2.
- **Admin tool UIs.** No `/admin/users`, `/admin/locations`, `/admin/vendors`, `/admin/checklist-templates`, `/admin/pars`, `/admin/audit` implementations. Those are Phase 5. Phase 1 only writes the schema they'll write to.
- **Supabase client wiring.** `lib/supabase.ts` and `lib/supabase-server.ts` stay stubs in Phase 1. Phase 2 wires them when auth needs them.
- **Module logic.** No `lib/checklists.ts`, `lib/prep.ts`, `lib/handoff.ts`, etc. — those are Phase 6. Phase 1 only ensures the tables they'll read/write exist with correct RLS.
- **Photo storage.** Supabase Storage bucket creation can happen in Phase 1 if convenient (`report-photos` bucket, private), but the upload code is Phase 6.

---

## Pointers

- **Schema source of truth:** Foundation Spec v1.2 §4 (sections 4.1–4.16). Juan will attach the corrected v1.2 (with `complimentsonlysubs.com` fix) to the next session. Don't trust any older copy.
- **RLS policies:** spec §5. Helper functions at top of §5. Explicit SQL in §5.2–5.5. Derive 5.1 / 5.6 / 5.7 per the rules in this handoff document.
- **Build sequencing:** spec §16 — Phase 1 = steps 6–10.
- **Acceptance criteria for Phase 1:** spec §17 "Database" section.
- **Decision history from Phase 0:** see commit `0ee79c7` and the Phase 0 chat transcript for the six locked architectural decisions.

---

## The two-sessions expectation

**Session A (next):** schema + helper functions + RLS policies (apply, don't test exhaustively) + seed.
**Session B:** the RLS audit. Per spec: for every table verify `relrowsecurity = true`; for every policy run a representative SELECT/INSERT/UPDATE/DELETE under each affected role and confirm the policy denies/allows correctly. Document each test case in the session recap.

The audit is the security boundary. It cannot be skipped. It cannot be batched with schema-writing. Plan accordingly.

When session B passes, Phase 1 is done. Phase 2 (auth) opens.
