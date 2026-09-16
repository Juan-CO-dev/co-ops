-- Migration 0204_stripe_events_and_checkout
-- AUTHORED 2026-09-16. NOT YET APPLIED — GATE (LEAD/JUAN). Sim first, prod on Juan's word.
-- Provenance: launch-readiness audit row LRA-210 (the /order/review copy promised a
--             provider that was not wired) + lib/catering/payments.ts's provider-agnostic
--             seam (0127) + its one-due invariant (0130).
--
-- WHAT: (a) `public.stripe_events` — the inbound-webhook ledger, keyed on STRIPE'S OWN
--           event id, so replay/duplicate deliveries are refused by the primary key
--           instead of by application reasoning.
--       (b) `public.catering_payments.provider_session_id` — the Checkout Session id we
--           hand the customer, recorded on the `due` row BEFORE any money moves.
--
-- ── WHY THE EVENT ID IS THE PRIMARY KEY (ledger-first idempotency) ────────────────────
-- Stripe retries a webhook until it gets a 2xx, and it is explicit that a delivery may
-- arrive MORE THAN ONCE even after a 200. The route therefore appends to this table
-- FIRST, before it reads or writes a single payment row: the insert either succeeds (this
-- delivery is new and we may process it) or raises 23505 (we have seen this exact event
-- and must do nothing but answer 200). That is why `id` is `text primary key` holding
-- `evt_…` verbatim rather than a surrogate uuid with a unique index beside it — the
-- idempotency key IS the identity, and a surrogate would let a second row exist for one
-- event during the window a unique index is being created.
--
-- This mirrors `ezcater_events` (0168) in posture and differs in exactly one way, on
-- purpose: ezCater's ledger is append-EVERY-delivery (its notification ids repeat across
-- retries by design and its processor reasons about duplicates itself), while Stripe hands
-- us a stable event id, so the cheapest correct guard is the constraint.
--
-- `payload` stores the delivery VERBATIM. It is UNTRUSTED CONTENT: nothing reads it as
-- markup, no field of it is ever used as an href/src, and every value the processor acts on
-- (payment_id, quote_id) is UUID-validated in TypeScript before it reaches a query. The
-- row is forensic evidence, not a source of authority.
--
-- `outcome` + `processed_at` are written at the END of processing, so a row with a null
-- outcome is a delivery that was recorded and then died mid-flight — which is precisely the
-- forensic signal a ledger exists to preserve. Deliberately no CHECK constraint on
-- `outcome`: the vocabulary is closed on the WRITE side in TypeScript
-- (`StripeProcessingResult`), the same posture `audit_log` takes with `AuditAction` and
-- `par_auto_moves.reason_code` with `ParReasonCode` — a DDL enum would only force a
-- migration per new outcome.
--
-- ── `location_id` IS NULLABLE, AND THAT IS THE SINGLE-ACCOUNT DEFAULT ─────────────────
-- The default deployment is ONE Stripe account serving both shops, registered at
-- `POST /api/webhooks/stripe`: that delivery carries no location in its URL, and the shop
-- is only knowable AFTER the payment row is located (via its quote's `location_id`). The
-- ledger row is written BEFORE that lookup (ledger-first), so the column starts null and is
-- filled in by the same final UPDATE that stamps `outcome`/`processed_at` whenever the
-- resolution succeeded. A per-location deployment (`POST /api/webhooks/stripe/<code>`,
-- one connected account per shop) knows the location at signature-verification time and
-- fills it immediately. NOT NULL would have forced the single-account shape to either
-- guess a shop or abandon ledger-first; both are worse than an honest null.
--
-- ── RLS POSTURE: DENY-ALL, AND IT IS DELIBERATE ──────────────────────────────────────
-- The house idiom for every table created since 0168/0174: RLS enabled, `REVOKE ALL …
-- FROM anon, authenticated, public`, and NO policies. The only reader and the only writer
-- are service-role (`lib/stripe/webhook.ts`), and AGENTS.md's law is blunt — "The staff JWT
-- is a valid PostgREST bearer" — so anything `authenticated` may touch is reachable by any
-- staff member with a cookie and curl, past every app-layer gate. Granting here would open
-- a direct-PostgREST path to every raw payment payload the business receives. Explicit deny
-- POLICIES are deliberately NOT stacked on top of the revoke (0172/0174/0182/0203
-- precedent): with no privilege granted there is nothing for a policy to narrow, and a
-- policy that can never be evaluated reads as protection that is not there.
--
-- ── `provider_session_id` vs `provider_ref` (two different external ids) ──────────────
-- `provider_ref` keeps its 0127 meaning and is set ONLY when money has actually moved: the
-- PaymentIntent id, written by the webhook at the same instant `status` becomes 'paid'.
-- `provider_session_id` is the Checkout Session id, written when the customer is SENT to
-- pay — before, and possibly without, any payment. Collapsing them into one column would
-- make "has a provider_ref" stop meaning "was charged", which is the one question the
-- refund path asks (`charge.refunded` locates its payment by `provider_ref = the charge's
-- payment_intent`).
--
-- Additive and re-runnable: `create table if not exists`, `add column if not exists`,
-- `create index if not exists`. No data is written, moved or deleted; with no Stripe keys
-- set the app behaves exactly as it did before this migration.
--
-- VERIFY AFTER APPLY (the 0132/0189 law — verify grants, never assume):
--   select relrowsecurity from pg_class
--    where oid = 'public.stripe_events'::regclass;             -- expect: t
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'stripe_events'
--      and grantee in ('anon', 'authenticated', 'PUBLIC') order by 1, 2;
--                                                             -- expect: NO ROWS
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'stripe_events';
--                                                             -- expect: NO ROWS (deny-all)
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'catering_payments'
--      and column_name = 'provider_session_id';               -- expect: 1 row, YES

begin;

-- ── (a) the inbound webhook ledger ───────────────────────────────────────────────────
create table if not exists public.stripe_events (
  -- Stripe's own event id (`evt_…`) VERBATIM. This is the idempotency key; see header.
  id           text        primary key,
  -- Stripe's event type (`checkout.session.completed`, `charge.refunded`, …). Stored even
  -- for types we ignore, so "did Stripe ever send us X?" is answerable without Stripe.
  type         text        not null,
  -- Stripe's own test/live discriminator. A test-mode delivery against live keys (or the
  -- reverse) is the classic mis-wiring, and it is invisible unless the ledger records it.
  livemode     boolean     not null,
  received_at  timestamptz not null default now(),
  -- The delivery VERBATIM. UNTRUSTED CONTENT — see header.
  payload      jsonb       not null,
  -- The shop this delivery resolved to. NULL until known; see header (single-account mode
  -- learns it from the payment's quote, per-location mode from the URL segment).
  location_id  uuid        null references public.locations(id),
  -- Written at the END of processing. NULL = recorded but never finished (forensic signal).
  outcome      text        null,
  processed_at timestamptz null
);

comment on table public.stripe_events is
  'Inbound Stripe webhook ledger. PK = Stripe''s own event id, which IS the idempotency '
  'guard: the route appends here BEFORE touching a payment row, and a 23505 means "already '
  'delivered, do nothing but answer 200". payload is stored verbatim and is UNTRUSTED '
  'CONTENT (never rendered as markup, never an href; every id acted on is UUID-validated '
  'in TS first). outcome/processed_at are stamped at the end, so a null outcome is a '
  'delivery that died mid-flight. location_id is nullable because single-account mode only '
  'learns the shop after the payment row resolves. Service-role only '
  '(lib/stripe/webhook.ts); deny-all RLS per the 0174/0182/0203 posture.';

-- "What arrived recently / what is still unprocessed" — the operator-facing sweep.
create index if not exists stripe_events_received_ix
  on public.stripe_events (received_at desc);
-- "Which shop's deliveries are these" — for the per-location readiness read.
create index if not exists stripe_events_location_ix
  on public.stripe_events (location_id);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
revoke all on public.stripe_events from public;

-- ── (b) the Checkout Session id on the payment intent ────────────────────────────────
alter table public.catering_payments
  add column if not exists provider_session_id text null;

comment on column public.catering_payments.provider_session_id is
  'Stripe Checkout Session id (cs_…), written on the still-''due'' row when the customer is '
  'SENT to pay. NOT proof of payment — provider_ref keeps that job and holds the '
  'PaymentIntent/charge id, written only at the instant status becomes ''paid''. The '
  'webhook uses this as the FALLBACK lookup when a delivery''s metadata.payment_id is '
  'missing or unusable.';

-- The webhook's fallback lookup (`provider_session_id = <session id>`). Partial: a row
-- without a session id is not a candidate, and most rows never have one.
create index if not exists catering_payments_provider_session_ix
  on public.catering_payments (provider_session_id)
  where provider_session_id is not null;

commit;
