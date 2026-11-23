-- Migration 0356_delivery_jobs
-- AUTHORED 2026-11-22 (PR DELIV-1, CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO SIM 2026-11-23 (schema_migrations version 20261123031134, name '0356_delivery_jobs')
-- NUMBER: 0354 is the highest on main; 0355 is reserved for the all-shops access build (co-ops-wt/.mig-claims), so this
-- file takes 0356 (claimed there by unit deliv).
-- Plan: catering delivery integration, plan r6 (Astra-approved), section 4. Juan's decisions 2026-11-22.
--
-- WHAT THIS IS. The provider-independent delivery LEDGER. A delivery is a JOB hanging off a catering lead
-- (catering_pipeline). Nothing here calls a courier, a webhook, an email or a text: people record what happened.
-- PURELY ADDITIVE: new objects only. No existing table, function, trigger or policy is altered or re-emitted
-- (transfer_catering_lead, the stage writers, quotes and payments are untouched).
--
--   TABLES (deny-all RLS, NO policies; service_role SELECT only; every write is a SECURITY DEFINER function below)
--     delivery_settings          one row per shop: enabled, the shop's couriers (tenant vocabulary), the driver's share.
--     delivery_jobs              one row per booking. ONE OPEN JOB PER LEAD (unique (pipeline_id) where closed_at is null).
--                                location_id = the PICKUP shop when recorded (history); scope follows the LEAD.
--     delivery_job_events        append-only status history. CURRENT STATUS = THE EVENT WITH THE HIGHEST seq.
--                                occurred_at is information only (a person may backdate it); it never orders anything.
--     delivery_job_costs         append-only money observations: what the courier costs US (a payable). Never the fee the
--                                customer pays (catering_quotes.delivery_fee_cents), never summed with it. No row = UNKNOWN,
--                                not zero; "no charge" is an explicit 0 row.
--     delivery_gratuity_splits   the recorded driver / crew split of the quote's gratuity, ONE chain per ORDER (lead).
--                                RECORDED ONLY: nothing pays, pools or exports it. Its payroll and legal treatment is
--                                UNVERIFIED (the driver works for the courier, not for us).
--     delivery_pickup_decisions  "the old shop still sends it", bound to the destination shop it was decided for.
--   VIEW delivery_job_current    a job with its current status (highest seq). security_invoker, service_role SELECT.
--   RULES (functions)
--     delivery_gratuity_split(cents, bps)   driver = (cents * bps + 5000) / 10000 in integers; crew = the rest.
--     delivery_order_quote(lead)            THE one order-quote selection (a lead may hold several quote families;
--                                           a candidate = the live revision of each: superseded_at is null):
--                                           accepted (exactly one accepted) / ambiguous (two or more accepted) /
--                                           rejected (every candidate declined) / pending (newest non-declined by
--                                           created_at, id) / none.
--     delivery_order_rejected(lead)         the lead is lost OR its order quote is rejected.
--     delivery_lead_is_ezcater(lead)        lead_source = 'ezcater' OR an ezcater_orders row names the lead (lead_source
--                                           is editable, so it is not sufficient alone).
--     delivery_manual_move_allowed(a, b)    accepted -> picked_up | delivered | cancelled | failed;
--                                           picked_up -> delivered | failed | cancelled; nothing leaves a terminal status.
--     delivery_actor_role(actor, shop)      THE actor rule, on the LOCKED users row: owner / cgs / moo / catering_mgr at
--                                           any shop; gm / agm only with an ACTIVE user_locations membership at that shop;
--                                           anyone else (prep_mgr and social_media_mgr included) and anyone inactive:
--                                           forbidden.
--   WRITERS (service_role EXECUTE only; each inserts its own audit row in the same transaction)
--     set_delivery_settings              owner / cgs / moo.                                  audit delivery.settings_update
--     record_manual_delivery_job         a booking made outside CO-OPS.                      audit delivery.record
--     record_delivery_event              a status a person saw.                              audit delivery.status
--     record_delivery_cost               a cost, or a correction of the current figure.      audit delivery.cost / delivery.cost_correct
--     keep_delivery_pickup               acknowledge a pickup-shop mismatch.                 audit delivery.pickup_kept
--     record_delivery_gratuity_split     recompute or void the order's split.                audit delivery.gratuity_split
--     delivery_ready()                   the lib's installed probe: { ready: true, version: 1 }.
--
-- LOCK ORDER, EVERYWHERE: (1) the lead row FOR NO KEY UPDATE -> (2) the job row FOR UPDATE -> (3) children.
--   transfer_catering_lead takes the lead row FOR UPDATE, so a transfer and any delivery writer serialize on (1).
--   The two gates below (delivery_lead_gate, delivery_job_gate) are the ONLY places that take (1) and (2).
-- THE SHOP THE PERSON SAW: every job-level and lead-level writer takes p_expected_shop and refuses `shop_moved` under
--   the lead lock BEFORE the actor rule: an old panel can never write against the destination shop's settings.
-- OFF MEANS OFF: every job-level and lead-level writer refuses `delivery_off` when the lead's CURRENT shop has no
--   enabled delivery_settings row. Judged in the gate, in ONE order everywhere: the lead lock, `shop_moved`,
--   `delivery_off`, the actor rule. No exception: an open job at a shop that is turned off WAITS until the shop is
--   turned on again. set_delivery_settings answers `open_jobs` (open jobs of leads now at that shop) so the card can warn.
-- JUAN'S DECISIONS: (1) a job only on a confirmed / out / completed lead (`lead_not_confirmed`); (1b) nothing new on a
--   rejected order (`order_rejected`); cancelling stays possible in every stage; (2) the actor rule; (4) the split is
--   recorded on `delivered`; (5) an ezCater lead takes ONLY booked_via = 'provider_native' (`ezcater_never_booked`), a
--   permanent rule, not a setting; (6) couriers are tenant DATA (delivery_settings.manual_providers).
-- NOT HERE (a later migration, when the provider is known): booked_via = 'co_ops_api' is in the vocabulary but NO
--   function can write it (`api_booking_unavailable`); no provider job id, webhook or poll table exists.
-- EVERY REFUSAL IS NAMED (errcode P0001, the message is the code):
--   invalid_request invalid_settings forbidden location_not_found settings_moved no_change lead_not_found job_not_found
--   shop_moved lead_not_confirmed order_rejected quote_ambiguous delivery_off api_booking_unavailable
--   ezcater_never_booked not_ezcater not_delivery unknown_provider delivery_job_open job_closed status_moved
--   illegal_move bad_occurred_at bad_amount cost_exists not_current_head reason_required no_mismatch already_kept
--   split_moved bad_gratuity
-- Proof: scripts/sql-harness-0356.mjs (PGlite, this REAL file), CI-pinned by tests/delivery-0356-migration.test.ts.

begin;

-- 0. Pre-flight: every table and column this file reads exists; every name it creates is free.
do $$
declare t text; c text;
begin
  for t, c in
    select * from (values
      ('catering_pipeline', 'id'), ('catering_pipeline', 'location_id'), ('catering_pipeline', 'stage'), ('catering_pipeline', 'lead_source'),
      ('catering_quotes', 'id'), ('catering_quotes', 'pipeline_id'), ('catering_quotes', 'status'), ('catering_quotes', 'is_delivery'),
      ('catering_quotes', 'gratuity_cents'), ('catering_quotes', 'delivery_fee_cents'), ('catering_quotes', 'superseded_at'), ('catering_quotes', 'created_at'),
      ('catering_pipeline_events', 'id'), ('catering_pipeline_events', 'pipeline_id'), ('catering_pipeline_events', 'from_stage'),
      ('catering_pipeline_events', 'to_stage'), ('catering_pipeline_events', 'created_at'),
      ('ezcater_orders', 'lead_id'),
      ('locations', 'id'), ('locations', 'active'),
      ('users', 'id'), ('users', 'role'), ('users', 'active'),
      ('user_locations', 'user_id'), ('user_locations', 'location_id'), ('user_locations', 'active'),
      ('audit_log', 'actor_id'), ('audit_log', 'actor_role'), ('audit_log', 'action'), ('audit_log', 'resource_table'),
      ('audit_log', 'resource_id'), ('audit_log', 'metadata'), ('audit_log', 'destructive')) as need(tbl, col)
  loop
    if not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = t and k.column_name = c) then
      raise exception '0356: public.%.% is missing', t, c;
    end if;
  end loop;
  foreach t in array array['delivery_settings', 'delivery_jobs', 'delivery_job_events', 'delivery_job_costs', 'delivery_gratuity_splits',
                           'delivery_pickup_decisions', 'delivery_job_current'] loop
    if to_regclass('public.' || t) is not null then raise exception '0356: public.% already exists', t; end if;
  end loop;
  select p.proname into t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('delivery_gratuity_split', 'delivery_order_quote', 'delivery_order_rejected',
      'delivery_lead_is_ezcater', 'delivery_manual_move_allowed', 'delivery_status_terminal', 'delivery_actor_role', 'delivery_lead_gate',
      'delivery_job_gate', 'delivery_computed_split', 'delivery_write_split', 'set_delivery_settings', 'record_manual_delivery_job',
      'record_delivery_event', 'record_delivery_cost', 'keep_delivery_pickup', 'record_delivery_gratuity_split', 'delivery_ready')
    limit 1;
  if t is not null then raise exception '0356: function public.% already exists', t; end if;
