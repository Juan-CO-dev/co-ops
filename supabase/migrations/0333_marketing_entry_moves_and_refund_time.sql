-- Migration 0333_marketing_entry_moves_and_refund_time
-- AUTHORED 2026-11-16. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0289,
--   0292 and 0303).
-- Provenance: CO-OPS bug audit wave W26, bugs B139 + B140, found at 7494f738.
--   Plan: audit/plans/W26.md; owner decisions (decisions-resolved 2026-11-15): W26-2 b = add "remove this spend
--   entry"; W26-1 = the plan's recommendation (accept this migration for B140).
--
-- WHAT:
--   1. B139 — a CORRECTION finds its head BY ID, not by period, so it may MOVE an entry to another period (the
--      first-ad-spend date D moved, the scorecard's weeks moved with it, and the spend recorded for an old week
--      was stranded: creating the new week overlapped it, correcting it to the old week was misaligned, and
--      correcting it to the new week found "no head" there). record_marketing_manual_entry is re-emitted FROM 0289
--      (same signature; only the head lookup, the overlap rule and the voided-head handling change):
--        · create (p_corrects null): unchanged exact-period lookup, but a REMOVED (voided) head no longer counts as
--          an existing entry, so a removed week can be entered again;
--        · correct: p_corrects must be a LIVE head of the SAME series (kind, shop, platform), else
--          'correction_target_not_head'; its period may change; a correction of a removed head restores it;
--        · the overlap check now runs for EVERY kind (a moved email-list-size entry must not land on a day another
--          live entry holds) and ignores removed heads.
--   2. W26-2 b — "remove this spend entry": marketing_manual_entries.voided (default false) and the new writer
--      void_marketing_manual_entry(actor, entry, reason). A removal is an append-only CORRECTION row (corrects_id =
--      the head, reason required, the head's period and amount copied, voided = true) — nothing is deleted or
--      updated. Spend kinds only (meta_spend, promo_spend). Readers skip a voided head (lib/marketing/scorecard.ts).
--   3. The 0289 root unique index (kind, shop, platform, period_start, period_end WHERE corrects_id IS NULL) is
--      DROPPED. A correction may now move a series off its root's period and a removal frees a period, so "one root
--      per period" no longer means "one live entry per period"; it would refuse (unnamed 23505) a legitimate new
--      entry for a period an old, moved or removed chain started on. "At most one live entry per series per
--      period" is enforced as before by the writers: the per-series advisory lock, then the exact-period head
--      lookup and the overlap check, all under that lock.
--   4. B140 (review r1) — refunds are recorded PER EVENT: the new append-only table
--      public.catering_payment_refund_events, one row per Stripe `charge.refunded` event (primary key = Stripe's
--      event id, so a redelivery adds nothing), holding the payment, the event's own time (capped at now — the
--      paid_at rule) and the charge's CUMULATIVE amount_refunded. The webhook (lib/stripe/webhook.ts refund())
--      appends it for partial AND whole refunds, BEFORE the paid → refunded flip (unchanged). What one refund gave
--      back is derived at read time (lib/catering/refund-events-shared.ts: its cumulative minus the previous
--      cumulative of the same payment, ordered by the cumulative figure — review r2), and the daily catering digest reports every event on
--      the day it happened at that amount: $10 refunded Tuesday then the remaining $90 Wednesday reads $10 on
--      Tuesday and $90 on Wednesday (the first cut of this file stamped the payment row, which reported $100 on
--      the flip day and nothing for a partial). catering_payments is NOT altered.
--
-- EXISTING ROWS: marketing entries untouched (voided = false). Refund events are backfilled (review r2) from
--   (A) every `charge.refunded` delivery in the webhook ledger stripe_events — including the ones that wrote
--   no audit row (a partial refund delivered after the whole-charge refund, `no_paid_row`) — at the Stripe
--   EVENT's own time (`payload->>'created'`, capped at received_at), bound to the payment by its
--   payment_intent = provider_ref; then (B) every 'catering.payment.provider_refunded' audit row (A) did not
--   cover, at the audit row's occurred_at (its metadata carries no event time), marked
--   refunded_at_approximate = true and pulled back to no later than any higher-cumulative event of the same
--   payment. A row with no numeric cumulative figure or no payment we hold is skipped. No other row is written.
--
-- APP (same PR, W26): works before AND after this file is applied.
--   · The scorecard reads `voided` and, when the column is missing (42703), re-reads without it (nothing voided).
--   · The remove route answers 503 marketing_unavailable while void_marketing_manual_entry is missing.
--   · The Stripe refund writer appends the event and, when the table is missing (42P01 / PGRST205), appends
--     nothing; the status flip is exactly as before either way.
--   · The digest reads the events and, when the table is missing, falls back to the pre-0333 paid_at read.
--   Until this file is applied a correction still cannot move an entry (B139 stays open) and the digest keeps
--   missing later-day refunds (B140 stays open); nothing breaks.
--
-- DEPENDS ON: 0289 (marketing ledgers + writers + marketing_assert_actor), 0127 (catering_payments), 0204
--   (stripe_events, the backfill's event-time source), 0303
--   (settlement_cleanup_at — the payments table at its current shape).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select column_name, data_type from information_schema.columns where table_schema='public'
--    and table_name='audit_log' and column_name in ('action','resource_table','resource_id','metadata','occurred_at');
--   select count(*) from public.catering_payments where status = 'refunded';            -- report it in the PR
--   select count(*) from public.audit_log where action = 'catering.payment.provider_refunded';  -- backfill source (B)
--   select count(*), count(*) filter (where payload ? 'created') from public.stripe_events
--    where type = 'charge.refunded';                                                      -- backfill source (A)
--   select count(*) from public.marketing_manual_entries;                                 -- untouched
--   select md5(prosrc) from pg_proc where oid =
--     'public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)'::regprocedure;
--     -- equals the 0289 body (this file refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select to_regprocedure('public.void_marketing_manual_entry(uuid,uuid,text)');         -- not null
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema='public'
--    and routine_name in ('record_marketing_manual_entry','void_marketing_manual_entry') order by 1,2;  -- service_role (+ owner)
--   select count(*), count(*) filter (where refunded_at_approximate) from public.catering_payment_refund_events;
--     -- = the distinct backfill keys; report how many times are approximate (delivery time) in the PR
--   select privilege_type from information_schema.role_table_grants where table_name='catering_payment_refund_events'
--    and grantee='service_role';                                                           -- SELECT, INSERT only
--
-- PROOF: scripts/sql-harness-0333.mjs (PGlite: real 0273 → 0289 → 0292 → 0333, plus a minimal payments fixture),
--   CI-pinned by tests/marketing-entry-moves-migration.test.ts. The per-series lock is unchanged from 0289 (two
--   sessions queue on the same advisory key); no new lock, no sim lock script.
-- ROLLBACK: a new migration. The voided rows and the refund events are append-only evidence; never delete them.
begin;

do $$ begin
  if to_regprocedure('public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)') is null
    or to_regprocedure('public.marketing_assert_actor(uuid)') is null then
    raise exception '0333: 0289 not installed';
  end if;
  if to_regclass('public.catering_payments') is null then raise exception '0333: catering_payments missing'; end if;
  if to_regclass('public.stripe_events') is null then raise exception '0333: stripe_events missing (0204)'; end if;
  if exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_payments'
      and column_name = 'settlement_cleanup_at') is not true then
    raise exception '0333: apply 0303 first';
  end if;
  if exists(select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'marketing_manual_entries' and column_name = 'voided')
    or to_regclass('public.catering_payment_refund_events') is not null then
    raise exception '0333: already installed';
  end if;
  -- The re-emitted writer must still be 0289's: a later definer would be silently overwritten.
  if (select prosrc from pg_proc where oid =
      'public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)'::regprocedure)
      not like '%if p_corrects is distinct from v_head.id then raise exception ''correction_target_not_head''; end if;%' then
    raise exception '0333: record_marketing_manual_entry drifted from 0289; re-emit from the live body';
  end if;
end $$;

-- ── 1–3. Marketing entries ──────────────────────────────────────────────────────────────────────────────
-- No marketing write lands while the table changes shape (the writers take no table lock; this waits for them).
lock table public.marketing_manual_entries in share row exclusive mode;

alter table public.marketing_manual_entries
  add column voided boolean not null default false,
  add constraint marketing_manual_entries_void_is_correction check (not voided or corrects_id is not null);

drop index public.marketing_manual_entries_root;

create or replace function public.record_marketing_manual_entry(p_actor uuid, p_kind text, p_location_id uuid, p_platform text,
  p_from date, p_to date, p_amount_cents bigint, p_list_count integer, p_note text, p_corrects uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_head public.marketing_manual_entries%rowtype; v_id uuid;
begin
  perform public.marketing_assert_actor(p_actor);
  if p_kind is null or p_kind not in ('meta_spend','promo_spend','email_list_size') or p_from is null or p_to is null
    or p_to < p_from or p_to - p_from > 29 or length(p_note) > 200 or length(p_reason) > 300
    or (p_location_id is not null and not exists(select 1 from public.locations where id = p_location_id))
    or (p_kind = 'meta_spend' and p_location_id is not null)
    or (p_kind = 'promo_spend' and (p_platform is null or p_platform not in ('uber_eats','doordash','grubhub','other')))
    or (p_kind <> 'promo_spend' and p_platform is not null)
    or (p_kind = 'email_list_size' and (p_to <> p_from or p_list_count is null or p_list_count < 0 or p_amount_cents is not null))
    or (p_kind <> 'email_list_size' and (p_to <> p_from + 6 or p_amount_cents is null or p_amount_cents not between 0 and 100000000 or p_list_count is not null))
  then raise exception 'entry_invalid'; end if;
  -- Serialize the whole series so different overlapping periods cannot race.
  -- JSON encoding keeps nullable identity fields distinct without sentinel collisions.
  perform pg_advisory_xact_lock(hashtextextended('marketing:entry:' || jsonb_build_array(p_kind,p_location_id,p_platform)::text, 0));
  if p_corrects is null then
    -- Create: a live, not removed head at exactly this period means "correct it instead" (0289's rule).
    select e.* into v_head from public.marketing_manual_entries e
      where kind = p_kind and location_id is not distinct from p_location_id and platform is not distinct from p_platform
      and period_start = p_from and period_end = p_to and not e.voided
      and not exists(select 1 from public.marketing_manual_entries c where c.corrects_id = e.id);
    if v_head.id is not null then raise exception 'entry_exists_use_correct'; end if;
  else
    -- Correct (0333): the target is found BY ID and must be a live head of the SAME series. Its period may move
    -- (B139: the scorecard's weeks follow the first-ad-spend date). A removed head is restored by a correction.
    select e.* into v_head from public.marketing_manual_entries e
      where e.id = p_corrects
      and not exists(select 1 from public.marketing_manual_entries c where c.corrects_id = e.id);
    if v_head.id is null or v_head.kind <> p_kind or v_head.location_id is distinct from p_location_id
      or v_head.platform is distinct from p_platform then raise exception 'correction_target_not_head'; end if;
    if nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
  end if;
  -- Every kind (0333): a moved email-list-size entry must not land on a day another live entry holds.
  if exists(
    select 1 from public.marketing_manual_entries e
    where e.kind = p_kind and e.location_id is not distinct from p_location_id
      and e.platform is not distinct from p_platform
      and e.period_start <= p_to and e.period_end >= p_from
      and e.id is distinct from p_corrects
      and not e.voided
      and not exists(select 1 from public.marketing_manual_entries c where c.corrects_id = e.id)
  ) then raise exception 'entry_overlaps'; end if;
  insert into public.marketing_manual_entries(kind,location_id,platform,period_start,period_end,amount_cents,list_count,note,corrects_id,reason,recorded_by)
    values(p_kind,p_location_id,p_platform,p_from,p_to,p_amount_cents,p_list_count,p_note,p_corrects,nullif(btrim(p_reason),''),p_actor) returning id into v_id;
  return v_id;
end $$;

-- W26-2 b: remove a spend entry. An append-only correction row marked voided; the head's own facts are copied so
-- every 0289 table CHECK still holds and the history reads "this entry was removed, because <reason>".
create function public.void_marketing_manual_entry(p_actor uuid, p_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_series public.marketing_manual_entries%rowtype; v_head public.marketing_manual_entries%rowtype; v_id uuid;
begin
  perform public.marketing_assert_actor(p_actor);
  if p_entry is null or length(p_reason) > 300 then raise exception 'entry_invalid'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
  -- The series identity never changes along a chain, so it can be read before the lock.
  select e.* into v_series from public.marketing_manual_entries e where e.id = p_entry;
  if v_series.id is null then raise exception 'correction_target_not_head'; end if;
  if v_series.kind not in ('meta_spend','promo_spend') then raise exception 'entry_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketing:entry:' || jsonb_build_array(v_series.kind,v_series.location_id,v_series.platform)::text, 0));
  select e.* into v_head from public.marketing_manual_entries e
    where e.id = p_entry and not e.voided
    and not exists(select 1 from public.marketing_manual_entries c where c.corrects_id = e.id);
  if v_head.id is null then raise exception 'correction_target_not_head'; end if;
  insert into public.marketing_manual_entries(kind,location_id,platform,period_start,period_end,amount_cents,list_count,note,corrects_id,reason,recorded_by,voided)
    values(v_head.kind,v_head.location_id,v_head.platform,v_head.period_start,v_head.period_end,v_head.amount_cents,v_head.list_count,
      v_head.note,v_head.id,btrim(p_reason),p_actor,true) returning id into v_id;
  return v_id;
end $$;

-- ── 4. Catering refund events (B140, review r1) ────────────────────────────────────────────────────────
create table public.catering_payment_refund_events (
  stripe_event_id text primary key check (length(stripe_event_id) between 1 and 255),
  payment_id uuid not null references public.catering_payments(id),
  refunded_at timestamptz not null,
  cumulative_refunded_cents bigint not null check (cumulative_refunded_cents >= 0),
  charge_amount_cents bigint check (charge_amount_cents is null or charge_amount_cents >= 0),
  -- true = `refunded_at` is a DELIVERY time (Stripe's event time was not available), not the
  -- refund's own time (review r2). Amounts never depend on it: they follow the cumulative figure.
  refunded_at_approximate boolean not null default false,
  recorded_at timestamptz not null default now()
);
create index catering_payment_refund_events_refunded_at on public.catering_payment_refund_events (refunded_at);
create index catering_payment_refund_events_payment on public.catering_payment_refund_events (payment_id, refunded_at);
alter table public.catering_payment_refund_events enable row level security;
create policy catering_payment_refund_events_no_user_select on public.catering_payment_refund_events for select using (false);
create policy catering_payment_refund_events_no_user_insert on public.catering_payment_refund_events for insert with check (false);
create policy catering_payment_refund_events_no_user_update on public.catering_payment_refund_events for update using (false);
create policy catering_payment_refund_events_no_user_delete on public.catering_payment_refund_events for delete using (false);
revoke all on table public.catering_payment_refund_events from public, anon, authenticated, service_role;
grant select, insert on table public.catering_payment_refund_events to service_role;

-- Backfill (review r2). Two sources, one row per Stripe event, append-only by construction:
--  (A) the webhook ledger `stripe_events` (0204): every `charge.refunded` delivery is stored VERBATIM
--      before it is worked — including the ones that wrote NO audit row (a partial refund delivered
--      after the whole-charge refund answers `no_paid_row`; a refund seen before its payment). The
--      time is the Stripe EVENT's own `created` (`payload->>'created'`, epoch seconds — the same
--      field the webhook reads as `createdSec`), capped at `received_at`; the figure is the charge's
--      cumulative `payload->'data'->'object'->>'amount_refunded'`; the payment is bound by
--      `payment_intent` (a string, or an expanded object's `id`) = `catering_payments.provider_ref`,
--      exactly the live path's binding, on a row money was recorded on (paid / refunded).
--      A `location_mismatch` delivery is skipped (the live path appends nothing for it).
--  (B) the audit trail (`catering.payment.provider_refunded`), only for an event (A) did not yield.
--      Its metadata carries `stripe_event_id`, `refunded_amount_cents` and `charge_amount_cents` and
--      NO event time — so its time is the audit row's `occurred_at` (the DELIVERY time) and the row
--      is marked `refunded_at_approximate = true`.
-- An approximate time never reorders history: amounts are derived in the order of the cumulative
-- figure (`refundEventAmounts`), and an approximate time is pulled back to no later than the
-- earliest time of any event of the same payment with a HIGHER cumulative figure (that refund
-- happened after this one, so its time bounds this one's from above).
-- Unparseable payloads, non-numeric figures and payments we do not hold are skipped, never guessed.
with ledger as (
  select e.id as event_key, e.received_at, e.payload->'data'->'object' as obj, e.payload->>'created' as created_txt
    from public.stripe_events e
   where e.type = 'charge.refunded' and e.outcome is distinct from 'location_mismatch'
     and jsonb_typeof(e.payload->'data'->'object') = 'object'
), from_ledger as (
  select l.event_key,
         case jsonb_typeof(l.obj->'payment_intent') when 'string' then l.obj->>'payment_intent'
              when 'object' then l.obj->'payment_intent'->>'id' end as payment_intent,
         case when jsonb_typeof(l.obj->'amount_refunded') = 'number' and (l.obj->>'amount_refunded') ~ '^[0-9]{1,15}$'
              then (l.obj->>'amount_refunded')::bigint end as cumulative,
         case when jsonb_typeof(l.obj->'amount') = 'number' and (l.obj->>'amount') ~ '^[0-9]{1,15}$'
              then (l.obj->>'amount')::bigint end as charge,
         case when l.created_txt ~ '^[0-9]{1,12}$' and l.created_txt::bigint > 0
              then least(to_timestamp(l.created_txt::bigint), l.received_at) end as event_time,
         l.received_at
    from ledger l
), cand as (
  -- (A)
  (select distinct on (f.event_key) f.event_key, p.id as payment_id,
         coalesce(f.event_time, f.received_at) as at, f.event_time is null as approximate,
         f.cumulative, f.charge, 0 as source
    from from_ledger f
    join public.catering_payments p on p.provider_ref = f.payment_intent and p.status in ('paid','refunded')
   where f.cumulative is not null and f.payment_intent is not null
   order by f.event_key, p.id)
  union all
  -- (B)
  (select distinct on (k.event_key) k.event_key, k.payment_id, k.occurred_at, true, k.cumulative, k.charge, 1
    from (select coalesce(nullif(a.metadata->>'stripe_event_id', ''), 'audit:' || a.id::text) as event_key,
                 p.id as payment_id, a.occurred_at, a.id as audit_id,
                 (a.metadata->>'refunded_amount_cents')::bigint as cumulative,
                 case when (a.metadata->>'charge_amount_cents') ~ '^[0-9]+$' then (a.metadata->>'charge_amount_cents')::bigint end as charge
            from public.audit_log a
            join public.catering_payments p on p.id::text = a.resource_id::text
           where a.action = 'catering.payment.provider_refunded' and a.resource_table = 'catering_payments'
             and (a.metadata->>'refunded_amount_cents') ~ '^[0-9]{1,15}$') k
   order by k.event_key, k.occurred_at, k.audit_id)
), chosen as (
  select distinct on (c.event_key) c.* from cand c order by c.event_key, c.source
)
insert into public.catering_payment_refund_events
  (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents, refunded_at_approximate)
select c.event_key, c.payment_id,
       case when c.approximate then least(c.at, coalesce((select min(h.at) from chosen h
              where h.payment_id = c.payment_id and h.cumulative > c.cumulative), c.at))
            else c.at end,
       c.cumulative, c.charge, c.approximate
  from chosen c
on conflict (stripe_event_id) do nothing;

-- ── Privileges and owners (0289's ceiling) ─────────────────────────────────────────────────────────────
do $$ declare f regprocedure; owner_oid oid; begin
  select proowner into owner_oid from pg_proc where oid = 'public.marketing_assert_actor(uuid)'::regprocedure;
  foreach f in array array[
    'public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)'::regprocedure,
    'public.void_marketing_manual_entry(uuid,uuid,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
    if (select proowner from pg_proc where oid = f) <> owner_oid then raise exception '0333: function owner mismatch'; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0333: % executable by a PostgREST role', f;
    end if;
  end loop;
  if has_table_privilege('service_role','public.marketing_manual_entries','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege('service_role','public.marketing_manual_entries','INSERT,UPDATE,REFERENCES') then
    raise exception '0333: service_role above SELECT ceiling';
  end if;
  if has_table_privilege('service_role','public.catering_payment_refund_events','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or not has_table_privilege('service_role','public.catering_payment_refund_events','SELECT')
    or not has_table_privilege('service_role','public.catering_payment_refund_events','INSERT')
    or has_table_privilege('anon','public.catering_payment_refund_events','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.catering_payment_refund_events','SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0333: catering_payment_refund_events outside its SELECT + INSERT ceiling';
  end if;
end $$;

commit;
