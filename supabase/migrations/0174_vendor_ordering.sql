-- 0174: vendor ordering V1 — the order lifecycle schema
-- Spec: docs/superpowers/specs/2026-08-06-vendor-ordering-v1-design.md §2 + §5c.1
-- Plan: docs/superpowers/plans/2026-08-06-vendor-ordering-v1.md Task 1
--
-- Append-only: purchase_orders/po_lines/po_transmissions/vendor_cutoffs/location_sku_settings
-- rows are never deleted by the application. Status transitions on purchase_orders are
-- app-layer only (service-role); line edits are permitted only while status = 'draft' (app-layer).
--
-- Time zone note: vendor_cutoffs.cutoff_time is a bare TIME (no zone). All cutoff
-- evaluation is performed in ET (America/New_York) at the application layer — callers
-- convert the current ET clock time before comparing. Never store TZ-aware cutoffs here;
-- the bare TIME is the intent (same clock each day, DST handled by the ET derivation).
--
-- RLS posture: deny-all on all five new tables (service-role writes; app-layer role gates
-- in lib/purchase-orders.ts, lib/location-sku-settings.ts, etc.). House idiom from 0168+:
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY;
--   REVOKE ALL ON … FROM anon, authenticated;
--   REVOKE ALL ON … FROM public;
-- Explicit deny policies are NOT added on top of the revoke posture (the revoke is sufficient
-- and avoids the policy-stacking hazard; see 0172 which uses the same approach).

-- ── (1) LOCATION SKU SETTINGS (D1 overlay) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.location_sku_settings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid        NOT NULL REFERENCES public.locations(id),
  sku_id          uuid        NOT NULL REFERENCES public.vendor_items(id),
  -- null = inherit global active; false = deactivated at this shop;
  -- true = active here even if promotional / location-specific.
  active_override boolean     NULL,
  -- null = inherit global weekday_par / weekend_par from vendor_items.
  weekday_par     numeric     NULL,
  weekend_par     numeric     NULL,
  updated_by      uuid        NULL REFERENCES public.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_sku_settings_location_sku_uq UNIQUE (location_id, sku_id)
);

CREATE INDEX IF NOT EXISTS location_sku_settings_location_ix
  ON public.location_sku_settings (location_id);

ALTER TABLE public.location_sku_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.location_sku_settings FROM anon, authenticated;
REVOKE ALL ON public.location_sku_settings FROM public;

-- ── (2) PURCHASE ORDERS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          uuid        NOT NULL REFERENCES public.locations(id),
  vendor_id            uuid        NOT NULL REFERENCES public.vendors(id),
  -- Born-from: links the par-pass event that spawned this PO (null when spawned by
  -- cutoff surfacing's "generate draft" path).
  par_pass_event_id    uuid        NULL REFERENCES public.par_pass_events(id),
  -- Display code: {location.code}-{YYYYMMDD}-{first-6 of vendor name, alnum upper}
  -- uniquified with -2/-3 on same-day collision (app-layer generation in lib/purchase-orders.ts).
  display_code         text        NOT NULL,
  status               text        NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','confirmed','placed','invoiced','received','reconciled')),
  -- Frozen at Confirm: {displayCode, vendor, lines[{skuId,name,itemNumber,qty,unitLabel,priceCents,guidePos}],
  --                      confirmedBy, confirmedAtEt}. Null until confirmed.
  confirmed_snapshot   jsonb       NULL,
  confirmed_by         uuid        NULL REFERENCES public.users(id),
  confirmed_at         timestamptz NULL,
  placed_by            uuid        NULL REFERENCES public.users(id),
  placed_at            timestamptz NULL,
  -- D3: acknowledged = metadata on placed in V1; inbound confirmation details land here.
  placed_note          text        NULL,
  ack                  jsonb       NULL,
  -- ET cutoff governing this order at confirm time (null when no cutoff row matched today).
  cutoff_at_confirm    timestamptz NULL,
  created_by           uuid        NOT NULL REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_display_code_uq UNIQUE (display_code)
);

