-- Migration 0196_checklist_completions_live_head_per_phase
-- AUTHORED 2026-09-09. NOT YET APPLIED TO PROD — GATE (JUAN). Lineage at 0195.
--
-- 0196: the one-live-head index (0176) learns that an opening item legitimately carries TWO
-- live completion rows — its Phase 1 verification row and its Phase 2 prep-entry row — and the
-- 342 Phase 1 rows 0176's collapse wrongly superseded are restored.
--
-- ── PROVENANCE (guide-walk sim, 2026-09-08 · manager lane) ─────────────────────────────
-- Every "Opener prepped" save on the opening's Phase 2 returned 500:
--     save_phase2_item_atomic rpc: duplicate key value violates unique constraint
--     "checklist_completions_one_live_head"
-- 0176 (2026-08-11) added UNIQUE (instance_id, template_item_id) WHERE superseded_at IS NULL AND
-- revoked_at IS NULL. The opening was designed (0053–0056) as TWO live rows per spot-check item:
-- Phase 1 submit inserts a completion carrying prep_data.phase1; Phase 2's save_phase2_item_atomic
-- inserts a second completion carrying prep_data.phase2, and its supersede UPDATE deliberately
-- targets only `prep_data ? 'phase2'` (0056:239-245) because 0056:150-158 READS the live Phase 1
-- row for ground truth, and lib/reports-hub.ts (opening report detail) prefers the Phase 1 row
-- "when both exist for one item". Under 0176 the second insert is a 23505 on every item, so
-- "Finalize Phase 2" can never enable and no opening can be confirmed.
--
-- VERIFIED AGAINST THE LIVE SYSTEM (read-only probes, 2026-09-08/09):
--   · save_phase2_item_atomic prosrc md5 bec3141d16229c9f258b6938b6247724 on sim AND prod.
--   · prod: 0 completions with prep_data ? 'phase1' or 'phase2' dated >= 2026-08-11 — the
--     opening has not been exercised since the index landed, which is why it has not fired.
--   · prod history: 376 items carried both phase rows. 0176's collapse step kept "the newest
--     completed_at per (instance, item) live" and superseded the rest — so under every one of
--     410 live Phase 2 rows it superseded the Phase 1 sibling: 342 rows, 10 opening instances
--     (2026-06-03 EM+MEP · 06-04 EM+MEP · 06-15 EM+MEP · 06-16 EM · 06-17 EM+MEP · 07-10 EM),
--     ALL stamped superseded_at = 2026-08-11 18:48:44.528874+00, each superseded_by = the live
--     Phase 2 row of the same key. Those ten reports lost their verification fields.
--   · Dry run: restoring the 342 rows and building the per-phase index yields 0 duplicates.
--   · 1,932 live rows have prep_data IS NULL; `prep_data ? 'phase2'` is NULL there and NULLs are
--     distinct in a unique index, so the expression is coalesced to false.
--
-- ── WHY THIS SHAPE ─────────────────────────────────────────────────────────────────────
-- The alternative — Phase 2 supersedes the Phase 1 row and carries its blob forward — moves every
-- Phase 1 reader (0056:150, reports-hub, trends, C.54 provenance). This shape keeps the 0053–0056
-- contract byte-for-byte and changes no function and no reader: one live head PER PHASE KIND.
-- completeItem (lib/checklists.ts) supersedes every live row for the key before it inserts a
-- plain row, so it is unaffected. Follow-up (not here): 0185's chain-edit branch does a single-row
-- `UPDATE … RETURNING id INTO` over the live rows of a key; with two live rows plpgsql raises.
-- That branch has no caller (0185 header) — scope its predicate to NOT (prep_data ? 'phase2')
-- the day the chain-edit UI is built.
--
-- ── ORDER INSIDE THIS FILE (load-bearing) ───────────────────────────────────────────────
-- (1) drop the 0176 index — restoring a Phase 1 row under a live Phase 2 sibling would 23505.
-- (2) restore the 342 victims, asserted against the literal manifest; a fresh environment
--     (sim, a new tenant) has 0 victims and skips the restore — any OTHER count refuses.
-- (3) create the per-phase index — its build is the proof the data now satisfies it.
-- No deploy-ordering hazard: no code changes; the app only gains the writes it was refused.

