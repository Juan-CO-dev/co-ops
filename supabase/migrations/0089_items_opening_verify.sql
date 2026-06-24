-- Migration 0089_items_opening_verify
-- Applied via Supabase MCP apply_migration on 2026-06-24.
-- Canonical reference: lib/admin/templates.ts (setItemOpeningVerify + createOpeningMirror gating) +
--   docs/superpowers/specs/2026-06-24-item-attached-questions-slice2-design.md (PR B)

-- Per-item "include in Opening verification" toggle (Slice 2 PR B). Today the
-- AM-prep→Opening mirror is hard-wired for every am_prep item; this makes it a
-- controllable per-item setting. default true + NOT NULL → every existing item
-- gets true on add-column (verified: 45/45 active items true), so current
-- behavior is preserved EXACTLY — a true no-op on ship. Flipping an item false
-- stops its am_prep line from mirroring to Opening (createOpeningMirror gates on
-- this flag); toggling propagates (create/deactivate the item's Opening mirrors).

alter table public.items add column opening_verify boolean not null default true;
