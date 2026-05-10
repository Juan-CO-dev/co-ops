-- Migration 0049_opening_phase2_schema_additions
-- Applied via Supabase MCP apply_migration on 2026-05-06.
-- Canonical references:
--   - lib/opening.ts (closer-estimate snapshot resolver added Build #3 PR 3 Step 2)
--   - lib/notifications.ts (under-par notification emission added Build #3 PR 3 Step 5)
--   - AGENTS.md "Pre-INSERT pg_enum query for enum-constrained columns" lesson
--     — pre-flight against this lesson caught the design-vs-reality drift:
--     BUILD_3_OPENING_REPORT_DESIGN.md §3.3 assumed a notifications.priority
--     enum existed; reality had no priority column at all. The migration adds
--     the column via TEXT-with-CHECK pattern matching the per-table convention
--     (notification_recipients.delivery_method/delivery_status), avoiding pg
--     ENUM ALTER TYPE non-transactional gotchas. Sibling lesson direction
--     (lesson taught by 0048's gap-recovery → lesson applied by 0049's
--     pre-flight catch).
--   - SPEC_AMENDMENTS.md C.50 (PENDING — captures design-vs-reality drift on
--     notifications.priority, Phase 2 join key with ON DELETE SET NULL semantic
--     for Path A v3 supersession safety, prep_data.phase2 runtime narrowing
--     pattern, notifications.type vocabulary at lib layer not DB layer.)

-- Build #3 PR 3 Step 1: Opening Phase 2 schema additions.
-- Three coherent changes:
--   (1) Self-referential FK column on checklist_template_items for the
--       Phase 2 closer-estimate join (opening Phase 2 item points to the
--       matching AM Prep template item per location).
--   (2) priority column on notifications matching design doc §3.3 intent
--       (urgent under-par alerts). TEXT-with-CHECK matches the per-table
--       convention (notification_recipients.delivery_method/status).
--   (3) Partial index on the FK column for resolver performance — only
--       Phase 2 rows populate it, keeping the index tiny.
--
-- Pre-flight per AGENTS.md "Pre-INSERT pg_enum query for enum-constrained
-- columns" lesson surfaced that notifications had no priority column or
-- enum despite the design doc §3.3 assuming both. Captured as C.50 in
-- Step 10 amendments.

ALTER TABLE checklist_template_items
  ADD COLUMN references_template_item_id UUID NULL
    REFERENCES checklist_template_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN checklist_template_items.references_template_item_id IS
  'Cross-template reference for Phase 2 closer-estimate join. Per SPEC_AMENDMENTS.md C.50: opening Phase 2 items reference the matching AM Prep template item per location. ON DELETE SET NULL preserves the opening item when the AM Prep template is restructured (Path A v3 supersession); admin tooling reposts when the AM Prep ref is replaced. NULL for items that are not Phase 2 (Phase 1 items, AM Prep items, closing items).';

CREATE INDEX idx_template_items_references_target
  ON checklist_template_items(references_template_item_id)
  WHERE references_template_item_id IS NOT NULL;

ALTER TABLE notifications
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'info'
    CHECK (priority IN ('info', 'urgent'));

COMMENT ON COLUMN notifications.priority IS
  'Notification severity. ''urgent'' triggers visual emphasis + (future) push/SMS routing. Per SPEC_AMENDMENTS.md C.50, under-par opening alerts populate ''urgent''. TEXT-with-CHECK pattern matches notification_recipients.delivery_method/delivery_status convention; new values added via amendment + ALTER CONSTRAINT (cleaner than ALTER TYPE non-transactional gotchas).';
