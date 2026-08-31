-- Migration 0188_cash_report_atomic_supersede
-- AUTHORED 2026-08-30. NOT YET APPLIED — GATE (LEAD/JUAN).
--
-- 0188: submit_cash_report_atomic — supersede + insert + back-point in ONE transaction,
-- so the cash-report strand window stops existing rather than being narrowed and reported.
--
-- ── PROVENANCE (wiring audit, checklists-cash cluster; PR #304's flag) ────────────────
-- PR #304 hardened `submitCashReport` (lib/cash.ts) as far as an un-transactional caller
-- can be hardened, and then filed the rest honestly:
--
--     "FILED, NOT BUILT: the transactional cash write (supersede + insert + back-pointer
--      in one Postgres RPC) is the only thing that REMOVES the strand window rather than
--      narrowing it and reporting it. Not doable in this PR — the migration would be
--      authored-only, and shipped code cannot call an unapplied RPC."
--
-- This file is that migration. It is the AUTHORING half only; see "the wiring is NOT in
-- this PR" below.
--
-- ── THE WINDOW, PRECISELY ─────────────────────────────────────────────────────────────
-- `cash_reports_one_live_per_day` (0067) is UNIQUE (location_id, report_date) WHERE
-- superseded_at IS NULL. One live row per shop per day. An edit is therefore not an
-- UPDATE — it is supersede-the-old, insert-the-new, then write the successor's id back
-- onto the old row. Three statements, three separate PostgREST round trips, no
-- transaction:
--
--   1. UPDATE prior SET superseded_at = now        ← the old row leaves the live set
--   2. INSERT the new row                          ← the new row enters it
--   3. UPDATE prior SET superseded_by = new.id     ← the forensic chain link
--
-- If (2) fails, the day has NO live cash report and every read surface — loadCashReport,
-- the reports hub, the dashboard — filters `superseded_at IS NULL` and therefore renders
-- the location as having filed nothing at all. #304 added a compare-and-set rollback plus
-- a live-row re-read that distinguishes "a concurrent submit won" from "we stranded the
-- day", and an audit row (`cash_report.supersede`, `metadata.outcome = supersede_strand`)
-- so the strand is at least queryable. That is diagnosis, not prevention: the rollback is
-- itself a fourth un-transactional write that can fail. If (3) fails the row set is
-- correct but the chain link is missing, and the code can only console.error about it.
--
-- Inside a function body all three statements share ONE transaction. (2) failing rolls (1)
-- back with it — no rollback statement to fail, no strand to detect, no audit row needed
-- for a state that can no longer occur. (3) becomes unconditional rather than best-effort.
--
-- ── WHAT IS IN THE FUNCTION, AND WHAT IS DELIBERATELY LEFT IN TS ──────────────────────
-- IN: the three writes, and only the three writes.
--
-- OUT, and on purpose:
--   · THE EDIT-WINDOW GATE. `submitCashReport` refuses with `closing_finalized` when the
--     day's closing instance is confirmed, resolved through `applyEffectiveResolution`
--     (PR-3 date-aware template versioning). That is a policy read across three tables
--     with its own resolution semantics, it does not participate in the race, and moving
--     it would fork the definition of "the closing is final" into plpgsql. It stays where
--     it is and still runs FIRST.
--   · THE TOTALS. `computeCashTotals` is pure and test-pinned in lib/cash-shared.ts. The
--     server already never trusts the client for over/short and deposit; re-deriving them
--     in SQL would create a second arithmetic that must be kept equal to the first. The
--     function takes the computed cents as parameters.
--   · THE AUDIT ROW. `audit()` is fail-open by design (AGENTS.md) and its action
--     vocabulary is closed and compiler-enforced in TypeScript. Emitting from SQL would
--     bypass `isDestructive` — the exact exception `report.update` had to be carved out
--     for. The caller keeps writing it, unchanged, after the RPC returns.
--
-- ── THE RETURN CONTRACT ───────────────────────────────────────────────────────────────
-- Returns the NEW row's id, plus the superseded id (null on a first submit) so the caller
-- can keep its existing audit metadata (`superseded: prior?.id ?? null`) byte-identical.
-- A 23505 from the unique index — a genuinely concurrent submit that committed first —
-- propagates as itself, and the caller maps it the way lib/checklists.ts and
-- lib/catering/toast-sales.ts already map that code: a named 409, not a 500.
--
-- ── THE WIRING IS NOT IN THIS PR ──────────────────────────────────────────────────────
-- lib/cash.ts is UNCHANGED and still performs its three round trips. Shipped code cannot
-- call an unapplied RPC, and the repo has no function-existence probe idiom — every probe
-- in lib/dynamic-pars-probes.ts and lib/vendor-schema-probes.ts is a table+column select,
-- and minting the first function-existence probe on the cash path (the one surface where a
-- wrong answer is money) is not a thing to do as a side effect of an authoring PR. The
-- swap is the named follow-up for the PR after this gate opens, and it is a small one:
-- replace steps 1-3 with one `.rpc()` call and delete the rollback/strand machinery, which
-- exists only to describe a state this function makes impossible.
--
-- ── VERIFIED BEFORE AUTHORING (source, 2026-08-30) ────────────────────────────────────
--   · `cash_reports` DDL: 0067_cash_reports.sql. Columns re-read from that file, plus
--     0069_cash_reports_rename_drawer_float.sql, which renamed register_count_cents →
--     drawer_total_cents and register_target_cents → float_cents. Those two files are the
--     only migrations in the whole lineage that mention the table.
--   · The insert column list below is exactly lib/cash.ts's, field for field, including
--     `signed_at = nowIso` sharing the supersede instant and
--     `signed_by = entered_by = actor.userId`.
--   · `denominations` is written only when count_method = 'denomination'; the caller
--     already passes null otherwise, and the function does not second-guess it.
--   · RLS on `cash_reports` is read/insert at level ≥ 4 within the actor's locations, with
--     explicit no-user UPDATE and DELETE (0067). This function is SECURITY DEFINER and
--     service-role-granted, matching every other write path into this table.
--   · No checksum is asserted: this creates a NEW function, so there is no prod prosrc to
--     compare against, and this session had no MCP access.
--
-- ── APPLY ORDER (for whoever gates this) ──────────────────────────────────────────────
-- Additive: one new function, no DDL on any table, no backfill, no policy change. Applying
-- it changes NOTHING at runtime until the follow-up PR points lib/cash.ts at it — so it is
-- safe to apply ahead of that PR, and it must be applied before it. The PR body carries the
-- pre-apply existence check and the post-apply grant verification. Apply via MCP; then this
-- file IS the record. NOTHING IN THIS PR APPLIES IT.

