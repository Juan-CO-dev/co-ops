-- Migration 0348_catering_toast_reconciler
-- AUTHORED 2026-11-19 (item 21 PR 4, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first (planner timing + equivalence, then the two-session proof), then prod on Juan's word. Apply AFTER 0347.
-- NUMBER: 0347 is the highest on main and on prod; 0348 was claimed in co-ops-wt/.mig-claims (unit portal45).
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-21-PORTAL-CATERING-TOAST-PLAN-r3.md (PR 4), with
-- Juan's 8 answers and the two contracts PR 3 left binding on PR 4 (docs/runbooks/catering-toast.md, Astra r3 #3 and #4).
--
-- WHAT THIS IS. The HOUSE RECONCILER: the first AUTOMATIC house links. Everything stays OFF: it writes nothing for a
-- shop whose settings row does not say enabled AND auto_link_enabled / origin_auto_link_enabled (no row = off; today
-- no shop has a row), and never for an event before the shop's auto_link_from_date (Juan answer 7: history is
-- suggestions only).
--   reconcile_catering_toast(shop, from, to)   links a house lead to a Toast check on two kinds of evidence, each behind
--                                      its own switch: 'ring_code' (auto_link_enabled) and 'toast_origin'
--                                      (origin_auto_link_enabled; Juan answer 5, contract #4). It ONLY ADDS links. Never
--                                      over an owner (ezCater or house), never over a tombstone (an unlink / not_a_match
--                                      head), never for a lead marked "no Toast ring expected", never outside the
--                                      D-1 .. D+7 window the human Link uses, never on a dual-code check (an ezCater
--                                      number on the same check: neither source links, a person decides), never when
--                                      two house orders claim one check (two ring codes, or a code on another lead's
--                                      Toast order), and never by origin on a check rung on an ezCater dining option
--                                      (ezCater's batch may claim it; a person decides). It retires nothing a person or
--                                      ezCater holds: a wrong automatic link is undone by Unlink (the tombstone), as
--                                      plan r3 #4 says ("to free a house-owned check, a human unlinks it").
--   catering_toast_note_codes          contract #3: the ONE note lookup's intersections, CODES ONLY. A ring code or an
--                                      ezCater number staff typed as a SPECIAL_REQUEST note is not in capture; the
--                                      ephemeral lookup (lib/ezcater/toast-codes.ts) intersects note tokens with KNOWN
--                                      codes in memory and hands the matches here. A row counts only while its
--                                      toast_snapshot_id is still the order's CURRENT capture (a recapture drops it
--                                      until the next lookup finds it again). No note text can reach this table: the
--                                      writer refuses anything not code-shaped and stores a code only if it IS a known
--                                      ring code or ezCater order number.
--   record_catering_toast_note_codes(rows)     its one writer (service_role, definer).
--   plan_catering_toast(...)           re-emitted from 0347 by ADDING LINES ONLY (pinned): the recorded note codes of a
--                                      check's current capture are tokens too. No recorded note code = 0347's rows.
--   catering_toast_check_code_leads(...)       THE one rule for "which live house leads' ring codes are on this check":
--                                      retained item names (the 0229 token rule) UNION the recorded note codes, pairs
--                                      not blocked. catering_toast_check_house_code (0347: the publisher guard's
--                                      dual-code test and the conflict read) is re-emitted as its first element, so
--                                      the guard, the conflict read and the reconciler see the SAME evidence.
--   plan_ezcater_toast()               re-emitted from 0347 by ADDING LINES ONLY (pinned as a line-subsequence): the
--                                      house_coded set also holds a check whose CURRENT capture has a recorded
--                                      note-typed live ring code, so the planner and the publisher guard agree
--                                      (contract #3). With no recorded note code (today: the table is empty) it
--                                      returns 0347's rows exactly. The publisher, the reconciler, apply and transfer
--                                      are NOT re-emitted, and nothing here writes ezcater_toast_links.
--   ensure_catering_ring_codes(shop, from)     gives each booked house lead of a ring_code_enabled shop its code (0344's
--                                      ensure_catering_ring_code, one lead at a time). Called by the capture cron, never
--                                      on a read path.
--
-- THE ezCater RECONCILER NEVER RUNS IN A SUBTRANSACTION. 0347's incumbent rule reads xmin of the row the reconciler
-- retired in the SAME top-level transaction; under a savepoint (a plpgsql EXCEPTION block, a SAVEPOINT) that xmin is a
-- subtransaction id and the re-home would be skipped. So: nothing in this file calls reconcile_ezcater_toast or
-- publish_ezcater_shadow, the house reconciler is its OWN call (its own transaction, after the ezCater one), and it
-- has no EXCEPTION block. Pinned by tests/catering-toast-0348-migration.test.ts and tests/ezcater-reconcile-no-subtransaction.test.ts.
--
-- LOCKS. reconcile_catering_toast answers 'off' for a shop that is off BEFORE any lock (the cron asks every ten minutes),
-- then takes hashtext('ezcater-toast-reconcile') FIRST (publisher, ezCater reconciler and decide_catering_toast do),
-- reads the settings AGAIN under it, then the candidate lead rows FOR NO KEY UPDATE in id order, then plans again and
-- writes only leads it holds, then link rows. Transfer (0225) holds a lead row and never waits for the advisory lock: no cycle.
-- record_catering_toast_note_codes writes no link and takes no lock: evidence that lands between two runs is read by
-- the next one.
--
-- APPEND-ONLY BY GRANT: deny-all RLS, service_role SELECT only, every write through SECURITY DEFINER.
-- Proof: scripts/sql-harness-0348.mjs (PGlite; the REAL 0225 transfer, 0229 publisher, 0231 planner, 0330 reconciler,
-- 0344 and 0347 files), CI-pinned by tests/catering-toast-0348-migration.test.ts.

begin;

-- 0. Pre-flight: 0347 is in place and the live ezCater planner is still 0347's body (the one this file re-emits).
do $$
begin
  if to_regprocedure('public.decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid)') is null
     or to_regprocedure('public.catering_toast_link_ready()') is null or to_regclass('public.catering_toast_conflicts') is null then
    raise exception '0348: apply 0347 first';
  end if;
  if not public.catering_toast_link_ready() then
    raise exception '0348: the 0347 link step is not ready (a guard is missing or disabled)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'plan_ezcater_toast'
                    and strpos(p.prosrc, '0347 (plan r3 #3): a check a house lead holds is not ezCater''s to plan') > 0
                    and strpos(p.prosrc, '0348') = 0) then
    raise exception '0348: the live plan_ezcater_toast is not the 0347 body; re-emit this file from the live definer';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'plan_catering_toast'
                    and strpos(p.prosrc, 'public.catering_toast_house_owner(p_location_id, b.order_guid, b.check_guid),') > 0
                    and strpos(p.prosrc, '0348') = 0) then
    raise exception '0348: the live plan_catering_toast is not the 0347 body; re-emit this file from the live definer';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'catering_toast_check_house_code'
                    and strpos(p.prosrc, 'catering_live_ring_codes') > 0 and strpos(p.prosrc, 'catering_toast_check_code_leads') = 0) then
    raise exception '0348: the live catering_toast_check_house_code is not the 0347 body';
  end if;
