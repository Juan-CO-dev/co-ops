-- 0295_toast_legacy_retire
-- AUTHORED 2026-11-09. APPLIED: SIM 20261109205021 (2026-11-09; dry run + verify clean). PROD: NOT YET (Juan-gated).
-- WHAT / WHY: remove synthetic Toast selections after the capture cutover;
-- remove dormant PostgREST write privileges from the historical ledgers.
-- Fixture identity: 0147 defines check_guid TEXT; check-1 through check-4
-- come from orders-v2-sample.json. Real Toast check GUIDs are UUIDs. Prod and
-- sim have different dates, but both have two shop-days with counts 3/1/2/1.
-- STOPPED: retain the 134 depletion rows on those days. 0166 stores only a
-- shop/day/SKU aggregate, without source-event lineage; no migration or seed
-- proves those rows derive exclusively from fixtures. A date match is not proof.
-- BACKWARD COMPATIBLE: keep tables, SELECT and service_role privileges unchanged;
-- older deployed writers use service_role; capture readers are unaffected.
-- ROLLOUT: apply before or after the app merge; ordering does not matter.
-- VERIFY SQL (run by CC, not by this author):
-- SELECT check_guid, count(*) FROM public.toast_sales_events
-- WHERE check_guid IN ('check-1','check-2','check-3','check-4')
-- GROUP BY check_guid; -- no rows
-- SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges
-- WHERE table_schema = 'public'
--   AND table_name IN ('toast_sales_events','toast_daily_depletion','toast_daily_sales_signals')
--   AND grantee IN ('anon','authenticated','PUBLIC')
--   AND privilege_type IN ('INSERT','UPDATE','DELETE'); -- no rows
-- ROLLBACK (per table, restoring only privileges present in the pre-apply ACL):
-- toast_sales_events: GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.toast_sales_events
-- TO anon, authenticated; -- pre-existing Supabase default ACL, not a 0147 GRANT
-- toast_daily_depletion: 0166 has no explicit GRANT; ONLY if the pre-apply ACL
-- confirms these privileges: GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
-- public.toast_daily_depletion TO anon, authenticated;
-- toast_daily_sales_signals: NO re-grant. 0182 revoked ALL, including SELECT.
-- Restore any pre-existing PUBLIC grants only from the pre-apply ACL backup.
-- Deleted rows are restorable from backup only. Zero fixture groups (including
-- a re-apply or fresh database) are a clean no-op for deletion.

begin;

-- Keep the validated fixture population stable until its deletion commits.
lock table public.toast_sales_events in share row exclusive mode;

do $$
declare
  fixture_groups integer;
  malformed_groups integer;
  deleted_fixtures integer;
begin
  select count(*), count(*) filter (where c1 <> 3 or c2 <> 1 or c3 <> 2 or c4 <> 1)
    into fixture_groups, malformed_groups
  from (
    select location_id, business_date,
      count(*) filter (where check_guid = 'check-1') as c1,
      count(*) filter (where check_guid = 'check-2') as c2,
      count(*) filter (where check_guid = 'check-3') as c3,
      count(*) filter (where check_guid = 'check-4') as c4
    from public.toast_sales_events
    where check_guid in ('check-1', 'check-2', 'check-3', 'check-4')
    group by location_id, business_date
  ) fixture_pattern;

  if fixture_groups > 2 or malformed_groups <> 0 then
    raise exception '0295 fixture pattern mismatch: % groups, % malformed',
      fixture_groups, malformed_groups;
  end if;
  if fixture_groups = 0 then
    raise notice '0295 no fixture groups; deletion is a no-op';
  end if;

  delete from public.toast_sales_events
  where check_guid in ('check-1', 'check-2', 'check-3', 'check-4');
  get diagnostics deleted_fixtures = row_count;
  if deleted_fixtures <> 7 * fixture_groups then
    raise exception '0295 fixture deletion mismatch: expected %, deleted %',
      7 * fixture_groups, deleted_fixtures;
  end if;
end;
$$;

revoke insert, update, delete, truncate, references, trigger on public.toast_sales_events,
  public.toast_daily_depletion, public.toast_daily_sales_signals
  from anon, authenticated, public;

commit;
