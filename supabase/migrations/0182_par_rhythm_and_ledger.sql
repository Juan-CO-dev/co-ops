-- Migration 0182_par_rhythm_and_ledger
-- AUTHORED 2026-08-22. NOT YET APPLIED — GATE M1 (LEAD/JUAN).
--
-- 0182: Dynamic Pars — vendor rhythm, the par-move ledger, and the day-grain sales signal
-- Spec:  docs/superpowers/specs/2026-08-21-dynamic-pars-design.md (four layers, final at 2389f5e)
-- Plan:  docs/superpowers/plans/2026-08-22-dynamic-pars.md Task 1.1 (GATE M1)
--
-- WHAT THIS IS NOT: it does not touch toast_daily_depletion, production_inputs, or any
-- par column. The double-count law's two lanes are not in play anywhere in this file.
--
-- RLS posture: deny-all on every new table (service-role writes; app-layer role gates in
-- lib/vendor-rhythm.ts and lib/dynamic-pars.ts). House idiom from 0168+/0174:
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY;  REVOKE ALL … FROM anon, authenticated, public;
-- Explicit deny policies are NOT stacked on top of the revoke (0172/0174 precedent).
--
-- Append-only: rows are never deleted by the application, with ONE documented exception
-- recorded on par_auto_moves below (the nightly recompute of its own non-applied opinions).

-- ── (1) VENDOR DELIVERY RHYTHM — order→delivery PAIRS, explicitly per-location ───────────
--
-- WHY PAIRS AND NOT TWO ARRAYS. vendors.order_days and vendors.delivery_days are both
-- smallint[] and they DO NOT MAP: a vendor that takes orders on three days may run trucks
-- on two, and nothing in two parallel arrays says which order lands on which truck. One row
-- per (order day → lead) IS the pair; delivery_dow is GENERATED from it so there is exactly
-- one authority for the arithmetic and no chance of an authored pair disagreeing with itself.
--
-- WHY location_id IS NOT NULLABLE HERE, unlike vendor_cutoffs. A NULL=all-shops row would let
-- the ghost kitchen silently inherit P Street's trucks — which is precisely the fact that is
-- NOT shared between two shops of one vendor. Cutoffs may be shared (one phone system, one
-- deadline); routes may not. Deliberate asymmetry, ruled by the council's round 3.
--
-- LEGACY: vendors.delivery_days (migration 0094) is vendor-global, set on 4 of 18 vendors,
-- and is NEVER read by this layer. It is not migrated and not deleted; it stays where the
-- vendor calendar uses it.

