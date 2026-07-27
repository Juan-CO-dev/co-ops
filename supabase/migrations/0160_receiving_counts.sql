-- Migration 0160_receiving_counts
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-27-sku-pack-hierarchy-design.md
--                      (COUNCIL DESIGN LOCKS L1-L8, decisions 2+3) + the PR-1 spine
--                      (lib/pack-chain-shared.ts walk, migration 0159 sku_pack_levels).
--
-- PR 2 of the pack-hierarchy arc: the receiving-form upgrade + the manager COUNT
-- surface. Two concerns, one migration (both ride the pack-chain resolution the
-- 0159 spine gives us):
--
--  (A) RECEIVING FORM UPGRADE (spec decision 3 / adjudication A1, A2, A3)
--      vendor_delivery_items gains per-line chain-level capture + resolved oz +
--      a note + a (stubbed-in-PR-2) photo url. vendor_deliveries gains a delivery
--      receipt url (stubbed) + a header note. Existing qty_received/unit_price/
--      observed_oz_per_each STAY — additive; legacy lines keep working.
--        received_level_label   — the chain level (or legacy pack label) the qty
--                                  was entered at ("case", "log", …). NULL on
--                                  legacy lines that never named one.
--        received_qty_at_level   — the numeric qty at that level.
--        resolved_oz             — oz-at-write (L3 "persist resolved_oz"): the
--                                  qty resolved through the SKU's pack chain at
--                                  write time. Consumers read stored oz; the
--                                  spine is date-blind. NULL when unresolvable
--                                  (chain-less / no content) — advisory, never
--                                  a fabricated number (A3).
--        note / photo_url        — per-line comment + PHOTO (A1: photo lands the
--                                  column + full plumbing; UI affordance is a
--                                  DISABLED Phase-6 stub — no bucket, no uploader
--                                  in this PR; a one-swap seam).
--
--  (B) COUNT SURFACE (spec decision 2 / adjudication A4 / council L5+L8)
--      A manager physical-count EVENT (one per session/location, L5) with lines
--      in MIXED chain levels ("2 cases + 3 loose logs"). Each line persists the
--      entered level + qty AND resolved_oz at write (L3). On-hand becomes
--      count-anchored (anchor = the event's summed resolved oz per SKU) with a
--      derived drift (received-since − consumed-since IN OZ, A3). Disjoint-by-law
--      UI (full containers + loose-below + partial-container annotation, L5):
--        is_loose         — a loose unit below a full container (the "3 loose
--                           logs" tier); UI states the disjointness law.
--        partial_fraction — a partially-consumed container (0<f<=1); the line's
--                           resolved_oz already bakes the fraction in.
--        resolved_oz      — NOT NULL: a count line with no oz can't anchor, so
--                           the write path (lib/counts.ts) rejects an
--                           unresolvable count line rather than store a null.
--
-- COUNCIL LOCKS honored here:
--   L3  history: receiving + count lines persist (entered level, qty) AND
--       resolved_oz at write; consumers read stored oz — no retro re-derivation.
--       Count EVENTS carry active + created_at; a superseding count is a NEW event
--       (active=true), older events flipped active=false (append-only, no DELETE).
--   L4  per-location: count events are location-scoped rows (existing law). SKUs
--       stay global; the physical count is per (sku, location) via the event.
--   L5  one count EVENT per session/location; lines disjoint-by-law; anchor = oz
--       snapshot; drift in oz; anchor age surfaced (created_at); retro-edit
--       staleness is a read-time flag (lib/counts.ts), not a column.
--   L8  observed oz on receiving is level-scoped (received_level_label +
--       resolved_oz); shrinkage delta (count vs derived) surfaced read-time with
--       a reason-code display seam kept simple on the line note.
--
-- Flat/legacy fields stay functional — additive only; NO backfill here.

-- ── (A) RECEIVING FORM UPGRADE ────────────────────────────────────────────────
ALTER TABLE public.vendor_delivery_items
  ADD COLUMN received_level_label   text     NULL,
  ADD COLUMN received_qty_at_level  numeric  NULL CHECK (received_qty_at_level IS NULL OR received_qty_at_level > 0),
  ADD COLUMN resolved_oz            numeric  NULL CHECK (resolved_oz IS NULL OR resolved_oz >= 0),
  ADD COLUMN note                   text     NULL,
  ADD COLUMN photo_url              text     NULL;

ALTER TABLE public.vendor_deliveries
  ADD COLUMN receipt_url  text  NULL,
  ADD COLUMN note         text  NULL;

COMMENT ON COLUMN public.vendor_delivery_items.received_level_label IS
  'Pack-chain (or legacy pack) level the qty was entered at (pack hierarchy, 0159/0160). NULL on legacy lines.';
COMMENT ON COLUMN public.vendor_delivery_items.resolved_oz IS
  'Oz-at-write (council L3): received_qty_at_level resolved through the SKU pack chain at write time. NULL when unresolvable (advisory, never fabricated).';
COMMENT ON COLUMN public.vendor_delivery_items.photo_url IS
  'Per-line receiving photo. Column + plumbing land in PR 2; the UI affordance is a DISABLED Phase-6 stub (no bucket/uploader this PR). One-swap seam.';
COMMENT ON COLUMN public.vendor_deliveries.receipt_url IS
  'Delivery receipt attachment. Column + plumbing land in PR 2; UI is a DISABLED Phase-6 stub. One-swap seam.';

-- ── (B) COUNT SURFACE ─────────────────────────────────────────────────────────
CREATE TABLE public.sku_count_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES public.locations(id),
  counted_at   timestamptz NOT NULL DEFAULT now(),
  counted_by   uuid NULL REFERENCES public.users(id),
  note         text NULL,
  -- Append-only: a superseding count is a NEW event; the prior latest is flipped
  -- active=false (never DELETE). The anchor for on-hand = the latest ACTIVE event.
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sku_count_events_location_active_idx
  ON public.sku_count_events (location_id) WHERE active;
CREATE INDEX sku_count_events_counted_at_idx
  ON public.sku_count_events (location_id, counted_at DESC);

CREATE TABLE public.sku_count_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_event_id    uuid NOT NULL REFERENCES public.sku_count_events(id) ON DELETE CASCADE,
  sku_id            uuid NOT NULL REFERENCES public.vendor_items(id),
  -- The chain level (or a legacy pack/measure label) this line was counted at.
  level_label       text NOT NULL,
  qty               numeric NOT NULL CHECK (qty >= 0),
  -- Disjoint-by-law (L5): a loose unit below a full container.
  is_loose          boolean NOT NULL DEFAULT false,
  -- A partially-consumed container: 0 < f <= 1. resolved_oz bakes the fraction in.
  partial_fraction  numeric NULL CHECK (partial_fraction IS NULL OR (partial_fraction > 0 AND partial_fraction <= 1)),
  -- Oz-at-write (L3), NOT NULL: a count line with no oz can't anchor — the write
  -- path rejects an unresolvable count line rather than store a null.
  resolved_oz       numeric NOT NULL CHECK (resolved_oz >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sku_count_lines_event_idx ON public.sku_count_lines (count_event_id);
CREATE INDEX sku_count_lines_sku_idx   ON public.sku_count_lines (sku_id);

COMMENT ON TABLE public.sku_count_events IS
  'One manager physical-count EVENT per session/location (council L5). Append-only: a superseding count is a NEW active event, prior latest flipped active=false. On-hand anchor = latest active event summed resolved_oz per SKU (lib/counts.ts).';
COMMENT ON TABLE public.sku_count_lines IS
  'Per-SKU count line at a chain level (pack hierarchy, 0159/0160). Disjoint-by-law (is_loose + partial_fraction, L5). resolved_oz persisted at write (L3); consumers read stored oz.';

-- Deny-all RLS triads (house pattern, mirrors sku_pack_levels / production_inputs):
-- NO select policy other than an explicit deny; service-role reads bypass RLS and
-- end users never read these directly. Writes are service-role only — lib/counts.ts
-- is the authority (app-layer AGM+ gate + Tier-A step-up + location-bind).
ALTER TABLE public.sku_count_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY sku_count_events_no_user_select ON public.sku_count_events FOR SELECT USING (false);
CREATE POLICY sku_count_events_no_user_insert ON public.sku_count_events FOR INSERT WITH CHECK (false);
CREATE POLICY sku_count_events_no_user_update ON public.sku_count_events FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY sku_count_events_no_user_delete ON public.sku_count_events FOR DELETE USING (false);

ALTER TABLE public.sku_count_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sku_count_lines_no_user_select ON public.sku_count_lines FOR SELECT USING (false);
CREATE POLICY sku_count_lines_no_user_insert ON public.sku_count_lines FOR INSERT WITH CHECK (false);
CREATE POLICY sku_count_lines_no_user_update ON public.sku_count_lines FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY sku_count_lines_no_user_delete ON public.sku_count_lines FOR DELETE USING (false);
