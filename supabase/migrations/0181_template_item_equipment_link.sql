-- Migration 0181_template_item_equipment_link
-- AUTHORED 2026-08-21. NOT YET APPLIED — GATE M3 (LEAD/JUAN).
-- Canonical reference: docs/superpowers/specs/2026-08-20-product-identity-design.md
--   section "Equipment identity (the same pattern, cold side)".
-- Plan: docs/superpowers/plans/2026-08-20-product-identity.md, Phase 6 / Task 6.7.
--
-- WHY: 34 ACTIVE expects_count template items sit in the Template Doctor's
-- "needs link" queue with item_id AND vendor_item_id both NULL. 32 of them are
-- fridge TEMPERATURE lines — verified live 2026-08-21: all 32 already have a
-- maintenance_equipment row pointing AT them via opening_temp_item_id /
-- closing_temp_item_id. They are not unlinked; they are linked to a KIND OF THING
-- THE QUEUE COULD NOT EXPRESS. A thermometer finally has something to link TO.
--
-- ⚠ THE TABLE IS maintenance_equipment, NOT equipment. public.equipment does not
-- exist; the registry has been maintenance_equipment since 0070. (Its columns, for
-- anyone writing against it: id, location_id, name, kind, opening_temp_item_id,
-- closing_temp_item_id, safe_max_f, sort_order, active, created_at. There is no
-- `equipment_type`; the discriminator is `kind`.)
--
-- ⚠ NO XOR CHECK IS ADDED, AND NONE IS REMOVED — there is none to extend. The
-- spine-link CHECK in 0163:62-97 is a DEFERRED, commented-out block that was never
-- applied, because a NOT VALID CHECK is enforced on any UPDATE to any column of a
-- legacy row and would have 500'd the fillItemTranslations es-fill campaign on
-- exactly the unlinked rows the Doctor drives managers to fix. Enforcement stays
-- app-layer (linkTemplateItem / fillItemSpineLink / copyItemsToVersion), which is
-- where it already lives. What this migration DOES do is drop the backlog from 34 to
-- 2, which is the first time 0163's deferred constraint becomes near-shippable — as
-- a FOLLOW-UP, filed on the ROADMAP, deliberately not taken here.
--
-- ⚠ REFERENCE CYCLE, ON PURPOSE: maintenance_equipment already points at
-- checklist_template_items (two columns, 0070). This closes the loop. Legal in
-- Postgres (both sides nullable) and both directions are needed:
--   equipment_id                          = "which asset does this line measure"
--   opening_temp_item_id / closing_temp_item_id = "which line is the AM vs the PM
--     reading" — the PHASE discriminator, which equipment_id alone cannot express
--     (lib/maintenance.ts derives AM/PM by comparing against openingTempItemId).
-- Do NOT retire the two existing columns; they answer a different question.
--
-- BACKFILL IS A PURE JOIN, no guesswork: every one of the 32 rows is already named by
-- a maintenance_equipment row. Migration 0071 set the precedent for exactly this join
-- (it bulk-relabeled the same 32 rows and recorded affected_item_count = 32).
--
-- ADDITIVE: nullable, no default. RLS unchanged.
--
-- ══ PRE-FLIGHT (lead runs these and pastes the output into the PR) ═════════════
--
-- ⚠ THE PLAN'S GATE SECTION MIXES TWO POPULATIONS AND THE NUMBERS LOOK WRONG IF YOU
-- DO NOT KNOW THAT. Its pre-flight query filters on `t.active` (yielding 32) while
-- its post-apply expectation of "2 remaining" comes from the queue's OWN predicate,
-- which does NOT filter on template active (yielding 34). Both are stated here so
-- the apply is not chased over a phantom discrepancy. Verified live 2026-08-21.
--
--   -- (a) the QUEUE's population — what the Doctor actually shows. EXPECT 34.
--   select count(*) from checklist_template_items cti
--    where cti.active and cti.expects_count
--      and cti.item_id is null and cti.vendor_item_id is null;
--
--   -- (b) the same, restricted to ACTIVE templates. EXPECT 32.
--   select count(*) from checklist_template_items cti
--     join checklist_templates t on t.id = cti.template_id
--    where cti.active and t.active and cti.expects_count
--      and cti.item_id is null and cti.vendor_item_id is null;
--
--   -- (c) how many the backfill can reach. EXPECT 32.
--   select count(*) from checklist_template_items cti
--     join maintenance_equipment me
--       on (cti.id = me.opening_temp_item_id or cti.id = me.closing_temp_item_id);
--
--   -- (d) the column must not exist yet. EXPECT 0.
--   select count(*) from information_schema.columns
--    where table_name = 'checklist_template_items' and column_name = 'equipment_id';

alter table public.checklist_template_items
  add column if not exists equipment_id uuid null references public.maintenance_equipment(id);

create index if not exists checklist_template_items_equipment_id_idx
  on public.checklist_template_items (equipment_id);

comment on column public.checklist_template_items.equipment_id is
  'The maintenance_equipment asset this line measures (0181). A third spine-link '
  'target beside item_id and vendor_item_id, so a temperature line is LINKED rather '
  'than counted as a needs-link false positive. It does NOT replace '
  'maintenance_equipment.opening_temp_item_id / closing_temp_item_id: those carry the '
  'AM/PM phase discriminator that lib/maintenance.ts derives readings from. '
  'Enforcement of the three-way exactly-one is APP-LAYER, matching the live pattern — '
  'there is no DB CHECK on this table to extend (0163''s is deferred and unapplied).';

-- Backfill from the existing pointers. Both directions then agree by construction.
update public.checklist_template_items cti
   set equipment_id = me.id
  from public.maintenance_equipment me
 where cti.equipment_id is null
   and (cti.id = me.opening_temp_item_id or cti.id = me.closing_temp_item_id);

-- ══ POST-APPLY EXPECTATION (lead verifies and pastes) ══════════════════════════
--
--   select count(*) from checklist_template_items where equipment_id is not null;
--     -- EXPECT 32
--
--   -- the QUEUE's population, now equipment-aware. EXPECT 2.
--   select count(*) from checklist_template_items cti
--    where cti.active and cti.expects_count and cti.item_id is null
--      and cti.vendor_item_id is null and cti.equipment_id is null;
--
--   -- Those 2 are both "Walk-in temp log" on the INACTIVE "Standard Closing v1"
--   -- template (ids 7e85fcf4-… and a377e3ce-…). CO has zero walk-ins — AGENTS.md
--   -- records that as ground truth — so they are legacy rows naming equipment that
--   -- does not exist, on a template that is already retired. They are correctly
--   -- left unlinked: there is nothing to link them to. Retiring the rows themselves
--   -- is a template-hygiene follow-up, not this migration's business.