end $$;

-- 1. Note codes: the one lookup's intersections, codes only (contract #3) ---------------------------------------------
create table public.catering_toast_note_codes (
  location_id       uuid not null references public.locations(id),
  order_guid        text not null,
  check_guid        text not null,
  -- Normalized the 0229:46 way (upper, hyphen stripped). Code-shaped by constraint: never note text.
  code_norm         text not null check (code_norm ~ '^[A-Z0-9]{4,32}$'),
  -- The capture the lookup was fenced to. The row counts only while this is the order's current capture.
  toast_snapshot_id uuid not null,
  first_seen_at     timestamptz not null default clock_timestamp(),
  last_seen_at      timestamptz not null default clock_timestamp(),
  primary key (location_id, order_guid, check_guid, code_norm)
);
create index catering_toast_note_codes_snapshot on public.catering_toast_note_codes (toast_snapshot_id, check_guid);

-- The one writer. p_rows = [{location_id, order_guid, check_guid, toast_snapshot_id, code}]. A row is stored only when
-- (a) it names the order's CURRENT capture and a check of it, and (b) the code IS a known code: a house ring code or
-- an ezCater order number. Anything else is dropped (never an error for an unknown code: the lookup is ephemeral and
-- a code can stop being known between the lookup and this call). Returns the number of rows written.
create function public.record_catering_toast_note_codes(p_rows jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_n integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or exists (
       select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) n
        where jsonb_typeof(n) <> 'object' or coalesce(n->>'code', '') !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'
           or length(n->>'code') > 32 or n->>'order_guid' is null or n->>'check_guid' is null
           or coalesce(n->>'location_id', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(n->>'toast_snapshot_id', '') !~ '^[0-9a-fA-F-]{36}$') then
    -- Codes only: a note's text can never be passed in.
    raise exception 'catering_toast_note_codes_invalid' using errcode = 'P0001';
  end if;
  insert into public.catering_toast_note_codes(location_id, order_guid, check_guid, code_norm, toast_snapshot_id)
  select distinct x.location_id, x.order_guid, x.check_guid, x.code_norm, x.toast_snapshot_id
    from (select (n->>'location_id')::uuid location_id, n->>'order_guid' order_guid, n->>'check_guid' check_guid,
                 upper(replace(btrim(n->>'code'), '-', '')) code_norm, (n->>'toast_snapshot_id')::uuid toast_snapshot_id
            from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) n) x
    join public.toast_orders_latest t on t.id = x.toast_snapshot_id and t.location_id = x.location_id and t.order_guid = x.order_guid
    join public.toast_order_checks c on c.snapshot_id = t.id and c.check_guid = x.check_guid
   where x.code_norm ~ '^[A-Z0-9]{4,32}$'
     and (exists (select 1 from public.catering_pipeline p
                   where p.ring_code is not null and upper(replace(p.ring_code, '-', '')) = x.code_norm)
          or exists (select 1 from public.ezcater_orders e
                      where nullif(btrim(e.order_number), '') is not null
                        and upper(replace(btrim(e.order_number), '-', '')) = x.code_norm))
  on conflict (location_id, order_guid, check_guid, code_norm)
  do update set toast_snapshot_id = excluded.toast_snapshot_id, last_seen_at = clock_timestamp();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- The house planner, re-emitted from 0347 by ADDING LINES ONLY (pinned as a line-subsequence): the recorded note codes
