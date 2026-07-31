-- Migration 0167_annotate_deferred_integration_tables
-- Annotate two empty, Foundation-Spec-era integration rollup tables so they
-- stop reading as orphans on schema inspection. METADATA ONLY (COMMENT ON
-- TABLE) — no structural change, no data change, no RLS change.
--
-- Decision blessed by Juan 2026-07-31 during the whole-app quality-hardening
-- pass: KEEP both tables (they are the designed homes for a future Toast /
-- 7shifts business-analytics layer) and just document their deferred state.
-- The LIVE Toast read-track (migrations 0146–0166) stores event-level
-- toast_sales_events and derives toast_daily_depletion for inventory drift;
-- neither of these rollup tables is written by it.

comment on table public.toast_daily_data is
  'DEFERRED, EMPTY (blessed 2026-07-31). Foundation-Spec 4.16 daily business-metrics rollup (sales / labor / void / comp / product+channel mix). NOT written by the live Toast read-track, which uses event-level toast_sales_events + derived toast_daily_depletion for inventory drift. Kept as the designed home for a future Toast analytics layer; drop if that layer is redesigned around the event ledger. Twin: shifts_daily_data.';

comment on table public.shifts_daily_data is
  'DEFERRED, EMPTY (blessed 2026-07-31). Foundation-Spec 4.16 daily labor/shift rollup (7shifts adapter target). No 7shifts integration is built. Kept as the designed home; drop if superseded. Twin: toast_daily_data.';
