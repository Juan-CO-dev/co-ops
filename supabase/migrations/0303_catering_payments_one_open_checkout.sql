-- Migration 0303_catering_payments_one_open_checkout
-- AUTHORED 2026-11-14. NOT YET APPLIED — file only; apply via MCP after review (sim first, prod on Juan's word, AFTER 0204).
-- Provenance: bug audit 2026-11-14, wave W02 "Card payments and quote payability (Stripe)", finding B035 —
--   "Deposit and full-payment checkouts can both be paid for the same quote". A staff quote far enough out
--   offers two ways to pay (a deposit, or the full amount). Each catering_payments row got its own hosted
--   Stripe Checkout Session and nothing closed the first when the second was opened, so BOTH stayed payable
--   for a day and both charges were accepted: a deposit AND the full total for one order.
--
-- WHAT: exactly ONE object.
--   create unique index catering_payments_one_open_checkout
--     on public.catering_payments (quote_id)
--     where status = 'due' and provider_session_id is not null;
--   "At most one still-due payment intent per quote may point at a Checkout Session." A session id on a due
--   row is a LIVE PAYMENT SURFACE — a URL the customer can pay into right now — so this is the database
--   saying a quote has at most one of those at a time.
--
-- ── WHY AN INDEX, WHEN THE APP ALREADY RETIRES THE OTHER SESSION ─────────────────────────────────
-- lib/portal/quotes.ts `createQuoteCheckout` (same PR) retires every other open session of the quote at
-- Stripe and clears its id from its row BEFORE it mints a new one. That closes the hole for one request at
-- a time. It cannot close it for TWO requests racing: both read "no other open session", both mint, both
-- attach. This index is the arbiter for that case, the same job 0130's `catering_payments_one_due` does
-- for the racy SELECT-then-INSERT of the intent itself: the second attach gets 23505, the app reads that as
-- "another checkout won", closes the session it just minted and answers 409 `payment_in_progress`.
-- The index is the guard; the app's retire step is what makes the guard rarely fire.
--
-- ── WHAT IT DOES NOT CONSTRAIN, ON PURPOSE ───────────────────────────────────────────────────────
--   · rows that are not `due`. A paid / refunded / void row keeps its `provider_session_id` as history (the
--     webhook's fallback lookup reads it), and history is not a live payment surface.
--   · due rows with NO session. A quote may hold a due `deposit` AND a due `full` intent (0130 allows one
--     per kind); only one of them may be at Stripe at a time.
--   · other quotes. The key is `quote_id`; revisions of one quote family are separate rows by design —
--     the app moves a family's payments onto its live revision when a quote is revised (W02/B006), so the
--     live revision is where this index does its work.
--
-- ── THE APP WORKS BEFORE THIS IS APPLIED ─────────────────────────────────────────────────────────
-- Nothing reads this index and no code path requires it: before the apply, the retire-then-mint sequence
-- runs exactly the same and only the two-requests race stays open (backstopped by the webhook, which flags
-- a second payment on a quote as `paid_needs_review`). After the apply the race closes. There is no
-- ordering requirement between this migration and the deploy.
--
-- NO DATA IS WRITTEN, MOVED OR DELETED. No table, column, function, policy or grant is created or changed,
-- so there is no privilege ceiling to assert here: `catering_payments` keeps the posture 0127 gave it (RLS
-- enabled, no policies, service-role only through lib/catering/payments.ts, lib/portal/quotes.ts and
-- lib/stripe/webhook.ts). The post-flight proves the row count is what it was.
--
-- EXISTING ROWS: prod has never had Stripe keys (the leg is dormant), so no prod row carries a
--   `provider_session_id` and the index builds over nothing. The sim may hold test sessions. The pre-flight
--   DATA CHECK refuses, naming the count, if any quote already has two due rows with a session — it does
--   not pick a winner. Resolve those by hand first (expire the stale session in the Stripe dashboard, then
--   set that row's provider_session_id to null) and re-apply.
--
-- DEPENDS ON: 0127 (catering_payments), 0130 (catering_payments_one_due), 0204 (provider_session_id).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regclass('public.catering_payments');                                             -- present
--   select 1 from information_schema.columns where table_schema = 'public'
--     and table_name = 'catering_payments' and column_name = 'provider_session_id';              -- 1 row (0204)
--   select indexname from pg_indexes where schemaname = 'public' and tablename = 'catering_payments' order by 1;
--     -- includes catering_payments_one_due (0130) and catering_payments_provider_session_ix (0204);
--     -- does NOT include catering_payments_one_open_checkout
--   select quote_id, count(*) from public.catering_payments
--    where status = 'due' and provider_session_id is not null group by 1 having count(*) > 1;    -- none
--
-- VERIFY AFTER APPLY:
--   select indexdef from pg_indexes where schemaname = 'public' and indexname = 'catering_payments_one_open_checkout';
--     -- CREATE UNIQUE INDEX catering_payments_one_open_checkout ON public.catering_payments USING btree (quote_id)
--     --   WHERE ((status = 'due'::text) AND (provider_session_id IS NOT NULL))
--   select count(*) from public.catering_payments;                                               -- unchanged
--
-- ROLLBACK (if ever needed; restores the pre-0303 behaviour exactly, the app needs no change):
--   drop index public.catering_payments_one_open_checkout;

begin;

-- ── PRE-FLIGHT: 0127 / 0130 / 0204 applied, not already applied, and the live rows already obey the rule ──
do $$
declare
  v_dup integer;
begin
  if to_regclass('public.catering_payments') is null then
    raise exception '0303: 0127 (catering_payments) must be applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'catering_payments'
                    and column_name = 'provider_session_id') then
    raise exception '0303: 0204 (catering_payments.provider_session_id) must be applied first';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'catering_payments'
                    and indexname = 'catering_payments_one_due') then
    raise exception '0303: 0130 (catering_payments_one_due) must be applied first';
  end if;
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'catering_payments_one_open_checkout') then
    raise exception '0303: catering_payments_one_open_checkout already exists: refusing a second apply';
  end if;
  -- DATA CHECK: the migration never chooses which of two open checkouts survives. A human does.
  select count(*) into v_dup from (
    select 1 from public.catering_payments
     where status = 'due' and provider_session_id is not null
     group by quote_id having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception '0303: % quote(s) already hold more than one due payment with an open checkout session: refusing (expire the stale session and null its provider_session_id, then re-apply)', v_dup;
  end if;
end $$;

-- ── THE INDEX ───────────────────────────────────────────────────────────────────────────────────
create unique index catering_payments_one_open_checkout
  on public.catering_payments (quote_id)
  where status = 'due' and provider_session_id is not null;

comment on index public.catering_payments_one_open_checkout is
  '0303: at most ONE still-due payment intent per quote may point at a Stripe Checkout Session '
  '(provider_session_id). A session id on a due row is a live payment surface; two of them on one quote is '
  'how a deposit and the full amount were both charged (audit W02/B035). The app retires the other session '
  'before it mints a new one (lib/portal/quotes.ts createQuoteCheckout); this index arbitrates the race two '
  'requests can still have, and the loser''s 23505 is answered 409 payment_in_progress. Not due = history, '
  'not constrained.';

-- ── POST-FLIGHT: the index is exactly the one above, and its neighbours are untouched ───────────
do $$
declare
  v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'catering_payments_one_open_checkout';
  if v_def is null then
    raise exception '0303: catering_payments_one_open_checkout was not created';
  end if;
  if v_def !~* '^create unique index catering_payments_one_open_checkout on public\.catering_payments using btree \(quote_id\) where '
     or v_def !~* 'status = ''due'''
     or v_def !~* 'provider_session_id is not null' then
    raise exception '0303: catering_payments_one_open_checkout is not UNIQUE (quote_id) WHERE status = due AND provider_session_id IS NOT NULL (%)', v_def;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'catering_payments_one_due')
     or not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'catering_payments_provider_session_ix') then
    raise exception '0303: a pre-existing catering_payments index went missing';
  end if;
end $$;

commit;
