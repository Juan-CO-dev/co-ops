-- Migration 0357_catering_refund_requests
-- AUTHORED 2026-11-23 (refund build, CC bench Opus, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- NUMBER: 0356 is the highest on main; 0355 is reserved for the all-shops access build (co-ops-wt/.mig-claims), so this
-- file takes 0357 (claimed there by the refund build).
-- Juan 2026-11-23: "Yes" to an in-app refund step when a catering order is rejected / cancelled / lost after the
-- customer paid. Ships DARK: the app refuses every refund unless CATERING_REFUNDS=1 (lib/catering/refunds-shared.ts).
--
-- WHAT THIS IS. The ledger of refunds a PERSON asked CO-OPS to make at Stripe, and the one function that reserves one.
-- PURELY ADDITIVE: one new table, four new functions, one trigger on the new table. No existing table, function,
-- trigger, policy or grant is altered or re-emitted (catering_payments, catering_payment_refund_events and the Stripe
-- webhook are untouched: the webhook's `charge.refunded` path still records what Stripe did and still moves a payment
-- to `refunded` only when the whole charge is refunded — the report and the digest keep reading exactly that).
--
--   TABLE catering_refund_requests   one row per (confirm tap, payment). Its id is the anchor of the Stripe
--                                    Idempotency-Key (`catering-refund:<id>`), so every retry of one row is the same
--                                    Stripe request and a row can become at most one Stripe refund.
--     status pending    reserved; Stripe's answer is not confirmed (in flight, or the call failed in a way that might
--                       have landed: no response, 5xx, 409, 429). COUNTS AGAINST what is refundable. Retryable.
--            submitted  Stripe accepted it and the refund is `pending` / `requires_action` at Stripe. Counts.
--            succeeded  Stripe says `succeeded`. Counts.
--            failed     Stripe refused it, or the refund `failed` / was `canceled`. Counts for nothing. Terminal.
--     unique (client_token, payment_id): a second tap with the same token is the same request (see the function).
--   FUNCTIONS
--     catering_refund_actor_ok(actor, shop)   THE actor rule on the locked users row: owner / cgs at any shop;
--                                             moo / catering_mgr with an ACTIVE membership at that shop; anyone else
--                                             (gm, agm, prep_mgr, social_media_mgr, every lower role) and anyone
--                                             inactive: false. The conservative gate (Juan to confirm, see the PR).
--     catering_refund_figures(payment)        what one payment can still give back, from what we KNOW:
--                                             captured  = the CHARGE amount Stripe reported (the largest
--                                                         catering_payment_refund_events.charge_amount_cents) when known --
--                                                         the charge is the money, in both directions (review r1: a $300
--                                                         charge on a $200 row is $300 the customer paid) -- else the row's;
--                                             refunded  = the larger of: Stripe's cumulative amount_refunded (the
--                                                         webhook's events); and, BY IDENTITY (review r4, r5), our own
--                                                         submitted + succeeded requests PLUS the refunds CO-OPS did NOT
--                                                         make (no metadata.refund_request_id) that Stripe listed for the
--                                                         charge when one of our refunds was recorded (the largest such
--                                                         listing, outside_refunded_seen_cents). A dashboard refund and any
--                                                         number of app refunds the webhook has not reported yet therefore
--                                                         all count, each once;
--                                             in_flight = our own pending requests;
--                                             refundable = captured - refunded - in_flight, never below 0; 0 unless the
--                                                         row is `paid`, provider 'stripe', with a PaymentIntent.
--                                             The app's pure twin is refundFigures (lib/catering/refunds-shared.ts).
--     catering_refund_reserve(...)            THE one writer of the table (service_role only). Validates the input,
--                                             locks the order's Stripe-paid payment rows, re-checks the actor, replays
--                                             a token it has seen, recomputes every figure UNDER THE LOCKS, allocates
--                                             the amount (balance -> full -> deposit, newest first), refuses an
--                                             over-refund by name, inserts the rows and their audit row
--                                             (`catering.refund.request`, destructive) in the same transaction.
--                                             The amount is REQUIRED (review r1): it is the number the person saw
--                                             and confirmed. "Refund everything" is never re-read at execution, so a
--                                             payment that lands between the screen and the tap cannot grow it.
--     catering_refund_claim(request)          THE one sender lock for a row (review r1): an exclusive, EXPIRING claim
--                                             (claim_token + claimed_until, 3 minutes, the database clock) on a
--                                             pending or submitted row. A second press while a claim is live gets
--                                             nothing and sends nothing. Every outcome the app writes is fenced on
--                                             the claim_token it holds (and releases it), so a press that outlived
--                                             its claim can never overwrite what the newer one recorded. Sending
--                                             counts an attempt and stamps first_attempt_at (the 24-hour window).
--   TRIGGER catering_refund_requests_guard   a row's money facts never change (amount, payment, token, reason, who),
--                                            a terminal row never changes status, a Stripe refund id once set never
--                                            changes, and a status only moves forward
--                                            (pending -> submitted | succeeded | failed; submitted -> succeeded | failed).
--
-- LOCK ORDER: the order's payment rows FOR NO KEY UPDATE, in id order, and nothing else. Two reserves on one order
--   queue there; the webhook's refund-event insert (FK KEY SHARE) does not wait on them; the webhook's paid -> refunded
--   UPDATE waits for a reserve to commit (milliseconds). Every figure is read AFTER the locks (READ COMMITTED: each
--   statement sees what committed before it), so the second of two simultaneous taps sees the first one's rows.
-- NOT A STRIPE GUARD ON ITS OWN. Stripe itself refuses a refund above what is left on a charge ("This method will raise
--   an error ... when trying to refund more money than is left on a charge" -- docs.stripe.com/api/refunds/create); this
--   function is what stops CO-OPS asking, and what keeps two people from splitting one deposit twice.
--
-- PRIVILEGES: the table is deny-all RLS with no policies; service_role holds SELECT and UPDATE on the outcome and claim
--   columns only (no INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER). The functions are service_role EXECUTE only.
-- DEPENDS ON: 0127 (catering_payments), 0120 (catering_quotes.root_id), 0333 (catering_payment_refund_events), users,
--   user_locations, audit_log.
-- PROOF: scripts/sql-harness-0357.mjs (PGlite, the REAL file), CI-pinned by tests/catering-refund-0357-migration.test.ts.
-- ROLLBACK (only while the table is empty): drop trigger catering_refund_requests_guard on public.catering_refund_requests;
--   drop function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text);
--   drop function public.catering_refund_claim(uuid);
--   drop function public.catering_refund_figures(uuid); drop function public.catering_refund_actor_ok(uuid, uuid);
--   drop function public.catering_refund_requests_guard(); drop table public.catering_refund_requests;
--   Once a row exists it is money history: never delete it.
begin;

