# Handoff — post-C.43, next CO-OPS session (2026-06-14)

Cold-start doc. If you've been through compaction or this is a fresh session, read this first, then `docs/REMAINING_SCOPE.md`.

## Where we are
- **C.43 Mid-day Prep is SHIPPED + merged to `main`** (squash `03be60c`, was PR #51, 13 commits). Full two-phase module: schema (migrations 0059–0065) → lib → trigger → seed → dashboard tile → Phase 1 count → Phase 2 collaborative prep (structured over/under) → finalize → closing auto-tick with count.
- **The entire opening-report arc is done** (C.41 renumber / C.52 realtime-lite / C.53 three-phase / C.55 cross-user mark-not-done) and live in prod (`co-ops-ashy.vercel.app`). Auth/RLS/foundation all live.
- **Pre-launch:** CO is NOT live yet. Juan smoke-tests manually; prod DB writes are low-stakes. Prod-data scrubs are HELD for Juan's `--execute` (`docs/LAUNCH_PURGE_MANIFEST.md`).

## Resume points (in order of readiness)
1. **Next Wave 2 module** — `docs/REMAINING_SCOPE.md` is the board. Candidates: PM Report, Mid-Shift Report (read surface), Cash Deposit Confirmation (needs photo service), Maintenance Log (read surface), then Reports Hub (Wave 3). Pick one → **brainstorm fresh** (new module → use the brainstorming skill).
2. **Two small C.43 follow-ups** (also in the `next_session_c43_midday_prep` memory):
   - Closing report-ref auto-tick only fires if **today's closing instance exists at report-finalize time**. Reconcile-at-closing-load would make it order-independent (affects AM-prep equally, not just mid-day).
   - **Full action-button uniformity sweep** (am-prep/closing CTAs → a shared button component). `LogoutButton` + the back-link were done as representatives only.

## Locked decisions — do NOT re-litigate
- **C.52 mid-day realtime = realtime-lite** (per-item save + reconcile-on-load; live websocket sync deferred by Juan). C.52 itself was already shipped via C.53 Commit B.
- **Mid-day Phase 2 over/under = structural** — reuses opening `OverParModal`/`UnderParModal`; stored as `prep_data.overUnder = {kind, reasonCategory, directedBy, freeText}`.
- **Opening auto-tick already existed** (closing "Opening verified" item + `submit_opening_atomic`); mid-day auto-tick added (migration 0065 + `autoCompleteClosingMidDayRef`, with a count of finalized instances).

## How to operate (the load-bearing lessons this session proved)
- **Verify against live ground truth before acting.** Re-read cited files; query the live DB/schema; read back persisted writes. Plans, specs, memory, and comments drift. (This caught ~12 would-be bugs; the two that shipped came from NOT checking what an edit invalidates — grep ALL call-sites when changing a shared filter, and `select proname from pg_proc where prosrc like '%<name>%'` before dropping a named constraint.)
- **The scope map undercounts shipped work** — `/ordering`, `/recipes`, `/reports`, the admin suite, etc. already exist as routes/pages. Do a **git-grounded recount before planning any wave**, not just a spec read.
- `next build` is a separate gate from `tsc`. Every DB change = a captured migration in `supabase/migrations/` + a throwaway smoke that cleans up after itself.

## Key files
- `docs/REMAINING_SCOPE.md` — the 7-wave board (Aggie adversarial-pass reconciled).
- `docs/LAUNCH_PURGE_MANIFEST.md` — prod scrubs HELD for Juan.
- `docs/superpowers/specs/2026-06-13-c43-midday-prep-design.md` + `docs/superpowers/plans/2026-06-14-c43-midday-prep.md` — C.43 spec + plan.
- Migrations `0059`–`0065` (C.43 schema + RPCs + closing ref).

## Operating framework
Juan + Claude Chat + Aggie + CC (this). CC (me) = T0 main coder + sole semantic reviewer of all non-CC code. Aggie (DeepSeek v4 Pro) helps via the CHIEF system / file-drops; her output routes to Opus 4.8 and I review it. Durable operating pattern lives in CHIEF: `verify-against-live-ground-truth-before-acting.md`.