create or replace function submit_cash_report_atomic(
  p_location_id        uuid,
  p_report_date        date,
  p_projected_cents    integer,
  p_drawer_total_cents integer,
  p_float_cents        integer,
  p_count_method       text,
  p_denominations      jsonb,
  p_cash_tips_cents    integer,
  p_on_shift           jsonb,
  p_over_short_cents   integer,
  p_deposit_cents      integer,
  p_over_short_note    text,
  p_actor_id           uuid,
  p_now                timestamptz
) returns table (new_id uuid, superseded_id uuid)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_prior_id uuid; v_new_id uuid;
begin
  -- (1) Find and supersede the live row for this (location, date), if there is one.
  --     The compare-and-set on `superseded_at IS NULL` means a concurrent transaction
  --     that already claimed this row updates zero rows here and its INSERT then loses
  --     to cash_reports_one_live_per_day — one winner, and the loser's whole transaction
  --     rolls back rather than leaving a half-applied edit.
  update cash_reports
     set superseded_at = p_now
   where location_id = p_location_id
     and report_date = p_report_date
     and superseded_at is null
  returning id into v_prior_id;

  -- (2) Insert the new live row. A 23505 here (a genuinely concurrent submit that
  --     committed first) aborts the transaction, which un-supersedes (1) for free.
  insert into cash_reports (
    location_id, report_date,
    projected_cents, drawer_total_cents, float_cents,
    count_method, denominations, cash_tips_cents, on_shift,
    over_short_cents, deposit_cents, over_short_note,
    signed_by, signed_at, entered_by
  ) values (
    p_location_id, p_report_date,
    p_projected_cents, p_drawer_total_cents, p_float_cents,
    p_count_method,
    case when p_count_method = 'denomination' then p_denominations else null end,
    p_cash_tips_cents, coalesce(p_on_shift, '[]'::jsonb),
    p_over_short_cents, p_deposit_cents, p_over_short_note,
    p_actor_id, p_now, p_actor_id
  ) returning id into v_new_id;

  -- (3) The back-pointer. Unconditional now, not best-effort: it shares the
  --     transaction with the insert whose id it records, so it cannot be the one
  --     write that silently did not happen.
  if v_prior_id is not null then
    update cash_reports set superseded_by = v_new_id where id = v_prior_id;
  end if;

  new_id := v_new_id;
  superseded_id := v_prior_id;
  return next;
end $$;

comment on function submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
) is
  'Supersede the live cash_reports row for (location, date), insert the new one, and write '
  'the back-pointer — in ONE transaction, so a failed insert cannot strand the day with no '
  'live report. The edit-window gate (closing_finalized), the totals (computeCashTotals) '
  'and the audit row stay in lib/cash.ts on purpose. Returns (new_id, superseded_id); '
  'superseded_id is null on a first submit. 23505 propagates for the caller to map to 409.';

-- REVOKE-FROM-PUBLIC (AGENTS.md): Supabase's default ACLs grant EXECUTE to anon
-- EXPLICITLY, so revoking from public alone is not enough. Verify after apply via
-- information_schema.routine_privileges.
revoke execute on function submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
) from public;

revoke execute on function submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
) from anon;

revoke execute on function submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
) from authenticated;

grant execute on function submit_cash_report_atomic(
  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz
) to service_role;
