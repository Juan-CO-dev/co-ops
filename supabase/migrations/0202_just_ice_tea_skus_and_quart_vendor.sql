-- Migration 0202_just_ice_tea_skus_and_quart_vendor
-- Applied via Supabase MCP 2026-09-10 (sim first, then prod). Provenance: LRA SKU arc — Juan's floor answers 2026-09-10
-- ("the just tea is our Just Ice Tea drinks we carry… they come in packs of 12 12oz cans" · "#98 those are heat resistant
-- quart containers" + "we have mostly moved away from US Foods and mostly use PFG now") and his word "do all the pending
-- things properly". Config writes only; no operational history touched.
--
-- WHAT:
--   A. Three Just Ice Tea SKUs (Lemon · Raspberry · Dragon Green), mirroring the existing beverage-cohort rows exactly
--      (DB Cherry Soda: vendor Boar's Head, pack_format 'Pack', each 12 fl oz, avg_oz_per_each 1, sku_class raw,
--      inventory_only false, pars NULL until Juan sets them). units_per_pack = 12 (Juan: "packs of 12").
--      Priced from the Angel invoices (Delmar Provisions, case $14.95 × 8 cases each, Jul 30 – Aug 10 2026):
--      case $14.95 = 12 × 12 fl oz cans = our 12-can pack → $14.95 per pack (no division). source 'angel-wave7-2026-09-10'.
--   B. Quart (Large) re-vendored Webstaurant → PFG (the Angel identity "CONT PLAS 32 OZ DELI W/LID CLR · PFG" is this SKU;
--      its price lands on the next wave-7 rerun once the vendor matches).
--
-- Idempotent: inserts guard on name+vendor; the vendor update guards on the current vendor.
-- VERIFY AFTER APPLY: 3 rows named 'Just Ice Tea %' active under Boar's Head with a price row each; Quart (Large).vendor_id
-- = PFG; audit rows vendor_item.create ×3, vendor_item.price_recorded ×3, vendor_item.update ×1 (actor_context migration_apply).

begin;

do $$
declare
  v_bh uuid := 'aff69f0d-0a7e-4b6f-9371-3eef47df86e3';   -- Boar's Head (Delmar Provisions distributes)
  v_pfg uuid := 'a0d8986c-e097-46f0-9e3f-e70943d4291b';  -- PFG
  v_quart uuid := '2b36cfe8-06cb-46cf-b5d2-7f30abacc498'; -- Quart (Large)
  v_ids uuid[] := array['7a1f6d2e-3c5b-4e8a-9f01-2a6b8c4d0e11'::uuid, '7a1f6d2e-3c5b-4e8a-9f01-2a6b8c4d0e12'::uuid, '7a1f6d2e-3c5b-4e8a-9f01-2a6b8c4d0e13'::uuid];
  v_names text[] := array['Just Ice Tea Lemon', 'Just Ice Tea Raspberry', 'Just Ice Tea Dragon Green'];
  v_angel text[] := array['Just Lemon Tea Can', 'Just Raspberry Tea Can', 'Just Dragon Green Can'];
  v_old_vendor uuid; v_n int; i int;
begin
  if not exists (select 1 from public.vendors where id = v_bh and active) then raise exception '0202: Boar''s Head vendor missing'; end if;
  if not exists (select 1 from public.vendors where id = v_pfg and active) then raise exception '0202: PFG vendor missing'; end if;

  for i in 1..3 loop
    if not exists (select 1 from public.vendor_items where name = v_names[i] and vendor_id = v_bh) then
      insert into public.vendor_items (id, vendor_id, name, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each,
                                       inventory_only, sku_class, active, weekday_par, weekend_par, location_id, created_by, updated_by)
      values (v_ids[i], v_bh, v_names[i], 'Pack', 12, 12, 'fl oz', 1, false, 'raw', true, null, null, null, null, null);
      insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
      values (null, null, 'vendor_item.create', 'vendor_items', v_ids[i], true,
              jsonb_build_object('actor_context', 'migration_apply', 'migration', '0202', 'ruling', 'Juan 2026-09-10: Just Ice Tea drinks we carry, packs of 12 12oz cans',
                                 'mirrors', 'DB Cherry Soda (beverage cohort shape)', 'angel_product', v_angel[i], 'vendor', 'Boar''s Head (Delmar Provisions)'));
      insert into public.vendor_price_history (vendor_item_id, unit_price, effective_date, recorded_at, recorded_by, source, source_note)
      values (v_ids[i], 14.95, date '2026-08-10', now(), null, 'angel-wave7-2026-09-10',
              v_angel[i] || ' [—] — | case $14.95 = 12 × 12 fl oz cans = our 12-can pack → $14.95 per pack (no division); 8 cases Jul 30–Aug 10 2026; Juan 2026-09-10: "packs of 12 12oz cans"');
      insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
      values (null, null, 'vendor_item.price_recorded', 'vendor_items', v_ids[i], false,
              jsonb_build_object('actor_context', 'migration_apply', 'migration', '0202', 'unit_price', 14.95, 'effective_date', '2026-08-10', 'source', 'angel-wave7-2026-09-10'));
    end if;
  end loop;

  select vendor_id into v_old_vendor from public.vendor_items where id = v_quart;
  if v_old_vendor is null then raise exception '0202: Quart (Large) missing'; end if;
  if v_old_vendor <> v_pfg then
    update public.vendor_items set vendor_id = v_pfg, updated_at = now(), updated_by = null where id = v_quart and vendor_id = v_old_vendor;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '0202: Quart (Large) re-vendor wrote % rows', v_n; end if;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'vendor_item.update', 'vendor_items', v_quart, true,
            jsonb_build_object('actor_context', 'migration_apply', 'migration', '0202', 'field', 'vendor_id', 'before', v_old_vendor, 'after', v_pfg,
                               'ruling', 'Juan 2026-09-10: heat-resistant quart containers, bought from PFG now (mostly moved away from US Foods)'));
  end if;

  select count(*) into v_n from public.vendor_items where name like 'Just Ice Tea %' and vendor_id = v_bh and active;
  if v_n <> 3 then raise exception '0202: expected 3 Just Ice Tea SKUs, found %', v_n; end if;
  if (select vendor_id from public.vendor_items where id = v_quart) <> v_pfg then raise exception '0202: Quart (Large) vendor is not PFG'; end if;
end $$;

commit;
