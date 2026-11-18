-- Migration 0344_catering_toast_house_side
-- AUTHORED 2026-11-18 (item 21 PR 1, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO PROD 2026-11-18 (schema_migrations version 20261118185441, name 'catering_toast_house_side'), after sim. The line above is the authoring-time gate note, kept as history.
-- NUMBER: 0342 is the highest on main; 0343 may be claimed by the board PR in flight, so this file takes 0344 to be safe.
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-21-PORTAL-CATERING-TOAST-PLAN-r3.md ("Migration A"),
-- with Juan's 8 answers (2026-11-18) and Astra r3's P2s that touch this file folded in (r3 #3 and #4, see below).
--
-- WHAT THIS IS. The HOUSE side of the portal-catering <-> Toast cross-check, read-only. NOTHING WRITES A LINK HERE:
-- the link and decision tables are created empty and stay empty until Migration B (PR 3, the human link RPC) and the
-- house reconciler (PR 4). No ezCater object is touched: no ezCater function is re-emitted, nothing writes
-- ezcater_toast_links, and the sales classifier and every fact reader are left alone (a linked Toast check stays a
-- `sale`; tests/catering-toast-classifier-untouched.test.ts pins it).
--   catering_toast_settings        one optional row per shop. NO ROW = everything OFF. `enabled` gates every reader.
--   catering_pipeline.ring_code    the short code staff type into the Toast check (Juan answer 1), CO-XXXXX, global,
--                                  never reused (immutable once set; leads are never deleted). Generated only by
--                                  ensure_catering_ring_code, and only while the shop's ring_code_enabled is on.
--   catering_toast_links           house lead <-> Toast check, keyed by the LOGICAL check (shop, order guid, check guid),
--                                  never a snapshot id (a recapture changes nothing). One current house lead per check.
--   catering_toast_link_decisions  the human decisions, append-only chains with one head per key: pair kinds (link,
--                                  unlink, not_a_match) on (lead, shop, order, check); lead kinds (no_ring_expected,
--                                  ring_expected) on the lead. An `unlink` or `not_a_match` head is the TOMBSTONE that
--                                  blocks automatic relinking of that pair (plan r3 #5).
--   plan_catering_toast(...)       the house planner: a bounded, read-only list of candidate checks per house lead,
--                                  with the evidence, the owner of the check and whether the pair is blocked.
--   catering_toast_decision_heads, catering_reconciliation_status, catering_toast_orphans: views.
--   catering_pipeline_reconciliation(...): partitions the UNCHANGED 0232 pipeline value (Juan answer 6: ezCater stays IN).
--
-- EVIDENCE (Astra r3 #3, Juan answer 1: "staff type a short code into the Toast check/tab like ezCater today").
-- Today an ezCater number reaches Toast in one of two places, and the ring code follows both:
--   (a) as the NAME of an item-bearing selection (an open item). Capture keeps that name (lib/toast/capture-shared.ts),
--       so the planner reads it from toast_orders_latest.selection_units, exactly as plan_ezcater_toast does (0229).
--   (b) as a SPECIAL_REQUEST note on an item. Capture DROPS note text (no item identity). It is recovered only by the
--       ephemeral, version-fenced lookup (lib/ezcater/toast-codes.ts loadKnownToastOrderCodes) that intersects the note's
--       tokens with KNOWN codes before anything leaves the stack frame. The planner takes those intersections as
--       p_note_codes = [{location_id, order_guid, check_guid, code}] -- codes only, each refused unless it is
--       code-shaped, so no note text can ever be passed in or stored.
--   A check's TAB NAME is read by neither path. If staff use the tab name, the lookup must learn to read check.tabName
--   (the same intersect-with-known-codes rule) BEFORE ring_code_enabled flips -- the fixture test pins that it reads
--   nothing today (tests/catering-ring-code-capture-fixture.test.ts).
-- The Toast check is the money of record (answer 2); one check per order with deposits lumped in (answer 3), so the
-- amount compared is the check's TOTAL against the lead's value (accepted quote total, else estimate); several checks
-- per lead stay allowed and are summed.
--
-- TOAST-ORIGIN LEADS (Astra r3 #4, Juan answer 5: auto-link by origin). A lead the Toast scan created from a Toast order
-- (toast_catering_orders.lead_id) has ORIGIN evidence: every live check of that order's latest snapshot at the same
-- shop. The planner emits it as evidence 'toast_origin'; the reconciler (PR 4) links it automatically under the same
-- ownership and tombstone rules as a code. Until that ships, the readers keep Toast-origin leads OFF the not-rung list
-- (include_toast_origin_leads, default false): they are rung in Toast by construction, and listing them as "not rung"
-- would be false. Backfill (answer 7): automatic linking never reaches an event dated before auto_link_from_date;
-- older history is suggestions only. The CHECK below makes an auto switch without that date impossible.
--
-- APPEND-ONLY BY GRANT: deny-all RLS, service_role SELECT only (0257 ceiling), every write through SECURITY DEFINER.
-- Settings have no writer yet: CC flips a shop's row on Juan's word (runbook docs/runbooks/catering-toast.md); PR 3
-- adds the settings card and its audited writer.
-- Proof: scripts/sql-harness-0344.mjs (PGlite; the REAL 0232 assert_window + catering_values bodies), CI-pinned by
-- tests/catering-toast-0344-migration.test.ts.

begin;

-- 1. Settings ------------------------------------------------------------------------------------------------------
create table public.catering_toast_settings (
  location_id                uuid primary key references public.locations(id),
  enabled                    boolean not null default false,
  ring_code_enabled          boolean not null default false,
  auto_link_enabled          boolean not null default false,
  origin_auto_link_enabled   boolean not null default false,
  include_toast_origin_leads boolean not null default false,
  tolerance_cents            integer not null default 5000 check (tolerance_cents between 0 and 100000),
  tolerance_pct              numeric(4,3) not null default 0.150 check (tolerance_pct between 0 and 1),
  auto_link_from_date        date,
  updated_at                 timestamptz not null default clock_timestamp(),
  -- Backfill is suggestions only (Juan answer 7): no automatic switch without the date it starts from.
  constraint catering_toast_settings_auto_needs_floor
    check ((not auto_link_enabled and not origin_auto_link_enabled) or auto_link_from_date is not null),
  -- Toast-origin leads are listed only once they can be linked by origin (Astra r3 #4).
  constraint catering_toast_settings_origin_listing
    check (not include_toast_origin_leads or origin_auto_link_enabled)
);

-- 2. The ring code --------------------------------------------------------------------------------------------------
-- CO- + 5 from an unambiguous alphabet (no B/I/O/S/Z, no 0/1/2/5/8), at least one digit. Normalized (upper, hyphen
-- stripped, the 0229:46 rule) it is 7 characters starting CO: an ezCater order number normalizes to 6 (ABC-123), and
-- the DO block below refuses to apply if any stored ezCater number has the house shape.
alter table public.catering_pipeline add column ring_code text
  constraint catering_pipeline_ring_code_shape check (ring_code ~ '^CO-[ACDEFGHJKLMNPQRTUVWXY34679]{5}$' and ring_code ~ '[34679]');
create unique index catering_pipeline_ring_code_uq on public.catering_pipeline (upper(replace(ring_code, '-', '')))
  where ring_code is not null;

create function public.catering_pipeline_ring_code_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.ring_code is not null and new.ring_code is distinct from old.ring_code then
    raise exception 'ring_code_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- Fires only when an UPDATE names ring_code: every existing pipeline writer is unaffected.
create trigger catering_pipeline_ring_code_immutable before update of ring_code on public.catering_pipeline
  for each row execute function public.catering_pipeline_ring_code_immutable();

do $$
begin
  if exists (select 1 from public.ezcater_orders e
              where upper(replace(btrim(coalesce(e.order_number, '')), '-', '')) ~ '^CO[ACDEFGHJKLMNPQRTUVWXY34679]{5}$') then
    raise exception 'ring_code_format_collides_with_ezcater';
  end if;
end $$;

-- Returns the lead's code, generating it once. Dormant until PR 3 wires it (never on a read path).
create function public.ensure_catering_ring_code(p_lead_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_lead public.catering_pipeline%rowtype;
  v_alphabet constant text := 'ACDEFGHJKLMNPQRTUVWXY34679';
  v_code text;
  v_try integer := 0;
begin
  select * into v_lead from public.catering_pipeline where id = p_lead_id for no key update;
  if v_lead.id is null then raise exception 'lead_not_found' using errcode = 'P0001'; end if;
  if v_lead.ring_code is not null then return v_lead.ring_code; end if;
  if coalesce(v_lead.lead_source, '') = 'ezcater' or exists (select 1 from public.ezcater_orders e where e.lead_id = v_lead.id) then
    raise exception 'ezcater_lead' using errcode = 'P0001';
  end if;
  if not coalesce((select s.ring_code_enabled from public.catering_toast_settings s where s.location_id = v_lead.location_id), false) then
    raise exception 'ring_code_disabled' using errcode = 'P0001';
  end if;
  loop
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'ring_code_exhausted' using errcode = 'P0001'; end if;
    v_code := 'CO-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
                          from generate_series(1, 5));
    continue when v_code !~ '[34679]';
    continue when exists (select 1 from public.ezcater_orders e
                           where upper(replace(btrim(coalesce(e.order_number, '')), '-', '')) = upper(replace(v_code, '-', '')));
    begin
      update public.catering_pipeline set ring_code = v_code where id = v_lead.id and ring_code is null;
      return v_code;
    exception when unique_violation then
      -- Another lead holds this code: draw again.
    end;
  end loop;
end $$;

-- 3. Links and decisions (created empty; no writer in this migration) ---------------------------------------------
create table public.catering_toast_link_decisions (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.catering_pipeline(id),
  kind          text not null check (kind in ('link', 'unlink', 'not_a_match', 'no_ring_expected', 'ring_expected')),
  location_id   uuid references public.locations(id),
  order_guid    text,
  check_guid    text,
  -- No free text: a closed reason for no_ring_expected only.
  reason_code   text check (reason_code in ('paid_outside_toast', 'cancelled', 'comped', 'duplicate_lead', 'other')),
  actor_id      uuid not null references public.users(id),
  supersedes_id uuid unique references public.catering_toast_link_decisions(id),
  created_at    timestamptz not null default clock_timestamp(),
  constraint catering_toast_decisions_pair_key check (
    (kind in ('link', 'unlink', 'not_a_match')) = (location_id is not null and order_guid is not null and check_guid is not null)),
  constraint catering_toast_decisions_lead_key check (
    (kind in ('no_ring_expected', 'ring_expected')) = (location_id is null and order_guid is null and check_guid is null)),
  constraint catering_toast_decisions_reason check ((kind = 'no_ring_expected') = (reason_code is not null))
);
-- One root per key + one successor per row (supersedes_id unique) + same-key successors = exactly one head per key.
create unique index catering_toast_decisions_one_root on public.catering_toast_link_decisions
  (lead_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(order_guid, ''), coalesce(check_guid, ''))
  where supersedes_id is null;
create index catering_toast_decisions_pair on public.catering_toast_link_decisions (location_id, order_guid, check_guid)
  where location_id is not null;

create function public.catering_toast_decision_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_prev public.catering_toast_link_decisions%rowtype;
begin
  if tg_op <> 'INSERT' then raise exception 'catering_toast_decisions_append_only' using errcode = 'P0001'; end if;
  if new.supersedes_id is null then return new; end if;
  select * into v_prev from public.catering_toast_link_decisions where id = new.supersedes_id;
  if v_prev.id is null or v_prev.lead_id <> new.lead_id
     or v_prev.location_id is distinct from new.location_id or v_prev.order_guid is distinct from new.order_guid
     or v_prev.check_guid is distinct from new.check_guid then
    raise exception 'decision_chain_key_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger catering_toast_decision_guard before insert or update or delete on public.catering_toast_link_decisions
  for each row execute function public.catering_toast_decision_guard();

create table public.catering_toast_links (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.catering_pipeline(id),
  location_id       uuid not null references public.locations(id),
  order_guid        text not null,
  check_guid        text not null,
  -- The snapshot seen when linked: provenance only. Ownership is the logical key, so a recapture changes nothing.
  toast_snapshot_id uuid not null,
  evidence          text not null check (evidence in ('ring_code', 'toast_origin', 'manual')),
  decision_id       uuid references public.catering_toast_link_decisions(id),
  is_current        boolean not null default true,
  created_at        timestamptz not null default clock_timestamp(),
  retired_at        timestamptz,
  retired_reason    text check (retired_reason in ('unlinked', 'check_gone', 'lead_moved', 'lead_lost')),
  constraint catering_toast_links_retired check (
    (is_current and retired_at is null and retired_reason is null) or (not is_current and retired_at is not null and retired_reason is not null)),
  constraint catering_toast_links_manual_decision check (evidence <> 'manual' or decision_id is not null)
);
-- A check holds one current house lead (a lead may hold several checks).
create unique index catering_toast_links_one_lead_per_check on public.catering_toast_links (location_id, order_guid, check_guid)
  where is_current;
create index catering_toast_links_lead on public.catering_toast_links (lead_id) where is_current;

-- 4. Reads ----------------------------------------------------------------------------------------------------------
create view public.catering_toast_decision_heads with (security_invoker = true) as
select d.* from public.catering_toast_link_decisions d
where not exists (select 1 from public.catering_toast_link_decisions n where n.supersedes_id = d.id);

-- Every house lead in scope (booked, dated, at a shop, not ezCater), with its value (the 0195 rule), its current
-- live links at ITS shop (a link left at another shop by a transfer does not count) and its status.
create view public.catering_reconciliation_status with (security_invoker = true) as
with house as (
  select p.id lead_id, p.location_id, p.event_date, p.stage, p.lead_source, p.ring_code, p.headcount,
         coalesce((select qq.total_cents from public.catering_quotes qq
                    where qq.pipeline_id = p.id and qq.superseded_at is null and qq.status = 'accepted'
                    order by qq.version desc limit 1), p.estimated_revenue_cents)::bigint value_cents,
         exists (select 1 from public.toast_catering_orders o where o.lead_id = p.id) toast_origin
    from public.catering_pipeline p
   where p.location_id is not null and p.event_date is not null and p.stage in ('confirmed', 'out', 'completed')
     and coalesce(p.lead_source, '') <> 'ezcater'
     and not exists (select 1 from public.ezcater_orders e where e.lead_id = p.id)
), linked as (
  select h.lead_id, count(*) link_count, sum(c.total_cents) linked_cents, bool_or(c.total_cents is null) linked_unknown
    from house h
    join public.catering_toast_links l on l.lead_id = h.lead_id and l.is_current and l.location_id = h.location_id
    join public.toast_orders_latest t on t.location_id = l.location_id and t.order_guid = l.order_guid
    join public.toast_order_checks c on c.snapshot_id = t.id and c.check_guid = l.check_guid
   where not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
   group by h.lead_id
)
select h.lead_id, h.location_id, h.event_date, h.stage, h.lead_source, h.ring_code, h.headcount, h.value_cents, h.toast_origin,
       coalesce(k.link_count, 0) link_count, k.linked_cents,
       case when k.link_count > 0 and h.value_cents is not null and not k.linked_unknown
            then k.linked_cents - h.value_cents end amount_diff_cents,
       case
         when k.link_count > 0 and h.value_cents is not null and not k.linked_unknown
              and abs(k.linked_cents - h.value_cents) > coalesce(s.tolerance_cents, 5000)
              and abs(k.linked_cents - h.value_cents) > abs(h.value_cents) * coalesce(s.tolerance_pct, 0.150) then 'amount_mismatch'
         -- A current link wins over a no-ring decision: the money of record exists.
         when k.link_count > 0 then 'matched'
         when exists (select 1 from public.catering_toast_decision_heads d
                       where d.lead_id = h.lead_id and d.location_id is null and d.kind = 'no_ring_expected') then 'no_ring_expected'
         else 'not_rung_in_toast'
       end status
  from house h
  left join linked k on k.lead_id = h.lead_id
  left join public.catering_toast_settings s on s.location_id = h.location_id;

-- Live checks on a HOUSE catering dining option that no source owns. ezCater ownership is the RAW is_current row on
-- the logical key (plan r3 #2: a snapshot change never releases it). Floor: only where house history exists.
create view public.catering_toast_orphans with (security_invoker = true) as
select t.location_id, t.business_date, t.order_guid, c.check_guid, c.total_cents
  from public.toast_orders_latest t
  join public.toast_order_checks c on c.snapshot_id = t.id
 where not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
   and exists (select 1 from public.toast_dining_options d join public.sales_channel_map m on m.dining_option_label = d.name
                where d.location_id = t.location_id and d.guid = t.dining_option_guid
                  and m.channel = 'catering' and lower(coalesce(m.provider, '')) <> 'ezcater')
   and not exists (select 1 from public.ezcater_toast_links z where z.is_current and z.location_id = t.location_id
                    and z.order_guid = t.order_guid and z.check_guid = c.check_guid)
   and not exists (select 1 from public.catering_toast_links h where h.is_current and h.location_id = t.location_id
                    and h.order_guid = t.order_guid and h.check_guid = c.check_guid)
   and not exists (select 1 from public.toast_catering_orders o where o.location_id = t.location_id
                    and o.order_guid = t.order_guid and o.lead_id is not null)
   and t.business_date >= (select min(r.event_date) - 1 from public.catering_reconciliation_status r where r.location_id = t.location_id);

-- The house planner. Bounded by shop and event-date window (<= 62 days); read-only; one row per (lead, check).
create function public.plan_catering_toast(p_location_id uuid, p_from date, p_to date, p_note_codes jsonb default '[]'::jsonb)
returns table (
  lead_id uuid, location_id uuid, order_guid text, check_guid text, toast_snapshot_id uuid, business_date date,
  evidence text, check_total_cents bigint, lead_value_cents bigint, amount_diff_cents bigint, amount_mismatch boolean,
  dual_code boolean, owner text, owner_lead_id uuid, blocked boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_location_id is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'catering_toast_invalid_window' using errcode = 'P0001';
  end if;
  if p_to - p_from > 62 then raise exception 'catering_toast_window_too_wide' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_note_codes, '[]'::jsonb)) <> 'array' or exists (
       select 1 from jsonb_array_elements(coalesce(p_note_codes, '[]'::jsonb)) n
        where jsonb_typeof(n) <> 'object' or coalesce(n->>'code', '') !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'
           or length(n->>'code') > 32 or n->>'order_guid' is null or n->>'check_guid' is null or n->>'location_id' is null) then
    -- Codes only: a note's text can never be passed in.
    raise exception 'catering_toast_note_codes_invalid' using errcode = 'P0001';
  end if;
  return query
  with tol as (
    select coalesce((select s.tolerance_cents from public.catering_toast_settings s where s.location_id = p_location_id), 5000) cents,
           coalesce((select s.tolerance_pct from public.catering_toast_settings s where s.location_id = p_location_id), 0.150) pct
  ), leads as (
    select r.lead_id, r.location_id, r.event_date, r.value_cents,
           case when r.ring_code is null then null else upper(replace(r.ring_code, '-', '')) end code_norm
      from public.catering_reconciliation_status r
     where r.location_id = p_location_id and r.event_date between p_from and p_to
  ), checks as (
    select t.id toast_snapshot_id, t.location_id, t.order_guid, c.check_guid, t.business_date, c.total_cents,
           t.selection_units, t.dining_option_guid
      from public.toast_orders_latest t
      join public.toast_order_checks c on c.snapshot_id = t.id
     where t.location_id = p_location_id and t.business_date between p_from - 1 and p_to + 7
       and not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
  ), tokens as (
    -- (a) retained item-bearing selection names, the 0229 token rule.
    select c.toast_snapshot_id, c.check_guid, upper(replace(tok[1], '-', '')) token
      from checks c
      cross join lateral jsonb_array_elements(c.selection_units) s
      cross join lateral regexp_matches(coalesce(s->>'name', ''), '[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*', 'g') tok
     where s->>'check_guid' = c.check_guid
       and not coalesce((s->>'voided')::boolean, false) and not coalesce((s->>'deleted')::boolean, false)
    union
    -- (b) codes the ephemeral note lookup intersected with known codes (never text).
    select c.toast_snapshot_id, c.check_guid, upper(replace(btrim(n->>'code'), '-', ''))
      from checks c
      join jsonb_array_elements(coalesce(p_note_codes, '[]'::jsonb)) n
        on (n->>'location_id')::uuid = c.location_id and n->>'order_guid' = c.order_guid and n->>'check_guid' = c.check_guid
  ), candidates as (
    select l.lead_id, c.toast_snapshot_id, c.order_guid, c.check_guid, c.business_date, c.total_cents, l.value_cents,
           'toast_origin'::text evidence, 1 priority
      from leads l
      join public.toast_catering_orders o on o.lead_id = l.lead_id and o.location_id = l.location_id and not o.voided
      join checks c on c.order_guid = o.order_guid
    union all
    select l.lead_id, c.toast_snapshot_id, c.order_guid, c.check_guid, c.business_date, c.total_cents, l.value_cents, 'ring_code', 2
      from leads l
      join checks c on c.business_date between l.event_date - 1 and l.event_date + 7
     where l.code_norm is not null
       and exists (select 1 from tokens k where k.toast_snapshot_id = c.toast_snapshot_id and k.check_guid = c.check_guid
                    and k.token = l.code_norm)
    union all
    select l.lead_id, c.toast_snapshot_id, c.order_guid, c.check_guid, c.business_date, c.total_cents, l.value_cents, 'amount_date', 3
      from leads l
      cross join tol
      join checks c on c.business_date between l.event_date - 1 and l.event_date + 1
     where l.value_cents is not null and c.total_cents is not null
       and abs(c.total_cents - l.value_cents) <= greatest(tol.cents, abs(l.value_cents) * tol.pct)
       and exists (select 1 from public.toast_dining_options d join public.sales_channel_map m on m.dining_option_label = d.name
                    where d.location_id = p_location_id and d.guid = c.dining_option_guid
                      and m.channel = 'catering' and lower(coalesce(m.provider, '')) <> 'ezcater')
  ), best as (
    select distinct on (x.lead_id, x.order_guid, x.check_guid) x.*
      from candidates x
     order by x.lead_id, x.order_guid, x.check_guid, x.priority
  )
  select b.lead_id, p_location_id, b.order_guid, b.check_guid, b.toast_snapshot_id, b.business_date, b.evidence,
         b.total_cents::bigint, b.value_cents,
         case when b.total_cents is not null and b.value_cents is not null then (b.total_cents - b.value_cents)::bigint end,
         coalesce(b.total_cents is not null and b.value_cents is not null
                  and abs(b.total_cents - b.value_cents) > tol.cents
                  and abs(b.total_cents - b.value_cents) > abs(b.value_cents) * tol.pct, false),
         -- The same check also carries an ezCater order number of this shop: neither source may take it alone.
         exists (select 1 from tokens k
                   join public.ezcater_orders e on upper(replace(btrim(coalesce(e.order_number, '')), '-', '')) = k.token
                   left join public.catering_pipeline ep on ep.id = e.lead_id
                  where k.toast_snapshot_id = b.toast_snapshot_id and k.check_guid = b.check_guid
                    and coalesce(ep.location_id, e.location_id) = p_location_id and nullif(btrim(e.order_number), '') is not null),
         case when exists (select 1 from public.ezcater_toast_links z where z.is_current and z.location_id = p_location_id
                             and z.order_guid = b.order_guid and z.check_guid = b.check_guid) then 'ezcater'
              when exists (select 1 from public.catering_toast_links h where h.is_current and h.location_id = p_location_id
                             and h.order_guid = b.order_guid and h.check_guid = b.check_guid) then 'house' end,
         (select h.lead_id from public.catering_toast_links h where h.is_current and h.location_id = p_location_id
            and h.order_guid = b.order_guid and h.check_guid = b.check_guid),
         exists (select 1 from public.catering_toast_decision_heads d
                  where d.lead_id = b.lead_id and d.location_id = p_location_id and d.order_guid = b.order_guid
                    and d.check_guid = b.check_guid and d.kind in ('unlink', 'not_a_match'))
    from best b cross join tol
   order by b.lead_id, b.order_guid, b.check_guid;
end $$;

-- The UNCHANGED 0232 pipeline value, partitioned. The `leads` CTE is 0232's sales_report_catering_values CTE with three
-- columns added (id, lead_source, the ezCater test); the parts always sum to its completed + confirmed/out totals.
-- Priority: ezcater_sourced > rung_in_toast (a current link) > toast_origin > no_ring_expected > not_rung.
create function public.catering_pipeline_reconciliation(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  with leads as (
    select p.id, p.lead_source, p.stage, coalesce(q.total_cents, p.estimated_revenue_cents)::bigint as value_cents,
           (coalesce(p.lead_source, '') = 'ezcater' or exists (select 1 from public.ezcater_orders e where e.lead_id = p.id)) as is_ezcater
      from public.catering_pipeline p
      left join lateral (
        select qq.total_cents from public.catering_quotes qq
         where qq.pipeline_id = p.id and qq.superseded_at is null and qq.status = 'accepted'
         order by qq.version desc limit 1) q on true
     where p.location_id = p_location_id and p.event_date between p_from and p_to
       and p.stage in ('confirmed', 'out', 'completed')
  ), parted as (
    select l.value_cents,
           case when l.is_ezcater then 'ezcater_sourced'
                when r.status in ('matched', 'amount_mismatch') then 'rung_in_toast'
                when r.toast_origin then 'toast_origin'
                when r.status = 'no_ring_expected' then 'no_ring_expected'
                else 'not_rung' end part
      from leads l left join public.catering_reconciliation_status r on r.lead_id = l.id
  )
  select jsonb_build_object(
    'total_events', (select count(*) from parted),
    'total_value_cents', (select coalesce(sum(value_cents), 0) from parted),
    'total_unvalued', (select count(*) from parted where value_cents is null),
    'parts', coalesce((select jsonb_object_agg(part, jsonb_build_object('events', n, 'value_cents', cents, 'unvalued', unvalued))
                         from (select part, count(*) n, coalesce(sum(value_cents), 0) cents, count(*) filter (where value_cents is null) unvalued
                                 from parted group by part) g), '{}'::jsonb)
  ) into v;
  return v;
end $$;

-- 5. Row security and the privilege ceiling (0257 pattern) -------------------------------------------------------------
alter table public.catering_toast_settings enable row level security;
create policy catering_toast_settings_no_user_select on public.catering_toast_settings for select using (false);
create policy catering_toast_settings_no_user_insert on public.catering_toast_settings for insert with check (false);
create policy catering_toast_settings_no_user_update on public.catering_toast_settings for update using (false);
create policy catering_toast_settings_no_user_delete on public.catering_toast_settings for delete using (false);
alter table public.catering_toast_link_decisions enable row level security;
create policy catering_toast_link_decisions_no_user_select on public.catering_toast_link_decisions for select using (false);
create policy catering_toast_link_decisions_no_user_insert on public.catering_toast_link_decisions for insert with check (false);
create policy catering_toast_link_decisions_no_user_update on public.catering_toast_link_decisions for update using (false);
create policy catering_toast_link_decisions_no_user_delete on public.catering_toast_link_decisions for delete using (false);
alter table public.catering_toast_links enable row level security;
create policy catering_toast_links_no_user_select on public.catering_toast_links for select using (false);
create policy catering_toast_links_no_user_insert on public.catering_toast_links for insert with check (false);
create policy catering_toast_links_no_user_update on public.catering_toast_links for update using (false);
create policy catering_toast_links_no_user_delete on public.catering_toast_links for delete using (false);

revoke all on public.catering_toast_settings, public.catering_toast_link_decisions, public.catering_toast_links
  from public, anon, authenticated, service_role;
grant select on public.catering_toast_settings, public.catering_toast_link_decisions, public.catering_toast_links to service_role;
revoke all on public.catering_toast_decision_heads, public.catering_reconciliation_status, public.catering_toast_orphans
  from public, anon, authenticated, service_role;
grant select on public.catering_toast_decision_heads, public.catering_reconciliation_status, public.catering_toast_orphans to service_role;

revoke all on function public.ensure_catering_ring_code(uuid) from public, anon, authenticated;
grant execute on function public.ensure_catering_ring_code(uuid) to service_role;
revoke all on function public.plan_catering_toast(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.plan_catering_toast(uuid, date, date, jsonb) to service_role;
revoke all on function public.catering_pipeline_reconciliation(uuid, date, date) from public, anon, authenticated;
grant execute on function public.catering_pipeline_reconciliation(uuid, date, date) to service_role;
revoke all on function public.catering_pipeline_ring_code_immutable() from public, anon, authenticated;
revoke all on function public.catering_toast_decision_guard() from public, anon, authenticated;

do $$
declare t text; p text;
begin
  foreach t in array array['catering_toast_settings', 'catering_toast_link_decisions', 'catering_toast_links'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'select') then raise exception 'ceiling: % select missing', t; end if;
    foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception 'ceiling: service_role holds % on %', p, t; end if;
      if has_table_privilege('authenticated', 'public.' || t, p) or has_table_privilege('anon', 'public.' || t, p) then
        raise exception 'ceiling: a user role holds % on %', p, t;
      end if;
    end loop;
    if has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'ceiling: a user role can read %', t;
    end if;
  end loop;
  foreach t in array array['ensure_catering_ring_code(uuid)', 'plan_catering_toast(uuid,date,date,jsonb)',
                           'catering_pipeline_reconciliation(uuid,date,date)'] loop
    if has_function_privilege('authenticated', 'public.' || t, 'execute') or has_function_privilege('anon', 'public.' || t, 'execute') then
      raise exception 'ceiling: a user role can execute %', t;
    end if;
  end loop;
end $$;

commit;

-- Verify after apply:
--   select count(*) from pg_policies where tablename in ('catering_toast_settings','catering_toast_link_decisions','catering_toast_links'); -- 12
--   select count(*) from public.catering_toast_links;            -- 0 (nothing writes a link until PR 3)
--   select count(*) from public.catering_toast_settings;         -- 0 (everything off)
--   select count(*) from public.catering_pipeline where ring_code is not null; -- 0