CREATE TABLE IF NOT EXISTS public.vendor_delivery_rhythm (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid        NOT NULL REFERENCES public.vendors(id),
  -- NOT NULL by design (see the comment block above). No all-shops inheritance, ever.
  location_id   uuid        NOT NULL REFERENCES public.locations(id),
  -- JS getDay convention, matching vendors.order_days and vendor_cutoffs.order_day:
  -- 0 = Sunday … 6 = Saturday.
  order_dow     smallint    NOT NULL CHECK (order_dow BETWEEN 0 AND 6),
  -- Calendar days from placing the order to the truck landing. 0 = same-day delivery.
  -- Capped at 14: anything longer is a standing order, not a rhythm, and would make the
  -- coverage window longer than the demand window that feeds it.
  lead_days     smallint    NOT NULL CHECK (lead_days BETWEEN 0 AND 14),
  -- DERIVED, never authored — one authority for the arithmetic.
  delivery_dow  smallint    GENERATED ALWAYS AS (((order_dow + lead_days) % 7)) STORED,
  active        boolean     NOT NULL DEFAULT true,
  created_by    uuid        NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
  -- One LIVE pair per (vendor, location, order day) — enforced by the partial unique index
  -- below rather than a table constraint, so a changed lead deactivates and re-adds
  -- (append-only) and the deactivated history stays readable.
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_delivery_rhythm_live_uq
  ON public.vendor_delivery_rhythm (vendor_id, location_id, order_dow)
  WHERE active;

CREATE INDEX IF NOT EXISTS vendor_delivery_rhythm_location_ix
  ON public.vendor_delivery_rhythm (location_id, vendor_id) WHERE active;

ALTER TABLE public.vendor_delivery_rhythm ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_delivery_rhythm FROM anon, authenticated;
REVOKE ALL ON public.vendor_delivery_rhythm FROM public;

COMMENT ON TABLE public.vendor_delivery_rhythm IS
  'Per-location order-day -> delivery-day PAIRS. The ONLY source of the coverage horizon. '
  'location_id is NOT NULL on purpose: no all-shops inheritance (a new shop must not silently '
  'inherit another shop''s trucks). vendors.delivery_days is legacy and is never read here.';

-- ── (2) VENDOR RHYTHM SKIPS — the one-off outage window ─────────────────────────────────
--
-- A vendor-down week is not par disagreement. Without this, a manager handling an outage by
-- ordering elsewhere reads to the machine as "the human keeps overriding the suggestion",
-- which burns budget and PIN state on an event that has nothing to do with the par.
-- Inclusive date range, append-only (retract = active=false).

CREATE TABLE IF NOT EXISTS public.vendor_rhythm_skips (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid        NOT NULL REFERENCES public.vendors(id),
  location_id   uuid        NOT NULL REFERENCES public.locations(id),
  skip_from     date        NOT NULL,
  skip_through  date        NOT NULL,
  note          text        NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_by    uuid        NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_rhythm_skips_range CHECK (skip_through >= skip_from)
);

CREATE INDEX IF NOT EXISTS vendor_rhythm_skips_lookup_ix
  ON public.vendor_rhythm_skips (location_id, vendor_id, skip_from, skip_through) WHERE active;

ALTER TABLE public.vendor_rhythm_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_rhythm_skips FROM anon, authenticated;
REVOKE ALL ON public.vendor_rhythm_skips FROM public;

-- ── (3) PAR AUTO MOVES — the nightly ledger, the guard's state home, the history drawer ──
--
-- ONE ROW PER (run_date, location, sku, day_class). 141 SKUs x 2 day-classes x 2 locations
-- = 564 rows a night. That volume is exactly why this is NOT the audit log: 282 audit rows
-- per location-night would be ~21x the entire audit log annually (r3). audit_log gets ONE
-- run-level row per (location, night); the detail lives here.
--
-- IDEMPOTENCE + APPEND-ONLY, RECONCILED. The nightly recompute deletes its own prior
-- opinions for (run_date, location) WHERE outcome <> 'applied' and re-inserts — the
-- materializeDailyDepletion pattern, so a Vercel retry cannot double-count a budget. An
-- 'applied' row records a REAL par write and is never deleted and never updated.
--
-- day_class, NOT "day slot": the budget, the band and the par columns all live at
-- weekday/weekend grain. r2 named it "day-slot"; r3 renamed it throughout. Two values only.

CREATE TABLE IF NOT EXISTS public.par_auto_moves (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date              date        NOT NULL,
  location_id           uuid        NOT NULL REFERENCES public.locations(id),
  sku_id                uuid        NOT NULL REFERENCES public.vendor_items(id),
  day_class             text        NOT NULL CHECK (day_class IN ('weekday','weekend')),
  -- 'shadow' = the write bit is off and the guard stack was SIMULATED. 'live' = graduated.
  mode                  text        NOT NULL CHECK (mode IN ('shadow','live')),
  -- Which tier this row belongs to, after the band decided.
  tier                  text        NOT NULL CHECK (tier IN ('auto','suggestion','none')),
  outcome               text        NOT NULL
                          CHECK (outcome IN ('would_apply','applied','suppressed','advisory_null')),
  -- Which guard stopped it. NULL unless outcome = 'suppressed'.
  suppressed_by         text        NULL
                          CHECK (suppressed_by IS NULL OR suppressed_by IN
                            ('band','budget','hysteresis','pin','slot_creation','below_band_resolution')),
  -- The closed reason vocabulary (lib/dynamic-pars-shared.ts ParReasonCode). Deliberately
  -- NO CHECK: the vocabulary is closed BY THE COMPILER on the write side (the same posture
  -- audit_log takes with AuditAction), and a DDL enum would force a migration per new cause.
  -- Always set — a row that produced a number carries 'ok'.
  reason_code           text        NOT NULL,
  -- Stable suggestion identity. NULL when no number was produced. A standing suggestion
  -- re-offered 14 nights keeps ONE generation id, so the trust ramp counts offers, not renders.
  generation_id         text        NULL,
  -- The numbers, all in ORDER UNITS (never oz).
  current_par           numeric     NULL,
  target_par            numeric     NULL,   -- the raw coverage target, pre-rounding
  suggested_par         numeric     NULL,   -- rounded to the step and clamped; what renders
  par_step              numeric     NULL,
  -- True when the day_class has no par slot on this SKU today: suggestion-only FOREVER.
  slot_creation         boolean     NOT NULL DEFAULT false,
  -- The demand terms, persisted so the walker can re-select a horizon at read time WITHOUT
  -- recomputing 21 days of history (R3-A: the horizon is a read-time pure SELECTION).
  base_rate_oz_per_day  numeric     NULL,
  observed_days         smallint    NULL,
  gap_days              smallint    NULL,
  velocity_ratio        numeric     NULL,
  cushion_pct           numeric     NULL,
  per_order_unit_oz     numeric     NULL,
  peak_floor_oz         numeric     NULL,
  -- The horizon THIS run computed with (the walker names its own, live).
  coverage_days         smallint    NULL,
  next_delivery_date    date        NULL,
  cover_through_date    date        NULL,
  -- The full why, for the history drawer and for forensics. Never parsed by the engine.
  detail                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT par_auto_moves_run_uq UNIQUE (run_date, location_id, sku_id, day_class)
);

-- The walker's read: latest row per (location, sku, day_class).
CREATE INDEX IF NOT EXISTS par_auto_moves_walker_ix
  ON public.par_auto_moves (location_id, sku_id, day_class, run_date DESC);
-- The budget read: non-manual writes at one (sku, location, day_class) in a rolling 7 days.
CREATE INDEX IF NOT EXISTS par_auto_moves_budget_ix
  ON public.par_auto_moves (location_id, sku_id, day_class, run_date DESC)
  WHERE outcome IN ('applied','would_apply');

ALTER TABLE public.par_auto_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.par_auto_moves FROM anon, authenticated;
REVOKE ALL ON public.par_auto_moves FROM public;

-- ── (4) PAR SUGGESTION ACTIONS — one human verdict per generation, arbitrated by the index ─
--
-- THE UNIQUE INDEX IS THE CONCURRENCY GUARD. Two taps on one suggestion race; the loser gets
-- 23505 and the route maps it to 409 suggestion_already_actioned. Same move as the display-code
-- unique index arbitrating the double-generate race in lib/ordering.ts (noCodeSuffixRetry) —
-- proven on this exact surface by SIM-22.
--
-- This table is also (a) the trust ramp's numerator/denominator, counted in DISTINCT
-- GENERATIONS by construction, and (b) the PIN's state home ('revert' rows).

CREATE TABLE IF NOT EXISTS public.par_suggestion_actions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid        NOT NULL REFERENCES public.locations(id),
  sku_id         uuid        NOT NULL REFERENCES public.vendor_items(id),
  day_class      text        NOT NULL CHECK (day_class IN ('weekday','weekend')),
  generation_id  text        NOT NULL,
  action         text        NOT NULL CHECK (action IN ('accept','dismiss','revert')),
  -- Snapshotted so the ramp and the history drawer never re-derive a past offer.
  par_before     numeric     NULL,
  par_after      numeric     NULL,
  actor_id       uuid        NOT NULL REFERENCES public.users(id),
  acted_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT par_suggestion_actions_generation_uq
    UNIQUE (location_id, sku_id, day_class, generation_id)
);

