-- Migration 0191_pipeline_events_out_stage
-- AUTHORED 2026-09-04. NOT YET APPLIED — GATE (JUAN).
--
-- 0191: catering_pipeline_events.from_stage / to_stage CHECKs learn the 'out' stage.
--
-- ── PROVENANCE (ezCater lifecycle build, 2026-09-04 · the "asymmetry" class) ───────────
-- 0110 created catering_pipeline_events with CHECKs enumerating the five original stages.
-- 0129 added the 'out' fulfilment stage to catering_pipeline.stage (drop + recreate of
-- catering_pipeline_stage_check) — and did not touch the EVENTS table. LEGAL_TRANSITIONS
-- (lib/catering/pipeline-shared.ts) has allowed confirmed → out → completed/lost since,
-- so moveStage (lib/catering/pipeline.ts) would UPDATE the lead to 'out' and then fail on
-- the append-only event INSERT (from_stage/to_stage = 'out' violates the CHECK): a stage
-- change with no event row and a 500 to the operator — the silent-UPDATE class, one layer
-- down. Live probe 2026-09-04: zero leads have ever been at 'out' and zero event rows touch
-- it, so nothing is inconsistent yet; the first delivery-day would have been the incident.
-- Found by the ezCater lifecycle implementer while confirming to_stage's NOT NULL.
--
-- Same shape as 0129: a CHECK cannot be extended in place → drop + recreate, both columns.
-- No data change. Idempotent-safe: DROP CONSTRAINT IF EXISTS.

ALTER TABLE public.catering_pipeline_events
  DROP CONSTRAINT IF EXISTS catering_pipeline_events_from_stage_check;
ALTER TABLE public.catering_pipeline_events
  ADD CONSTRAINT catering_pipeline_events_from_stage_check
  CHECK (from_stage IS NULL OR from_stage IN ('inquiry','quote_sent','confirmed','out','completed','lost'));

ALTER TABLE public.catering_pipeline_events
  DROP CONSTRAINT IF EXISTS catering_pipeline_events_to_stage_check;
ALTER TABLE public.catering_pipeline_events
  ADD CONSTRAINT catering_pipeline_events_to_stage_check
  CHECK (to_stage IN ('inquiry','quote_sent','confirmed','out','completed','lost'));

-- Verify (run after apply):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'catering_pipeline_events'::regclass and contype = 'c';
-- Expected: both definitions list 'out'.
