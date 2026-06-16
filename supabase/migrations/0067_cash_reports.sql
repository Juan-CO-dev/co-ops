-- Migration 0067_cash_reports
-- Applied via Supabase MCP apply_migration on 2026-06-16.
-- Canonical reference: lib/cash.ts; docs/superpowers/specs/2026-06-16-cash-deposit-confirmation-design.md
-- Cash Deposit Confirmation (Wave 2 #1) — dedicated financial record, append-only, KH+ RLS.

CREATE TABLE public.cash_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id           uuid NOT NULL REFERENCES public.locations(id),
  report_date           date NOT NULL,
  projected_cents       integer NOT NULL,
  register_count_cents  integer NOT NULL,
  register_target_cents integer NOT NULL DEFAULT 20000,
  count_method          text NOT NULL CHECK (count_method IN ('hand','denomination')),
  denominations         jsonb,
  cash_tips_cents       integer NOT NULL DEFAULT 0,
  on_shift              jsonb NOT NULL DEFAULT '[]'::jsonb,
  over_short_cents      integer NOT NULL,
  deposit_cents         integer NOT NULL,
  over_short_note       text,
  signed_by             uuid NOT NULL REFERENCES public.users(id),
  signed_at             timestamptz NOT NULL,
  entered_by            uuid NOT NULL REFERENCES public.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  superseded_by         uuid REFERENCES public.cash_reports(id)
);

CREATE UNIQUE INDEX cash_reports_one_live_per_day
  ON public.cash_reports (location_id, report_date)
  WHERE superseded_at IS NULL;

CREATE INDEX cash_reports_location_date ON public.cash_reports (location_id, report_date);

ALTER TABLE public.cash_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_reports_read ON public.cash_reports FOR SELECT
  USING (public.current_user_role_level() >= 4 AND location_id = ANY (public.current_user_locations()));

CREATE POLICY cash_reports_insert ON public.cash_reports FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 4 AND location_id = ANY (public.current_user_locations()));

CREATE POLICY cash_reports_no_user_update ON public.cash_reports FOR UPDATE USING (false);
CREATE POLICY cash_reports_no_user_delete ON public.cash_reports FOR DELETE USING (false);
