-- Migration 0303_catering_payments_one_open_checkout
-- AUTHORED 2026-11-14. NOT YET APPLIED — file only; apply via MCP after review (sim first, prod on Juan's word, AFTER 0204).
-- Provenance: bug audit 2026-11-14, wave W02 "Card payments and quote payability (Stripe)", finding B035 —
--   "Deposit and full-payment checkouts can both be paid for the same quote". A staff quote far enough out
--   offers two ways to pay (a deposit, or the full amount). Each catering_payments row got its own hosted
--   Stripe Checkout Session and nothing closed the first when the second was opened, so BOTH stayed payable
--   for a day and both charges were accepted: a deposit AND the full total for one order.
--
-- WHAT: exactly FOUR objects — one index, two functions, one column.
--   (1) create unique index catering_payments_one_open_checkout
--         on public.catering_payments (quote_id)
--         where status = 'due' and provider_session_id is not null;
--       "At most one still-due payment intent per quote may point at a Checkout Session." A session id on a
--       due row is a LIVE PAYMENT SURFACE — a URL the customer can pay into right now — so this is the
--       database saying a quote has at most one of those at a time.
--   (2) create function public.catering_payment_attach_checkout(p_payment_id uuid, p_quote_id uuid,
--         p_amount_cents integer, p_session_id text) returns text
--       (review r3 of this wave.) The ONE writer that records a minted Checkout Session on its intent, and
--       the place "may this quote still be collected on?" is decided — under the quote's own row lock, so a
--       settlement cannot land between the question and the write. See the section below.
--   (3) alter table public.catering_payments add column settlement_cleanup_at timestamptz;
--       (review r6 of this wave.) THE DURABLE MARKER OF A FINISHED SETTLEMENT. Recording money is a flip
--       (`due -> paid`) followed by cleanup: void the order's other deposit / full intent, close the order's
--       other checkouts. A delivery can be cut off between the two, and two deliveries can overlap. "Is the
--       cleanup still owed?" used to be inferred from WHICH delivery inserted the Stripe ledger row; the one
--       that inserted it could stamp `already_advanced` while the one that flipped the row had died before
--       the cleanup — and nothing ever looked again. Now it is a fact on the payment row: NULL = the cleanup
--       has not been confirmed complete, and ANY delivery (or a second "Mark paid" press) that finds the
--       money recorded runs the idempotent cleanup again; a timestamp = every sibling void landed and every
--       other checkout was confirmed closed. It is written once, by compare-and-set (NULL -> now), by the app
--       (lib/catering/payment-sessions.ts `markSettlementCleanupDone`). See the section below.
--   (4) create function public.catering_payment_checkout_ready() returns boolean
--       (review r6.) The app's ONE question before it lets anything reach Stripe: "is this file applied?"
--       True only while the three objects above all exist. PostgREST answers PGRST202 when the function is
--       not there, and the app REFUSES the pay tap on that answer — it opens no checkout. See the next but
--       one section.
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
-- ── WHY A FUNCTION AS WELL: SETTLEMENT RACING A CHECKOUT (review r3, P1) ─────────────────────────
-- The index sees DUE rows that hold a session. It cannot see the two facts that made a second charge possible:
--   · A PAID SIBLING. A full-amount request passed the app's already-paid gate; the deposit's webhook then
--     landed (the deposit row is `paid` — outside the index); the request resumed, raised its intent and
--     attached a checkout. Deposit + the whole total, for one order.
--   · A VOID INTENT WHOSE CHECKOUT WAS NEVER CONFIRMED CLOSED. A revise that makes the deposit zero voids
--     the deposit intent; when retiring its session failed, the row is `void` WITH the session id — outside
--     the index, still payable at Stripe — and a second checkout opened beside it.
-- Both are "read, then write" with a gap, and a gap is closed by a lock, not by reading more carefully. So
-- the attach is a function, and it takes, in this order:
--   1. the QUOTE row FOR UPDATE. Every insert into catering_payments for this quote, and every move of a
--      payment onto it (a revise's carry), runs a foreign-key check that needs FOR KEY SHARE on this row —
--      which FOR UPDATE blocks. So no payment can ARRIVE on the quote while the function decides. (A revise
--      superseding the quote waits too, and the function re-reads `superseded_at` under the lock.)
--   2. EVERY payment row of the quote FOR UPDATE, in id order. A status flip — a webhook's or a person's
--      `due -> paid`, a void — is an UPDATE of one of these rows and waits for the function to commit; one
--      already in flight makes the function wait for IT, and the function then reads the committed result
--      (each statement of a READ COMMITTED function takes a fresh snapshot).
-- Only then does it read, and it answers ONE word (the app maps each to a refusal; none raises):
--   not_payable         the quote is gone or superseded, or the intent is on another quote / at another amount
--   not_due             the intent is gone, or no longer `due`
--   in_progress         the intent already holds a session (another request attached first)
--   already_paid        ANY payment of the quote is `paid`
--   session_unresolved  another `due` OR `void` intent of the quote still names a session
--   attached            none of the above: provider = 'stripe', provider_session_id = p_session_id written
-- A settlement therefore lands entirely BEFORE the attach (which answers already_paid) or entirely AFTER it
-- (and the app's settlement paths then retire the checkout they find: lib/catering/payment-sessions.ts).
-- LOCK ORDER: quote row, then payment rows. Nothing else takes a quote row lock and then waits on a payment
-- row of another transaction that is itself waiting on that quote row: the settlement writers lock one
-- payment row and no quote; a carry locks one payment row and then needs KEY SHARE on the TARGET quote, and
-- that row is not yet in this function's scan (its committed version is still on the old revision). A
-- residual 40P01 / 55P03 is answered by the app as "another checkout is in progress" (409), never a charge.
--
-- THE INDEX STAYS DUE-ONLY, ON PURPOSE. Widening it to void rows would make the SECOND unresolved void row
-- of a quote a 23505 on the carry's own void write, and wedge a family's reconciliation until someone
-- cleaned Stripe by hand. The void rule is a CHECK inside the function instead, where a refusal is a 409
-- for one request, not a constraint a healing write can trip over.
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
-- ── THE SETTLEMENT MARKER: WHAT `settlement_cleanup_at` MEANS, EXACTLY (review r6, P1) ───────────
--   NULL on a `paid` row   the settlement's after-flip work is NOT confirmed complete. Either it has not run
--                          to its end (a delivery cut off after its flip), or it ran and something could not
--                          be confirmed (a checkout Stripe would not confirm closed, an order that could not
--                          be read) — in which case a person was told (ledger outcome `paid_needs_review`,
--                          audit row, staff email) and the unresolved checkout keeps its session id on its
--                          row. Whoever next finds this row paid runs the cleanup again: it is idempotent.
--   a timestamp            the cleanup is DONE: every other due deposit / full intent of the order was voided
--                          (or there was none), every other checkout was confirmed closed or is already
--                          landing, and the whole family was looked at. Only then may a Stripe delivery that
--                          finds its charge already on the row answer `already_advanced`.
--   Written ONCE, NULL -> now, guarded on `status in ('paid', 'refunded')`; never cleared, never rewritten.
--   The run whose write lands is the one that sends the ordinary "payment received" report, so two
--   overlapping deliveries report it once.
--   THE MARKER ALONE OWNS THE CLEANUP — NOT THE MONEY STATUS (review r8, P1). Rounds r6 / r7 guarded the
--   write on `status = 'paid'` and read "NULL on a `paid` row" at every gate. A settlement can apply a
--   whole-charge refund to its own row before its cleanup is finished (a refund Stripe reported before the
--   payment), and the row then fell out of every gate with a voided intent's checkout still attached and
--   payable — for good. So: NULL on a row MONEY WAS RECORDED ON (`paid`, or `refunded` since) = cleanup owed,
--   and such a row takes the marker when the cleanup is done. The app writes this column and nothing else in
--   that statement: a refunded row stays refunded. A `due` or `void` row has had no settlement; it owes no
--   cleanup and never takes the marker. (The rule is the app's — lib/catering/payment-sessions.ts
--   `SETTLED_PAYMENT_STATUSES` — and no object in this file changed for it: the column carries no CHECK.)
--   EXISTING ROWS keep NULL. Prod has never had Stripe keys, so every paid row there was recorded by hand
--   and names no checkout: a second "Mark paid" press on one finds nothing to close and stamps it. No
--   backfill is run — the apply writes no row.
--
-- ── THE APP FAILS CLOSED WITHOUT THIS FILE: APPLY 0303 BEFORE ANY STRIPE KEY IS SET (review r6) ──
-- Rounds r3–r5 kept a second, lock-free attach for a database without this file: write the session, re-read
-- the quote, undo if something had turned up. Review r6 broke it (a request that re-used the session before
-- the undo walked away with a live checkout the row had forgotten), and a path that only exists to be raced
-- is not worth keeping: STRIPE IS DORMANT IN PROD — no key is set — so nothing is lost by requiring the lock.
--   · The pay tap asks `catering_payment_checkout_ready()` BEFORE it retires, re-uses or mints anything at
--     Stripe. PGRST202 / 42883 (not applied) or anything but `true` → 503 `payment_unavailable` ("Payment is
--     temporarily unavailable"), no Stripe call, no session. The same answer from the attach itself closes
--     the session just minted and refuses.
--   · A shop with NO Stripe credentials never asks: the pay tap records the intent and shows the stub
--     message exactly as before, and "Mark paid" works exactly as before (its marker write is best-effort).
--   · The webhook: a paid flip never depends on this file. A delivery that finds its charge ALREADY on the
--     row reads `settlement_cleanup_at`; without the column that read fails, the event is `processing_failed`
--     (500) and Stripe redelivers until the file is applied. (Review r7: the delivery that MADE the flip
--     cannot write the marker either, so it answers `settlement_incomplete` — also a 500, also redelivered.)
-- ORDER OF ROLLOUT: (1) apply this file (sim, then prod), (2) deploy, (3) only then may Stripe keys be set.
-- With no key set the order of (1) and (2) does not matter.
--
-- NO DATA IS WRITTEN, MOVED OR DELETED BY THE APPLY. No table or policy is created or changed; ONE nullable
-- column is added, with no default, so no existing row is rewritten. `catering_payments` keeps the posture
-- 0127 gave it (RLS enabled, no policies, service-role only) and its table grants are untouched. The one
-- UPDATE in this file is inside the attach function's body and runs only when the app calls it.
-- PRIVILEGE CEILING (the 0257 / 0300 pattern): the attach function is SECURITY DEFINER with
-- `search_path = pg_catalog, public`; the readiness function reads the catalog only and is SECURITY INVOKER
-- with the same pinned search_path. For BOTH, EXECUTE is revoked from PUBLIC, anon, authenticated and
-- service_role and granted back to service_role ONLY, and the post-flight asserts exactly that (a function
-- left executable by `authenticated` is callable by any staff cookie with curl — the 0189 lesson).
--
-- EXISTING ROWS: prod has never had Stripe keys (the leg is dormant), so no prod row carries a
--   `provider_session_id` and the index builds over nothing. The sim may hold test sessions. The pre-flight
--   DATA CHECK refuses, naming the count, if any quote already has two due rows with a session — it does
--   not pick a winner. Resolve those by hand first (expire the stale session in the Stripe dashboard, then
--   set that row's provider_session_id to null) and re-apply.
--
-- DEPENDS ON: 0120 (catering_quotes.superseded_at), 0127 (catering_payments), 0130 (catering_payments_one_due),
--   0204 (provider_session_id).
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
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'catering_payment_attach_checkout' order by 1;
--     -- service_role EXECUTE (plus the owner); NOT anon, NOT authenticated, NOT PUBLIC
--   select prosecdef, proconfig from pg_proc where oid = 'public.catering_payment_attach_checkout(uuid,uuid,integer,text)'::regprocedure;
--     -- t, {"search_path=pg_catalog, public"}
--   select public.catering_payment_checkout_ready();                                             -- t
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'catering_payments' and column_name = 'settlement_cleanup_at';
--     -- settlement_cleanup_at | timestamp with time zone | YES | (null)
--   select count(*) from public.catering_payments where settlement_cleanup_at is not null;       -- 0
--
-- ROLLBACK (if ever needed). FIRST remove every Stripe key (the app then never asks for a checkout); with a
-- key still set, every pay tap answers 503 the moment the readiness function is gone — it never falls back
-- to an unlocked attach. Then, in this order:
--   drop function public.catering_payment_checkout_ready();
--   drop function public.catering_payment_attach_checkout(uuid, uuid, integer, text);
--   drop index public.catering_payments_one_open_checkout;
--   alter table public.catering_payments drop column settlement_cleanup_at;

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
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'catering_payment_attach_checkout') then
    raise exception '0303: catering_payment_attach_checkout already exists: refusing a second apply';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'catering_payment_checkout_ready') then
    raise exception '0303: catering_payment_checkout_ready already exists: refusing a second apply';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'catering_payments'
                and column_name = 'settlement_cleanup_at') then
    raise exception '0303: catering_payments.settlement_cleanup_at already exists: refusing a second apply';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'catering_quotes'
                    and column_name = 'superseded_at') then
    raise exception '0303: 0120 (catering_quotes.superseded_at) must be applied first';
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

-- ── THE ATTACH FUNCTION (review r3) ─────────────────────────────────────────────────────────────
create function public.catering_payment_attach_checkout(
  p_payment_id   uuid,
  p_quote_id     uuid,
  p_amount_cents integer,
  p_session_id   text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_superseded timestamptz;
  v_pay        public.catering_payments%rowtype;
begin
  if p_payment_id is null or p_quote_id is null or p_amount_cents is null
     or p_session_id is null or btrim(p_session_id) = '' then
    raise exception 'catering_payment_attach_checkout: invalid_arguments' using errcode = '22023';
  end if;

  -- 1. THE QUOTE ROW. FOR UPDATE (not NO KEY UPDATE) on purpose: it must conflict with the FOR KEY SHARE a
  --    payment's foreign-key check takes, so nothing can be inserted on, or moved onto, this quote until
  --    this transaction ends.
  select q.superseded_at into v_superseded
    from public.catering_quotes q where q.id = p_quote_id for update;
  if not found then
    return 'not_payable';
  end if;

  -- 2. EVERY PAYMENT ROW OF THE QUOTE. A status flip in flight is waited for; one that starts now waits for us.
  perform 1 from public.catering_payments p where p.quote_id = p_quote_id order by p.id for update;

  if v_superseded is not null then
    return 'not_payable';
  end if;

  -- 3. THE INTENT, as it is NOW (a fresh snapshot, after the locks).
  select * into v_pay from public.catering_payments p where p.id = p_payment_id for update;
  if not found or v_pay.status <> 'due' then
    return 'not_due';
  end if;
  if v_pay.quote_id <> p_quote_id or v_pay.amount_cents <> p_amount_cents then
    return 'not_payable';
  end if;
  if v_pay.provider_session_id is not null then
    return 'in_progress';
  end if;

  -- 4. THE QUOTE'S OTHER MONEY. Anything paid: both of the portal's options are priced for an UNPAID quote.
  if exists (select 1 from public.catering_payments p
              where p.quote_id = p_quote_id and p.status = 'paid') then
    return 'already_paid';
  end if;
  --    A session id on a due OR void row is a checkout nobody has confirmed closed.
  if exists (select 1 from public.catering_payments p
              where p.quote_id = p_quote_id and p.id <> p_payment_id
                and p.status in ('due', 'void') and p.provider_session_id is not null) then
    return 'session_unresolved';
  end if;

  update public.catering_payments
     set provider = 'stripe', provider_session_id = p_session_id
   where id = p_payment_id;
  return 'attached';
end
$$;

comment on function public.catering_payment_attach_checkout(uuid, uuid, integer, text) is
  '0303: the ONE writer that records a minted Stripe Checkout Session on its due intent. Locks the quote row '
  '(FOR UPDATE) and every payment row of the quote, then answers one word: attached | already_paid | '
  'session_unresolved | in_progress | not_due | not_payable. A settlement cannot land between its checks '
  'and its write (audit W02 review r3). service_role only; lib/portal/quotes.ts attachCheckoutSession.';

-- PRIVILEGE CEILING: nobody but service_role, and say so twice (revoke, then assert in the post-flight).
revoke all on function public.catering_payment_attach_checkout(uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.catering_payment_attach_checkout(uuid, uuid, integer, text) to service_role;

-- ── THE SETTLEMENT MARKER (review r6) ───────────────────────────────────────────────────────────
-- Nullable, no default: existing rows are not rewritten and every one of them reads "not confirmed".
alter table public.catering_payments add column settlement_cleanup_at timestamptz;

comment on column public.catering_payments.settlement_cleanup_at is
  '0303: when this SETTLED payment''s cleanup was confirmed complete (the order''s other deposit / '
  'full intent voided, its other checkouts confirmed closed, the whole quote family looked at). NULL on a '
  'paid OR refunded row = not confirmed: whoever next finds it runs the idempotent cleanup again (a Stripe '
  'redelivery, an overlapping delivery, a second "Mark paid" press). Written once, NULL -> now, guarded on '
  'status in (paid, refunded) (lib/catering/payment-sessions.ts markSettlementCleanupDone); never cleared, '
  'and independent of the money status: a refund neither sets nor clears it. A Stripe delivery answers '
  'already_advanced only when this is set (audit W02 review r6, r8).';

-- ── THE READINESS FUNCTION (review r6) ──────────────────────────────────────────────────────────
-- "Is 0303 applied, whole?" The app asks this before anything reaches Stripe and refuses on any answer but
-- true — including PostgREST's PGRST202 for a function that does not exist. It reads the catalog only.
create function public.catering_payment_checkout_ready() returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select to_regprocedure('public.catering_payment_attach_checkout(uuid,uuid,integer,text)') is not null
     and exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'catering_payments_one_open_checkout')
     and exists (select 1 from pg_attribute a
                  where a.attrelid = 'public.catering_payments'::regclass
                    and a.attname = 'settlement_cleanup_at' and not a.attisdropped);
$$;

comment on function public.catering_payment_checkout_ready() is
  '0303: true while the whole of 0303 is in place (the attach function, the one-open-checkout index, the '
  'settlement marker column). The pay path asks it before any Stripe call and FAILS CLOSED on anything but '
  'true — PGRST202 included (audit W02 review r6: there is no unlocked attach to fall back to). service_role '
  'only; lib/portal/quotes.ts requireCheckoutSchema.';

revoke all on function public.catering_payment_checkout_ready()
  from public, anon, authenticated, service_role;
grant execute on function public.catering_payment_checkout_ready() to service_role;

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

-- ── POST-FLIGHT: the function exists once, as a definer with a pinned search_path, service_role only ──
do $$
declare
  f regprocedure := to_regprocedure('public.catering_payment_attach_checkout(uuid,uuid,integer,text)');
begin
  if f is null then
    raise exception '0303: catering_payment_attach_checkout was not created';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'catering_payment_attach_checkout') <> 1 then
    raise exception '0303: catering_payment_attach_checkout has more than one signature';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = f and p.prosecdef
                    and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=pg_catalog, public')) then
    raise exception '0303: catering_payment_attach_checkout is not SECURITY DEFINER with search_path = pg_catalog, public';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE')
     or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0303: catering_payment_attach_checkout privilege ceiling is not held (service_role only)';
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
    raise exception '0303: catering_payment_attach_checkout is executable by PUBLIC';
  end if;
end $$;

-- ── POST-FLIGHT: the marker column is nullable with no default and no row carries it; the readiness
--    function exists once, behind the same ceiling, and already answers true ──────────────────────
do $$
declare
  r regprocedure := to_regprocedure('public.catering_payment_checkout_ready()');
  v_nullable text;
  v_default  text;
  v_type     text;
begin
  select is_nullable, column_default, data_type into v_nullable, v_default, v_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'catering_payments' and column_name = 'settlement_cleanup_at';
  if not found then
    raise exception '0303: catering_payments.settlement_cleanup_at was not created';
  end if;
  if v_nullable <> 'YES' or v_default is not null or v_type <> 'timestamp with time zone' then
    raise exception '0303: catering_payments.settlement_cleanup_at is not a nullable timestamptz with no default';
  end if;
  if exists (select 1 from public.catering_payments where settlement_cleanup_at is not null) then
    raise exception '0303: the apply wrote a settlement marker: refusing';
  end if;
  if r is null then
    raise exception '0303: catering_payment_checkout_ready was not created';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'catering_payment_checkout_ready') <> 1 then
    raise exception '0303: catering_payment_checkout_ready has more than one signature';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = r and not p.prosecdef
                    and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=pg_catalog, public')) then
    raise exception '0303: catering_payment_checkout_ready is not SECURITY INVOKER with search_path = pg_catalog, public';
  end if;
  if has_function_privilege('anon', r, 'EXECUTE')
     or has_function_privilege('authenticated', r, 'EXECUTE')
     or not has_function_privilege('service_role', r, 'EXECUTE') then
    raise exception '0303: catering_payment_checkout_ready privilege ceiling is not held (service_role only)';
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = r and a.grantee = 0) then
    raise exception '0303: catering_payment_checkout_ready is executable by PUBLIC';
  end if;
  if public.catering_payment_checkout_ready() is not true then
    raise exception '0303: catering_payment_checkout_ready does not answer true after the apply';
  end if;
end $$;

commit;
