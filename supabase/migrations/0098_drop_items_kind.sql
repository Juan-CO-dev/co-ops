-- Migration 0098_drop_items_kind
-- Applied via Supabase MCP apply_migration on 2026-06-30, AFTER R1 (PR #102)
-- merged to main + the production deploy reached success (so live code no longer
-- inserts/reads items.kind). Canonical reference:
-- docs/superpowers/specs/2026-06-28-r1-composition-recipe-upgrade-design.md §8.

-- Post-deploy: R1 code no longer inserts/reads items.kind.
alter table items drop column kind;

-- P2 symmetry with batch_yield's CHECK (>0): oz_per_par_unit must be a positive
-- ounce count when present (NULL allowed — not yet entered for most items).
alter table items add constraint items_oz_per_par_unit_check
  check (oz_per_par_unit is null or oz_per_par_unit > 0);
