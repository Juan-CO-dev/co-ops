-- Migration 0260_sku_pack_versions_finalize
-- AUTHORED 2026-10-15. APPLIED TO SIM 20261015124920 · APPLIED TO PROD 20261015132616 (right after the 2a deploy, PR #477).
-- ORDER: apply ONLY AFTER the Phase 2a code is deployed to production (plan Task 14, step 9), and
-- only after the A → B → C sequence check (plan Task 4 Step 2) has passed on the sim.
-- DEADLINE: apply BEFORE THE NEXT DEPLETION CRON after the deploy — /api/cron/toast-sales-pull,
-- `0 9 * * *` UTC (05:00 EDT / 04:00 EST), which rebuilds T-1..T-3 through the dated graphs. Until
-- 0260 heals the deploy window, a day inside it can resolve through a version marked live whose
-- levels the old writer deactivated.
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase2a-shop-versions-data.md (Task 4).
--
-- WHY A SECOND MIGRATION. 0259 had to stay compatible with the code running when it was applied:
-- the pre-2a chain writer deactivates EVERY active level of the SKU — versioned ones included — and
-- inserts rows with no version_id. Between the 0259 apply and the 2a deploy that can leave (a) a
-- version marked live whose levels are all inactive, and (b) level sets with no version. After the
-- deploy every chain write goes through save_sku_pack_version, so the window is closed; this heals
-- it WITH REAL DATES (so as-of resolution stays true), asserts every invariant the resolver relies
-- on, and makes version_id NOT NULL so a forgotten writer (a spent seed, the 0201 one-shot bundle)
-- fails loudly instead of writing an orphan.
--
-- VERIFY AFTER APPLY:
--   select is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'sku_pack_levels' and column_name = 'version_id';  -- NO
--   select count(*) from public.sku_pack_versions where note like '0260 backfill%';  -- SKUs saved in the window (usually 0)

begin;

-- The baseline trigger (0259) must not fire while the window is healed: a SKU whose FIRST chain was
-- written in the window by the old code already had its flat mirror overwritten, so a "baseline"
-- taken now would record the NEW pack as the old one. Healing inserts no baseline.
alter table public.sku_pack_versions disable trigger sku_pack_versions_flat_baseline;

do $$
declare
  v_touched  uuid[];
  v_orphaned int;
  v_healed   int;
  v_redated  int;
  v_null     int;
  v_multi    int;
  v_empty    int;
  v_mismatch int;
  v_overlap  int;
begin
  -- The SKUs the window touched: an unversioned level set, or a version marked live whose levels
  -- were deactivated underneath it by the old writer.
  select coalesce(array_agg(distinct x.sku_id), '{}') into v_touched from (
    select sku_id from public.sku_pack_levels where version_id is null
    union
    select v.sku_id from public.sku_pack_versions v
     where v.active and not exists (select 1 from public.sku_pack_levels l where l.version_id = v.id and l.active)
  ) x;

  -- (a) a version marked live with no live level is no longer live (its end is re-dated in (c)).
  update public.sku_pack_versions v
     set active = false, valid_to = clock_timestamp()
   where v.active
     and not exists (select 1 from public.sku_pack_levels l where l.version_id = v.id and l.active);
  get diagnostics v_orphaned = row_count;

  -- (b) straggler level sets become global versions starting at their own effective_from (the
  --     end is a placeholder until (c)).
  insert into public.sku_pack_versions (sku_id, location_id, active, valid_from, valid_to, note, created_at, created_by)
  select g.sku_id, null, g.active, g.effective_from,
         case when g.active then null else g.effective_from end,
         '0260 backfill', g.effective_from, g.created_by
    from (select sku_id, effective_from, active, (array_agg(created_by order by id))[1] as created_by
            from public.sku_pack_levels where version_id is null
           group by sku_id, effective_from, active) g;
  get diagnostics v_healed = row_count;

  update public.sku_pack_levels l
     set version_id = v.id
    from public.sku_pack_versions v
   where l.version_id is null and v.note = '0260 backfill'
     and v.sku_id = l.sku_id and v.valid_from = l.effective_from and v.active = l.active;

  -- (c) RE-DATE THE WHOLE GLOBAL TIMELINE of every touched SKU, across versioned AND healed rows
  --     (Astra 2a r2#5): each closed version ends exactly when the next one (in valid_from order)
  --     began. A → B (old code, unversioned) → C (new code) gives A until B, B until C — so a past
  --     day inside B resolves to B, never to A. Pre-chain baselines keep their own end.
  --     THE ORDER REPRODUCES 0259's (review P3a): on a valid_from tie the set that ended LATER sorts
  --     later and the open (live) set sorts last — `valid_to nulls last`. 0259 ordered by `active`,
  --     which is the same thing at backfill time, but NOT here: once the new writer has retired the
  --     backfilled live set it is `active = false` like the older set it tied with, and an `active`
  --     tie-break would fall to a random id and could hand that older set's interval to it
  --     (caught by scripts/sql-harness-0259.mjs, intermittently, before this order).
  with t as (
    select v.id, lead(v.valid_from) over (partition by v.sku_id order by v.valid_from, v.valid_to nulls last, v.created_at, v.id) as next_from
      from public.sku_pack_versions v
     where v.location_id is null and v.flat_snapshot is null and v.sku_id = any (v_touched)
  )
  update public.sku_pack_versions v
     set valid_to = coalesce(t.next_from, v.valid_to, clock_timestamp())
    from t
   where v.id = t.id and not v.active
     and v.valid_to is distinct from coalesce(t.next_from, v.valid_to, clock_timestamp());
  get diagnostics v_redated = row_count;

  select count(*) into v_null from public.sku_pack_levels where version_id is null;
  assert v_null = 0, format('0260: %s levels still without a version', v_null);

  select count(*) into v_multi
    from (select sku_id from public.sku_pack_versions where active group by sku_id, scope_key having count(*) > 1) x;
  assert v_multi = 0, format('0260: %s (sku, scope) pairs with two live chains', v_multi);

  select count(*) into v_empty from public.sku_pack_versions v
   where v.active and not exists (select 1 from public.sku_pack_levels l where l.version_id = v.id and l.active);
  assert v_empty = 0, format('0260: %s live versions with no live level', v_empty);

  select count(*) into v_mismatch from public.sku_pack_levels l
    join public.sku_pack_versions v on v.id = l.version_id
   where l.active <> v.active;
  assert v_mismatch = 0, format('0260: %s levels disagree with their version about being live', v_mismatch);

  -- No two global chain versions of a touched SKU are in force at the same instant.
  select count(*) into v_overlap
    from public.sku_pack_versions a join public.sku_pack_versions b
      on a.sku_id = b.sku_id and a.id < b.id and a.location_id is null and b.location_id is null
     and a.flat_snapshot is null and b.flat_snapshot is null
     and a.valid_from < coalesce(b.valid_to, 'infinity') and b.valid_from < coalesce(a.valid_to, 'infinity')
   where a.sku_id = any (v_touched);
  assert v_overlap = 0, format('0260: %s overlapping global version intervals', v_overlap);

  raise notice '0260: % orphaned live versions closed, % straggler sets versioned, % versions re-dated', v_orphaned, v_healed, v_redated;
end $$;

alter table public.sku_pack_versions enable trigger sku_pack_versions_flat_baseline;

alter table public.sku_pack_levels alter column version_id set not null;

commit;
