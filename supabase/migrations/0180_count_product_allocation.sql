-- Migration 0180_count_product_allocation
-- AUTHORED 2026-08-20. NOT YET APPLIED — GATE M2 (LEAD/JUAN).
-- Canonical reference: docs/superpowers/specs/2026-08-20-product-identity-design.md
--   section "Counting UX (locked: option C)".
-- Plan: docs/superpowers/plans/2026-08-20-product-identity.md, Phase 5 · Task 5.1.
--
-- WHY: a product-level count ("HAM ... 300 oz") is entered once but must land as
-- ORDINARY per-SKU anchor lines, because sku_count_lines.sku_id is NOT NULL and the
-- whole anchor/drift/variance engine (resolvePerSkuAnchors, computeOnHand,
-- computeVariance) is per-SKU keyed. Allocation happens in lib/products-shared.ts
-- (allocateProductCount, newest-back over remaining lots). This column records that
-- the line was DERIVED from a product count rather than counted per vendor, so an
-- auditor reading the anchor can tell a measurement from an allocation.
--
-- HONEST-NULL (0161 LOCK-1 doctrine): NULL means "counted directly at this SKU",
-- which is the pre-existing meaning of every row. No sentinel, no backfill.
--
-- ADDITIVE: nullable, no default. Every existing writer keeps working unchanged.
-- RLS unchanged — sku_count_lines stays deny-all to users (0160); service-role writes.
--
-- PRE-M2 DEGRADATION (the products_schema_pending pattern, Phase 1): the app ships
-- BEFORE this file is applied. lib/counts.ts probes for this column once per server
-- process (countProductAllocationReady) and, while it is absent, serves
-- CountFormData.products = [] and OnHandView.products = [] — so the count sheet and
-- the on-hand panel render byte-identically to today's per-SKU behavior and no
-- operator is ever offered a product row whose submit would fail. The write path
-- refuses a product line with a named 503 count_allocation_schema_pending rather
-- than writing an un-provenanced line. The probe caches only the TRUE answer, so the
-- surface lights up on its own the moment this migration applies — no redeploy.
--
-- PRE-FLIGHT BEFORE APPLY (lead runs these and pastes the output into the PR):
--   select count(*) from sku_count_lines;                                  -- expect 0 (no census yet)
--   select count(*) from information_schema.columns
--    where table_name = 'sku_count_lines' and column_name = 'allocated_from_product_id';  -- expect 0
--   select count(*) from information_schema.tables where table_name = 'products';         -- expect 1 (0179 applied)

alter table public.sku_count_lines
  add column if not exists allocated_from_product_id uuid null references public.products(id);

comment on column public.sku_count_lines.allocated_from_product_id is
  'Set when this line was DERIVED by allocating a product-level count across member '
  'SKUs (spec 2026-08-20, option C; lib/products-shared.ts allocateProductCount, '
  'newest-back over remaining FIFO lots). NULL = counted directly at this SKU, which '
  'is what every pre-0180 row means. The number is still a real anchor either way; '
  'this column only says how the vendor attribution was arrived at.';

create index if not exists sku_count_lines_allocated_product_ix
  on public.sku_count_lines(allocated_from_product_id)
  where allocated_from_product_id is not null;

-- POST-APPLY VERIFICATION (lead pastes the output into the PR):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'sku_count_lines' and column_name = 'allocated_from_product_id';
--   select indexname, indexdef from pg_indexes
--    where tablename = 'sku_count_lines' and indexname = 'sku_count_lines_allocated_product_ix';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'sku_count_lines'::regclass and contype = 'f';