do $$
declare t text;
begin
  foreach t in array array['catering_payments', 'catering_quotes', 'catering_payment_refund_events', 'users',
                           'user_locations', 'locations', 'audit_log'] loop
    if to_regclass('public.' || t) is null then raise exception '0357: public.% is missing', t; end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_quotes'
                  and column_name = 'root_id') then
    raise exception '0357: public.catering_quotes.root_id is missing';
  end if;
  if to_regclass('public.catering_refund_requests') is not null then
    raise exception '0357: public.catering_refund_requests already exists';
  end if;
  foreach t in array array['catering_refund_actor_ok', 'catering_refund_figures', 'catering_refund_reserve',
                           'catering_refund_claim', 'catering_refund_requests_guard'] loop
    if exists (select 1 from pg_proc where proname = t and pronamespace = 'public'::regnamespace) then
      raise exception '0357: function public.% already exists', t;
    end if;
  end loop;
end $$;

create table public.catering_refund_requests (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.catering_payments(id),
  quote_id           uuid not null references public.catering_quotes(id),
  location_id        uuid not null references public.locations(id),
  client_token       uuid not null,
  amount_cents       bigint not null check (amount_cents > 0),
  reason_code        text not null check (reason_code in
                       ('customer_cancelled', 'event_lost', 'quote_declined', 'duplicate_charge', 'service_issue', 'other')),
  reason_note        text check (reason_note is null or (length(reason_note) between 1 and 500)),
  trigger_kind       text not null check (trigger_kind in ('panel', 'declined', 'lost')),
  status             text not null default 'pending' check (status in ('pending', 'submitted', 'succeeded', 'failed')),
  stripe_refund_id   text unique check (stripe_refund_id is null or stripe_refund_id ~ '^(re|pyr)_[A-Za-z0-9_]{1,250}$'),
  stripe_status      text check (stripe_status is null or length(stripe_status) <= 40),
  last_error_code    text check (last_error_code is null or length(last_error_code) <= 80),
  last_error_message text check (last_error_message is null or length(last_error_message) <= 500),
  attempts           integer not null default 0 check (attempts >= 0),
  first_attempt_at   timestamptz,
  requested_by       uuid not null references public.users(id),
  requested_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  settled_at         timestamptz,
  claim_token        uuid,
  claimed_until      timestamptz,
  -- The refunds on this charge that CO-OPS did NOT make (Stripe lists them with no metadata.refund_request_id; failed
  -- and canceled ones excluded), as listed in the attempt that recorded THIS refund. Set once, with the acceptance.
  outside_refunded_seen_cents bigint check (outside_refunded_seen_cents is null or outside_refunded_seen_cents >= 0),
  constraint catering_refund_requests_one_per_tap unique (client_token, payment_id),
  constraint catering_refund_requests_other_needs_note check (reason_code <> 'other' or reason_note is not null)
);
create index catering_refund_requests_payment on public.catering_refund_requests (payment_id, status);
create index catering_refund_requests_quote on public.catering_refund_requests (quote_id, requested_at);