end $$;

-- 1. Tables.

create table public.delivery_settings (
  location_id uuid primary key references public.locations(id),
  enabled boolean not null default false,
  manual_providers jsonb not null default '[]'::jsonb check (jsonb_typeof(manual_providers) = 'array'),
  gratuity_driver_bps integer not null default 1000 check (gratuity_driver_bps between 0 and 10000),
  updated_at timestamptz not null,
  updated_by uuid references public.users(id)
);

create table public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.catering_pipeline(id),
  location_id uuid not null references public.locations(id),
  quote_id uuid references public.catering_quotes(id),
  confirm_event_id uuid references public.catering_pipeline_events(id),
  booked_via text not null check (booked_via in ('manual', 'provider_native', 'co_ops_api')),
  provider_label text not null check (char_length(provider_label) between 1 and 40 and provider_label = btrim(provider_label)),
  external_ref text check (external_ref is null or char_length(external_ref) between 1 and 80),
  attempt_no integer not null check (attempt_no >= 1),
  pickup_at timestamptz,
  dropoff_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (pipeline_id, attempt_no)
);
-- THE DOUBLE-BOOKING ARBITER: one open job per lead.
create unique index delivery_jobs_one_open_per_lead on public.delivery_jobs (pipeline_id) where closed_at is null;
create index delivery_jobs_location on public.delivery_jobs (location_id, created_at);

create table public.delivery_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.delivery_jobs(id),
  seq integer not null check (seq >= 1),
  status text not null check (status in ('requested', 'accepted', 'driver_assigned', 'en_route_pickup', 'at_pickup', 'picked_up',
                                         'en_route_dropoff', 'at_dropoff', 'delivered', 'cancelled', 'failed', 'returned')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  source text not null check (source in ('manual', 'system', 'provider')),
  actor_id uuid references public.users(id),
  note text check (note is null or char_length(note) <= 500),
  unique (job_id, seq)
);

create table public.delivery_job_costs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.delivery_jobs(id),
  component text not null check (component in ('base', 'adjustment', 'wait_time', 'cancellation_fee', 'credit', 'invoice_total')),
  semantics text not null check (semantics in ('snapshot', 'delta')),
  amount_cents integer not null,
  money_identity text not null,
  source text not null check (source in ('manual', 'provider', 'invoice')),
  provider_ref text,
  observed_at timestamptz not null default clock_timestamp(),
  corrects_id uuid references public.delivery_job_costs(id),
  actor_id uuid references public.users(id),
  note text check (note is null or char_length(note) <= 500)
);
create index delivery_job_costs_job on public.delivery_job_costs (job_id, observed_at);
-- One successor per row; one manual root per monetary identity; a provider observation is recorded once.
create unique index delivery_job_costs_one_successor on public.delivery_job_costs (corrects_id) where corrects_id is not null;
create unique index delivery_job_costs_one_manual_root on public.delivery_job_costs (money_identity) where corrects_id is null and source = 'manual';
create unique index delivery_job_costs_provider_once on public.delivery_job_costs (money_identity, amount_cents, semantics) where source = 'provider';

create table public.delivery_gratuity_splits (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.catering_pipeline(id),
  job_id uuid references public.delivery_jobs(id),
  quote_id uuid references public.catering_quotes(id),
  kind text not null check (kind in ('split', 'void')),
  gratuity_cents integer not null check (gratuity_cents >= 0),
  driver_bps integer not null check (driver_bps between 0 and 10000),
  driver_cents integer not null check (driver_cents >= 0),
  crew_cents integer not null check (crew_cents >= 0),
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid references public.users(id),
  reason text check (reason is null or char_length(reason) <= 500),
  supersedes_id uuid references public.delivery_gratuity_splits(id),
  check (driver_cents + crew_cents = gratuity_cents),
  check (kind = 'split' or (gratuity_cents = 0 and job_id is null)),
  check (kind = 'void' or job_id is not null)
);
-- One successor per row; ONE root per order. The head (the row nothing supersedes) is the order's allocation.
create unique index delivery_gratuity_splits_one_successor on public.delivery_gratuity_splits (supersedes_id) where supersedes_id is not null;
create unique index delivery_gratuity_splits_one_root on public.delivery_gratuity_splits (pipeline_id) where supersedes_id is null;
create index delivery_gratuity_splits_lead on public.delivery_gratuity_splits (pipeline_id, recorded_at);

