-- Migration 0303_catering_payments_one_open_checkout
-- AUTHORED 2026-11-14. NOT YET APPLIED — file only; apply via MCP after review (sim first, prod on Juan's word, AFTER 0204).
-- Provenance: bug audit 2026-11-14, wave W02 "Card payments and quote payability (Stripe)", finding B035 —
--   "Deposit and full-payment checkouts can both be paid for the same quote". A staff quote far enough out
--   offers two ways to pay (a deposit, or the full amount). Each catering_payments row got its own hosted
--   Stripe Checkout Session and nothing closed the first when the second was opened, so BOTH stayed payable
--   for a day and both charges were accepted: a deposit AND the full total for one order.
--
-- WHAT: exactly TWO objects — one index, one function.
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
-- ── THE APP WORKS BEFORE THIS IS APPLIED ─────────────────────────────────────────────────────────
-- Nothing reads this index and no code path requires it. The app CALLS the function and, when PostgREST
-- answers PGRST202 (no such function = this file is not applied), falls back to its own sequence: the
-- compare-and-set attach it always did, followed by a re-read of the same two facts (anything paid? any
-- other unresolved checkout?) and an undo when either turned true. That is "write, then look again" on
-- both sides of every race — each side's later read sees the other's earlier write — so the app refuses in
-- both states; this migration makes the refusal a single decision under a lock instead of two writes and
-- an undo. There is no ordering requirement between this migration and the deploy.
--
-- NO DATA IS WRITTEN, MOVED OR DELETED BY THE APPLY. No table, column or policy is created or changed:
-- `catering_payments` keeps the posture 0127 gave it (RLS enabled, no policies, service-role only). The one
-- UPDATE in this file is inside the function body and runs only when the app calls it.
-- PRIVILEGE CEILING (the 0257 / 0300 pattern): the function is SECURITY DEFINER with
-- `search_path = pg_catalog, public`; EXECUTE is revoked from PUBLIC, anon, authenticated and service_role
-- and granted back to service_role ONLY, and the post-flight asserts exactly that (a function left
-- executable by `authenticated` is callable by any staff cookie with curl — the 0189 lesson).
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
--
-- ROLLBACK (if ever needed; restores the pre-0303 behaviour exactly, the app needs no change — it falls
-- back the moment the function is gone):
--   drop function public.catering_payment_attach_checkout(uuid, uuid, integer, text);
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
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'catering_payment_attach_checkout') then
    raise exception '0303: catering_payment_attach_checkout already exists: refusing a second apply';
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

commit;