CREATE INDEX IF NOT EXISTS par_suggestion_actions_ramp_ix
  ON public.par_suggestion_actions (location_id, acted_at DESC);

ALTER TABLE public.par_suggestion_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.par_suggestion_actions FROM anon, authenticated;
REVOKE ALL ON public.par_suggestion_actions FROM public;

-- ── (5) TOAST DAILY SALES SIGNALS — the day-grain catering marker (plan D4) ──────────────
--
-- WHY A SEPARATE TABLE AND NOT A FILTER. deriveSalesConsumption computes suspectedCatering
-- AFTER it has summed skuDirect over every counted line (lib/catering/toast-sales.ts:757).
-- Excluding suspect checks from the aggregation would change what direct_oz MEANS — the one
-- lane the double-count law protects. So the detector's verdict is recorded BESIDE the day,
-- at day grain, and the velocity layer reads it. direct_oz is byte-identical.
--
-- Written by materializeDailyDepletion inside its EXISTING idempotent (location, date)
-- delete-and-reinsert scope, so it inherits that function's re-pull safety for free.

CREATE TABLE IF NOT EXISTS public.toast_daily_sales_signals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         uuid        NOT NULL REFERENCES public.locations(id),
  business_date       date        NOT NULL,
  -- Checks the shipped detector flagged (name hit or quantity threshold).
  suspect_check_count integer     NOT NULL DEFAULT 0 CHECK (suspect_check_count >= 0),
  suspect_qty         numeric     NOT NULL DEFAULT 0 CHECK (suspect_qty >= 0),
  -- The day's resolved sold-line quantity — volume CONTEXT for the ledger and for a future
  -- shop-level floor. The SHIPPED velocity volume floor uses the SKU's own order-units-per-day
  -- (dimensionally honest, needs no cross-SKU denominator), so nothing reads this yet.
  counted_qty         numeric     NOT NULL DEFAULT 0 CHECK (counted_qty >= 0),
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, business_date)
);

