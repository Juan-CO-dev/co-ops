-- Migration 0161_count_anchor_dimension
-- STAGED in PR; prod apply deferred to Juan's go (apply BEFORE merging the code —
-- the #191 apply-first protocol; safe because the pre-0161 code can never write a
-- NULL/count row, see the rationale below).
-- Canonical reference: docs/superpowers/specs/2026-07-28-sku-toptier-design.md
--                      (PR-C contents §1) + council DESIGN LOCK 1 (2026-07-28).
--
-- PR-C of the SKU top-tier arc: the COUNT surface becomes DIMENSION-AWARE. A count
-- line is either WEIGHT-anchored (an oz-resolvable chain — raw SKUs — persists
-- resolved_oz exactly as 0160 does) or COUNT-anchored (a count-terminated chain on a
-- packaging/cleaning/misc SKU — persists resolved_units in LEAF UNITS, resolved_oz
-- NULL). Before PR-C, lib/counts.ts REJECTED count-terminated lines with
-- `unresolvable_line` because resolved_oz was NOT NULL and there was no honest ounce
-- to store; this migration + the new write path let those lines anchor in count-space.
--
-- ── WHY NULLABLE resolved_oz, NOT A SENTINEL (LOCK 1) ─────────────────────────────
-- A count-anchored line has NO honest ounce. A sentinel resolved_oz = 0 would be a
-- SILENT-WRONG-NUMBER trap: any future oz aggregation (an on-hand oz rollup, a
-- cross-SKU value report) would sum a real-looking 0 and be quietly wrong with no
-- signal. NULL is honest — it propagates to an advisory "—" everywhere and can never
-- be mistaken for a measured ounce (the A3 discipline: never fabricate a number).
--
-- ── APPLY-FIRST-SAFE (the #191 protocol) ──────────────────────────────────────────
-- The pre-0161 code ALWAYS writes a non-null resolved_oz and rejects count-terminated
-- lines, so no NULL/count rows can exist until the new code deploys. Applying 0161
-- before merging is therefore a no-op on existing data and cannot break the running
-- app. Legacy rows (anchor_dimension NULL) read as weight-anchored by lib/counts.ts.
--
-- Additive only; NO backfill. The existing column CHECK (resolved_oz >= 0) stays
-- satisfied on NULL (Postgres CHECK passes on unknown), so DROP NOT NULL is clean.

ALTER TABLE public.sku_count_lines
  -- Which measurement space this line anchors in. NULL on legacy rows (0160) →
  -- read as 'weight' (they all carry a non-null resolved_oz by construction).
  ADD COLUMN anchor_dimension text NULL
    CHECK (anchor_dimension IN ('weight', 'count')),
  -- Count-space anchor: the count of LEAF units this line resolves to (qty walked
  -- down the chain to the count leaf — e.g. "2 cases" of a 12-per-case chain = 24).
  -- NULL on weight lines. NEVER negative.
  ADD COLUMN resolved_units numeric NULL
    CHECK (resolved_units IS NULL OR resolved_units >= 0);

-- resolved_oz becomes NULL-able: a count-anchored line has no honest ounce.
ALTER TABLE public.sku_count_lines
  ALTER COLUMN resolved_oz DROP NOT NULL;

-- The invariant, tolerant of legacy rows: either a weight line with an ounce, or a
-- count line with leaf units. anchor_dimension NULL = legacy weight-anchored (its
-- resolved_oz is non-null by 0160's old NOT NULL, so it satisfies the weight arm
-- implicitly; the NULL arm here just tolerates it without forcing anchor_dimension).
ALTER TABLE public.sku_count_lines
  ADD CONSTRAINT sku_count_lines_anchor_dimension_ck CHECK (
    anchor_dimension IS NULL
    OR (anchor_dimension = 'weight' AND resolved_oz IS NOT NULL)
    OR (anchor_dimension = 'count' AND resolved_units IS NOT NULL)
  );

COMMENT ON COLUMN public.sku_count_lines.anchor_dimension IS
  'Measurement space this count line anchors in (SKU top-tier PR-C, 0161). ''weight'' = oz-resolvable chain (resolved_oz set); ''count'' = count-terminated chain (resolved_units set, resolved_oz NULL). NULL on legacy 0160 rows → read as weight-anchored.';
COMMENT ON COLUMN public.sku_count_lines.resolved_units IS
  'Count-space anchor: LEAF units this line resolves to (qty walked to the count leaf). NULL on weight lines. A count-anchored line has no honest oz → resolved_oz stays NULL (never a 0 sentinel — A3, no fabricated number).';
