# Phase 1 Session A → Session B Handoff

**Snapshot date:** 2026-04-29
**Last commit on `claude/strange-keller-f772b9` at handoff:** see `git log --oneline -5`
**Audience:** the Phase 1 Session B (RLS audit) Claude Code

This is a "you are here" snapshot from end-of-Session-A. Read `AGENTS.md` and `docs/PHASE_0_HANDOFF.md` first; this document is Phase 1 Session A specific.

---

## What Session A produced

**28 named migrations**, applied via Supabase MCP `apply_migration` against project `bgcvurheqzylyfehqgzh` (us-east-1, Postgres 17.6.1.111). Every migration is named, traceable, and re-runnable through the migration history.

### Schema (15 migrations)

```
0001_extensions                    pgcrypto
0002_auth_tables                   users, locations, user_locations, sessions,
                                   email_verifications, password_resets
0003_helper_functions              current_user_id, current_user_role_level,
                                   current_user_locations
0004_vendor_tables                 vendors, vendor_items, par_levels,
                                   vendor_deliveries, vendor_orders,
                                   vendor_price_history
0005_photos_views                  report_photos, report_views
0006_checklist_tables              checklist_templates, checklist_template_items,
                                   checklist_instances, checklist_completions,
                                   checklist_submissions, checklist_incomplete_reasons,
                                   prep_list_resolutions
0007_shift_overlay_tables          shift_overlays, shift_overlay_corrections
0008_written_announcements         written_reports, announcements,
                                   announcement_acknowledgements
0009_training_tables               positions, position_responsibilities,
                                   training_modules, training_reports,
                                   training_progress
0010_catering_tables               catering_customers, catering_orders,
                                   catering_pipeline
0011_recipe_tables                 recipes, recipe_ingredients, recipe_steps
0012_maintenance_tables            deep_clean_tasks, deep_clean_assignments,
                                   maintenance_tickets
0013_ops_aggregates                tip_pools, tip_pool_distributions,
                                   customer_feedback, lto_performance,
                                   weekly_rollups, ai_reports
0014_notifications                 notifications, notification_recipients,
                                   user_notification_prefs, sms_queue
0015_audit_integrations            audit_log, toast_daily_data, shifts_daily_data
```

### RLS (10 migrations)

```
0016_rls_auth                      §5.1 derived (users, user_locations,
                                   locations, sessions, email_verifications,
                                   password_resets) — service-role-only on
                                   verifications/resets/sessions per Juan's
                                   sign-off revisions
0017_rls_checklists                §5.2 verbatim
0018_rls_shift_overlays            §5.3 verbatim
0019_rls_written_announcements     §5.4 verbatim (incl. written_reports_insert)
0020_rls_vendors_items_pars        §5.5 verbatim
0021_rls_auth_corrections          fix FOR ALL leak in user_locations + locations
0022_rls_location_scoped           §5.6 derived (15 tables, 5 write tiers)
0023_rls_verbatim_corrections      append-only fix for FOR ALL leaks in
                                   §5.2 / §5.4 / §5.5 + announcements
                                   author-scoped 3-hour edit window +
                                   vendors_update_trivial audit comment
0024_rls_global                    §5.7 derived (8 tables, GM+/MoO+/service-role
                                   tiers; vendor_price_history read tightened
                                   to AGM+)
0025_rls_audit_misc                §5.8 verbatim audit_log + 7 leftover tables
                                   (notifications subsystem, photos/views,
                                   training_progress with self-signoff prevention,
                                   sms_queue tightened to CGS-only)
```

### Seed (3 migrations)

```
0026_seed_locations                Capitol Hill (MEP), P Street (EM)
0027_seed_user_juan                Juan as cgs + user_locations rows for both
                                   locations. PLACEHOLDER pin_hash —
                                   Phase 2 must overwrite.
0028_seed_vendor_starter_items     "TBD - Reassign" vendor + 24 items, NULL pars
```

---

## Smoke test results

**`relrowsecurity = true` count: 53 / 53 tables.** Zero gaps.

**Seed verification:**

| Table | Count | Expected |
|---|---|---|
| locations | 2 | 2 |
| users | 1 | 1 (Juan) |
| user_locations | 2 | 2 (Juan ↔ MEP, EM) |
| vendors | 1 | 1 (TBD - Reassign) |
| vendor_items | 24 | 24 |
| vendor_items with NULL pars | 24 | 24 (intentional) |

24 items confirmed by name, category, unit — exactly matching Juan's spec.

---

## Write-tier matrix (cheat sheet for the audit)

The Phase 0 handoff specified read patterns and partial write thresholds. Session A surfaced and Juan signed off on the full write tier per table. Session B's audit harness needs this matrix.

