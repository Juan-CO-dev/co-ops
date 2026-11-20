-- Migration 0347_catering_toast_link_step
-- AUTHORED 2026-11-18 (item 21 PR 3, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first (with the sim two-session proof), then prod on Juan's word. Apply AFTER 0344.
-- APPLIED TO PROD 2026-11-19 UTC (schema_migrations version 20261119041752, name '0347_catering_toast_link_step'), after sim. The line above is the authoring-time gate note, kept as history.
-- NUMBER: 0345 is the highest on main; 0346 may be claimed by board PR 2 (worktree board2), so this file takes 0347 to be safe.
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-21-PORTAL-CATERING-TOAST-PLAN-r3.md ("Migration B"),
-- with Juan's 8 answers and the two contracts PR 2 left for PR 3 (docs/runbooks/catering-toast.md, Astra r3 #1 and #2).
--
-- WHAT THIS IS. The LINK step of the portal-catering <-> Toast cross-check: the first link writes, HUMAN ONLY.
--   decide_catering_toast(...)         THE one writer of house links and decisions (link, unlink, not_a_match,
--                                      no_ring_expected, ring_expected). Catering manager (any shop) and GM and up
--                                      (Juan answer 8; a GM at a shop they are an active member of, level 8+ any shop),
--                                      re-checked here under the locks. Every decision writes its own audit row.
--   catering_toast_conflicts           a ledger of ezCater link rows this migration's trigger SKIPPED (never raised).
--   ezcater_toast_links_house_guard    BEFORE INSERT on ezcater_toast_links, NEVER RAISES. Returns NULL (the row is
--                                      skipped, the rest of the publication commits) when the check is held by a house
--                                      lead, or when the check is UNOWNED by ezCater and carries a live house ring code
--                                      (contract #1: the publisher inserts from its payload and calls no planner, so the
--                                      dual-code rule must hold at its insertion boundary). An INCUMBENT ezCater check
--                                      (a current row, or one this same transaction retired -- the reconciler's
--                                      retire-then-reinsert on a recapture) always passes: a rival code never takes a
--                                      check from ezCater (contract #2).
--   catering_toast_links_ezcater_guard BEFORE INSERT on catering_toast_links, RAISES check_owned_by_ezcater. Safe: the
--                                      only writer is decide_catering_toast, which refuses first by name.
--   plan_ezcater_toast()               re-emitted from 0231 by ADDING LINES ONLY (pinned as a line-subsequence):
--                                      a house-owned check leaves `checks` (before tokens, candidates and batch totals,
--                                      plan r3 #3); a check carrying a live house ring code that ezCater does not
--                                      already own is not admitted by code or batch (contract #2: incumbent evidence
--                                      stays in candidates / batch_checks, so the unchanged reconciler never retires an
--                                      owner). With no house link and no ring code it returns 0231's rows exactly.
--   ezcater_order_house_conflicts(...) a read: the ezCater side of a conflict, for the lead's reconciliation panel.
--                                      Only conflicts whose facts hold NOW (fix round 2): a recorded conflict is not
--                                      shown once the check is voided, the house evidence is gone or unlinked, the
--                                      ezCater order is cancelled / lost, moved to another shop or to a date outside
--                                      the check's window (fix round 3), or ezCater rang the order on another check,
--                                      or the ezCater evidence is gone from the check as Toast has it now (fix
--                                      round 4). The ledger is history and is never deleted.
--   catering_pipeline_end_toast_links  AFTER UPDATE on catering_pipeline (fix round 1): a lead that leaves its shop, is
--                                      lost, or becomes an ezCater lead ENDS its house links in the same transaction
--                                      (recorded lead_moved / lead_lost / lead_ezcater). Nothing revives a link.
--   plan_catering_toast(...)           re-emitted from 0344 with ONE change (pinned): owner / owner_lead_id come from
--                                      catering_toast_house_owner, the writer's own rule, not from the raw current row.
--   catering_toast_orphans             re-created from 0344 with the same one change.
--   catering_toast_ended_links(...)    a read: links of a lead that the SYSTEM ended, with the check's owner now.
--   catering_toast_link_ready()        the readiness probe the link panel asks before it offers a control.
--
-- OWNERSHIP (plan r3; fix round 1, review PORTAL3-r1). ezCater owns a check while a RAW is_current row exists in
-- ezcater_toast_links on the logical key (shop, order guid, check guid). House owns it while a current
-- catering_toast_links row exists AND its lead is still at that shop, not lost, not ezCater
-- (catering_toast_house_owner: THE one owner rule; the guards, both planners, the orphans view and the writer ask it).
-- A HOUSE LINK NEVER COMES BACK. It ends, for good and on the row (retired_at + retired_reason), when
--   (a) a person unlinks it (decide_catering_toast, the tombstone);
--   (b) its lead leaves the shop, is lost, or becomes an ezCater lead by an UPDATE of catering_pipeline (the trigger in
--       section 3b, same transaction as the 0225 transfer or the stage change);
--   (c) ezCater is admitted to the check while the holder no longer qualifies (the guard in section 3 ends the dormant
--       row in the admitting transaction; this covers a holder that stopped qualifying with no UPDATE of its own row,
--       e.g. an ezCater order attached to it), or another house lead takes it (the writer).
-- So a round-trip transfer, or lost -> re-opened, returns a lead with NO link: if ezCater took the check meanwhile,
-- ezCater keeps it and the lead shows the ended link with its present owner (catering_toast_ended_links); otherwise a
-- person may link it again (a NEW link row). Nothing here updates ezcater_toast_links (pinned).
--
-- EVIDENCE. The dual-code test reads the RETAINED evidence: item-bearing selection names (the 0229 token rule, copied
-- verbatim) matched against live house ring codes (catering_live_ring_codes). A pair whose head is `unlink` or
-- `not_a_match` is not evidence (the person said this lead is not this check), and neither is the code of a lead
-- marked "no Toast ring expected" (the person said this order has no check at all; fix round 4).
-- A RECORDED conflict holds only while the ezCater evidence is still on the check AS TOAST HAS IT NOW (fix round 4,
-- review PORTAL3-r4): the ledger row remembers the Toast snapshot the skipped publication named, and the read shows
-- it only while that is still the check's current snapshot (the publisher found its evidence, a name or a special
-- request, on this very capture) or the current capture's retained names still carry the ezCater order's number. Ring codes typed as SPECIAL_REQUEST notes
-- join this test in PR 4, when the reconcile pass hands the one note lookup's intersections to both sides (contract #3);
-- until then no ring code exists anywhere (ring_code_enabled is off and waits for the fixture gate AND for PR 4).
--
-- LOCKS. decide_catering_toast takes hashtext('ezcater-toast-reconcile') FIRST (as the 0229 publisher and the 0330
-- reconciler do), then the lead row FOR NO KEY UPDATE, then the link row(s) FOR UPDATE, then appends the decision.
-- Transfer (0225) holds a lead row and never waits for that advisory lock, so there is no cycle. Every function that
-- inserts into either link table takes the advisory lock first (pinned).
-- The lead trigger (3b) runs inside whatever updated the lead: it holds that lead row, then takes the lead's OWN link
-- rows. The guard's end of a dormant row (3) runs under the advisory lock and takes a link row only. Nothing waits for
-- a lead row or the advisory lock while holding a link row, so the order (advisory) -> lead -> link has no cycle.
--
-- APPEND-ONLY BY GRANT: deny-all RLS, service_role SELECT only, every write through SECURITY DEFINER.
-- Proof: scripts/sql-harness-0347.mjs (PGlite; the REAL 0221 view, 0229 publisher, 0231 planner, 0330 reconciler and
-- 0344 file), CI-pinned by tests/catering-toast-0347-migration.test.ts. Two-session proof (CC, sim only, both commit
-- orders): publisher vs manual link; ezCater reconcile vs manual link; two managers on one check; link vs lead transfer;
-- recapture then manual link then reconcile; transfer away vs an ezCater publication of the same check.

begin;

-- 0. Pre-flight: 0344 is in place and the live ezCater planner is still 0231's body (the one this file re-emits).
do $$
begin
  if to_regclass('public.catering_toast_links') is null or to_regclass('public.catering_toast_link_decisions') is null
     or to_regclass('public.catering_toast_settings') is null or to_regprocedure('public.plan_catering_toast(uuid,date,date,jsonb)') is null then
    raise exception '0347: apply 0344 first';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'plan_ezcater_toast'
                    and strpos(p.prosrc, '0231: tokenize each live selection name once, then match codes by equality.') > 0
                    and strpos(p.prosrc, '0347') = 0) then
    raise exception '0347: the live plan_ezcater_toast is not the 0231 body; re-emit this file from the live definer';
  end if;
end $$;

-- 0b. One more closed reason for a link the system ends: its lead became an ezCater lead. (0344 named the column's
-- inline check; the table is empty until this migration's writer exists.)
alter table public.catering_toast_links drop constraint catering_toast_links_retired_reason_check;
alter table public.catering_toast_links add constraint catering_toast_links_retired_reason_check
  check (retired_reason in ('unlinked', 'check_gone', 'lead_moved', 'lead_lost', 'lead_ezcater'));

-- 1. Ownership and evidence helpers ----------------------------------------------------------------------------------
-- Live house ring codes: a house lead (not ezCater, not lost) at a shop, normalized the 0229:46 way.
create view public.catering_live_ring_codes with (security_invoker = true) as
select p.id lead_id, p.location_id, upper(replace(p.ring_code, '-', '')) code_norm
  from public.catering_pipeline p
 where p.ring_code is not null and p.location_id is not null and p.stage <> 'lost'
   and coalesce(p.lead_source, '') <> 'ezcater'
   and not exists (select 1 from public.ezcater_orders e where e.lead_id = p.id)
   -- Fix round 4: a lead marked "no Toast ring expected" claims no check, so its code is not evidence (the writer
   -- refuses it a link, lead_no_ring_expected). "Ring expected" brings the code back.
   and not exists (select 1 from public.catering_toast_decision_heads d
                    where d.lead_id = p.id and d.location_id is null and d.kind = 'no_ring_expected');

-- The lead that HOLDS a check for house: a current link whose lead is still at that shop, not lost, not ezCater.
create function public.catering_toast_house_owner(p_location_id uuid, p_order_guid text, p_check_guid text) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select h.lead_id from public.catering_toast_links h join public.catering_pipeline p on p.id = h.lead_id
   where h.is_current and h.location_id = p_location_id and h.order_guid = p_order_guid and h.check_guid = p_check_guid
     and p.location_id = h.location_id and p.stage <> 'lost' and coalesce(p.lead_source, '') <> 'ezcater'
     and not exists (select 1 from public.ezcater_orders e where e.lead_id = p.id)
   limit 1
$$;

-- Why a holder no longer qualifies (the reason recorded on a link the system ends). Never NULL.
create function public.catering_toast_stale_reason(p_lead_id uuid, p_link_location_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select case when p.location_id is distinct from p_link_location_id then 'lead_moved'
                               when p.stage = 'lost' then 'lead_lost' else 'lead_ezcater' end
                     from public.catering_pipeline p where p.id = p_lead_id), 'lead_moved')
$$;

-- An unlink or not_a_match head on the pair: the person said this lead is not this check (plan r3 #5).
create function public.catering_toast_pair_blocked(p_lead_id uuid, p_location_id uuid, p_order_guid text, p_check_guid text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.catering_toast_decision_heads d
                  where d.lead_id = p_lead_id and d.location_id = p_location_id and d.order_guid = p_order_guid
                    and d.check_guid = p_check_guid and d.kind in ('unlink', 'not_a_match'))
$$;

-- A live house lead whose ring code is a token of the check's live item-bearing selections (the 0229 token rule), the
-- pair not blocked. NULL = no house evidence on the check.
create function public.catering_toast_check_house_code(p_location_id uuid, p_order_guid text, p_check_guid text) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select min(r.lead_id::text)::uuid
    from public.toast_orders_latest t
    cross join lateral jsonb_array_elements(t.selection_units) s
    cross join lateral regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok
    join public.catering_live_ring_codes r on r.location_id = t.location_id and r.code_norm = upper(replace(tok[1],'-',''))
   where t.location_id = p_location_id and t.order_guid = p_order_guid
     and not t.voided and not t.deleted and not t.excess_food
     and s->>'check_guid' = p_check_guid
     and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false)
     and not public.catering_toast_pair_blocked(r.lead_id, p_location_id, p_order_guid, p_check_guid)
$$;

-- ezCater already holds the check: a current row on the logical key, or a row THIS transaction retired (the reconciler
-- retires a stale-snapshot link and re-inserts it on the new snapshot in one transaction, 0330:316-328; between the two
-- the check is still ezCater's). xmin of a retired row version = the transaction that retired it. The callers run as
-- top-level statements (no savepoint); were one ever wrapped in a savepoint, its re-insert would be skipped and a
-- conflict recorded -- visible, never a silent change of owner.
create function public.ezcater_toast_incumbent(p_location_id uuid, p_order_guid text, p_check_guid text) returns boolean
language sql volatile security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.ezcater_toast_links z
                  where z.location_id = p_location_id and z.order_guid = p_order_guid and z.check_guid = p_check_guid
                    and (z.is_current or z.xmin::text = (txid_current() % 4294967296)::text))
$$;

-- 2. The conflict ledger --------------------------------------------------------------------------------------------
create table public.catering_toast_conflicts (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references public.locations(id),
  order_guid       text not null,
  check_guid       text not null,
  kind             text not null check (kind in ('dual_code', 'ownership_conflict')),
  ezcater_order_id uuid not null,
  house_lead_id    uuid,
  -- The Toast snapshot the skipped publication named, as last seen (fix round 4): the capture its evidence was on.
  toast_snapshot_id uuid,
  first_seen_at    timestamptz not null default clock_timestamp(),
  last_seen_at     timestamptz not null default clock_timestamp(),
  seen_count       integer not null default 1
);
create unique index catering_toast_conflicts_key on public.catering_toast_conflicts (location_id, order_guid, check_guid, kind, ezcater_order_id);
create index catering_toast_conflicts_order on public.catering_toast_conflicts (ezcater_order_id);

-- 3. The guards -----------------------------------------------------------------------------------------------------
-- NEVER RAISES. Any failure inside passes the row through unchanged (today's behaviour), never an error that would
-- abort the publisher (lib/ezcater/pass2.ts) and with it the reconciler behind it (lib/ezcater/reconcile.ts).
create function public.ezcater_toast_links_house_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lead uuid; v_kind text;
begin
  begin
    if not new.is_current then return new; end if;
    v_lead := public.catering_toast_house_owner(new.location_id, new.order_guid, new.check_guid);
    if v_lead is not null then
      v_kind := 'ownership_conflict';
    elsif not public.ezcater_toast_incumbent(new.location_id, new.order_guid, new.check_guid) then
      v_lead := public.catering_toast_check_house_code(new.location_id, new.order_guid, new.check_guid);
      if v_lead is not null then v_kind := 'dual_code'; end if;
    end if;
    if v_kind is null then
      -- ezCater is admitted. A current house row still on this check is DORMANT (its lead no longer qualifies, or the
      -- owner rule above would have answered): end it here, in the admitting transaction, so it can never own again.
      update public.catering_toast_links h
         set is_current = false, retired_at = clock_timestamp(),
             retired_reason = public.catering_toast_stale_reason(h.lead_id, h.location_id)
       where h.is_current and h.location_id = new.location_id and h.order_guid = new.order_guid and h.check_guid = new.check_guid;
      return new;
    end if;
    insert into public.catering_toast_conflicts(location_id, order_guid, check_guid, kind, ezcater_order_id, house_lead_id, toast_snapshot_id)
      values (new.location_id, new.order_guid, new.check_guid, v_kind, new.order_id, v_lead, new.toast_snapshot_id)
      on conflict (location_id, order_guid, check_guid, kind, ezcater_order_id)
      do update set last_seen_at = clock_timestamp(), seen_count = catering_toast_conflicts.seen_count + 1,
                    house_lead_id = excluded.house_lead_id, toast_snapshot_id = excluded.toast_snapshot_id;
    return null;
  exception when others then
    return new;
  end;
end $$;
create trigger ezcater_toast_links_house_guard before insert on public.ezcater_toast_links
  for each row execute function public.ezcater_toast_links_house_guard();

create function public.catering_toast_links_ezcater_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.is_current and exists (select 1 from public.ezcater_toast_links z where z.is_current
       and z.location_id = new.location_id and z.order_guid = new.order_guid and z.check_guid = new.check_guid) then
    raise exception 'check_owned_by_ezcater' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger catering_toast_links_ezcater_guard before insert on public.catering_toast_links
  for each row execute function public.catering_toast_links_ezcater_guard();

-- 3b. A house link ends when its lead stops qualifying (fix round 1) --------------------------------------------------
-- Fires inside whatever updated the lead (the 0225 transfer, a stage move, an edit), so the link ends in the SAME
-- transaction: there is no dormant row for a later transfer back, or a re-open, to bring back to life. A lead's link
-- at ANOTHER shop than the lead's is ended as lead_moved whatever else changed.
create function public.catering_pipeline_end_toast_links() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.catering_toast_links h
     set is_current = false, retired_at = clock_timestamp(),
         retired_reason = case when h.location_id is distinct from new.location_id then 'lead_moved'
                               when new.stage = 'lost' then 'lead_lost' else 'lead_ezcater' end
   where h.lead_id = new.id and h.is_current
     and (h.location_id is distinct from new.location_id or new.stage = 'lost' or coalesce(new.lead_source, '') = 'ezcater');
  return null;
end $$;
create trigger catering_pipeline_end_toast_links after update on public.catering_pipeline
  for each row when (old.location_id is distinct from new.location_id or old.stage is distinct from new.stage
                     or old.lead_source is distinct from new.lead_source)
  execute function public.catering_pipeline_end_toast_links();

-- 4. The ezCater planner, re-emitted from 0231 by ADDING LINES ONLY ----------------------------------------------------
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

-- 5. The ONE writer of house links and decisions -------------------------------------------------------------------
create function public.decide_catering_toast(
  p_actor_id uuid, p_lead_id uuid, p_kind text, p_location_id uuid, p_order_guid text, p_check_guid text,
  p_reason_code text, p_expected_head_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_role text; v_lead public.catering_pipeline%rowtype; v_pair boolean; v_head public.catering_toast_link_decisions%rowtype;
  v_link public.catering_toast_links%rowtype; v_other public.catering_toast_links%rowtype; v_snapshot uuid; v_business date;
  v_total bigint; v_decision uuid; v_link_id uuid; v_retired integer := 0; v_owner uuid;
begin
  if p_kind is null or p_kind not in ('link', 'unlink', 'not_a_match', 'no_ring_expected', 'ring_expected') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  v_pair := p_kind in ('link', 'unlink', 'not_a_match');
  if v_pair <> (p_location_id is not null and nullif(btrim(p_order_guid), '') is not null and nullif(btrim(p_check_guid), '') is not null)
     or (not v_pair and (p_location_id is not null or p_order_guid is not null or p_check_guid is not null))
     or (p_kind = 'no_ring_expected') <> (p_reason_code is not null)
     or (p_reason_code is not null and p_reason_code not in ('paid_outside_toast', 'cancelled', 'comped', 'duplicate_lead', 'other')) then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;

  -- Lock order: the reconcile advisory lock FIRST (publisher, reconciler and every house writer), then the lead, then
  -- link rows, then the decision append.
  perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));

  select u.role into v_role from public.users u where u.id = p_actor_id and u.active;
  if v_role is null or v_role not in ('catering_mgr', 'gm', 'moo', 'owner', 'cgs') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select * into v_lead from public.catering_pipeline where id = p_lead_id for no key update;
  if v_lead.id is null then raise exception 'lead_not_found' using errcode = 'P0001'; end if;
  -- A GM decides only at a shop they are an active member of; catering manager and level 8+ at any shop.
  if v_role = 'gm' and not exists (select 1 from public.user_locations ul where ul.user_id = p_actor_id
                                      and ul.location_id = v_lead.location_id and ul.active) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_lead.location_id is null or v_lead.event_date is null or v_lead.stage not in ('confirmed', 'out', 'completed')
     or coalesce(v_lead.lead_source, '') = 'ezcater' or exists (select 1 from public.ezcater_orders e where e.lead_id = v_lead.id) then
    raise exception 'lead_not_eligible' using errcode = 'P0001';
  end if;
  -- Everything stays behind the shop's `enabled` switch (no row = off): no decision is written for a shop that is off.
  if not coalesce((select s.enabled from public.catering_toast_settings s where s.location_id = v_lead.location_id), false) then
    raise exception 'catering_toast_off' using errcode = 'P0001';
  end if;
  if v_pair and p_kind <> 'unlink' and p_location_id <> v_lead.location_id then
    raise exception 'lead_moved' using errcode = 'P0001';
  end if;

  -- The expected head of THIS key (a pair, or the lead): another decision since the person looked = decision_moved.
  select d.* into v_head from public.catering_toast_decision_heads d
   where d.lead_id = p_lead_id and d.location_id is not distinct from p_location_id
     and d.order_guid is not distinct from p_order_guid and d.check_guid is not distinct from p_check_guid;
  if v_head.id is distinct from p_expected_head_id then raise exception 'decision_moved' using errcode = 'P0001'; end if;

  if p_kind = 'link' then
    if exists (select 1 from public.catering_toast_decision_heads d where d.lead_id = p_lead_id and d.location_id is null
                and d.kind = 'no_ring_expected') then
      raise exception 'lead_no_ring_expected' using errcode = 'P0001';
    end if;
    select t.id, t.business_date, c.total_cents into v_snapshot, v_business, v_total
      from public.toast_orders_latest t join public.toast_order_checks c on c.snapshot_id = t.id
     where t.location_id = p_location_id and t.order_guid = p_order_guid and c.check_guid = p_check_guid
       and not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted;
    if v_snapshot is null then raise exception 'check_not_found' using errcode = 'P0001'; end if;
    -- The window every suggestion comes from (D-1 .. D+7).
    if v_business not between v_lead.event_date - 1 and v_lead.event_date + 7 then
      raise exception 'check_out_of_window' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.ezcater_toast_links z where z.is_current and z.location_id = p_location_id
                and z.order_guid = p_order_guid and z.check_guid = p_check_guid) then
      raise exception 'check_owned_by_ezcater' using errcode = 'P0001';
    end if;
    select * into v_other from public.catering_toast_links h where h.is_current and h.location_id = p_location_id
       and h.order_guid = p_order_guid and h.check_guid = p_check_guid for update;
    if v_other.id is not null then
      if v_other.lead_id = p_lead_id then raise exception 'already_linked' using errcode = 'P0001'; end if;
      v_owner := public.catering_toast_house_owner(p_location_id, p_order_guid, p_check_guid);
      if v_owner is not null then raise exception 'check_owned_by_house' using errcode = 'P0001'; end if;
      -- The holder no longer qualifies with no change of its own row (an ezCater order attached to it; a move or a
      -- loss already ended the link, section 3b): a SYSTEM retirement, no tombstone.
      update public.catering_toast_links set is_current = false, retired_at = clock_timestamp(),
             retired_reason = public.catering_toast_stale_reason(v_other.lead_id, v_other.location_id)
       where id = v_other.id and is_current;
      get diagnostics v_retired = row_count;
    end if;
    insert into public.catering_toast_link_decisions(lead_id, kind, location_id, order_guid, check_guid, actor_id, supersedes_id)
      values (p_lead_id, 'link', p_location_id, p_order_guid, p_check_guid, p_actor_id, v_head.id) returning id into v_decision;
    insert into public.catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence, decision_id)
      values (p_lead_id, p_location_id, p_order_guid, p_check_guid, v_snapshot, 'manual', v_decision) returning id into v_link_id;
  elsif p_kind = 'unlink' then
    select * into v_link from public.catering_toast_links h where h.is_current and h.lead_id = p_lead_id
       and h.location_id = p_location_id and h.order_guid = p_order_guid and h.check_guid = p_check_guid for update;
    if v_link.id is null then raise exception 'not_linked' using errcode = 'P0001'; end if;
    update public.catering_toast_links set is_current = false, retired_at = clock_timestamp(), retired_reason = 'unlinked'
     where id = v_link.id and is_current;
    insert into public.catering_toast_link_decisions(lead_id, kind, location_id, order_guid, check_guid, actor_id, supersedes_id)
      values (p_lead_id, 'unlink', p_location_id, p_order_guid, p_check_guid, p_actor_id, v_head.id) returning id into v_decision;
    v_link_id := v_link.id;
  elsif p_kind = 'not_a_match' then
    if exists (select 1 from public.catering_toast_links h where h.is_current and h.lead_id = p_lead_id
                and h.location_id = p_location_id and h.order_guid = p_order_guid and h.check_guid = p_check_guid) then
      raise exception 'linked_use_unlink' using errcode = 'P0001';
    end if;
    if v_head.kind = 'not_a_match' then raise exception 'already_decided' using errcode = 'P0001'; end if;
    insert into public.catering_toast_link_decisions(lead_id, kind, location_id, order_guid, check_guid, actor_id, supersedes_id)
      values (p_lead_id, 'not_a_match', p_location_id, p_order_guid, p_check_guid, p_actor_id, v_head.id) returning id into v_decision;
  elsif p_kind = 'no_ring_expected' then
    if v_head.kind = 'no_ring_expected' then raise exception 'already_decided' using errcode = 'P0001'; end if;
    if exists (select 1 from public.catering_toast_links h where h.is_current and h.lead_id = p_lead_id
                and h.location_id = v_lead.location_id) then
      raise exception 'lead_has_links' using errcode = 'P0001';
    end if;
    insert into public.catering_toast_link_decisions(lead_id, kind, reason_code, actor_id, supersedes_id)
      values (p_lead_id, 'no_ring_expected', p_reason_code, p_actor_id, v_head.id) returning id into v_decision;
  else -- ring_expected
    if v_head.kind is distinct from 'no_ring_expected' then raise exception 'not_marked' using errcode = 'P0001'; end if;
    insert into public.catering_toast_link_decisions(lead_id, kind, actor_id, supersedes_id)
      values (p_lead_id, 'ring_expected', p_actor_id, v_head.id) returning id into v_decision;
  end if;

  -- Every decision is audited in the same transaction. No free text: ids, kinds and the closed reason only.
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role,
            case p_kind when 'link' then 'catering.toast_link' when 'unlink' then 'catering.toast_unlink'
                        when 'not_a_match' then 'catering.toast_not_a_match' when 'no_ring_expected' then 'catering.toast_no_ring_expected'
                        else 'catering.toast_ring_expected' end,
            'catering_pipeline', p_lead_id,
            jsonb_strip_nulls(jsonb_build_object('decision_id', v_decision, 'link_id', v_link_id,
              'location_id', coalesce(p_location_id, v_lead.location_id), 'order_guid', p_order_guid, 'check_guid', p_check_guid,
              'supersedes_id', v_head.id, 'reason_code', p_reason_code, 'check_total_cents', v_total,
              'retired_stale_link', case when v_retired > 0 then v_other.id end)),
            true);
  return jsonb_strip_nulls(jsonb_build_object('decision_id', v_decision, 'kind', p_kind, 'link_id', v_link_id));