do $$
declare
  v_victims   int;
  v_instances int;
  v_ids       uuid[];
  n           int;
begin
  if current_setting('plpgsql.check_asserts', true) = 'off' then
    raise exception '0196: plpgsql.check_asserts is off — the restore relies on ASSERT guards; refusing';
  end if;

  -- (1)
  drop index if exists public.checklist_completions_one_live_head;

  -- (2) the exact rows 0176's collapse took: a Phase 1 row, not revoked, stamped at the collapse
  --     instant, whose superseded_by is the LIVE Phase 2 row of the same (instance, item).
  create temp table tmp_0196_victims on commit drop as
    select c.id, c.instance_id, c.template_item_id
      from public.checklist_completions c
      join public.checklist_completions l
        on l.id = c.superseded_by
       and l.instance_id = c.instance_id
       and l.template_item_id = c.template_item_id
       and l.prep_data ? 'phase2'
       and l.superseded_at is null
       and l.revoked_at is null
     where c.revoked_at is null
       and c.prep_data ? 'phase1'
       and c.superseded_at = '2026-08-11 18:48:44.528874+00';

  select count(*), count(distinct instance_id), coalesce(array_agg(id), '{}')
    into v_victims, v_instances, v_ids
    from tmp_0196_victims;

  if v_victims = 0 then
    raise notice '0196: no 0176-collapse victims here (fresh / non-prod environment) — nothing to restore';
  else
    assert v_victims = 342,  format('0196: expected 342 collapse victims, found %s — stop and look', v_victims);
    assert v_instances = 10, format('0196: expected 10 affected instances, found %s — stop and look', v_instances);
    -- no key may hold two Phase 1 victims (the per-phase index would refuse)
    assert (select count(*) from (select instance_id, template_item_id from tmp_0196_victims
                                   group by 1, 2 having count(*) > 1) d) = 0,
           '0196: a key holds more than one Phase 1 victim — stop and look';

    update public.checklist_completions c
       set superseded_at = null, superseded_by = null
      from tmp_0196_victims v
     where c.id = v.id;
    get diagnostics n = row_count;
    assert n = 342, format('0196: restore touched %s rows, expected 342', n);

    -- one audit row for the ruling; destructive because it alters the accountability record
    -- (restoring what a migration removed). actor_context marks it as migration-applied.
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (null, null, 'checklist_completion.restore', 'checklist_completions', null,
      jsonb_build_object(
        'actor_context', 'migration_apply', 'migration', '0196',
        'cause', '0176 collapse superseded the Phase 1 row under every live Phase 2 row of the same item',
        'collapse_stamp', '2026-08-11 18:48:44.528874+00',
        'restored_rows', 342, 'instances', 10,
        'ids', to_jsonb(v_ids)),
      true);
  end if;

  -- (3) one live head per (instance, item, phase kind). Phase 2 prep-entry rows are their own kind;
  --     everything else (plain ticks, Phase 1 verification, mid-day rows without a phase2 key) is the
  --     other. Partial: only LIVE rows participate, so append-only history is unconstrained.
  create unique index checklist_completions_one_live_head_per_phase
    on public.checklist_completions (instance_id, template_item_id, (coalesce(prep_data ? 'phase2', false)))
    where superseded_at is null and revoked_at is null;
end $$;

-- Verify (run after apply):
--   select indexname, indexdef from pg_indexes where tablename = 'checklist_completions' and indexname like '%live_head%';
--   → exactly one row, checklist_completions_one_live_head_per_phase, with coalesce((prep_data ? 'phase2'), false).
--   select count(*) from checklist_completions where prep_data ? 'phase1' and superseded_at is null and revoked_at is null
--     and exists (select 1 from checklist_completions l where l.instance_id = checklist_completions.instance_id
--                 and l.template_item_id = checklist_completions.template_item_id and l.prep_data ? 'phase2' and l.superseded_at is null);
--   → 342 on prod (the restored pairs), 0 elsewhere.
--   Regression: save_phase2_item_atomic on a phase1_complete instance succeeds twice (second call supersedes the first phase2 row).