### §5.1 Auth (derived)

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `users` | self OR ≥6 | ≥6.5 | self (any field — column gating app-layer) OR ≥6.5 | denied |
| `user_locations` | self OR ≥6 | ≥6.5 | ≥6.5 | denied |
| `locations` | ≥3 | ≥6.5 | ≥6.5 | denied |
| `sessions` | service-role only | service-role only | service-role only | denied |
| `email_verifications` | service-role only | service-role only | service-role only | denied |
| `password_resets` | service-role only | service-role only | service-role only | denied |

### §5.2 Checklists (verbatim from spec, FOR ALL split per `0023`)

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `checklist_templates` | location ∈ user OR ≥7 | ≥6 | ≥6 | denied |
| `checklist_template_items` | parent template's read | ≥6 | ≥6 | denied |
| `checklist_instances` | location ∈ user OR ≥7 | location ∈ user AND ≥3 | location ∈ user AND ≥3 | denied |
| `checklist_completions` | parent instance's read | self AND item.min_role_level ≤ user OR (instance status = 'open') | denied | denied |
| `checklist_submissions` | parent instance's read | self | denied | denied |
| `checklist_incomplete_reasons` | parent instance's read | self | denied | denied |
| `prep_list_resolutions` | parent instance's read | service-role only | service-role only | denied |

### §5.3 Shift Overlay (verbatim)

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `shift_overlays` | location ∈ user OR ≥7 | self AND location ∈ user AND ≥3 | self AND submitted_at > now() − 3h | denied |
| `shift_overlay_corrections` | parent overlay's read | self AND ≥4 AND location ∈ user | denied | denied |

### §5.4 Written Reports & Announcements (verbatim, with `0023` author-scoped 3h window for announcements)

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `written_reports` | level ≥ visibility_min_level AND location-scope | self AND ≥3 | self AND submitted_at > now() − 3h | denied |
| `announcements` | active AND target band AND location-scope | ≥5 AND posted_by = self | self AND ≥5 AND posted_at > now() − 3h | denied |
| `announcement_acknowledgements` | self OR ≥5 | self | denied | denied |

### §5.5 Vendors / Items / Pars (verbatim, with `0023` split + comment)

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `vendors` | ≥3 | ≥6 | `vendors_update_trivial` ≥5 (column gating app-layer) | denied |
| `vendor_items` | ≥3 | ≥5 | ≥5 | denied |
| `par_levels` | location ∈ user OR ≥7 | ≥6 | ≥6 | denied |

### §5.6 Location-scoped (derived per Juan's tier overrides)

All reads: `location_id = ANY(current_user_locations()) OR current_user_role_level() >= 7`. All deletes: denied.

| Table | Insert/Update tier |
|---|---|
| `vendor_deliveries` | KH+ (≥3) |
| `customer_feedback` | KH+ (≥3) |
| `training_reports` | KH+ (≥3) — intentional v1.2 design (cross-shift observation) |
| `maintenance_tickets` | SL+ (≥4) — operationally non-negotiable for solo SL shifts |
| `catering_customers` | AGM+ (≥5) — scoped via `primary_location_id` |
| `catering_orders` | AGM+ (≥5) |
| `catering_pipeline` | AGM+ (≥5) — `location_id IS NULL` allowed for unassigned leads |
| `deep_clean_assignments` | AGM+ (≥5) |
| `vendor_orders` | GM+ (≥6) — placing an order commits CO money |
| `tip_pools` | GM+ (≥6) |
| `tip_pool_distributions` | GM+ (≥6) — scoped via parent `tip_pools.location_id` |
| `lto_performance` | GM+ (≥6) |
| `weekly_rollups` | service-role only — read includes `location_id IS NULL` |
| `toast_daily_data` | service-role only |
| `shifts_daily_data` | service-role only |

### §5.7 Global (derived per Juan's tier overrides)

All reads: `level >= 3` (with one tightening). All deletes: denied.

| Table | Insert/Update tier |
|---|---|
| `recipes`, `recipe_ingredients`, `recipe_steps` | GM+ (≥6) |
| `deep_clean_tasks` | GM+ (≥6) |
| `positions`, `position_responsibilities`, `training_modules` | MoO+ (≥6.5) — org / curriculum |
| `vendor_price_history` | service-role only — **read tightened to AGM+ (≥5)** for cost-data sensitivity |

### §5.8 + leftover (derived)

| Table | Read | Write |
|---|---|---|
| `audit_log` | actor_id = self OR ≥7 | service-role only |
| `notifications` | recipient OR ≥7 | service-role only |
| `notification_recipients` | self OR ≥7 | self update (column gating app-layer); service-role insert |
| `user_notification_prefs` | self OR ≥7 | self insert + update |
| `sms_queue` | **CGS-only (≥8)** | service-role only |
| `report_photos` | ≥3 (metadata only — content via signed URL gate in API) | ≥3 AND uploaded_by = self; no update; no delete |
| `report_views` | self OR ≥7 | self insert; no update; no delete |
| `training_progress` | self OR ≥5 | ≥5 AND signed_off_by != self (self-signoff prevention enforced in RLS) |

---

## High-priority policies to scrutinize specifically

