-- Migration 0141_lto_events
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Canonical reference: lib/catering/lto.ts + lib/catering/lto-pos-push.ts.

-- W4c-b: the LTO/discount action artifact a manager creates from surplus. Append-only friendly
-- (cancel = status flip). Module #17 (LTO Performance) later reads lto_events. RLS: read location-
-- scoped (staff directive) or all-locations >=7; no user writes (service-role only via lib/catering/lto.ts).

CREATE TABLE public.lto_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       uuid NOT NULL REFERENCES public.locations(id),
  kind              text NOT NULL CHECK (kind IN ('lto','discount')),
  name              text NOT NULL,
  discount_bps      integer CHECK (discount_bps IS NULL OR (discount_bps > 0 AND discount_bps <= 10000)),
  promo_price_cents integer CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  pos_push_status   text NOT NULL DEFAULT 'not_pushed' CHECK (pos_push_status IN ('not_pushed','pushed','failed')),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES public.users(id),
  CONSTRAINT lto_events_window CHECK (ends_on >= starts_on),
  CONSTRAINT lto_events_discount_needs_bps CHECK (kind <> 'discount' OR discount_bps IS NOT NULL)
);

CREATE TABLE public.lto_event_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.lto_events(id) ON DELETE CASCADE,
  item_id            uuid REFERENCES public.items(id),
  menu_item_id       uuid REFERENCES public.menu_items(id),
  name_snapshot      text NOT NULL,
  qty                numeric NOT NULL,
  source_pipeline_id uuid,
  CONSTRAINT lto_event_items_one_ref CHECK (num_nonnulls(item_id, menu_item_id) = 1)
);

CREATE INDEX lto_events_location_status_idx ON public.lto_events (location_id, status);
CREATE INDEX lto_event_items_event_idx ON public.lto_event_items (event_id);

ALTER TABLE public.lto_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lto_event_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY lto_events_read ON public.lto_events FOR SELECT
  USING (location_id = ANY (current_user_locations()) OR current_user_role_level() >= 7);
CREATE POLICY lto_events_no_user_insert ON public.lto_events FOR INSERT WITH CHECK (false);
CREATE POLICY lto_events_no_user_update ON public.lto_events FOR UPDATE USING (false);
CREATE POLICY lto_events_no_user_delete ON public.lto_events FOR DELETE USING (false);

CREATE POLICY lto_event_items_read ON public.lto_event_items FOR SELECT
  USING (current_user_role_level() >= 5);
CREATE POLICY lto_event_items_no_user_insert ON public.lto_event_items FOR INSERT WITH CHECK (false);
CREATE POLICY lto_event_items_no_user_update ON public.lto_event_items FOR UPDATE USING (false);
CREATE POLICY lto_event_items_no_user_delete ON public.lto_event_items FOR DELETE USING (false);
