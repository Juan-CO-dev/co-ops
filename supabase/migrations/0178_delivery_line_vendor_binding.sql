-- Migration 0178_delivery_line_vendor_binding
-- Applied via Supabase MCP apply_migration on 2026-08-20.
-- Canonical reference: docs/audits/2026-08-20-multivendor-semantics-audit.md (gap P3)
--
-- WHY: under Juan's ratified multi-vendor doctrine the same product carries a SEPARATE
-- vendor_items row per vendor. vendor_delivery_items had TWO independent FKs — one to the
-- delivery, one to the SKU — and nothing tied them together, so a line could name Baldor's
-- "Ham" on a PFG truck. That writes unit_price into vendor_price_history and folds
-- avg_oz_per_each onto the twin that never arrived; costing then reads a price the named
-- vendor never quoted. lib/receiving.ts now rejects it (findVendorMismatch), but an
-- app-layer guard is a rule one new code path can forget. This is the DB floor.
--
-- HOW: the classic composite-FK denormalization. Carry the vendor on the line, then two
-- composite FKs force it to equal BOTH the delivery's vendor AND the SKU's vendor —
-- transitively proving delivery.vendor = sku.vendor. The column cannot drift, because the
-- FKs are what define it.
--
-- NULL-TOLERANT ON PURPOSE: vendor_items.vendor_id is nullable and 11 ACTIVE SKUs carry
-- NULL in prod today (Sub Roll, Mortadella, Utz Ripples, Pepperoncini, Beef Base, …).
-- Those are UNASSIGNED, not owned by a rival vendor — they are legitimately receivable
-- against any truck, and a strict binding would make real ingredients un-receivable at the
-- door. Composite FKs default to MATCH SIMPLE: when any referencing column is NULL the
-- constraint is not checked. So a vendorless SKU's line stores vendor_id NULL and passes
-- unenforced, while every bindable line is held. The app guard applies the identical
-- tolerance, so the two layers agree rather than one being silently stricter.
--
-- ADDITIVE + BACKWARD-COMPATIBLE: the column is nullable with no default, so code that
-- predates this migration keeps inserting successfully (its rows are simply unenforced).
-- Backfill verified safe before apply: 8 existing lines, 0 of them cross-vendor.
-- No RLS change — vendor_delivery_items stays deny-all to users (0100); service-role writes.

-- (1) FK targets. `id` is already the PK of each table, so these UNIQUE constraints add no
--     new restriction whatsoever — they exist only because a composite FK requires a
--     UNIQUE/PK on exactly the referenced column pair.
alter table vendor_items
  add constraint vendor_items_id_vendor_uq unique (id, vendor_id);
alter table vendor_deliveries
  add constraint vendor_deliveries_id_vendor_uq unique (id, vendor_id);

-- (2) The denormalized binding column.
alter table vendor_delivery_items
  add column vendor_id uuid;

comment on column vendor_delivery_items.vendor_id is
  'The vendor this line is bound to = the SKU''s own vendor (audit P3, migration 0178). '
  'NULL only for a vendorless (unassigned) SKU, where the composite FKs go unenforced by '
  'MATCH SIMPLE. Never set this by hand: the two composite FKs below define it.';

-- (3) Backfill from the delivery header, but ONLY where the SKU actually names that
--     vendor — a vendorless SKU's line must stay NULL or the vendor_items FK would reject
--     it (no parent row with that (id, vendor_id) pair exists).
update vendor_delivery_items dli
   set vendor_id = d.vendor_id
  from vendor_deliveries d, vendor_items vi
 where dli.delivery_id = d.id
   and dli.vendor_item_id = vi.id
   and vi.vendor_id = d.vendor_id;

-- (4) The two composite FKs. Together: line.vendor = delivery.vendor AND
--     line.vendor = sku.vendor  ⟹  delivery.vendor = sku.vendor.
alter table vendor_delivery_items
  add constraint vendor_delivery_items_sku_vendor_fk
  foreign key (vendor_item_id, vendor_id) references vendor_items(id, vendor_id);

alter table vendor_delivery_items
  add constraint vendor_delivery_items_delivery_vendor_fk
  foreign key (delivery_id, vendor_id) references vendor_deliveries(id, vendor_id);

-- Supporting index for the new FK pair (the existing single-column indexes from 0100
-- remain; this one serves the composite lookups).
create index vendor_delivery_items_vendor_idx on vendor_delivery_items(vendor_id);