alter table public.catering_refund_requests enable row level security;
revoke all on table public.catering_refund_requests from public, anon, authenticated, service_role;
grant select on table public.catering_refund_requests to service_role;
grant update (status, stripe_refund_id, stripe_status, last_error_code, last_error_message, updated_at, settled_at,
              claim_token, claimed_until, outside_refunded_seen_cents)
  on table public.catering_refund_requests to service_role;

create function public.catering_refund_requests_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.id is distinct from old.id or new.payment_id is distinct from old.payment_id
     or new.quote_id is distinct from old.quote_id or new.location_id is distinct from old.location_id
     or new.client_token is distinct from old.client_token or new.amount_cents is distinct from old.amount_cents
     or new.reason_code is distinct from old.reason_code or new.reason_note is distinct from old.reason_note
     or new.trigger_kind is distinct from old.trigger_kind or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if new.attempts < old.attempts or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if old.outside_refunded_seen_cents is not null and new.outside_refunded_seen_cents is distinct from old.outside_refunded_seen_cents then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('submitted', 'succeeded', 'failed'))
    or (old.status = 'submitted' and new.status in ('succeeded', 'failed'))) then
    raise exception 'refund_request_bad_transition' using errcode = 'P0001';
  end if;
  if old.status in ('succeeded', 'failed') and (new.stripe_status is distinct from old.stripe_status
     or new.last_error_code is distinct from old.last_error_code) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger catering_refund_requests_guard before update on public.catering_refund_requests
  for each row execute function public.catering_refund_requests_guard();