create table public.delivery_pickup_decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.delivery_jobs(id),
  lead_location_id uuid not null references public.locations(id),
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default clock_timestamp(),
  note text check (note is null or char_length(note) <= 500),
  unique (job_id, lead_location_id)
);

-- A job with its CURRENT status: the event with the highest seq (never a time: occurred_at can be backdated).
create view public.delivery_job_current with (security_invoker = true) as
  select j.id, j.pipeline_id, j.location_id, j.quote_id, j.confirm_event_id, j.booked_via, j.provider_label, j.external_ref,
         j.attempt_no, j.pickup_at, j.dropoff_at, j.closed_at, j.created_by, j.created_at,
         e.status, e.seq as status_seq, e.occurred_at as status_at
    from public.delivery_jobs j
    left join lateral (select v.status, v.seq, v.occurred_at from public.delivery_job_events v
                        where v.job_id = j.id order by v.seq desc limit 1) e on true;

-- 2. Deny-all: RLS on, no policy, service_role reads only.
alter table public.delivery_settings enable row level security;
alter table public.delivery_jobs enable row level security;
alter table public.delivery_job_events enable row level security;
alter table public.delivery_job_costs enable row level security;
alter table public.delivery_gratuity_splits enable row level security;
alter table public.delivery_pickup_decisions enable row level security;
revoke all on public.delivery_settings, public.delivery_jobs, public.delivery_job_events, public.delivery_job_costs,
  public.delivery_gratuity_splits, public.delivery_pickup_decisions, public.delivery_job_current
  from public, anon, authenticated, service_role;
grant select on public.delivery_settings, public.delivery_jobs, public.delivery_job_events, public.delivery_job_costs,
  public.delivery_gratuity_splits, public.delivery_pickup_decisions, public.delivery_job_current to service_role;

-- 3. The pure rules.

-- The 10 / 90 rule (decision 4), integers only, round half up; the parts always sum to the whole.
create function public.delivery_gratuity_split(p_gratuity_cents integer, p_driver_bps integer)
returns table (driver_cents integer, crew_cents integer)
language plpgsql immutable set search_path = pg_catalog, public as $$
begin
  if p_gratuity_cents is null or p_gratuity_cents < 0 or p_driver_bps is null or p_driver_bps < 0 or p_driver_bps > 10000 then
    raise exception 'bad_gratuity' using errcode = 'P0001';
  end if;
  driver_cents := ((p_gratuity_cents::bigint * p_driver_bps + 5000) / 10000)::integer;
  crew_cents := p_gratuity_cents - driver_cents;
  return next;
end $$;