end $$;

-- 6. The ezCater side of a conflict, for that lead's reconciliation panel (read-only). Every row is a conflict whose
-- facts hold NOW (fix round 2, review PORTAL3-r2 P2 #1): the ledger is history and is never deleted; this read shows
-- a ledger row only while it is still actionable.
--   (a) a LIVE check of this order that ezCater holds while it also carries a live house ring code ('ownership_conflict');
--   (b) a skipped publication (the ledger) only while: the check is still live in Toast; no ezCater order holds it;
--       a house lead still holds it or a live house ring code is still on it (an unlink / not-a-match tombstones the
--       pair, so that code no longer counts); the ezCater order still claims (eligible as the planner reads it: a
--       snapshot, an event date, not cancelled / rejected / failed, its lead not lost) AT THE CHECK'S SHOP and with
--       the check inside its window (fix round 3: a transferred ezCater order, or a moved event date, ends it); and
--       ezCater has not rung the order on another check (a current link of this order elsewhere); and the ezCater
--       EVIDENCE is still on the check as Toast has it now (fix round 4, review PORTAL3-r4): the recorded
--       publication named the check's CURRENT snapshot, or the current capture's retained selection names still
--       carry the ezCater order's number. A recapture without the number ends the conflict; a number typed as a
--       special request is not retained (contract #3), so after a recapture that evidence counts again only once
--       the publisher has found it on the new capture (its skipped row re-stamps the ledger). The house lead named
--       is the one that holds or carries the code NOW, and the kind is the one that holds NOW (a house owner =
--       ownership_conflict, else dual_code), never the ones recorded.
create function public.catering_toast_check_live(p_location_id uuid, p_order_guid text, p_check_guid text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.toast_orders_latest t join public.toast_order_checks c on c.snapshot_id = t.id
                  where t.location_id = p_location_id and t.order_guid = p_order_guid and c.check_guid = p_check_guid
                    and not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted)
$$;

-- The check's live retained selection names carry this ezCater order's number (the 0229 token rule).
create function public.catering_toast_check_ezcater_code(p_location_id uuid, p_order_guid text, p_check_guid text, p_order_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.ezcater_orders o
      join public.toast_orders_latest t on t.location_id = p_location_id and t.order_guid = p_order_guid
      cross join lateral jsonb_array_elements(t.selection_units) s
      cross join lateral regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok
     where o.id = p_order_id and nullif(btrim(o.order_number), '') is not null
       and upper(replace(tok[1],'-','')) = upper(replace(btrim(o.order_number),'-',''))
       and not t.voided and not t.deleted and not t.excess_food
       and s->>'check_guid' = p_check_guid
       and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false))
$$;

create function public.ezcater_order_house_conflicts(p_order_id uuid)
returns table (location_id uuid, order_guid text, check_guid text, kind text, house_lead_id uuid)
language sql stable security definer set search_path = pg_catalog, public as $$
  select distinct z.location_id, z.order_guid, z.check_guid, 'ownership_conflict'::text,
         public.catering_toast_check_house_code(z.location_id, z.order_guid, z.check_guid)
    from public.ezcater_toast_links z
   where z.order_id = p_order_id and z.is_current
     and public.catering_toast_check_live(z.location_id, z.order_guid, z.check_guid)
     and public.catering_toast_check_house_code(z.location_id, z.order_guid, z.check_guid) is not null
  union
  select k.location_id, k.order_guid, k.check_guid,
         case when public.catering_toast_house_owner(k.location_id, k.order_guid, k.check_guid) is not null
              then 'ownership_conflict' else 'dual_code' end,
         h.lead_id
    from public.catering_toast_conflicts k
    cross join lateral (select coalesce(public.catering_toast_house_owner(k.location_id, k.order_guid, k.check_guid),
                                        public.catering_toast_check_house_code(k.location_id, k.order_guid, k.check_guid)) lead_id) h
   where k.ezcater_order_id = p_order_id
     and h.lead_id is not null
     and public.catering_toast_check_live(k.location_id, k.order_guid, k.check_guid)
     and not exists (select 1 from public.ezcater_toast_links z where z.is_current
                      and z.location_id = k.location_id and z.order_guid = k.order_guid and z.check_guid = k.check_guid)
     and not exists (select 1 from public.ezcater_toast_links z where z.is_current and z.order_id = p_order_id
                      and not (z.location_id = k.location_id and z.order_guid = k.order_guid and z.check_guid = k.check_guid))
     -- The ezCater evidence is still on the check as Toast has it NOW (fix round 4, review PORTAL3-r4): the recorded
     -- publication named the current snapshot, or the current retained names still carry the order's number.
     and (k.toast_snapshot_id = (select t.id from public.toast_orders_latest t
                                  where t.location_id = k.location_id and t.order_guid = k.order_guid)
          or public.catering_toast_check_ezcater_code(k.location_id, k.order_guid, k.check_guid, p_order_id))
     -- BOTH sides must still match (fix round 3, review PORTAL3-r3): the ezCater order is still eligible, its CURRENT
     -- shop (the planner's: the lead's, else the order's) is the recorded check's shop, and the check is still inside
     -- the order's window (D-1 .. D+7). A transfer of the ezCater order, or a moved event date, ends the conflict.
     and exists (select 1 from public.ezcater_orders o
                   join public.toast_orders_latest t on t.location_id = k.location_id and t.order_guid = k.order_guid
                   left join public.catering_pipeline p on p.id = o.lead_id
                  where o.id = p_order_id and o.snapshot_id is not null and o.event_date is not null
                    and coalesce(p.stage, '') <> 'lost' and lower(coalesce(o.status, '')) !~ '(cancel|reject|fail)'
                    and coalesce(p.location_id, o.location_id) = k.location_id
                    and t.business_date between o.event_date - 1 and o.event_date + 7)
  order by 1, 2, 3, 4
$$;

-- 6b. ONE owner rule for every reader (fix round 1, review PORTAL3-r1 P2) ---------------------------------------------
-- The house planner, re-emitted from 0344 with ONE change (pinned by tests/catering-toast-0347-migration.test.ts): the
-- owner of a candidate check is catering_toast_house_owner, the rule the writer and the guards use, never the raw
-- current row. A check whose holder no longer qualifies is offered as open, so the panel's "Link this check" reaches
-- the writer's stale-holder path. A later definer of plan_catering_toast is re-emitted FROM this file.
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

-- The orphans view, re-created from 0344 with the same one change.
create or replace view public.catering_toast_orphans with (security_invoker = true) as
select t.location_id, t.business_date, t.order_guid, c.check_guid, c.total_cents
  from public.toast_orders_latest t
  join public.toast_order_checks c on c.snapshot_id = t.id
 where not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
   and exists (select 1 from public.toast_dining_options d join public.sales_channel_map m on m.dining_option_label = d.name
                where d.location_id = t.location_id and d.guid = t.dining_option_guid
                  and m.channel = 'catering' and lower(coalesce(m.provider, '')) <> 'ezcater')
   and not exists (select 1 from public.ezcater_toast_links z where z.is_current and z.location_id = t.location_id
                    and z.order_guid = t.order_guid and z.check_guid = c.check_guid)
   and public.catering_toast_house_owner(t.location_id, t.order_guid, c.check_guid) is null
   and not exists (select 1 from public.toast_catering_orders o where o.location_id = t.location_id
                    and o.order_guid = t.order_guid and o.lead_id is not null)
   and t.business_date >= (select min(r.event_date) - 1 from public.catering_reconciliation_status r where r.location_id = t.location_id);

-- Links of this lead that the SYSTEM ended (the lead moved, was lost, or became ezCater) and that nobody has decided
-- on since: the pair's head is still the `link` decision, the lead is back at the link's shop, and it holds no current
-- link on the pair. `owner` = who holds the check NOW ('ezcater' | 'house' | null = free to link again). This is how a
-- returning lead SHOWS the conflict instead of owning the check.
create function public.catering_toast_ended_links(p_lead_id uuid)
returns table (location_id uuid, order_guid text, check_guid text, evidence text, retired_reason text, head_id uuid, owner text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select distinct on (h.location_id, h.order_guid, h.check_guid)
         h.location_id, h.order_guid, h.check_guid, h.evidence, h.retired_reason, d.id,
         case when exists (select 1 from public.ezcater_toast_links z where z.is_current and z.location_id = h.location_id
                             and z.order_guid = h.order_guid and z.check_guid = h.check_guid) then 'ezcater'
              when public.catering_toast_house_owner(h.location_id, h.order_guid, h.check_guid) is not null then 'house' end
    from public.catering_toast_links h
    join public.catering_pipeline p on p.id = h.lead_id and p.location_id = h.location_id
    join public.catering_toast_decision_heads d on d.lead_id = h.lead_id and d.location_id = h.location_id
     and d.order_guid = h.order_guid and d.check_guid = h.check_guid and d.kind = 'link'
   where h.lead_id = p_lead_id and not h.is_current and h.retired_reason in ('lead_moved', 'lead_lost', 'lead_ezcater')
     and not exists (select 1 from public.catering_toast_links c where c.is_current and c.lead_id = h.lead_id
                      and c.location_id = h.location_id and c.order_guid = h.order_guid and c.check_guid = h.check_guid)
   order by h.location_id, h.order_guid, h.check_guid, h.retired_at desc, h.id
$$;

-- The readiness probe (review PORTAL3-r1 P2): every object the panel READS exists since 0344, so the panel asks this
-- before it offers a control. true only while the writer and both guards of the link step are in place and enabled.
create function public.catering_toast_link_ready() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select to_regprocedure('public.decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid)') is not null
     and (select count(*) from pg_catalog.pg_trigger g
           where not g.tgisinternal and g.tgenabled <> 'D'
             and (g.tgrelid, g.tgname) in (('public.ezcater_toast_links'::regclass, 'ezcater_toast_links_house_guard'),
                                           ('public.catering_toast_links'::regclass, 'catering_toast_links_ezcater_guard'),
                                           ('public.catering_pipeline'::regclass, 'catering_pipeline_end_toast_links'))) = 3
$$;

-- 7. Row security and the privilege ceiling (0257 pattern) -------------------------------------------------------------
alter table public.catering_toast_conflicts enable row level security;
create policy catering_toast_conflicts_no_user_select on public.catering_toast_conflicts for select using (false);
create policy catering_toast_conflicts_no_user_insert on public.catering_toast_conflicts for insert with check (false);
create policy catering_toast_conflicts_no_user_update on public.catering_toast_conflicts for update using (false);
create policy catering_toast_conflicts_no_user_delete on public.catering_toast_conflicts for delete using (false);
revoke all on public.catering_toast_conflicts from public, anon, authenticated, service_role;
grant select on public.catering_toast_conflicts to service_role;
revoke all on public.catering_live_ring_codes from public, anon, authenticated, service_role;
grant select on public.catering_live_ring_codes to service_role;

revoke all on function public.catering_toast_house_owner(uuid,text,text) from public, anon, authenticated;
-- catering_toast_orphans is security_invoker: its reader (service_role) calls the owner rule itself.
grant execute on function public.catering_toast_house_owner(uuid,text,text) to service_role;
revoke all on function public.catering_toast_stale_reason(uuid,uuid) from public, anon, authenticated;
revoke all on function public.catering_pipeline_end_toast_links() from public, anon, authenticated;
revoke all on function public.catering_toast_ended_links(uuid) from public, anon, authenticated;
grant execute on function public.catering_toast_ended_links(uuid) to service_role;
revoke all on function public.catering_toast_link_ready() from public, anon, authenticated;
grant execute on function public.catering_toast_link_ready() to service_role;
revoke all on function public.plan_catering_toast(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.plan_catering_toast(uuid, date, date, jsonb) to service_role;
revoke all on public.catering_toast_orphans from public, anon, authenticated, service_role;
grant select on public.catering_toast_orphans to service_role;
revoke all on function public.catering_toast_pair_blocked(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.catering_toast_check_house_code(uuid,text,text) from public, anon, authenticated;
revoke all on function public.catering_toast_check_live(uuid,text,text) from public, anon, authenticated;
revoke all on function public.catering_toast_check_ezcater_code(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.ezcater_toast_incumbent(uuid,text,text) from public, anon, authenticated;
revoke all on function public.ezcater_toast_links_house_guard() from public, anon, authenticated;
revoke all on function public.catering_toast_links_ezcater_guard() from public, anon, authenticated;
revoke all on function public.plan_ezcater_toast() from public, anon, authenticated;
revoke all on function public.decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid) to service_role;
revoke all on function public.ezcater_order_house_conflicts(uuid) from public, anon, authenticated;
grant execute on function public.ezcater_order_house_conflicts(uuid) to service_role;

do $$
declare p text; f text;
begin
  if not has_table_privilege('service_role', 'public.catering_toast_conflicts', 'select') then raise exception 'ceiling: select missing'; end if;
  foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('service_role', 'public.catering_toast_conflicts', p) then raise exception 'ceiling: service_role holds %', p; end if;
    if has_table_privilege('authenticated', 'public.catering_toast_conflicts', p) or has_table_privilege('anon', 'public.catering_toast_conflicts', p) then
      raise exception 'ceiling: a user role holds %', p;
    end if;
  end loop;
  foreach f in array array['decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid)', 'ezcater_order_house_conflicts(uuid)',
                           'catering_toast_house_owner(uuid,text,text)', 'catering_toast_pair_blocked(uuid,uuid,text,text)',
                           'catering_toast_check_house_code(uuid,text,text)', 'catering_toast_check_live(uuid,text,text)', 'catering_toast_check_ezcater_code(uuid,text,text,uuid)', 'ezcater_toast_incumbent(uuid,text,text)',
                           'plan_ezcater_toast()', 'catering_toast_stale_reason(uuid,uuid)', 'catering_toast_ended_links(uuid)',
                           'catering_toast_link_ready()', 'plan_catering_toast(uuid,date,date,jsonb)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'ceiling: a user role can execute %', f;
    end if;
  end loop;
end $$;

commit;

-- Verify after apply:
--   select count(*) from pg_policies where tablename = 'catering_toast_conflicts';                 -- 4
--   select count(*) from pg_trigger where tgname in ('ezcater_toast_links_house_guard','catering_toast_links_ezcater_guard','catering_pipeline_end_toast_links'); -- 3
--   select public.catering_toast_link_ready();                                                      -- true
--   Planner equivalence (read-only, sim then prod; zero house links and zero ring codes): the 0231 body run beside
--   the live planner returns identical rows (the 0231 precedent):
--     begin read only; <create temp function from 0231's body as plan_ezcater_toast_0231>; select count(*) from (
--       select * from plan_ezcater_toast() except all select * from pg_temp.plan_ezcater_toast_0231()) d; -- 0, both ways
--   Planner time on sim: explain analyze select * from plan_ezcater_toast(); -- well under the 8 s statement timeout.
--   CC re-runs scripts/test-ezcater-pass2.sql on sim after 0347 (unchanged results).