-- of a check's CURRENT capture are tokens, beside the retained names and the ephemeral p_note_codes. So the panel, the
-- suggestion line and the reconciler all see a ring code (or an ezCater number: the dual_code flag) typed as a special
-- request, with no Toast call on a read path. No recorded note code = 0347's rows exactly.
create or replace function public.plan_catering_toast(p_location_id uuid, p_from date, p_to date, p_note_codes jsonb default '[]'::jsonb)
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
    union
    -- (c) 0348 (contract #3): codes the one note lookup RECORDED on this very capture (codes only, never text).
    select c.toast_snapshot_id, c.check_guid, n.code_norm
      from checks c
      join public.catering_toast_note_codes n
        on n.location_id = c.location_id and n.toast_snapshot_id = c.toast_snapshot_id and n.check_guid = c.check_guid
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
              when public.catering_toast_house_owner(p_location_id, b.order_guid, b.check_guid) is not null then 'house' end,
         public.catering_toast_house_owner(p_location_id, b.order_guid, b.check_guid),
         exists (select 1 from public.catering_toast_decision_heads d
                  where d.lead_id = b.lead_id and d.location_id = p_location_id and d.order_guid = b.order_guid
                    and d.check_guid = b.check_guid and d.kind in ('unlink', 'not_a_match'))
    from best b cross join tol
   order by b.lead_id, b.order_guid, b.check_guid;
end $$;

-- 2. ONE rule for house code evidence on a check -----------------------------------------------------------------------
-- The live house leads whose ring code is on the check, pairs not blocked: (a) a token of the check's live
-- item-bearing selection names (the 0229 token rule, 0347's body), or (b) a note code recorded on the check's CURRENT
-- capture. Sorted; empty = no house evidence.
create function public.catering_toast_check_code_leads(p_location_id uuid, p_order_guid text, p_check_guid text) returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct x.lead_id order by x.lead_id), '{}'::uuid[])
    from (
      select r.lead_id
        from public.toast_orders_latest t
        cross join lateral jsonb_array_elements(t.selection_units) s
        cross join lateral regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok
        join public.catering_live_ring_codes r on r.location_id = t.location_id and r.code_norm = upper(replace(tok[1],'-',''))
       where t.location_id = p_location_id and t.order_guid = p_order_guid
         and not t.voided and not t.deleted and not t.excess_food
         and s->>'check_guid' = p_check_guid
         and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false)
         and not public.catering_toast_pair_blocked(r.lead_id, p_location_id, p_order_guid, p_check_guid)
      union
      select r.lead_id
        from public.catering_toast_note_codes n
        join public.toast_orders_latest t on t.id = n.toast_snapshot_id and t.location_id = n.location_id and t.order_guid = n.order_guid
        join public.toast_order_checks c on c.snapshot_id = t.id and c.check_guid = n.check_guid
        join public.catering_live_ring_codes r on r.location_id = n.location_id and r.code_norm = n.code_norm
       where n.location_id = p_location_id and n.order_guid = p_order_guid and n.check_guid = p_check_guid
         and not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
         and not public.catering_toast_pair_blocked(r.lead_id, p_location_id, p_order_guid, p_check_guid)
    ) x
