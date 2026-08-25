-- Migration 0183_par_auto_lane
-- AUTHORED 2026-08-22. NOT YET APPLIED — GATE M2 (LEAD/JUAN).
--
-- 0183: Dynamic Pars — the machine's own par lane on the per-location overlay
-- Spec:  docs/superpowers/specs/2026-08-21-dynamic-pars-design.md (r1 #4, r2 #6, r3 PIN)
-- Plan:  docs/superpowers/plans/2026-08-22-dynamic-pars.md Task 3.2 (GATE M2)
--
-- SEQUENCED LAST ON PURPOSE (plan D12). These columns light resolvePar's third lane, so they
-- land only once the nightly engine that could populate them exists. Pre-apply, resolvePar
-- degrades to the two-layer form it has today (undefined ?? global = global) and the walker
-- is byte-identical. The probe caches only TRUE and re-probes while false (0180 precedent).
--
-- THE MACHINE NEVER MASQUERADES AS AN OPERATOR. A human's number lives in weekday_par /
-- weekend_par and ALWAYS wins; the machine's lives here and is only ever consulted when the
-- human lane is null. Global vendor_items pars are NEVER auto-written — per-location law.
--
-- PER-SLOT, NOT PER-ROW. Two day-classes means two of everything: two auto values, two
-- baselines, two applied stamps, two pins. A single auto_applied_at for both slots would let
-- a weekday move stamp the weekend slot's history (aggie r3).

ALTER TABLE public.location_sku_settings
  -- The machine's lane. NULL = the machine has nothing to say for this slot.
  ADD COLUMN IF NOT EXISTS auto_weekday_par           numeric     NULL,
  ADD COLUMN IF NOT EXISTS auto_weekend_par           numeric     NULL,
  ADD COLUMN IF NOT EXISTS auto_weekday_applied_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS auto_weekend_applied_at    timestamptz NULL,
  -- The GLOBAL par each auto value was computed against. When a human edits the global par,
  -- the standing auto value is invalidated on read: a human's global edit always reasserts
  -- the human lane, and a machine number computed against a baseline that no longer exists
  -- is a stale opinion, not a current one (r2-6).
  ADD COLUMN IF NOT EXISTS auto_weekday_baseline_par  numeric     NULL,
  ADD COLUMN IF NOT EXISTS auto_weekend_baseline_par  numeric     NULL,
  -- THE PIN. Set by a revert; NEVER cleared by the act that set it (a revert IS a human
  -- write — r2's "a human par edit clears the pin" was self-defeating and r3 fixed it).
  -- Cleared ONLY by a DIRECT human par edit at the SAME (sku, location, day-class): a global
  -- edit invalidates the auto VALUE but leaves the pin standing, so one Cap Hill decision
  -- can never un-pin a P Street manager's veto. No auto-expiry. Intended, and stated.
  ADD COLUMN IF NOT EXISTS pinned_weekday_at          timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pinned_weekend_at          timestamptz NULL;

COMMENT ON COLUMN public.location_sku_settings.auto_weekday_par IS
  'The machine lane. resolvePar = human ?? auto ?? global. Written ONLY by the graduated '
  'nightly engine through lib/dynamic-pars.ts writeParFromSuggestion(actorKind="machine"); '
  'the admin location-settings route structurally cannot write it (its payload is an '
  'explicit field list that names only the human lane).';
COMMENT ON COLUMN public.location_sku_settings.pinned_weekday_at IS
  'A human reverted the machine on this slot. The machine may not re-apply while it stands. '
  'Cleared only by a direct human par edit at this same (sku, location, weekday) slot.';

-- RLS: location_sku_settings already carries the 0174 deny-all posture (ENABLE RLS + REVOKE
-- ALL FROM anon, authenticated, public). Adding columns does not change it, and no policy is
-- added: service-role writes only, app-layer role gates in lib/dynamic-pars.ts. Stated here
-- because r3 requires the RLS stance to be named in the migration.
