-- Migration 0127_catering_portal_orders
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: lib/portal/orders.ts + lib/catering/payments.ts +
--   docs/superpowers/plans/2026-07-16-portal-3-order-submission.md
--
-- Portal-3: the unified order/quote flow substrate. One artifact (catering_quotes) with an
-- `origin` that drives the payment plan (self_serve = deposit-required; staff = full, deposit
-- optional only if >1wk out), plus a provider-agnostic payment seam.

-- Customer-submitted quotes need a status the staff-authored vocabulary lacks.
ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;
ALTER TABLE catering_quotes ADD CONSTRAINT catering_quotes_status_check
  CHECK (status = ANY (ARRAY['draft','sent','accepted','declined','expired','submitted']));

-- origin drives the payment plan. Existing rows are staff-built → default 'staff'.
ALTER TABLE catering_quotes ADD COLUMN origin text NOT NULL DEFAULT 'staff'
  CHECK (origin IN ('self_serve','staff'));

-- Provider-agnostic payment seam. One row per intent; a future provider (or a staff mark-paid
-- action) advances status. NOT the full settlement ledger (that evolves when real money flows).
CREATE TABLE catering_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid NOT NULL REFERENCES catering_quotes(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES catering_customers(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('deposit','balance','full')),
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  currency      text NOT NULL DEFAULT 'usd',
  status        text NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','refunded','void')),
  provider      text,                 -- null until a provider is wired (stripe/toast/…)
  provider_ref  text,                 -- external session/charge id
  created_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz,
  created_by    uuid                  -- customer_id for portal-created, user id for staff actions
);
CREATE INDEX catering_payments_quote ON catering_payments (quote_id);
ALTER TABLE catering_payments ENABLE ROW LEVEL SECURITY; -- deny-all to end-users; service-role only