These were flagged during Session A as worth deeper attention in the audit:

1. **`checklist_completions_insert`** — three-condition WITH CHECK (most complex policy in the schema). Validate all three branches independently.
2. **`tip_pool_distributions_*`** — explicit `tip_pool_distributions.tip_pool_id` qualifiers in EXISTS subqueries. Verify Postgres resolves correctly under RLS context (the unqualified version was a Session A change request from Juan; explicit-qualifier version is what landed).
3. **`users_update_self` + `users_update_admin` OR-stacking** — confirm a non-admin can only update own row, an admin can update any row. The API-layer column gating (role/email/active not editable via self path) lands in Phase 2 — Session B should document this as a Phase 2 acceptance criterion, not test it directly.
4. **`announcements_update`** — author-scoped + 3-hour window. Verify time-bound expiry.
5. **`training_progress_*`** — self-signoff prevention. Verify an AGM trying to set `signed_off_by = self` is denied at RLS (not just app-layer).
6. **`shift_overlays_update_self`** — same 3-hour time-bound test.
7. **`report_photos_read`** at level ≥3 — RLS allows metadata reads broadly. The `/api/photos/[id]` route (Phase 6) must enforce parent-artifact RLS before issuing signed URLs. Document this as a Phase 6 acceptance criterion.
8. **`announcements_insert`** — `posted_by = current_user_id()` constraint. AGMs cannot post announcements impersonating someone else.

---

## Negative-test surface

For every policy, an audit needs at least one negative case alongside the positive:

- **Anonymous (no JWT)** — every table should deny every operation. `current_user_id()` returns NULL when no claim is set; `current_user_role_level()` falls through the CASE to ELSE 0; every level-gated policy fails.
- **Wrong role for write tier** — KH attempting AGM+ insert, AGM attempting GM+ insert, GM attempting MoO+ insert. The role boundary cases (especially around 6.5 — MoO sits between GM and Owner) deserve specific tests.
- **Cross-location attempts** — a user assigned only to MEP attempting to read/write EM rows. Owner+ should bypass via `level >= 7`.
- **Time-window expiry** — for `shift_overlays_update_self`, `written_reports_update_self`, `announcements_update`: insert a row, advance simulated time past 3 hours (or use a DB trick to backdate `submitted_at` / `posted_at`), confirm UPDATE is denied.
- **Service-role bypass** — confirm service-role connection writes succeed where end-user RLS denies (sessions, email_verifications, password_resets, prep_list_resolutions, audit_log, notifications, sms_queue, weekly_rollups, toast_daily_data, shifts_daily_data, vendor_price_history).

---

## State at end of Session A

**What's done:**
- All 53 tables exist with RLS enabled.
- All policies applied; naming consistent (`<table>_<action>` permissive, `<table>_no_user_<operation>` deny).
- Three helper SQL functions in place.
- Seed data loaded and verified.

**What's NOT done (intentional):**
- **No `lib/supabase.ts` / `lib/supabase-server.ts` wiring.** Phase 2.
- **No auth code.** Phase 2.
- **No admin tool UIs.** Phase 5.
- **No module logic** (`lib/checklists.ts`, `lib/prep.ts`, `lib/handoff.ts`). Phase 6.
- **No Supabase Storage bucket.** Deferred to Phase 6.
- **Juan's `pin_hash` is a placeholder.** Phase 2 must overwrite before any auth attempt.

**Vercel auto-deploy:** Not triggered. Session A touched only the database via Supabase MCP; zero git pushes. The branch `claude/strange-keller-f772b9` will receive this handoff commit; main remains at the Phase 0 handoff commit.

---

## What Phase 1 Session B does

**Session B is the RLS audit.** It is the security boundary. Per Juan's spec, it must run as its own session — bundling it with schema-write fatigue would compromise the audit.

The session will be opened with a kickoff prompt that specifies:
- **Test fixtures** — one user per role (cgs, owner, moo, gm, agm, catering_mgr, shift_lead, key_holder, trainer), each assigned to specific locations.
- **Three test tiers** — must-pass / should-pass / adversarial.
- **Output** — `docs/PHASE_1_RLS_AUDIT.md`.

The methodology details come from the Session B kickoff prompt, not this handoff.

When Session B passes, Phase 1 is complete and Phase 2 (auth) opens. Until then, Phase 1 is *not* done — the schema and RLS exist but their correctness has not been verified per-role-per-policy.

---

## Quick references

- **Supabase project:** `bgcvurheqzylyfehqgzh` (us-east-1, PG17.6.1.111)
- **Connection for audit:** Supabase MCP tools (`apply_migration` for any corrective migrations, `execute_sql` for verification queries, `list_migrations` for history)
- **Migration history:** 28 migrations applied (`0001_extensions` through `0028_seed_vendor_starter_items`)
- **Source of truth:** Foundation Spec v1.2, sections §4 (schema) and §5 (RLS); `AGENTS.md` for durable knowledge; this document for Session A specifics.
