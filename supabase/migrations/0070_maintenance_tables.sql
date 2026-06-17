-- Migration 0070_maintenance_tables
-- Applied via Supabase MCP apply_migration on 2026-06-16.
-- Canonical reference: lib/maintenance.ts; docs/superpowers/specs/2026-06-16-maintenance-log-design.md
-- Maintenance Log (Wave 2 #2) — equipment registry + on-demand note log.

CREATE TABLE public.maintenance_equipment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          uuid NOT NULL REFERENCES public.locations(id),
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('fridge','equipment')),
  opening_temp_item_id uuid REFERENCES public.checklist_template_items(id),
  closing_temp_item_id uuid REFERENCES public.checklist_template_items(id),
  safe_max_f           integer,
  sort_order           integer NOT NULL DEFAULT 0,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_equipment_location ON public.maintenance_equipment (location_id) WHERE active;

CREATE TABLE public.maintenance_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES public.locations(id),
  equipment_id uuid REFERENCES public.maintenance_equipment(id),
  other_label  text,
  note         text NOT NULL,
  created_by   uuid NOT NULL REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_notes_location_created ON public.maintenance_notes (location_id, created_at DESC);

ALTER TABLE public.maintenance_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;

-- Equipment: read for shift staff (>=3) at the location; no end-user writes (seed-only).
CREATE POLICY maintenance_equipment_read ON public.maintenance_equipment FOR SELECT
  USING (public.current_user_role_level() >= 3 AND location_id = ANY (public.current_user_locations()));
CREATE POLICY maintenance_equipment_no_user_insert ON public.maintenance_equipment FOR INSERT WITH CHECK (false);
CREATE POLICY maintenance_equipment_no_user_update ON public.maintenance_equipment FOR UPDATE USING (false);
CREATE POLICY maintenance_equipment_no_user_delete ON public.maintenance_equipment FOR DELETE USING (false);

-- Notes: read + insert for shift staff (>=3) at the location; append-only.
CREATE POLICY maintenance_notes_read ON public.maintenance_notes FOR SELECT
  USING (public.current_user_role_level() >= 3 AND location_id = ANY (public.current_user_locations()));
CREATE POLICY maintenance_notes_insert ON public.maintenance_notes FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 3 AND location_id = ANY (public.current_user_locations()));
CREATE POLICY maintenance_notes_no_user_update ON public.maintenance_notes FOR UPDATE USING (false);
CREATE POLICY maintenance_notes_no_user_delete ON public.maintenance_notes FOR DELETE USING (false);