$$;

-- 0347's function, now the first element of the one rule (the same lead 0347's min() named when only names count).
create or replace function public.catering_toast_check_house_code(p_location_id uuid, p_order_guid text, p_check_guid text) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select (public.catering_toast_check_code_leads(p_location_id, p_order_guid, p_check_guid))[1]
$$;

-- 3. The ezCater planner, re-emitted from 0347 by ADDING LINES ONLY ----------------------------------------------------
create or replace function public.plan_ezcater_toast() returns table(
 order_id uuid,snapshot_id uuid,location_id uuid,toast_snapshot_id uuid,order_guid text,check_guid text,selection_guid text,
 business_date date,evidence text,amount_diff_cents bigint,amount_mismatch boolean,reconciliation_details jsonb)
language sql stable security definer set search_path=pg_catalog,public as $plan$
with eligible as (
 select o.id order_id,o.snapshot_id,coalesce(p.location_id,o.location_id) location_id,o.event_date,o.order_number,o.subtotal_cents
 from public.ezcater_orders o left join public.catering_pipeline p on p.id=o.lead_id
 where o.snapshot_id is not null and o.event_date is not null and coalesce(p.stage,'')<>'lost'
 and lower(coalesce(o.status,'')) !~ '(cancel|reject|fail)'
), checks as (
 select t.id toast_snapshot_id,t.location_id,t.order_guid,c.check_guid,t.business_date,c.amount_cents,t.selection_units,
 exists(select 1 from public.toast_dining_options d where d.location_id=t.location_id and d.guid=t.dining_option_guid
 and lower(regexp_replace(d.name,'[^a-zA-Z0-9]','','g'))='ezcater') is_ezcater
 from public.toast_orders_latest t join public.toast_order_checks c on c.snapshot_id=t.id
 where not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
 -- 0231: only the window ezCater orders can link to (D-1 .. D+7); Toast history reaches back 12 months.
 and t.business_date between (select min(event_date)-1 from eligible) and (select max(event_date)+7 from eligible)
 -- 0347 (plan r3 #3): a check a house lead holds is not ezCater's to plan, upstream of tokens, candidates and batch
 -- totals. ezCater never holds it at the same time (0347 guards); if it ever did, its incumbent row is kept.
 and (public.catering_toast_house_owner(t.location_id,t.order_guid,c.check_guid) is null
 or exists(select 1 from public.ezcater_toast_links z where z.is_current and z.location_id=t.location_id
 and z.order_guid=t.order_guid and z.check_guid=c.check_guid))
), tokens as (
 -- 0231: tokenize each live selection name once, then match codes by equality.
 select distinct c.toast_snapshot_id,c.location_id,c.order_guid,c.check_guid,c.business_date,
 s->>'selection_guid' selection_guid,upper(replace(tok[1],'-','')) code
 from checks c cross join lateral jsonb_array_elements(c.selection_units) s
 cross join lateral regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok
 where s->>'check_guid'=c.check_guid and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false)
), house_coded as (
 -- 0347 (Astra r3 #1/#2): a check carrying a live house ring code is not ADMITTED to ezCater by code or batch while
 -- ezCater does not already hold it. An incumbent keeps its evidence: a rival code never retires an owner.
 select distinct k.toast_snapshot_id,k.check_guid from tokens k
 join public.catering_live_ring_codes r on r.location_id=k.location_id and r.code_norm=k.code
 where not public.catering_toast_pair_blocked(r.lead_id,k.location_id,k.order_guid,k.check_guid)
 and not exists(select 1 from public.ezcater_toast_links z where z.is_current and z.location_id=k.location_id
 and z.order_guid=k.order_guid and z.check_guid=k.check_guid)
 union
 -- 0348 (contract #3): the same rule for a live ring code typed as a special-request note, as the one note lookup
 -- recorded it on this very capture (catering_toast_note_codes). No recorded note code = 0347's rows exactly.
 select c.toast_snapshot_id,c.check_guid from checks c
 join public.catering_toast_note_codes n on n.toast_snapshot_id=c.toast_snapshot_id and n.check_guid=c.check_guid
 join public.catering_live_ring_codes r on r.location_id=c.location_id and r.code_norm=n.code_norm
 where not public.catering_toast_pair_blocked(r.lead_id,c.location_id,c.order_guid,c.check_guid)
 and not exists(select 1 from public.ezcater_toast_links z where z.is_current and z.location_id=c.location_id
 and z.order_guid=c.order_guid and z.check_guid=c.check_guid)
), candidates as (
 select distinct e.*,k.toast_snapshot_id,k.order_guid,k.check_guid,k.business_date,
 k.selection_guid,case when k.business_date-e.event_date<=1 then 'normalized_code' else 'late_code' end evidence
 from eligible e join tokens k on k.location_id=e.location_id and k.business_date between e.event_date-1 and e.event_date+7
 and k.code=upper(replace(btrim(e.order_number),'-',''))
 where nullif(e.order_number,'') is not null
 and not exists(select 1 from house_coded h where h.toast_snapshot_id=k.toast_snapshot_id and h.check_guid=k.check_guid)
 union
 select e.*,c.toast_snapshot_id,c.order_guid,c.check_guid,c.business_date,l.selection_guid,
 case when c.business_date-e.event_date<=1 then 'normalized_code' else 'late_code' end
 from eligible e join public.ezcater_toast_links l on l.order_id=e.order_id and l.snapshot_id=e.snapshot_id
 and l.location_id=e.location_id and l.is_current and l.evidence in ('normalized_code','late_code')
 join checks c on c.toast_snapshot_id=l.toast_snapshot_id and c.check_guid=l.check_guid
 and c.business_date between e.event_date-1 and e.event_date+7
 and exists(select 1 from jsonb_array_elements(c.selection_units) s where s->>'check_guid'=c.check_guid
 and s->>'selection_guid'=l.selection_guid and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false))
), prioritized as (
 select *,min(case evidence when 'normalized_code' then 1 else 2 end) over(partition by toast_snapshot_id,check_guid,selection_guid) priority
 from candidates
), codes as (
 select c.* from prioritized c where (case evidence when 'normalized_code' then 1 else 2 end)=priority
 and 1=(select count(distinct x.order_id) from prioritized x where x.toast_snapshot_id=c.toast_snapshot_id and x.check_guid=c.check_guid
 and x.selection_guid=c.selection_guid and (case x.evidence when 'normalized_code' then 1 else 2 end)=x.priority)
), remaining as (
 select e.* from eligible e where not exists(select 1 from codes c where c.order_id=e.order_id)
), batch_checks as (
 select c.*,case when exists(select 1 from eligible e where e.location_id=c.location_id and e.event_date=c.business_date)
 then c.business_date else c.business_date-1 end target_date
 from checks c where c.is_ezcater and not exists(select 1 from codes k where k.toast_snapshot_id=c.toast_snapshot_id and k.check_guid=c.check_guid)
 and not exists(select 1 from house_coded h where h.toast_snapshot_id=c.toast_snapshot_id and h.check_guid=c.check_guid)
) , batches as (
 -- Same-day batches claim their day first; D+1 fallback cannot claim it again.
 select b.* from batch_checks b where b.target_date=b.business_date or not exists(
 select 1 from batch_checks direct where direct.location_id=b.location_id
 and direct.business_date=b.target_date and direct.target_date=b.target_date)
), batch_totals as (
 select b.location_id,b.target_date,sum(b.amount_cents) toast_cents,
 (select sum(r.subtotal_cents) from remaining r where r.location_id=b.location_id and r.event_date=b.target_date) ez_cents
 from batches b group by b.location_id,b.target_date
), planned as (
 select order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence,
 null::bigint amount_diff_cents,false amount_mismatch,'{}'::jsonb reconciliation_details from codes
 union all
 select r.order_id,r.snapshot_id,r.location_id,b.toast_snapshot_id,b.order_guid,b.check_guid,''::text,b.business_date,'daily_batch',
 (t.toast_cents-t.ez_cents)::bigint,coalesce(abs(t.toast_cents-t.ez_cents)>5000 and abs(t.toast_cents-t.ez_cents)>abs(t.ez_cents)*0.15,false),
 jsonb_build_object('toast_subtotal_cents',t.toast_cents,'ezcater_subtotal_cents',t.ez_cents,'event_date',b.target_date,'fallback',b.target_date<>b.business_date)
 from remaining r join batches b on b.location_id=r.location_id and b.target_date=r.event_date
 join batch_totals t on t.location_id=b.location_id and t.target_date=b.target_date
)
select * from planned
$plan$;

-- 4. Ring codes for booked house leads (cron, never a read path) --------------------------------------------------------
-- Each booked house lead of the shop with an event on or after p_from, no code yet, not created from a Toast order
-- (it is rung by construction) and not marked "no Toast ring expected", gets its code from 0344's generator. Bounded.
create function public.ensure_catering_ring_codes(p_location_id uuid, p_from date) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; v_n integer := 0;
begin
  if p_location_id is null or p_from is null then raise exception 'catering_toast_invalid_window' using errcode = 'P0001'; end if;
  if not coalesce((select s.enabled and s.ring_code_enabled from public.catering_toast_settings s
                    where s.location_id = p_location_id), false) then
    return 0;
  end if;
  for r in
    select s.lead_id from public.catering_reconciliation_status s
     where s.location_id = p_location_id and s.event_date >= p_from and s.ring_code is null
       and not s.toast_origin and s.status <> 'no_ring_expected'
     order by s.event_date, s.lead_id limit 200
  loop
    perform public.ensure_catering_ring_code(r.lead_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 5. The house reconciler ---------------------------------------------------------------------------------------------
-- A check rung on an ezCater dining option (the ezCater planner's own test, or the reviewed channel map's provider).
create function public.catering_toast_check_on_ezcater_option(p_location_id uuid, p_order_guid text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.toast_orders_latest t
      join public.toast_dining_options d on d.location_id = t.location_id and d.guid = t.dining_option_guid
     where t.location_id = p_location_id and t.order_guid = p_order_guid
       and (lower(regexp_replace(d.name,'[^a-zA-Z0-9]','','g')) = 'ezcater'
            or exists (select 1 from public.sales_channel_map m
                        where m.dining_option_label = d.name and lower(coalesce(m.provider, '')) = 'ezcater')))
$$;

create function public.reconcile_catering_toast(p_location_id uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_set public.catering_toast_settings%rowtype; v_locked uuid[]; r record; v_reason text; v_codes uuid[]; v_evidence text;
  v_link uuid; v_links uuid[] := '{}'; v_ring integer := 0; v_origin integer := 0; v_already integer := 0; v_skipped jsonb := '{}'::jsonb;
begin
  if p_location_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'catering_toast_invalid_window' using errcode = 'P0001';
  end if;
  -- A shop that is off never takes the shared lock (the cron asks every ten minutes). Read again under the lock below.
  if not coalesce((select s.enabled and (s.auto_link_enabled or s.origin_auto_link_enabled) and s.auto_link_from_date is not null
                     from public.catering_toast_settings s where s.location_id = p_location_id), false) then
    return jsonb_build_object('skipped', 'off');
  end if;
  -- Lock order: the reconcile advisory lock FIRST (publisher, ezCater reconciler, decide_catering_toast), then leads,
  -- then link rows.
  perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));
  select * into v_set from public.catering_toast_settings s where s.location_id = p_location_id;
  -- Everything is off by default: no row, or a shop that is off, or neither automatic switch = nothing is written.
  if v_set.location_id is null or not v_set.enabled or not (v_set.auto_link_enabled or v_set.origin_auto_link_enabled)
     or v_set.auto_link_from_date is null then
    return jsonb_build_object('skipped', 'off');
  end if;
  if not public.catering_toast_link_ready() then return jsonb_build_object('skipped', 'not_ready'); end if;

  -- The leads this run may write, locked in id order; then planned AGAIN under those locks (a transfer or a stage
  -- change that committed first is seen), and only a lead held here is written.
  select coalesce(array_agg(k.id), '{}'::uuid[]) into v_locked
    from (select p.id from public.catering_pipeline p
           where p.id in (select x.lead_id from public.plan_catering_toast(p_location_id, p_from, p_to, '[]'::jsonb) x
                           where x.evidence in ('ring_code', 'toast_origin'))
           order by p.id for no key update) k;

  for r in
    select x.lead_id, x.order_guid, x.check_guid, x.toast_snapshot_id, x.business_date, x.evidence, x.dual_code,
           x.owner, x.owner_lead_id, x.blocked, lp.event_date
      from public.plan_catering_toast(p_location_id, p_from, p_to, '[]'::jsonb) x
      join public.catering_pipeline lp on lp.id = x.lead_id
     where x.evidence in ('ring_code', 'toast_origin') and x.lead_id = any(v_locked)
     order by x.lead_id, x.order_guid, x.check_guid
  loop
    if r.owner_lead_id = r.lead_id then v_already := v_already + 1; continue; end if;
    -- THE one rule for house code evidence on the check (the publisher guard and the ezCater planner read it too).
    v_codes := public.catering_toast_check_code_leads(p_location_id, r.order_guid, r.check_guid);
    -- Each kind of evidence behind its own switch. A Toast-origin lead whose ring code is also on the check may link
    -- by the code when only the code switch is on.
    v_evidence := case when r.evidence = 'toast_origin' and v_set.origin_auto_link_enabled then 'toast_origin'
                       when r.lead_id = any(v_codes) and v_set.auto_link_enabled then 'ring_code' end;
    v_reason := case
      -- The tombstone (an unlink / not_a_match head): nothing automatic relinks the pair (plan r3 #5).
      when r.blocked then 'blocked'
      when exists (select 1 from public.catering_toast_decision_heads d
                    where d.lead_id = r.lead_id and d.location_id is null and d.kind = 'no_ring_expected') then 'no_ring_expected'
      when v_evidence is null then 'switch_off'
      -- Backfill is suggestions only (Juan answer 7).
      when r.event_date < v_set.auto_link_from_date then 'before_start_date'
      when r.owner is not null then 'owned'
      -- The window the human Link uses (decide_catering_toast: check_out_of_window).
      when r.business_date not between r.event_date - 1 and r.event_date + 7 then 'out_of_window'
      -- An ezCater number on the same check: neither source links, a person decides (plan r3 #4).
      when r.dual_code then 'dual_code'
      -- Two house orders claim one check (two ring codes, or a code on another lead's Toast order): a person decides.
      when exists (select 1 from unnest(v_codes) c where c <> r.lead_id)
        or exists (select 1 from public.toast_catering_orders o where o.location_id = p_location_id
                    and o.order_guid = r.order_guid and o.lead_id is not null and o.lead_id <> r.lead_id) then 'two_house_orders'
      -- ezCater's daily batch may claim a check on its dining option: origin alone never decides between them.
      when v_evidence = 'toast_origin' and public.catering_toast_check_on_ezcater_option(p_location_id, r.order_guid) then 'ezcater_dining_option'
      -- Asked again NOW: an earlier row of this very run may have linked the check.
      when public.catering_toast_house_owner(p_location_id, r.order_guid, r.check_guid) is not null
        or exists (select 1 from public.ezcater_toast_links z where z.is_current and z.location_id = p_location_id
                    and z.order_guid = r.order_guid and z.check_guid = r.check_guid) then 'owned'
      else null end;
    if v_reason is not null then
      v_skipped := jsonb_set(v_skipped, array[v_reason], to_jsonb(coalesce((v_skipped->>v_reason)::integer, 0) + 1));
      continue;
    end if;
    -- A current row still on this check is DORMANT (its lead no longer qualifies, or the owner rule above would have
    -- answered): a SYSTEM retirement, no tombstone -- the same step as decide_catering_toast's link branch.
    update public.catering_toast_links h
       set is_current = false, retired_at = clock_timestamp(),
           retired_reason = public.catering_toast_stale_reason(h.lead_id, h.location_id)
     where h.is_current and h.location_id = p_location_id and h.order_guid = r.order_guid and h.check_guid = r.check_guid;
    insert into public.catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence)
      values (r.lead_id, p_location_id, r.order_guid, r.check_guid, r.toast_snapshot_id, v_evidence) returning id into v_link;
    v_links := v_links || v_link;
    if v_evidence = 'ring_code' then v_ring := v_ring + 1; else v_origin := v_origin + 1; end if;
  end loop;

  -- One run-level row, only when the run changed something (the ezcater.toast_reconciled posture): a system
  -- observation, never destructive. Ids and counts only.
  if v_ring + v_origin > 0 then
    insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (null, null, 'catering.toast_reconciled', 'catering_toast_links', null,
              jsonb_build_object('location_id', p_location_id, 'from', p_from, 'to', p_to, 'added', v_ring + v_origin,
                                 'ring_code', v_ring, 'toast_origin', v_origin, 'skipped', v_skipped,
                                 'link_ids', to_jsonb(v_links[1:50])),
              false);
  end if;
  return jsonb_build_object('added', v_ring + v_origin, 'ring_code', v_ring, 'toast_origin', v_origin,
                            'already_linked', v_already, 'skipped', v_skipped);
end $$;

-- 6. Row security and the privilege ceiling (0257 pattern) -------------------------------------------------------------
alter table public.catering_toast_note_codes enable row level security;
create policy catering_toast_note_codes_no_user_select on public.catering_toast_note_codes for select using (false);
create policy catering_toast_note_codes_no_user_insert on public.catering_toast_note_codes for insert with check (false);
create policy catering_toast_note_codes_no_user_update on public.catering_toast_note_codes for update using (false);
create policy catering_toast_note_codes_no_user_delete on public.catering_toast_note_codes for delete using (false);
revoke all on public.catering_toast_note_codes from public, anon, authenticated, service_role;
grant select on public.catering_toast_note_codes to service_role;

revoke all on function public.record_catering_toast_note_codes(jsonb) from public, anon, authenticated;
grant execute on function public.record_catering_toast_note_codes(jsonb) to service_role;
revoke all on function public.plan_catering_toast(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.plan_catering_toast(uuid, date, date, jsonb) to service_role;
revoke all on function public.catering_toast_check_code_leads(uuid, text, text) from public, anon, authenticated;
revoke all on function public.catering_toast_check_house_code(uuid, text, text) from public, anon, authenticated;
revoke all on function public.catering_toast_check_on_ezcater_option(uuid, text) from public, anon, authenticated;
revoke all on function public.plan_ezcater_toast() from public, anon, authenticated;
revoke all on function public.ensure_catering_ring_codes(uuid, date) from public, anon, authenticated;
grant execute on function public.ensure_catering_ring_codes(uuid, date) to service_role;
revoke all on function public.reconcile_catering_toast(uuid, date, date) from public, anon, authenticated;
grant execute on function public.reconcile_catering_toast(uuid, date, date) to service_role;

do $$
declare p text; f text;
begin
  if not has_table_privilege('service_role', 'public.catering_toast_note_codes', 'select') then raise exception 'ceiling: select missing'; end if;
  foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('service_role', 'public.catering_toast_note_codes', p) then raise exception 'ceiling: service_role holds %', p; end if;
    if has_table_privilege('authenticated', 'public.catering_toast_note_codes', p) or has_table_privilege('anon', 'public.catering_toast_note_codes', p) then
      raise exception 'ceiling: a user role holds %', p;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.catering_toast_note_codes', 'select') or has_table_privilege('anon', 'public.catering_toast_note_codes', 'select') then
    raise exception 'ceiling: a user role can read catering_toast_note_codes';
  end if;
  foreach f in array array['record_catering_toast_note_codes(jsonb)', 'plan_catering_toast(uuid,date,date,jsonb)',
                           'catering_toast_check_code_leads(uuid,text,text)', 'catering_toast_check_house_code(uuid,text,text)',
                           'catering_toast_check_on_ezcater_option(uuid,text)', 'plan_ezcater_toast()',
                           'ensure_catering_ring_codes(uuid,date)', 'reconcile_catering_toast(uuid,date,date)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'ceiling: a user role can execute %', f;
    end if;
  end loop;
end $$;

commit;

-- Verify after apply:
--   select count(*) from pg_policies where tablename = 'catering_toast_note_codes';      -- 4
--   select count(*) from public.catering_toast_note_codes;                                -- 0 (no lookup has run)
--   select public.catering_toast_link_ready();                                            -- true (0347 untouched)
--   select public.reconcile_catering_toast('<shop>', current_date - 8, current_date + 1); -- {"skipped": "off"} (no settings row)
--   Planner equivalence (read-only, sim then prod; zero recorded note codes): the 0347 bodies run beside the new
--   planners return identical rows, both ways (ezCater and house), and the ezCater planner's time stays near 0347's
--   (about 2.4 s on prod against the 8 s statement timeout; the prepared apply script refuses above 3 s).