ALTER TABLE public.toast_daily_sales_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.toast_daily_sales_signals FROM anon, authenticated;
REVOKE ALL ON public.toast_daily_sales_signals FROM public;

-- ── (6) ADDITIVE COLUMNS — cushion class + par step, both per-SKU DATA ──────────────────
--
-- cushion_class: NO ENUM, NO CHECK — the 0177_vendor_price_history_provenance precedent
-- ("the vocabulary is expected to grow; pinning it in DDL now would force a migration per
-- source"). sku_class is raw/packaging and is NOT this taxonomy (verified live: two values
-- across 164 active SKUs). The PERCENTAGES stay in code; only the CLASS is tenant data.
--
-- par_step: the SKU's par quantum. NULL = infer from the standing pars' observed grain
-- (36 par'd SKUs are deliberately fractional, e.g. 0.25-case Dijon). The column is the
-- override, the inference is the bootstrap — no data entry required for correctness.

ALTER TABLE public.vendor_items
  ADD COLUMN IF NOT EXISTS cushion_class text    NULL,
  ADD COLUMN IF NOT EXISTS par_step      numeric NULL CHECK (par_step IS NULL OR par_step > 0);

COMMENT ON COLUMN public.vendor_items.cushion_class IS
  'Cushion policy class (protein/produce/dry/…). Deliberately un-enumerated. The percentage '
  'for each class lives in lib/dynamic-pars-shared.ts CUSHION_BY_CLASS; only the class is data.';
COMMENT ON COLUMN public.vendor_items.par_step IS
  'The par quantum in ORDER UNITS. NULL = inferred from the standing pars'' grain by '
  'parStepFor(). The band, the rounding and the below-resolution rule all speak in steps.';
