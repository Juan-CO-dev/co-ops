-- Migration 0130_catering_payments_one_due
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/security/2026-07-18-coops-security-hardening.md (finding A-M6)
--                      + lib/catering/payments.ts createPaymentDue
--
-- A-M6 (security hardening): at most ONE live 'due' payment intent per (quote, kind). The pay flow
-- did a racy SELECT-then-INSERT with no unique constraint, so concurrent /pay taps could create
-- duplicate 'due' rows — a double-charge hazard once a real provider iterates due intents. This
-- partial unique index makes the invariant DB-enforced; createPaymentDue treats 23505 as idempotent.

CREATE UNIQUE INDEX catering_payments_one_due
  ON public.catering_payments (quote_id, kind)
  WHERE status = 'due';
