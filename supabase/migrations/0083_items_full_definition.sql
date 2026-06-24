-- Migration 0083_items_full_definition
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: lib/admin/templates.ts (updateRegistryItemDefinition +
--   propagateItemDefinitionToLines) + docs/superpowers/specs/2026-06-23-full-definition-on-item-design.md

-- Item/Inventory Spine sub-slice B: the item carries the CANONICAL full
-- definition so it can be edited once on the Global tab (MoO+) and propagated to
-- every line (all locations + opening mirrors). Operator render + the core
-- completion gating in lib/checklists.ts keep reading the LINE values (low-risk);
-- these columns are the edit target + the source new lines inherit from.
-- (`section` already lives on items from migration 0079.)

alter table public.items add column special_instruction text null;
alter table public.items add column special_instruction_es text null;
alter table public.items add column min_role_level integer null;
alter table public.items add column required boolean not null default false;

-- Backfill canonical from a representative active line per item. Rank: am_prep
-- prep line first, then any prep line, then opening Phase-2 mirror, then any;
-- stable tiebreak on cti.id (checklist_template_items has no created_at column).
with ranked as (
  select cti.item_id,
         cti.prep_meta->>'specialInstruction' as si,
         cti.translations->'es'->>'specialInstruction' as si_es,
         cti.min_role_level, cti.required,
         row_number() over (
           partition by cti.item_id
           order by case
             when ct.type='prep' and ct.prep_subtype='am_prep' then 0
             when ct.type='prep' then 1
             when ct.type='opening' then 2 else 3 end,
           cti.id
         ) rn
  from checklist_template_items cti
  join checklist_templates ct on ct.id = cti.template_id
  where cti.item_id is not null and cti.active
)
update items i set
  special_instruction = r.si,
  special_instruction_es = r.si_es,
  min_role_level = r.min_role_level,
  required = coalesce(r.required, false)
from ranked r
where r.item_id = i.id and r.rn = 1;
