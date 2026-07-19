-- Migration 0129_order_artifact_intake
-- Applied via Supabase MCP apply_migration on 2026-07-18.
-- Canonical reference: docs/superpowers/specs/2026-07-18-3a-order-artifact-lifecycle-design.md
--                      + lib/portal/draft.ts
--
-- 3a: the order artifact is the pipeline lead (mutable intake details) + its versioned quote.
-- (1) richer intake detail fields on the lead; (2) an 'out' fulfillment stage (confirmed=reserve,
-- out=deplete — the reserve/deplete LOGIC is W4, this only makes the stage valid); (3) an optional
-- intake payload on the magic-link token so the draft can be created post-verify (create-only-post-verify).

-- 1. catering_pipeline: the 7 new intake detail fields (all nullable text; event_date/headcount/
--    company/contact_name already exist).
ALTER TABLE public.catering_pipeline
  ADD COLUMN contact_phone    text,
  ADD COLUMN delivery_address text,
  ADD COLUMN time_window      text,
  ADD COLUMN event_type       text,
  ADD COLUMN dietary_notes    text,
  ADD COLUMN event_name       text,
  ADD COLUMN dropoff_door     text;

-- 2. Add 'out' to the pipeline stage CHECK (drop + recreate — a CHECK can't be extended in place).
ALTER TABLE public.catering_pipeline DROP CONSTRAINT catering_pipeline_stage_check;
ALTER TABLE public.catering_pipeline
  ADD CONSTRAINT catering_pipeline_stage_check
  CHECK (stage IN ('inquiry','quote_sent','confirmed','out','completed','lost'));

-- 3. catering_portal_tokens.intake — the optional intake payload a new-order magic-link carries,
--    so consumeMagicLink can create the draft AFTER email verification (never before → no spam rows).
--    NULL for pure sign-in links.
ALTER TABLE public.catering_portal_tokens
  ADD COLUMN intake jsonb;