CREATE INDEX IF NOT EXISTS purchase_orders_location_created_ix
  ON public.purchase_orders (location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS purchase_orders_vendor_status_ix
  ON public.purchase_orders (vendor_id, status);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders FROM anon, authenticated;
REVOKE ALL ON public.purchase_orders FROM public;

-- ── (3) PO LINES ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.po_lines (
  id                       uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id                    uuid    NOT NULL REFERENCES public.purchase_orders(id),
  sku_id                   uuid    NOT NULL REFERENCES public.vendor_items(id),
  -- Editable while status = 'draft'; frozen at Confirm (app-layer enforcement).
  order_qty                numeric NOT NULL CHECK (order_qty >= 0),
  order_unit_label         text    NULL,   -- chain root label else pack_format
  price_cents_at_order     integer NULL,   -- resolved from vendor_price_history at confirm time
  guide_position_snapshot  integer NULL,   -- snapshot of vendor_items.guide_position at PO creation
  note                     text    NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_lines_po_ix
  ON public.po_lines (po_id);

ALTER TABLE public.po_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.po_lines FROM anon, authenticated;
REVOKE ALL ON public.po_lines FROM public;

-- ── (4) PO TRANSMISSIONS ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.po_transmissions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id                uuid        NOT NULL REFERENCES public.purchase_orders(id),
  -- Every placement writes one row: the channel used + target identifier.
  channel              text        NOT NULL
                         CHECK (channel IN ('email','sms','phone','portal','in_person')),
  -- The target address/number/URL; null for in_person or when automated.
  target               text        NULL,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  -- null when automated (V2 adapters); non-null = the staff member who hit Mark Placed.
  sent_by              uuid        NULL REFERENCES public.users(id),
  -- Provider message ID (email message-id, Twilio SID, etc.) for inbound correlation (V2).
  provider_message_id  text        NULL,
  note                 text        NULL
);

CREATE INDEX IF NOT EXISTS po_transmissions_po_ix
  ON public.po_transmissions (po_id);

ALTER TABLE public.po_transmissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.po_transmissions FROM anon, authenticated;
REVOKE ALL ON public.po_transmissions FROM public;

-- ── (5) VENDOR CUTOFFS ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vendor_cutoffs (
  id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    uuid     NOT NULL REFERENCES public.vendors(id),
  -- null = applies to both shops; non-null = applies to this location only.
  location_id  uuid     NULL REFERENCES public.locations(id),
  -- ISO day-of-week: 0 = Sunday … 6 = Saturday.
  order_day    smallint NOT NULL CHECK (order_day BETWEEN 0 AND 6),
  -- Bare TIME, no zone. Evaluation is always in ET (America/New_York) at the app layer.
  -- DST handling is the caller's responsibility; the stored value is the wall-clock intent.
  cutoff_time  time     NOT NULL,
  active       boolean  NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_cutoffs_vendor_ix
  ON public.vendor_cutoffs (vendor_id);

ALTER TABLE public.vendor_cutoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_cutoffs FROM anon, authenticated;
REVOKE ALL ON public.vendor_cutoffs FROM public;

-- ── (6) ADDITIVE COLUMN EXTENSIONS ──────────────────────────────────────────────────────

-- vendors: transmission tier (D4: everyone seeds at manual; per-vendor flip as paths confirmed)
-- and portal_url for assisted-tier deep links.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS transmission_tier text NOT NULL DEFAULT 'manual'
    CHECK (transmission_tier IN ('auto','assisted','manual')),
  ADD COLUMN IF NOT EXISTS portal_url        text NULL;

-- vendor_items: global guide position for assisted-tier ordering sort (nulls last).
ALTER TABLE public.vendor_items
  ADD COLUMN IF NOT EXISTS guide_position integer NULL;

-- vendor_deliveries: the intake ↔ order link (set when an intake is received against a PO).
ALTER TABLE public.vendor_deliveries
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid NULL REFERENCES public.purchase_orders(id);

-- vendor_contacts: explicit marking of numbers that accept text orders (D5).
ALTER TABLE public.vendor_contacts
  ADD COLUMN IF NOT EXISTS accepts_text_orders boolean NOT NULL DEFAULT false;
