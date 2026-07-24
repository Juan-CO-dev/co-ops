-- Migration 0148_catering_lead_assignee
-- STAGED in PR (catering intake & attribution, spec #2b); prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-23-catering-intake-attribution-design.md
--
-- The "order lead": per-order assigned catering team member (attribution +
-- filter model — Juan 2026-07-23: edits stay open to the write floor but are
-- LOGGED; only the order lead is the client's contact person). Nullable —
-- existing leads stay unassigned until touched.

alter table public.catering_pipeline
  add column assigned_to uuid references public.users(id);
