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
--   4. B140 — catering_payments.refunded_at timestamptz + refunded_amount_cents bigint (>= 0) + a partial index on
--      refunded_at. The Stripe refund writer stamps them on the paid → refunded flip (lib/stripe/webhook.ts
--      refund(): the event's own time, capped at now — the paid_at rule; the charge's cumulative amount_refunded)
--      and the daily catering digest reads yesterday's refunds by refunded_at (it read paid_at, so a refund on
--      any later day was never reported).
--
-- EXISTING ROWS: marketing entries untouched (voided = false). catering_payments: rows already 'refunded' are
--   backfilled from their earliest NON-partial 'catering.payment.provider_refunded' audit row (its created_at and
--   metadata.refunded_amount_cents); a refunded row with no such audit row keeps refunded_at NULL and is never
--   reported (today's behaviour). No other row is written.
--
-- APP (same PR, W26): works before AND after this file is applied.
--   · The scorecard reads `voided` and, when the column is missing (42703), re-reads without it (nothing voided).
--   · The remove route answers 503 marketing_unavailable while void_marketing_manual_entry is missing.
--   · The Stripe refund flip writes the two new columns and, when PostgREST says a column is missing
--     (PGRST204 / 42703), repeats the SAME guarded flip without them (status only, exactly as before).
--   · The digest reads by refunded_at and, when the column is missing, falls back to the pre-0333 paid_at read.
--   Until this file is applied a correction still cannot move an entry (B139 stays open) and the digest keeps
--   missing later-day refunds (B140 stays open); nothing breaks.
--
-- DEPENDS ON: 0289 (marketing ledgers + writers + marketing_assert_actor), 0127 (catering_payments), 0303
--   (settlement_cleanup_at — the payments table at its current shape).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select column_name, data_type from information_schema.columns where table_schema='public'
--    and table_name='audit_log' and column_name in ('action','resource_table','resource_id','metadata','created_at');
--   select count(*) from public.catering_payments where status = 'refunded';            -- report it in the PR
--   select count(*) from public.marketing_manual_entries;                                 -- untouched
--   select md5(prosrc) from pg_proc where oid =
--     'public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)'::regprocedure;
--     -- equals the 0289 body (this file refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select to_regprocedure('public.void_marketing_manual_entry(uuid,uuid,text)');         -- not null
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema='public'
--    and routine_name in ('record_marketing_manual_entry','void_marketing_manual_entry') order by 1,2;  -- service_role (+ owner)
--   select count(*) from public.catering_payments where status='refunded' and refunded_at is null;  -- rows with no audit row
--
-- PROOF: scripts/sql-harness-0333.mjs (PGlite: real 0273 → 0289 → 0292 → 0333, plus a minimal payments fixture),
--   CI-pinned by tests/marketing-entry-moves-migration.test.ts. The per-series lock is unchanged from 0289 (two
--   sessions queue on the same advisory key); no new lock, no sim lock script.
-- ROLLBACK: a new migration. The columns and the voided rows are append-only evidence; never delete them.
begin;

do $$ begin
  if to_regprocedure('public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)') is null
    or to_regprocedure('public.marketing_assert_actor(uuid)') is null then
    raise exception '0333: 0289 not installed';
  end if;
  if to_regclass('public.catering_payments') is null then raise exception '0333: catering_payments missing'; end if;
  if exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_payments'
      and column_name = 'settlement_cleanup_at') is not true then
    raise exception '0333: apply 0303 first';
  end if;
  if exists(select 1 from information_schema.columns where table_schema = 'public'
      and ((table_name = 'marketing_manual_entries' and column_name = 'voided')
        or (table_name = 'catering_payments' and column_name in ('refunded_at','refunded_amount_cents')))) then
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

-- ── 4. Catering refunds (B140) ─────────────────────────────────────────────────────────────────────────
alter table public.catering_payments
  add column refunded_at timestamptz,
  add column refunded_amount_cents bigint check (refunded_amount_cents is null or refunded_amount_cents >= 0);
create index catering_payments_refunded_at on public.catering_payments (refunded_at) where refunded_at is not null;

update public.catering_payments p
   set refunded_at = a.created_at,
       refunded_amount_cents = case when (a.metadata->>'refunded_amount_cents') ~ '^[0-9]+$'
                                    then (a.metadata->>'refunded_amount_cents')::bigint end
  from (select distinct on (resource_id::text) resource_id::text as payment_id, created_at, metadata
          from public.audit_log
         where action = 'catering.payment.provider_refunded' and resource_table = 'catering_payments'
           and coalesce(metadata->>'partial', 'false') <> 'true'
         order by resource_id::text, created_at) a
 where p.id::text = a.payment_id and p.status = 'refunded' and p.refunded_at is null;

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
end $$;

commit;