create function public.catering_refund_actor_ok(p_actor_id uuid, p_shop_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null then return false; end if;
  if v_role in ('owner', 'cgs') then return true; end if;
  if v_role in ('moo', 'catering_mgr') and p_shop_id is not null and exists (
       select 1 from public.user_locations m where m.user_id = p_actor_id and m.location_id = p_shop_id and m.active) then
    return true;
  end if;
  return false;
end $$;

create function public.catering_refund_figures(p_payment_id uuid,
  out o_captured bigint, out o_refunded bigint, out o_in_flight bigint, out o_refundable bigint, out o_eligible boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_pay record;
  v_charge bigint;
  v_cum bigint;
  v_done bigint;
  v_outside bigint;
begin
  select p.amount_cents, p.status, p.provider, p.provider_ref into v_pay from public.catering_payments p where p.id = p_payment_id;
  if not found then
    o_captured := 0; o_refunded := 0; o_in_flight := 0; o_refundable := 0; o_eligible := false; return;
  end if;
  select max(e.charge_amount_cents), max(e.cumulative_refunded_cents) into v_charge, v_cum
    from public.catering_payment_refund_events e where e.payment_id = p_payment_id;
  select coalesce(sum(r.amount_cents) filter (where r.status in ('submitted', 'succeeded')), 0),
         coalesce(sum(r.amount_cents) filter (where r.status = 'pending'), 0),
         coalesce(max(r.outside_refunded_seen_cents) filter (where r.status in ('submitted', 'succeeded')), 0)
    into v_done, o_in_flight, v_outside
    from public.catering_refund_requests r where r.payment_id = p_payment_id;
  o_captured := coalesce(v_charge, v_pay.amount_cents::bigint);
  o_refunded := greatest(coalesce(v_cum, 0), v_done + v_outside);
  o_eligible := v_pay.status = 'paid' and v_pay.provider = 'stripe' and coalesce(v_pay.provider_ref, '') ~ '^pi_[A-Za-z0-9_]+$';
  o_refundable := case when o_eligible then greatest(0, o_captured - o_refunded - o_in_flight) else 0 end;
end $$;

create function public.catering_refund_reserve(p_actor_id uuid, p_quote_id uuid, p_client_token uuid,
  p_amount_cents bigint, p_reason_code text, p_reason_note text, p_trigger text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_shop uuid;
  v_root uuid;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_ids uuid[];
  v_existing jsonb;
  v_existing_total bigint;
  v_existing_bad boolean;
  v_total bigint := 0;
  v_want bigint;
  v_left bigint;
  v_take bigint;
  v_row record;
  v_fig record;
  v_out jsonb := '[]'::jsonb;
  v_new uuid;
begin
  if p_actor_id is null or p_quote_id is null or p_client_token is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code not in
       ('customer_cancelled', 'event_lost', 'quote_declined', 'duplicate_charge', 'service_issue', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  if p_trigger is null or p_trigger not in ('panel', 'declined', 'lost') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long' using errcode = 'P0001'; end if;
  if p_reason_code = 'other' and v_note is null then raise exception 'note_required' using errcode = 'P0001'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;

  select q.location_id, coalesce(q.root_id, q.id) into v_shop, v_root from public.catering_quotes q where q.id = p_quote_id;
  if v_shop is null then raise exception 'quote_not_found' using errcode = 'P0001'; end if;
  if not public.catering_refund_actor_ok(p_actor_id, v_shop) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select u.role into v_role from public.users u where u.id = p_actor_id;

  -- (1) THE LOCKS: every payment row of the order (the whole quote family), in id order.
  select array_agg(p.id order by p.id) into v_ids
    from public.catering_payments p join public.catering_quotes q on q.id = p.quote_id
   where coalesce(q.root_id, q.id) = v_root;
  if v_ids is not null then
    perform 1 from public.catering_payments p where p.id = any(v_ids) order by p.id for no key update;
  end if;

  -- (2) A token already used: the same tap. Return what it made, or refuse a different ask under the same token.
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents,
                                               'status', r.status) order by r.requested_at, r.id), '[]'::jsonb),
         coalesce(sum(r.amount_cents), 0),
         coalesce(bool_or(not (r.payment_id = any(coalesce(v_ids, array[]::uuid[])))), false)
    into v_existing, v_existing_total, v_existing_bad
    from public.catering_refund_requests r where r.client_token = p_client_token;
  if jsonb_array_length(v_existing) > 0 then
    if v_existing_bad or p_amount_cents <> v_existing_total then
      raise exception 'token_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object('replay', true, 'location_id', v_shop, 'requests', v_existing);
  end if;

  -- (3) What is refundable now, under the locks.
  for v_row in
    select p.id from public.catering_payments p where p.id = any(coalesce(v_ids, array[]::uuid[]))
  loop
    select * into v_fig from public.catering_refund_figures(v_row.id);
    v_total := v_total + v_fig.o_refundable;
  end loop;
  if v_total <= 0 then raise exception 'nothing_refundable' using errcode = 'P0001'; end if;
  v_want := p_amount_cents;
  if v_want > v_total then
    raise exception 'over_refundable' using errcode = 'P0001', detail = v_total::text;
  end if;

  -- (4) Allocate: the balance first, then a full payment, then the deposit; newest first within a kind.
  v_left := v_want;
  for v_row in
    select p.id, p.kind, p.paid_at from public.catering_payments p where p.id = any(v_ids)
     order by case p.kind when 'balance' then 1 when 'full' then 2 else 3 end, p.paid_at desc nulls last, p.id
  loop
    exit when v_left <= 0;
    select * into v_fig from public.catering_refund_figures(v_row.id);
    continue when v_fig.o_refundable <= 0;
    v_take := least(v_left, v_fig.o_refundable);
    insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents,
                                                  reason_code, reason_note, trigger_kind, requested_by)
      values (v_row.id, p_quote_id, v_shop, p_client_token, v_take, p_reason_code, v_note, p_trigger, p_actor_id)
      returning id into v_new;
    insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (p_actor_id, v_role, 'catering.refund.request', 'catering_refund_requests', v_new,
              jsonb_build_object('quote_id', p_quote_id, 'payment_id', v_row.id, 'location_id', v_shop,
                                 'amount_cents', v_take, 'requested_total_cents', v_want, 'refundable_before_cents', v_total,
                                 'reason_code', p_reason_code, 'trigger', p_trigger, 'has_note', v_note is not null,
                                 'full', p_amount_cents = v_total), true);
    v_out := v_out || jsonb_build_object('id', v_new, 'payment_id', v_row.id, 'amount_cents', v_take, 'status', 'pending');
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then raise exception 'over_refundable' using errcode = 'P0001', detail = v_total::text; end if;
  return jsonb_build_object('replay', false, 'location_id', v_shop, 'requests', v_out);
