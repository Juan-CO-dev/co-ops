-- 0295_toast_legacy_retire
-- AUTHORED 2026-11-09; NOT APPLIED. CC applies to sim, then prod.
-- WHAT / WHY: remove the 14 known synthetic Toast selections after the capture
-- cutover; remove dormant PostgREST write privileges from the historical ledgers.
-- Fixture identity: 0147 defines check_guid TEXT; the check-1 through check-4
-- values come from tests/fixtures/toast/orders-v2-sample.json. The two shop-days
-- and total of 14 are CC's read-only production manifest (2026-11-07).
-- STOPPED: retain the 134 depletion rows on those days. 0166 stores only a
-- shop/day/SKU aggregate, without source-event lineage; no migration or seed
-- proves those rows derive exclusively from fixtures. A date match is not proof.
-- BACKWARD COMPATIBLE: keep tables, SELECT and service_role privileges unchanged;
-- older deployed writers use service_role; capture readers are unaffected.
-- ROLLOUT: apply before or after the app merge; ordering does not matter.
-- VERIFY SQL (run by CC, not by this author):
-- SELECT count(*) FROM public.toast_sales_events
-- WHERE check_guid IN ('check-1','check-2','check-3','check-4')
--   AND (location_id, business_date) IN (
--     ('54ce1029-400e-4a92-9c2b-0ccb3b031f0a'::uuid, DATE '2026-08-01'),
--     ('d2cced11-b167-49fa-bab6-86ec9bf4ff09'::uuid, DATE '2026-08-06')); -- 0
-- SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges
-- WHERE table_schema = 'public'
--   AND table_name IN ('toast_sales_events','toast_daily_depletion','toast_daily_sales_signals')
--   AND grantee IN ('anon','authenticated','PUBLIC')
--   AND privilege_type IN ('INSERT','UPDATE','DELETE'); -- no rows
-- ROLLBACK: GRANT INSERT, UPDATE, DELETE ON public.toast_sales_events,
-- public.toast_daily_depletion, public.toast_daily_sales_signals TO anon, authenticated;
-- restore any pre-existing PUBLIC grants only from the pre-apply ACL backup.
-- Deleted rows are restorable from backup only. A re-apply intentionally fails
-- the manifest guard rather than silently accepting a changed database.

begin;

do $$
declare
  deleted_fixtures integer;
begin
  delete from public.toast_sales_events
  where check_guid in ('check-1', 'check-2', 'check-3', 'check-4')
    and (location_id, business_date) in (
      ('54ce1029-400e-4a92-9c2b-0ccb3b031f0a'::uuid, date '2026-08-01'),
      ('d2cced11-b167-49fa-bab6-86ec9bf4ff09'::uuid, date '2026-08-06')
    );
  get diagnostics deleted_fixtures = row_count;
  if deleted_fixtures <> 14 then
    raise exception '0295 fixture manifest mismatch: expected 14, deleted %', deleted_fixtures;
  end if;
end;
$$;

revoke insert, update, delete on public.toast_sales_events,
  public.toast_daily_depletion, public.toast_daily_sales_signals
  from anon, authenticated, public;

commit;