create function public.delivery_status_terminal(p_status text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(p_status in ('delivered', 'cancelled', 'failed', 'returned'), false)
$$;

-- The legal MANUAL moves (the TS twin is MANUAL_MOVES; one shared case file).
create function public.delivery_manual_move_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(
    (p_from = 'accepted' and p_to in ('picked_up', 'delivered', 'cancelled', 'failed'))
    or (p_from = 'picked_up' and p_to in ('delivered', 'failed', 'cancelled')), false)
$$;

-- THE one order-quote selection (the TS twin is orderQuoteOf; one shared case file). Candidates = the live revision of
-- each of the lead's quote families (0120: one row per family has superseded_at null).
create function public.delivery_order_quote(p_lead_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_n integer; v_accepted integer; v_declined integer; v_any_delivery boolean;
  v_id uuid; v_delivery boolean; v_gratuity integer; v_fee integer;
begin
  select count(*), count(*) filter (where q.status = 'accepted'), count(*) filter (where q.status = 'declined'),
         coalesce(bool_or(q.is_delivery) filter (where q.status = 'accepted'), false)
    into v_n, v_accepted, v_declined, v_any_delivery
    from public.catering_quotes q where q.pipeline_id = p_lead_id and q.superseded_at is null;
  if v_n = 0 then
    return jsonb_build_object('kind', 'none', 'quote_id', null, 'is_delivery', null, 'gratuity_cents', null, 'delivery_fee_cents', null);
  end if;
  if v_accepted = 1 then
    select q.id, q.is_delivery, q.gratuity_cents, q.delivery_fee_cents into v_id, v_delivery, v_gratuity, v_fee
      from public.catering_quotes q where q.pipeline_id = p_lead_id and q.superseded_at is null and q.status = 'accepted';
    return jsonb_build_object('kind', 'accepted', 'quote_id', v_id, 'is_delivery', v_delivery, 'gratuity_cents', v_gratuity, 'delivery_fee_cents', v_fee);
  end if;
  if v_accepted > 1 then
    return jsonb_build_object('kind', 'ambiguous', 'quote_id', null, 'is_delivery', v_any_delivery, 'gratuity_cents', null, 'delivery_fee_cents', null);
  end if;
  if v_declined = v_n then
    return jsonb_build_object('kind', 'rejected', 'quote_id', null, 'is_delivery', false, 'gratuity_cents', null, 'delivery_fee_cents', null);
  end if;
  select q.id, q.is_delivery into v_id, v_delivery
    from public.catering_quotes q where q.pipeline_id = p_lead_id and q.superseded_at is null and q.status <> 'declined'
    order by q.created_at desc, q.id desc limit 1;
  return jsonb_build_object('kind', 'pending', 'quote_id', v_id, 'is_delivery', v_delivery, 'gratuity_cents', null, 'delivery_fee_cents', null);
end $$;

-- Rejected = the lead is lost OR its order quote is rejected (plan 4.8). NULL when the lead does not exist.
create function public.delivery_order_rejected(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select l.stage = 'lost' or (public.delivery_order_quote(l.id)->>'kind') = 'rejected'
    from public.catering_pipeline l where l.id = p_lead_id
$$;

-- ezCater-ness is durable: the source label OR an ezcater_orders row naming the lead (the label is editable).
create function public.delivery_lead_is_ezcater(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.catering_pipeline l where l.id = p_lead_id and l.lead_source = 'ezcater')
      or exists (select 1 from public.ezcater_orders o where o.lead_id = p_lead_id)
$$;

-- 4. The actor rule and the two gates (the only places that take the lead lock and the job lock).

-- THE actor rule, on the locked users row. Returns the role, or refuses `forbidden`.
create function public.delivery_actor_role(p_actor_id uuid, p_shop_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if v_role in ('owner', 'cgs', 'moo', 'catering_mgr') then return v_role; end if;
  if v_role in ('gm', 'agm') and p_shop_id is not null and exists (
       select 1 from public.user_locations m where m.user_id = p_actor_id and m.location_id = p_shop_id and m.active) then
    return v_role;
  end if;
  raise exception 'forbidden' using errcode = 'P0001';
end $$;

-- Lead-level gate: (1) the lead row FOR NO KEY UPDATE, then the shop the person saw, then the shop's switch, then the
-- actor rule.
create function public.delivery_lead_gate(p_actor_id uuid, p_lead_id uuid, p_expected_shop uuid,
  out o_shop uuid, out o_stage text, out o_role text)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  select l.location_id, l.stage into o_shop, o_stage from public.catering_pipeline l where l.id = p_lead_id for no key update;
  if not found then raise exception 'lead_not_found' using errcode = 'P0001'; end if;
  if o_shop is distinct from p_expected_shop then raise exception 'shop_moved' using errcode = 'P0001'; end if;
  -- Off means off: the lead's CURRENT shop must have an enabled settings row.
  if not exists (select 1 from public.delivery_settings s where s.location_id = o_shop and s.enabled) then
    raise exception 'delivery_off' using errcode = 'P0001';
  end if;
  o_role := public.delivery_actor_role(p_actor_id, o_shop);
end $$;

-- Job-level gate: (1) the lead row FOR NO KEY UPDATE -> (2) the job row FOR UPDATE, then the shop the person saw, then
-- the shop's switch, then the actor rule. A job's lead never changes, so its id is read before the locks.
create function public.delivery_job_gate(p_actor_id uuid, p_job_id uuid, p_expected_shop uuid,
  out o_lead uuid, out o_shop uuid, out o_stage text, out o_role text, out o_pickup_shop uuid, out o_closed_at timestamptz,
  out o_booked_via text, out o_attempt integer)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  select j.pipeline_id into o_lead from public.delivery_jobs j where j.id = p_job_id;
  if o_lead is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  select l.location_id, l.stage into o_shop, o_stage from public.catering_pipeline l where l.id = o_lead for no key update;
  if not found then raise exception 'lead_not_found' using errcode = 'P0001'; end if;
  select j.location_id, j.closed_at, j.booked_via, j.attempt_no into o_pickup_shop, o_closed_at, o_booked_via, o_attempt
    from public.delivery_jobs j where j.id = p_job_id for update;
  if o_shop is distinct from p_expected_shop then raise exception 'shop_moved' using errcode = 'P0001'; end if;
  -- Off means off: the lead's CURRENT shop must have an enabled settings row.
  if not exists (select 1 from public.delivery_settings s where s.location_id = o_shop and s.enabled) then
    raise exception 'delivery_off' using errcode = 'P0001';
  end if;
  o_role := public.delivery_actor_role(p_actor_id, o_shop);
end $$;

-- 5. The gratuity allocation (plan 4.5).

-- The COMPUTED allocation of an order now: the gratuity of the order quote when it is accepted (pending / rejected /
-- none = 0; ambiguous = no allocation), the lead's CURRENT shop's driver share (1000 with no settings row), credited to
-- the delivered job with the highest attempt_no among those we or a person booked (never a provider_native job: the
-- ezCater tip is ezCater's fact).
create function public.delivery_computed_split(p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_quote jsonb; v_job uuid; v_gratuity integer; v_bps integer; v_driver integer; v_crew integer;
begin
  v_quote := public.delivery_order_quote(p_lead_id);
  if v_quote->>'kind' = 'ambiguous' then return jsonb_build_object('kind', 'ambiguous'); end if;
  select j.id into v_job from public.delivery_job_current j
    where j.pipeline_id = p_lead_id and j.status = 'delivered' and j.booked_via in ('manual', 'co_ops_api')
    order by j.attempt_no desc limit 1;
  if v_job is null then return jsonb_build_object('kind', 'nothing'); end if;
  v_gratuity := case when v_quote->>'kind' = 'accepted' then (v_quote->>'gratuity_cents')::integer else 0 end;
  select s.gratuity_driver_bps into v_bps from public.delivery_settings s
    where s.location_id = (select l.location_id from public.catering_pipeline l where l.id = p_lead_id);
  v_bps := coalesce(v_bps, 1000);
  select g.driver_cents, g.crew_cents into v_driver, v_crew from public.delivery_gratuity_split(v_gratuity, v_bps) g;
  return jsonb_build_object('kind', 'split', 'job_id', v_job,
    'quote_id', case when v_quote->>'kind' = 'accepted' then v_quote->>'quote_id' end,
    'gratuity_cents', v_gratuity, 'driver_bps', v_bps, 'driver_cents', v_driver, 'crew_cents', v_crew);
end $$;

-- Append to the order's chain. The caller HOLDS THE LEAD LOCK. p_mode: 'delivered' (the event writer), 'recompute',
-- 'void'. Returns the new row's id, or NULL when nothing was to be written.
create function public.delivery_write_split(p_lead_id uuid, p_actor_id uuid, p_mode text, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_head public.delivery_gratuity_splits%rowtype; v_c jsonb; v_id uuid;
  v_job uuid; v_gratuity integer; v_bps integer; v_driver integer; v_crew integer;
begin
  select s.* into v_head from public.delivery_gratuity_splits s
    where s.pipeline_id = p_lead_id
      and not exists (select 1 from public.delivery_gratuity_splits n where n.supersedes_id = s.id)
    for update of s;

  if p_mode = 'void' then
    if v_head.id is null or v_head.kind = 'void' then return null; end if;
    insert into public.delivery_gratuity_splits(pipeline_id, job_id, quote_id, kind, gratuity_cents, driver_bps, driver_cents, crew_cents,
                                                recorded_by, reason, supersedes_id)
      values (p_lead_id, null, null, 'void', 0, v_head.driver_bps, 0, 0, p_actor_id, p_reason, v_head.id)
      returning id into v_id;
    return v_id;
  end if;

  v_c := public.delivery_computed_split(p_lead_id);
  if v_c->>'kind' = 'ambiguous' then
    if p_mode = 'recompute' then raise exception 'quote_ambiguous' using errcode = 'P0001'; end if;
    return null;
  end if;
  if v_c->>'kind' = 'nothing' then return null; end if;
  v_job := (v_c->>'job_id')::uuid; v_gratuity := (v_c->>'gratuity_cents')::integer; v_bps := (v_c->>'driver_bps')::integer;
  v_driver := (v_c->>'driver_cents')::integer; v_crew := (v_c->>'crew_cents')::integer;

  -- No allocation yet and no gratuity on the quote: nothing to record (the read says "no gratuity on the quote").
  if v_head.id is null and v_gratuity = 0 then return null; end if;
  -- The head already says exactly this.
  if v_head.id is not null and v_head.kind = 'split' and v_head.job_id = v_job and v_head.gratuity_cents = v_gratuity
     and v_head.driver_bps = v_bps and v_head.driver_cents = v_driver and v_head.crew_cents = v_crew then
    return null;
  end if;
  insert into public.delivery_gratuity_splits(pipeline_id, job_id, quote_id, kind, gratuity_cents, driver_bps, driver_cents, crew_cents,
                                              recorded_by, reason, supersedes_id)
    values (p_lead_id, v_job, (v_c->>'quote_id')::uuid, 'split', v_gratuity, v_bps, v_driver, v_crew, p_actor_id, p_reason, v_head.id)
    returning id into v_id;
  return v_id;
end $$;

-- 6. The writers.

create function public.set_delivery_settings(p_actor_id uuid, p_location_id uuid, p_settings jsonb, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_role text; v_old public.delivery_settings%rowtype; v_new public.delivery_settings%rowtype;
  v_enabled boolean; v_providers jsonb; v_bps integer; v_before jsonb; v_after jsonb;
  c_keys constant text[] := array['enabled', 'manual_providers', 'gratuity_driver_bps'];
begin
  -- The whole row, exactly these three keys, each of its own type. Nothing else can ride in.
  if p_actor_id is null or p_location_id is null or p_settings is null or jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_object_keys(p_settings)) <> 3
     or exists (select 1 from jsonb_object_keys(p_settings) k where k <> all (c_keys)) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_settings->'enabled') is distinct from 'boolean'
     or jsonb_typeof(p_settings->'manual_providers') is distinct from 'array'
     or jsonb_typeof(p_settings->'gratuity_driver_bps') is distinct from 'number' then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  v_providers := p_settings->'manual_providers';
  if jsonb_array_length(v_providers) > 12
     or exists (select 1 from jsonb_array_elements(v_providers) e where jsonb_typeof(e) <> 'string') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  -- Each courier label: 1 to 40 characters, trimmed, distinct (case-insensitive).
  if exists (select 1 from jsonb_array_elements_text(v_providers) e where e <> btrim(e) or char_length(e) not between 1 and 40)
     or (select count(distinct lower(e)) from jsonb_array_elements_text(v_providers) e) <> jsonb_array_length(v_providers) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  if (p_settings->>'gratuity_driver_bps')::numeric <> trunc((p_settings->>'gratuity_driver_bps')::numeric)
     or (p_settings->>'gratuity_driver_bps')::numeric not between 0 and 10000 then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  v_enabled := (p_settings->>'enabled')::boolean;
  v_bps := (p_settings->>'gratuity_driver_bps')::integer;

  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null or v_role not in ('owner', 'cgs', 'moo') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.active) then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;

  -- A first save has no row to lock: it serializes here, before the read.
  perform pg_advisory_xact_lock(hashtext('delivery-settings:' || p_location_id::text));
  select * into v_old from public.delivery_settings s where s.location_id = p_location_id for update;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'settings_moved' using errcode = 'P0001'; end if;
  if v_old.location_id is not null and v_old.enabled = v_enabled and v_old.manual_providers = v_providers and v_old.gratuity_driver_bps = v_bps then
    raise exception 'no_change' using errcode = 'P0001';
  end if;

  insert into public.delivery_settings(location_id, enabled, manual_providers, gratuity_driver_bps, updated_at, updated_by)
    values (p_location_id, v_enabled, v_providers, v_bps, clock_timestamp(), p_actor_id)
  on conflict (location_id) do update
    set enabled = excluded.enabled, manual_providers = excluded.manual_providers, gratuity_driver_bps = excluded.gratuity_driver_bps,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by
  returning * into v_new;

  v_before := case when v_old.location_id is null then null else to_jsonb(v_old) - 'location_id' - 'updated_at' - 'updated_by' end;
  v_after := to_jsonb(v_new) - 'location_id' - 'updated_at' - 'updated_by';
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'delivery.settings_update', 'delivery_settings', p_location_id,
            jsonb_build_object('location_id', p_location_id, 'before', v_before, 'after', v_after), true);
  -- The open jobs of leads NOW at this shop: while the shop is off they wait (no writer accepts them).
  return to_jsonb(v_new) || jsonb_build_object('open_jobs', (
    select count(*) from public.delivery_jobs j join public.catering_pipeline l on l.id = j.pipeline_id
     where j.closed_at is null and l.location_id = p_location_id));
end $$;

-- A booking made outside CO-OPS (the courier's site, or the courier ezCater sent): the job, its first event
-- (`accepted` = "Booked"), an optional first cost.
create function public.record_manual_delivery_job(p_actor_id uuid, p_lead_id uuid, p_expected_shop uuid, p_provider_label text,
  p_external_ref text, p_booked_via text, p_pickup_at timestamptz, p_dropoff_at timestamptz, p_cost_cents integer, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_shop uuid; v_stage text; v_role text; v_quote jsonb; v_kind text; v_ez boolean; v_settings public.delivery_settings%rowtype;
  v_label text := btrim(coalesce(p_provider_label, '')); v_ref text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_job uuid; v_attempt integer; v_quote_id uuid; v_confirm uuid; v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null or p_lead_id is null or p_booked_via is null
     or p_booked_via not in ('manual', 'provider_native', 'co_ops_api')
     or char_length(v_label) not between 1 and 40 or char_length(coalesce(v_ref, '')) > 80 or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_cost_cents is not null and p_cost_cents < 0 then raise exception 'bad_amount' using errcode = 'P0001'; end if;

  -- (1) the lead lock, the shop the person saw, the actor rule.
  select g.o_shop, g.o_stage, g.o_role into v_shop, v_stage, v_role from public.delivery_lead_gate(p_actor_id, p_lead_id, p_expected_shop) g;

  if v_stage not in ('confirmed', 'out', 'completed') then raise exception 'lead_not_confirmed' using errcode = 'P0001'; end if;
  v_quote := public.delivery_order_quote(p_lead_id);
  v_kind := v_quote->>'kind';
  if v_kind = 'rejected' then raise exception 'order_rejected' using errcode = 'P0001'; end if;
  if v_kind = 'ambiguous' then raise exception 'quote_ambiguous' using errcode = 'P0001'; end if;
  -- The gate already refused an off shop; this read is for the shop's courier list.
  select * into v_settings from public.delivery_settings s where s.location_id = v_shop and s.enabled;
  if not found then raise exception 'delivery_off' using errcode = 'P0001'; end if;
  -- No function in this migration can write an API booking.
  if p_booked_via = 'co_ops_api' then raise exception 'api_booking_unavailable' using errcode = 'P0001'; end if;
  v_ez := public.delivery_lead_is_ezcater(p_lead_id);
  -- Decision 5, permanent: CO-OPS never books an ezCater delivery; it may only record the courier ezCater sent.
  if v_ez and p_booked_via <> 'provider_native' then raise exception 'ezcater_never_booked' using errcode = 'P0001'; end if;
  if not v_ez and p_booked_via = 'provider_native' then raise exception 'not_ezcater' using errcode = 'P0001'; end if;
  -- A house order whose order quote is a pickup. (`none` is not known to be a delivery and may be recorded.)
  if not v_ez and v_kind in ('accepted', 'pending') and not coalesce((v_quote->>'is_delivery')::boolean, false) then
    raise exception 'not_delivery' using errcode = 'P0001';
  end if;
  if p_booked_via = 'manual' and not exists (select 1 from jsonb_array_elements_text(v_settings.manual_providers) e where e = v_label) then
    raise exception 'unknown_provider' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.delivery_jobs j where j.pipeline_id = p_lead_id and j.closed_at is null) then
    raise exception 'delivery_job_open' using errcode = 'P0001';
  end if;

  select coalesce(max(j.attempt_no), 0) + 1 into v_attempt from public.delivery_jobs j where j.pipeline_id = p_lead_id;
  v_quote_id := case when v_kind in ('accepted', 'pending') then (v_quote->>'quote_id')::uuid end;
  -- The event that CONFIRMED the lead (a shop transfer writes confirmed -> confirmed rows: not a confirmation).
  -- NULL when the lead was created at confirmed (the Toast scan, ezCater).
  select e.id into v_confirm from public.catering_pipeline_events e
    where e.pipeline_id = p_lead_id and e.to_stage = 'confirmed' and e.from_stage is distinct from 'confirmed'
    order by e.created_at desc, e.id desc limit 1;

  insert into public.delivery_jobs(pipeline_id, location_id, quote_id, confirm_event_id, booked_via, provider_label, external_ref,
                                   attempt_no, pickup_at, dropoff_at, created_by, created_at)
    values (p_lead_id, v_shop, v_quote_id, v_confirm, p_booked_via, v_label, v_ref, v_attempt, p_pickup_at, p_dropoff_at, p_actor_id, v_now)
    returning id into v_job;
  insert into public.delivery_job_events(job_id, seq, status, occurred_at, recorded_at, source, actor_id, note)
    values (v_job, 1, 'accepted', v_now, v_now, 'manual', p_actor_id, v_note);
  if p_cost_cents is not null then
    insert into public.delivery_job_costs(job_id, component, semantics, amount_cents, money_identity, source, observed_at, actor_id)
      values (v_job, 'base', 'snapshot', p_cost_cents, v_job::text || ':base', 'manual', v_now, p_actor_id);
  end if;

  -- Ids and vocabulary only: never the note, never the confirmation number.
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'delivery.record', 'delivery_jobs', v_job,
            jsonb_build_object('pipeline_id', p_lead_id, 'location_id', v_shop, 'job_id', v_job, 'attempt_no', v_attempt,
                               'booked_via', p_booked_via, 'provider_label', v_label, 'quote_id', v_quote_id,
                               'confirm_event_id', v_confirm, 'has_cost', p_cost_cents is not null, 'has_note', v_note is not null), true);
  return jsonb_build_object('job_id', v_job, 'attempt_no', v_attempt, 'status', 'accepted', 'status_seq', 1);
end $$;

-- A status a person saw. The move is judged against the CURRENT status (highest seq) under the job lock, so recording
-- order IS status order; p_occurred_at is information only. Allowed in every lead stage (a lost lead's job must close).
create function public.record_delivery_event(p_actor_id uuid, p_job_id uuid, p_expected_shop uuid, p_expected_status text,
  p_status text, p_occurred_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_lead uuid; v_shop uuid; v_role text; v_closed timestamptz; v_status text; v_seq integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_now timestamptz := clock_timestamp();
  v_at timestamptz := coalesce(p_occurred_at, v_now); v_split uuid; v_terminal boolean;
begin
  if p_actor_id is null or p_job_id is null or p_expected_status is null or p_status is null or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  -- (1) the lead lock -> (2) the job lock, the shop the person saw, the actor rule.
  select g.o_lead, g.o_shop, g.o_role, g.o_closed_at into v_lead, v_shop, v_role, v_closed
    from public.delivery_job_gate(p_actor_id, p_job_id, p_expected_shop) g;

  if v_closed is not null then raise exception 'job_closed' using errcode = 'P0001'; end if;
  select e.status, e.seq into v_status, v_seq from public.delivery_job_events e where e.job_id = p_job_id order by e.seq desc limit 1;
  -- Nothing follows a terminal status, whatever closed_at says.
  if public.delivery_status_terminal(v_status) then raise exception 'job_closed' using errcode = 'P0001'; end if;
  if v_status is distinct from p_expected_status then raise exception 'status_moved' using errcode = 'P0001'; end if;
  if not public.delivery_manual_move_allowed(v_status, p_status) then raise exception 'illegal_move' using errcode = 'P0001'; end if;
  if v_at > v_now + interval '5 minutes' then raise exception 'bad_occurred_at' using errcode = 'P0001'; end if;

  -- (3) children.
  insert into public.delivery_job_events(job_id, seq, status, occurred_at, recorded_at, source, actor_id, note)
    values (p_job_id, v_seq + 1, p_status, v_at, v_now, 'manual', p_actor_id, v_note);
  v_terminal := public.delivery_status_terminal(p_status);
  if v_terminal then
    -- The ONE update of a job row: a one-time stamp.
    update public.delivery_jobs set closed_at = v_now where id = p_job_id and closed_at is null;
  end if;
  if p_status = 'delivered' then
    v_split := public.delivery_write_split(v_lead, p_actor_id, 'delivered', null);
  end if;

  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'delivery.status', 'delivery_jobs', p_job_id,
            jsonb_build_object('pipeline_id', v_lead, 'location_id', v_shop, 'job_id', p_job_id, 'from', v_status, 'to', p_status,
                               'seq', v_seq + 1, 'closed', v_terminal, 'split_id', v_split, 'has_note', v_note is not null), true);
  return jsonb_build_object('job_id', p_job_id, 'status', p_status, 'status_seq', v_seq + 1, 'closed', v_terminal, 'split_id', v_split);
end $$;

-- A cost a person states (always a snapshot of that component's current figure), or a correction of the CURRENT head
-- of that figure. Allowed on a closed job: the bill arrives later.
create function public.record_delivery_cost(p_actor_id uuid, p_job_id uuid, p_expected_shop uuid, p_component text,
  p_amount_cents integer, p_corrects_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_lead uuid; v_shop uuid; v_role text; v_identity text; v_head_id uuid; v_head_cents integer; v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_actor_id is null or p_job_id is null or p_component is null or p_amount_cents is null
     or p_component not in ('base', 'adjustment', 'wait_time', 'cancellation_fee', 'credit', 'invoice_total')
     or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  -- A credit is never positive; every other component is never negative.
  if (p_component = 'credit' and p_amount_cents > 0) or (p_component <> 'credit' and p_amount_cents < 0) then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  if p_corrects_id is not null and v_note is null then raise exception 'reason_required' using errcode = 'P0001'; end if;

  -- (1) the lead lock -> (2) the job lock, the shop the person saw, the actor rule.
  select g.o_lead, g.o_shop, g.o_role into v_lead, v_shop, v_role from public.delivery_job_gate(p_actor_id, p_job_id, p_expected_shop) g;

  v_identity := p_job_id::text || ':' || p_component;
  select c.id, c.amount_cents into v_head_id, v_head_cents from public.delivery_job_costs c
    where c.money_identity = v_identity
      and not exists (select 1 from public.delivery_job_costs n where n.corrects_id = c.id);
  if p_corrects_id is null then
    if v_head_id is not null then raise exception 'cost_exists' using errcode = 'P0001'; end if;
  else
    if v_head_id is null or v_head_id <> p_corrects_id then raise exception 'not_current_head' using errcode = 'P0001'; end if;
    if v_head_cents = p_amount_cents then raise exception 'no_change' using errcode = 'P0001'; end if;
  end if;

  insert into public.delivery_job_costs(job_id, component, semantics, amount_cents, money_identity, source, corrects_id, actor_id, note)
    values (p_job_id, p_component, 'snapshot', p_amount_cents, v_identity, 'manual', p_corrects_id, p_actor_id, v_note)
    returning id into v_id;

  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, case when p_corrects_id is null then 'delivery.cost' else 'delivery.cost_correct' end, 'delivery_job_costs', v_id,
            jsonb_build_object('pipeline_id', v_lead, 'location_id', v_shop, 'job_id', p_job_id, 'cost_id', v_id, 'component', p_component,
                               'amount_cents', p_amount_cents, 'corrects_id', p_corrects_id, 'before_cents', v_head_cents), true);
  return jsonb_build_object('cost_id', v_id, 'job_id', p_job_id, 'component', p_component, 'amount_cents', p_amount_cents);
end $$;

-- "The old shop still sends it": an append-only decision bound to the DESTINATION shop the lock saw. Another transfer
-- raises the mismatch again by derivation (no decision exists for the new shop).
create function public.keep_delivery_pickup(p_actor_id uuid, p_job_id uuid, p_expected_shop uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_lead uuid; v_shop uuid; v_role text; v_pickup uuid; v_closed timestamptz; v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_actor_id is null or p_job_id is null or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  -- (1) the lead lock -> (2) the job lock, the shop the person saw, the actor rule.
  select g.o_lead, g.o_shop, g.o_role, g.o_pickup_shop, g.o_closed_at into v_lead, v_shop, v_role, v_pickup, v_closed
    from public.delivery_job_gate(p_actor_id, p_job_id, p_expected_shop) g;

  if v_closed is not null then raise exception 'job_closed' using errcode = 'P0001'; end if;
  if v_shop is null or v_shop = v_pickup then raise exception 'no_mismatch' using errcode = 'P0001'; end if;
  if exists (select 1 from public.delivery_pickup_decisions d where d.job_id = p_job_id and d.lead_location_id = v_shop) then
    raise exception 'already_kept' using errcode = 'P0001';
  end if;

  insert into public.delivery_pickup_decisions(job_id, lead_location_id, decided_by, note)
    values (p_job_id, v_shop, p_actor_id, v_note) returning id into v_id;

  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'delivery.pickup_kept', 'delivery_pickup_decisions', v_id,
            jsonb_build_object('pipeline_id', v_lead, 'job_id', p_job_id, 'pickup_location_id', v_pickup, 'lead_location_id', v_shop,
                               'has_note', v_note is not null), true);
  return jsonb_build_object('decision_id', v_id, 'job_id', p_job_id, 'lead_location_id', v_shop);
end $$;

-- The gated correction of the order's split: 'recompute' (the quote changed after delivery, to zero included) or
-- 'void' (the delivery recorded as delivered never happened). Names the head the person saw (NULL = "I saw none").
-- RECORDED ONLY: this pays nothing.
create function public.record_delivery_gratuity_split(p_actor_id uuid, p_lead_id uuid, p_expected_shop uuid, p_mode text,
  p_expected_head uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_shop uuid; v_role text; v_head uuid; v_id uuid; v_new public.delivery_gratuity_splits%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_actor_id is null or p_lead_id is null or p_mode is null or p_mode not in ('recompute', 'void') or char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if v_reason is null then raise exception 'reason_required' using errcode = 'P0001'; end if;

  -- (1) the lead lock, the shop the person saw, the actor rule. Then the chain head FOR UPDATE.
  select g.o_shop, g.o_role into v_shop, v_role from public.delivery_lead_gate(p_actor_id, p_lead_id, p_expected_shop) g;
  select s.id into v_head from public.delivery_gratuity_splits s
    where s.pipeline_id = p_lead_id
      and not exists (select 1 from public.delivery_gratuity_splits n where n.supersedes_id = s.id)
    for update of s;
  if v_head is distinct from p_expected_head then raise exception 'split_moved' using errcode = 'P0001'; end if;

  v_id := public.delivery_write_split(p_lead_id, p_actor_id, p_mode, v_reason);
  if v_id is null then raise exception 'no_change' using errcode = 'P0001'; end if;
  select * into v_new from public.delivery_gratuity_splits s where s.id = v_id;

  -- Ids and figures only: never the reason text.
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'delivery.gratuity_split', 'delivery_gratuity_splits', v_id,
            jsonb_build_object('pipeline_id', p_lead_id, 'location_id', v_shop, 'mode', p_mode, 'split_id', v_id, 'supersedes_id', v_head,
                               'kind', v_new.kind, 'job_id', v_new.job_id, 'gratuity_cents', v_new.gratuity_cents,
                               'driver_bps', v_new.driver_bps, 'driver_cents', v_new.driver_cents, 'crew_cents', v_new.crew_cents), true);
  return jsonb_build_object('split_id', v_id, 'kind', v_new.kind, 'job_id', v_new.job_id, 'gratuity_cents', v_new.gratuity_cents,
                            'driver_bps', v_new.driver_bps, 'driver_cents', v_new.driver_cents, 'crew_cents', v_new.crew_cents);
end $$;

-- The lib's installed probe (42883 / PGRST202 = this file is not on the database).
create function public.delivery_ready() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('ready', true, 'version', 1)
$$;

-- 7. Function privileges. Internal helpers: nobody (they run inside the definer writers). The rest: service_role only.
revoke all on function public.delivery_status_terminal(text) from public, anon, authenticated, service_role;
revoke all on function public.delivery_actor_role(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delivery_lead_gate(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delivery_job_gate(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delivery_computed_split(uuid) from public, anon, authenticated, service_role;
revoke all on function public.delivery_write_split(uuid, uuid, text, text) from public, anon, authenticated, service_role;

revoke all on function public.delivery_gratuity_split(integer, integer) from public, anon, authenticated;
revoke all on function public.delivery_manual_move_allowed(text, text) from public, anon, authenticated;
revoke all on function public.delivery_order_quote(uuid) from public, anon, authenticated;
revoke all on function public.delivery_order_rejected(uuid) from public, anon, authenticated;
revoke all on function public.delivery_lead_is_ezcater(uuid) from public, anon, authenticated;
revoke all on function public.set_delivery_settings(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.record_manual_delivery_job(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.record_delivery_event(uuid, uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.record_delivery_cost(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.keep_delivery_pickup(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_delivery_gratuity_split(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.delivery_ready() from public, anon, authenticated;

grant execute on function public.delivery_gratuity_split(integer, integer) to service_role;
grant execute on function public.delivery_manual_move_allowed(text, text) to service_role;
grant execute on function public.delivery_order_quote(uuid) to service_role;
grant execute on function public.delivery_order_rejected(uuid) to service_role;
grant execute on function public.delivery_lead_is_ezcater(uuid) to service_role;
grant execute on function public.set_delivery_settings(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.record_manual_delivery_job(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, integer, text) to service_role;
grant execute on function public.record_delivery_event(uuid, uuid, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.record_delivery_cost(uuid, uuid, uuid, text, integer, uuid, text) to service_role;
grant execute on function public.keep_delivery_pickup(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_delivery_gratuity_split(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.delivery_ready() to service_role;

-- 8. The ceiling, asserted: tables are read by service_role and written by nobody but the functions above; no user
--    role reads, writes or executes anything here.
do $$
declare t text; p text; r text; n integer;
begin
  foreach t in array array['delivery_settings', 'delivery_jobs', 'delivery_job_events', 'delivery_job_costs', 'delivery_gratuity_splits',
                           'delivery_pickup_decisions', 'delivery_job_current'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'select') then raise exception 'ceiling: service_role cannot read %', t; end if;
    foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception 'ceiling: service_role holds % on %', p, t; end if;
    end loop;
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, 'public.' || t, p) then raise exception 'ceiling: % holds % on %', r, p, t; end if;
      end loop;
    end loop;
  end loop;
  foreach t in array array['delivery_settings', 'delivery_jobs', 'delivery_job_events', 'delivery_job_costs', 'delivery_gratuity_splits',
                           'delivery_pickup_decisions'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)) then raise exception 'ceiling: RLS is off on %', t; end if;
    if exists (select 1 from pg_policies y where y.schemaname = 'public' and y.tablename = t) then raise exception 'ceiling: % has a policy', t; end if;
  end loop;

  -- No user role (and not PUBLIC) may execute any function of this file. An EXPLICIT list of exactly the eighteen
  -- functions this file creates, never a name pattern: the database already holds unrelated vendor-receipt functions
  -- under a delivery_ name (delivery_match_verdict, delivery_receipt_auto_link, delivery_receipt_unlink) that this file
  -- does not own and must not judge.
  select count(*) into n from information_schema.routine_privileges g
    where g.routine_schema = 'public' and g.privilege_type = 'EXECUTE' and g.grantee in ('PUBLIC', 'anon', 'authenticated')
      and g.routine_name in ('delivery_gratuity_split', 'delivery_status_terminal', 'delivery_manual_move_allowed', 'delivery_order_quote',
           'delivery_order_rejected', 'delivery_lead_is_ezcater', 'delivery_actor_role', 'delivery_lead_gate', 'delivery_job_gate',
           'delivery_computed_split', 'delivery_write_split', 'set_delivery_settings', 'record_manual_delivery_job',
           'record_delivery_event', 'record_delivery_cost', 'keep_delivery_pickup', 'record_delivery_gratuity_split', 'delivery_ready');
  if n <> 0 then raise exception 'ceiling: a user role can execute a delivery function'; end if;
  -- service_role executes exactly the public surface, never an internal helper.
  select count(distinct g.routine_name) into n from information_schema.routine_privileges g
    where g.routine_schema = 'public' and g.privilege_type = 'EXECUTE' and g.grantee = 'service_role'
      and g.routine_name in ('delivery_gratuity_split', 'delivery_manual_move_allowed', 'delivery_order_quote', 'delivery_order_rejected',
           'delivery_lead_is_ezcater', 'set_delivery_settings', 'record_manual_delivery_job', 'record_delivery_event',
           'record_delivery_cost', 'keep_delivery_pickup', 'record_delivery_gratuity_split', 'delivery_ready');
  if n <> 12 then raise exception 'ceiling: service_role executes % of the 12 public delivery functions', n; end if;
  select count(*) into n from information_schema.routine_privileges g
    where g.routine_schema = 'public' and g.privilege_type = 'EXECUTE' and g.grantee = 'service_role'
      and g.routine_name in ('delivery_status_terminal', 'delivery_actor_role', 'delivery_lead_gate', 'delivery_job_gate',
           'delivery_computed_split', 'delivery_write_split');
  if n <> 0 then raise exception 'ceiling: service_role can execute an internal delivery helper'; end if;
end $$;

commit;

-- Verify after apply:
--   select public.delivery_ready();                                   -- {"ready": true, "version": 1}
--   select count(*) from public.delivery_settings;                    -- 0 (this file switches no shop on)
--   select has_table_privilege('service_role', 'public.delivery_jobs', 'insert');   -- false
--   select has_function_privilege('authenticated', 'public.record_manual_delivery_job(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer,text)', 'execute');  -- false
--   select tablename from pg_policies where schemaname = 'public' and tablename in ('delivery_settings', 'delivery_jobs', 'delivery_job_events',
--     'delivery_job_costs', 'delivery_gratuity_splits', 'delivery_pickup_decisions');   -- no rows
--   (Name 0356's six tables explicitly: the older vendor-receipt table delivery_receipt_unlinks has policies of its own.)