end $$;

create function public.catering_refund_claim(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_out jsonb;
begin
  update public.catering_refund_requests r
     set claim_token = gen_random_uuid(),
         claimed_until = now() + interval '3 minutes',
         attempts = r.attempts + case when r.status = 'pending' then 1 else 0 end,
         first_attempt_at = case when r.status = 'pending' then coalesce(r.first_attempt_at, now()) else r.first_attempt_at end,
         updated_at = now()
   where r.id = p_request_id and r.status in ('pending', 'submitted') and (r.claimed_until is null or r.claimed_until < now())
  returning jsonb_build_object('claim_token', r.claim_token, 'attempts', r.attempts, 'first_attempt_at', r.first_attempt_at,
                               'status', r.status, 'claimed_until', r.claimed_until)
    into v_out;
  return v_out; -- null: the row is finished, or another press holds a live claim
end $$;

revoke all on function public.catering_refund_actor_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public.catering_refund_figures(uuid) from public, anon, authenticated;
revoke all on function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.catering_refund_claim(uuid) from public, anon, authenticated;
revoke all on function public.catering_refund_requests_guard() from public, anon, authenticated;
grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;
grant execute on function public.catering_refund_figures(uuid) to service_role;
grant execute on function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text) to service_role;
grant execute on function public.catering_refund_claim(uuid) to service_role;

commit;
