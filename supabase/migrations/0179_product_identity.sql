-- Migration 0179_product_identity
-- AUTHORED 2026-08-20. NOT YET APPLIED — application is a named LEAD/JUAN gate
-- (plan docs/superpowers/plans/2026-08-20-product-identity.md, GATE M1).
-- Canonical reference: docs/superpowers/specs/2026-08-20-product-identity-design.md §1
-- Foundation: docs/audits/2026-08-20-multivendor-semantics-audit.md gap P2.
--
-- WHY: nothing above vendor_items knows that two vendors' hams are one product.
-- Recipes pin ONE vendor's SKU (recipe_inputs.component_sku_id), so a vendor going
-- down evaporates demand, depletion follows a dead pin producing mirrored false
-- SHORT/OVER variance, counts cannot roll twins up, and "what we buy most" has no
-- grain to live at. This adds the missing node: a thin product identity that recipes
-- pin instead of a vendor's SKU, with member SKUs attached beneath it.
--
-- SHAPE:
--   products                 the raw identity ("HAM"). Modeled on public.items
--                            (0079): name + name_es siblings, notes, active, the
--                            four-column audit block.
--   vendor_items.product_id  nullable FK. NULL = an implicit SINGLETON: the code
--                            treats a productless SKU as trivially resolving to
--                            itself, so ~95% of the catalog needs no product row
--                            and no data migration. Products exist only where
--                            plurality does.
--   product_primaries        per-location primary designation, location_id NULL =
--                            global default (the vendor_cutoffs / vendor_items
--                            "null = global" house idiom).
--   recipe_inputs.component_product_id
--                            the third component target; the 2-way XOR CHECK from
--                            0103 is replaced by a 3-way exactly-one.
--
-- WHAT ONE UNIT WEIGHS (products.unit_oz) — LOAD-BEARING, NOT DECORATION.
-- Live, the ham and fresh-mozzarella pins read `quantity = 1, unit = 'unit'`, and
-- 'unit' is a COUNT measure, so lib/recipe-math.ts ozForRecipeInput resolves the
-- line through the SKU'S OWN avg_oz_per_each — Baldor Ham 1.2, PFG Ham NULL. A pin
-- that resolved to a different member would swing or DELETE the line's oz with no
-- error anywhere. scripts/seed/18-twin-adjudication.ts refused its own pin-move over
-- exactly this and named the fix: "the pin cannot follow the par until something owns
-- what one 'unit' of the product weighs." products.unit_oz is that something, and
-- lib/products-shared.ts productInputBasis makes the recipe basis member-independent
-- by construction.
--
-- PROVENANCE COLUMNS (weight audit, spec section "Weight & trim audit").
-- weight_class / weight_source_note / weight_established_at / weight_established_by
-- are NULLABLE text/timestamptz/uuid with NO enum and NO CHECK — the deliberate
-- precedent set by 0177_vendor_price_history_provenance ("the vocabulary ... is
-- expected to grow ... pinning it in DDL now would force a migration per source").
-- Today the class lives only inside audit_log.metadata.weight_class and "who
-- established" is not recorded at all (the seeds write actorId null), so these
-- columns are the read surface the weight board needs; the audit rows remain the
-- forensic trail. NO backfill here — the evidence pass is a separate seed (Phase 6).
--
-- MEMBERSHIP IS DB-PROVEN, NOT APP-TRUSTED: a composite FK forces a primary to be a
-- member of the product it is primary for — the same denormalized-composite-FK move
-- migration 0178 made, MATCH SIMPLE and all: when product_id is NULL the constraint
-- is simply not checked, which is correct for a singleton SKU.
--
-- ADDITIVE + BACKWARD-COMPATIBLE: every new column is nullable with no default, and
-- the replaced CHECK is strictly weaker (it admits a third case and forbids nothing
-- previously legal). Append-only law untouched: no DELETE path, no supersede.
--
-- RLS: the REVOKE-only posture for new tables (0168+, per 0172/0174's stated
-- reasoning: "the revoke is sufficient and avoids the policy-stacking hazard").
-- Reads go through service-role app loaders with app-layer role gates.
--
-- PRE-FLIGHT BEFORE APPLY (lead runs these and pastes the output into the PR):
--   select count(*) from information_schema.tables where table_name = 'products';  -- expect 0
--   select count(*) from recipe_inputs;                                            -- record it
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'recipe_inputs'::regclass;                                    -- expect the 2-way XOR
--   select count(*) from vendor_items;                                             -- expect 182

-- (1) products -----------------------------------------------------------------
create table if not exists public.products (
  id                     uuid        primary key default gen_random_uuid(),
  name                   text        not null,
  name_es                text        null,
  notes                  text        null,
  unit_oz                numeric     null check (unit_oz is null or unit_oz > 0),
  unit_oz_class          text        null,
  unit_oz_source_note    text        null,
  unit_oz_established_at timestamptz null,
  unit_oz_established_by uuid        null references public.users(id),
  active                 boolean     not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid        null references public.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid        null references public.users(id)
);

create unique index if not exists products_name_lower_uq
  on public.products (lower(name)) where active;

comment on table public.products is
  'Product identity above SKUs (audit P2, spec 2026-08-20). The raw thing a recipe '
  'means ("HAM"), independent of which vendor supplied it. Member SKUs attach via '
  'vendor_items.product_id. A SKU with product_id NULL is an implicit singleton and '
  'needs no row here — products exist only where plurality does.';

comment on column public.products.unit_oz is
  'What ONE unit of this product weighs, in ounces. THE reason a product-pinned '
  'recipe line survives a member flip: lib/products-shared.ts productInputBasis '
  'builds the line''s pack basis from THIS number, never from the resolved member''s '
  'avg_oz_per_each, so a count-denominated line ("1 unit of HAM") means the same oz '
  'whichever vendor is primary today. NULL = not yet established; a count-denominated '
  'product-pinned line then refuses (poisons the flatten to `unresolved`) rather than '
  'guessing. See scripts/seed/18-twin-adjudication.ts''s refusal.';

comment on column public.products.unit_oz_class is
  'Provenance CLASS of unit_oz: OPERATIONAL | SPEC | INVOICE_DERIVED (lib/angel-wave4.ts '
  'WeightClass). Deliberately unconstrained text, per 0177''s precedent — the vocabulary '
  'is expected to grow and a CHECK would force a migration per class.';

-- (2) vendor_items.product_id + the composite-FK target ------------------------
alter table public.vendor_items
  add column if not exists product_id uuid null references public.products(id);

comment on column public.vendor_items.product_id is
  'The product this SKU is a member of (0179). NULL = implicit singleton (resolution '
  'is trivially itself) — the ~95% case, deliberately not backfilled.';

create index if not exists vendor_items_product_ix on public.vendor_items(product_id);

-- FK target for the primary-membership proof below. `id` is already the PK, so this
-- UNIQUE adds no restriction whatsoever; it exists only because a composite FK
-- requires a UNIQUE/PK on exactly the referenced column pair (the 0178 idiom).
alter table public.vendor_items
  add constraint vendor_items_id_product_uq unique (id, product_id);

-- (3) weight provenance on the SKU (deviation D10) -----------------------------
alter table public.vendor_items
  add column if not exists weight_class          text        null,
  add column if not exists weight_source_note    text        null,
  add column if not exists weight_established_at timestamptz null,
  add column if not exists weight_established_by uuid        null references public.users(id);

comment on column public.vendor_items.weight_class is
  'Provenance CLASS of avg_oz_per_each: OPERATIONAL | SPEC | INVOICE_DERIVED. Was '
  'audit_log.metadata.weight_class only (waves 3-4); promoted to a column so the weight '
  'board is a read, not a forensic scan. Unconstrained text per 0177''s precedent.';

comment on column public.vendor_items.weight_established_by is
  'Who last established avg_oz_per_each. NULL for every seed-written weight — the '
  'seeds audit with actorId null, so there is genuinely nobody to name. NULL is the '
  'honest value; never backfill it with a placeholder actor.';

-- (4) product_primaries (per-location, location_id NULL = global) --------------
create table if not exists public.product_primaries (
  id             uuid        primary key default gen_random_uuid(),
  product_id     uuid        not null references public.products(id),
  location_id    uuid        null references public.locations(id),
  primary_sku_id uuid        not null,
  note           text        null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid        null references public.users(id),
  constraint product_primaries_scope_uq unique nulls not distinct (product_id, location_id),
  -- MEMBERSHIP PROOF: the primary must be a SKU whose product_id equals this row's
  -- product_id. Two columns, one composite FK, zero app trust (0178's move).
  constraint product_primaries_member_fk
    foreign key (primary_sku_id, product_id) references public.vendor_items(id, product_id)
);

create index if not exists product_primaries_product_ix on public.product_primaries(product_id);

comment on table public.product_primaries is
  'Which member SKU is PRIMARY for a product. location_id NULL = the global default '
  '(the vendor_cutoffs / vendor_items "null = global" house idiom); a row with a '
  'location_id overrides it for that shop. Rung 1 of the resolution ladder — if the '
  'named primary is inactive, resolution falls through to rung 2 (most-recently '
  'received active member); it does NOT fail.';

alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
revoke all on public.products from public;

alter table public.product_primaries enable row level security;
revoke all on public.product_primaries from anon, authenticated;
revoke all on public.product_primaries from public;

-- (5) recipe_inputs: the third component target --------------------------------
alter table public.recipe_inputs
  add column if not exists component_product_id uuid null references public.products(id);

create index if not exists recipe_inputs_product_idx on public.recipe_inputs(component_product_id);

-- Replace the 2-way XOR (0103) with a 3-way exactly-one. Strictly weaker: every row
-- legal before is legal after. Drop-then-add inside the one migration transaction so
-- no window exists in which the table is unconstrained.
alter table public.recipe_inputs drop constraint recipe_inputs_exactly_one_component;
alter table public.recipe_inputs
  add constraint recipe_inputs_exactly_one_component check (
    ((component_sku_id     is not null)::int
   + (component_item_id    is not null)::int
   + (component_product_id is not null)::int) = 1
  );

comment on column public.recipe_inputs.component_product_id is
  'Pin the PRODUCT, not a vendor''s SKU (spec 2026-08-20). Resolution to a member '
  'happens once, at graph build (lib/prep-consumption.ts loadRecipeGraph), so every '
  'downstream consumer keeps its SKU-keyed output. A product-pinned line may only be '
  'denominated in a MEASURE-REGISTRY unit — a pack/chain label is a per-vendor '
  'spelling and is rejected at write and refused at resolve.';

-- (6) create_recipe_full RPC — carry the third target --------------------------
-- Same SECURITY DEFINER + locked search_path + service-role-only grants as 0105.
-- The app layer (lib/recipes.ts createRecipeFull) validates exactly-one BEFORE
-- calling; the table CHECK is the backstop.
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb;
begin
  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by
  ) returning id into v_recipe_id;

  for r in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'component_sku_id','')::uuid, nullif(r->>'component_item_id','')::uuid,
      nullif(r->>'component_product_id','')::uuid,
      (r->>'quantity')::numeric, nullif(r->>'unit',''), nullif(r->>'each_container_label',''),
      coalesce((r->>'portioned')::boolean, false), coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'output_item_id','')::uuid, nullif(r->>'output_menu_item_id','')::uuid,
      (r->>'yield')::numeric, nullif(r->>'output_container_label',''),
      coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  return v_recipe_id;
end $$;

-- CREATE OR REPLACE preserves grants, but re-assert them: AGENTS.md's
-- REVOKE-FROM-PUBLIC lesson is that Supabase's default ACLs grant EXECUTE to anon
-- EXPLICITLY, so revoking from public alone is not enough. Verify after apply via
-- information_schema.routine_privileges.
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from anon;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from authenticated;
grant  execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
