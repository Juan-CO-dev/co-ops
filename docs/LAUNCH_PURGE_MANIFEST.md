# Launch Purge Manifest (STAGED — do not execute piecemeal)

**Written 2026-06-13.** Single source of truth for everything to scrub before / at full launch.
This is a **staging** document. Production-data actions are **HELD for Juan's explicit `--execute` go** —
they are Juan's authority, not Claude Code's. Local-file actions are safe to run anytime.

> **Verify-before-execute discipline:** every prod identifier below was carried from prior handoff docs.
> Before running any DB action, re-confirm the row still exists via a live Supabase query — IDs drift,
> rows may already be cleaned. Do not execute from this doc's IDs blind.

---

## A. Production data — HELD FOR JUAN (`--execute` required)

Append-only philosophy applies: **deactivate (`active=false`) / soft-revoke, never hard-DELETE**, except
the sentinel instance cascade which is explicitly disposable test data.

| # | Artifact | Action | Confirm query before run |
|---|---|---|---|
| A1 | Sentinel opening instance `f66e0668-cad7-4382-aefa-f11424d8542f` (location EM, date `2099-12-31`, `phase2_complete`; ~78 Phase-1 + ~39 Phase-2 completions, all soft-revoked) | Cascade-delete instance + its completions/snapshots (disposable test data) | `select id,status,business_date from checklist_instances where id='f66e0668-...';` |
| A2 | ZZ_TEST accounts — `ZZ_TEST_KH1`, `ZZ_TEST_KH2`, `ZZ_TEST_PREP` (location `d2cced11`, EM; live disposable PINs documented in `handoff_C53-commitB-next-session.md` §5) | `active=false` (NOT delete — append-only preserves user_id forensically) | `select id,first_name,role,active from users where first_name like 'ZZ_TEST%';` |
| A3 | Orphaned `under_par_alert` notifications (2) + their `notification_recipients` rows, from the C.55 smoke re-run | Soft-clean per notifications convention | `select id,type,created_at from notifications where type='under_par_alert' order by created_at desc;` |
| A4 | C.41 session-revoke — staged script `scripts/role-renumber-revoke-sessions.ts` (dry-run = 116 sessions / 7 users). JWT claim is inert post-renumber, so this is cleanup not correctness. | Run with `--execute` (Juan's go) | dry-run first: `npx tsx --env-file=.env.local scripts/role-renumber-revoke-sessions.ts` |

**Each A-item should emit an `audit.*` row** (e.g. `audit.gap_recovery` for smoke-artifact cleanup, or the
canonical lifecycle action) capturing what was scrubbed and why — per the migration/seed audit conventions in AGENTS.md.

---

## B. Local files — ✅ DONE 2026-06-13 (deleted)

The 11 untracked smoke/scratch scripts below were **deleted 2026-06-13** (they were blocking a local `next build`).
The `.gitignore` patterns remain as defensive guards against re-creating them under the same names.
Original list (for the record):

```
scripts/c53-phase2-smoke.ts
scripts/c55-cleanup-orphans.ts
scripts/c55-diag.ts
scripts/c55-roles-check.ts
scripts/c55-seed-now.ts
scripts/c55-smoke-check2.ts
scripts/c55-smoke-check3.ts
scripts/c55-smoke-cleanup.ts
scripts/c55-smoke-seed.ts
scripts/c55-smoke-survey.ts
scripts/fix-test-pins.ts
```

Deletion is irreversible (untracked → no git history). They are smoke scaffolding only; nothing in app code imports them.
Also untracked: `docs/superpowers/` (superpowers skill cache, local tooling — not app infra; leave or delete, no prod impact).

---

## C. Done (no action)

- **FT.2 i18n re-namespace** — `opening.phase2.section_*` → `opening.section_verify.*`, `opening.phase2.recount_*` → `opening.recount.*` (8 keys × 2 locales + 6 callsites + 2 component header comments). Shipped 2026-06-13. tsc-clean.
- **Stale handoff docs** — 5 docs banner-marked SUPERSEDED (point here + to `REMAINING_SCOPE.md`).
