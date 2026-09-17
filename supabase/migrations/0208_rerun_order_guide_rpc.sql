-- 0208_rerun_order_guide_rpc.sql — Vendor Ordering V3-A follow-up, round 2
-- Astra second pass 2026-09-17, findings r2-1 (P1, BC-007) and r2-3 (P2, BC-036/BC-042).
-- AUTHORED 2026-09-17. CC applies to sim; production on Juan's word. No data moves here.
-- 0207 is already applied to the sim and is NEVER edited — this migration supersedes its
-- function with `create or replace` and adds the seed's own writer beside it.
--
-- FINDING r2-1 — the seed's rerun was still a sequence of committed statements. Each rematch
-- committed on its own, each append likewise, and only THEN did the guarded token bump run.
-- A manager saving between those statements wins: the rematch is cleared or the appended line
-- deleted, the manager is told "Saved", and the seed discovers the stale token AFTER the loss
-- with nothing rolled back. A failure halfway through left committed rows behind an unadvanced
-- token. The token bump closed the window at the END; this closes it at the START, the same
-- way `save_order_guide` does for the editor, and behind the same lock.
--
-- FINDING r2-3 — 0207 required EVERY retained SKU in the payload to be active. `loadOrderGuide`
-- keeps an inactive SKU's line (it is a real placement on the laminate), so retiring one SKU
-- made every later section rename or reorder of that vendor's guide fail with `foreign_sku`,
-- reported to the manager as a generic error, with the offending line rendering normally.
-- Vendor ownership is still required for every SKU; ACTIVE is now required only for a SKU that
-- is NEW to this guide — an existing placement may be carried through a save untouched.
--
-- THE TOKEN IS A CLOCK, NOT A TRANSACTION STAMP. Both functions stamp `updated_at` with
-- `clock_timestamp()`, not `now()`. `now()` is the TRANSACTION timestamp, so two writers in one
-- transaction stamp the same value and the first one's token still verifies — proven on the sim,
-- where a rerun followed by a second rerun on the stale token was accepted. PostgREST gives each
-- request its own transaction so production never saw it, but a concurrency token that can fail
-- to advance is not a concurrency token; `clock_timestamp()` advances per statement, always.
begin;

-- ── r2-3: `active` is a rule for NEW placements, not for the whole guide ─────────────────
create or replace function public.save_order_guide(
  p_guide_id            uuid,
  p_expected_updated_at timestamptz,
  p_name                text,
  p_sections            jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vendor_id   uuid;
  v_updated_at  timestamptz;
  v_now         timestamptz := clock_timestamp(); -- see THE TOKEN IS A CLOCK, in the header
  v_section_ids uuid[];
  v_line_ids    uuid[];
  v_bad         integer;
begin
  if p_guide_id is null
     or jsonb_typeof(p_sections) is distinct from 'array'
     or nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;

  -- THE SERIALIZATION POINT. A second save waits on this lock and then loses the token check,
  -- instead of interleaving its deletes and upserts with ours (round-1 finding 1).
  select g.vendor_id, g.updated_at into v_vendor_id, v_updated_at
    from public.vendor_order_guides g
   where g.id = p_guide_id
     for update;
  if not found then
    raise exception 'guide_not_found' using errcode = 'P0001';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'guide_stale' using errcode = 'P0001';
  end if;

  -- ── VALIDATE EVERYTHING BEFORE WRITING ANYTHING (round-1 finding 2) ──────────────────
  select count(*) into v_bad
    from jsonb_array_elements(p_sections) with ordinality as t(e, ord)
   where jsonb_typeof(t.e) is distinct from 'object'
      or nullif(btrim(coalesce(t.e->>'name', '')), '') is null
      or coalesce((t.e->>'position')::int, -1) <> t.ord
      or jsonb_typeof(coalesce(t.e->'lines', '[]'::jsonb)) is distinct from 'array';
  if v_bad > 0 then raise exception 'invalid_payload' using errcode = 'P0001'; end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}'::uuid[]) into v_section_ids
    from jsonb_array_elements(p_sections) as t(e);
  if array_position(v_section_ids, null) is not null
     or cardinality(v_section_ids) <> (select count(distinct x) from unnest(v_section_ids) as u(x)) then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;

  select count(*) - count(distinct lower(btrim(e->>'name'))) into v_bad
    from jsonb_array_elements(p_sections) as t(e);
  if v_bad > 0 then raise exception 'section_name_taken' using errcode = 'P0001'; end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_sections) as s(e),
         jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) with ordinality as t(l, ord)
   where jsonb_typeof(t.l) is distinct from 'object'
      or nullif(btrim(coalesce(t.l->>'label', '')), '') is null
      or coalesce((t.l->>'position')::int, -1) <> t.ord;
  if v_bad > 0 then raise exception 'invalid_payload' using errcode = 'P0001'; end if;

  select coalesce(array_agg((l->>'id')::uuid), '{}'::uuid[]) into v_line_ids
    from jsonb_array_elements(p_sections) as s(e),
         jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) as t(l);
  if array_position(v_line_ids, null) is not null
     or cardinality(v_line_ids) <> (select count(distinct x) from unnest(v_line_ids) as u(x)) then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;

  select count(*) - count(distinct sku) into v_bad
    from (select (l->>'skuId')::uuid as sku
            from jsonb_array_elements(p_sections) as s(e),
                 jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) as t(l)
           where nullif(l->>'skuId', '') is not null) as d;
  if v_bad > 0 then raise exception 'sku_already_placed' using errcode = 'P0001'; end if;

  if exists (select 1 from public.order_guide_sections s
              where s.id = any(v_section_ids) and s.guide_id <> p_guide_id) then
    raise exception 'foreign_section' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_guide_lines l
               join public.order_guide_sections s on s.id = l.section_id
              where l.id = any(v_line_ids) and s.guide_id <> p_guide_id) then
    raise exception 'foreign_line' using errcode = 'P0001';
  end if;

  -- VENDOR OWNERSHIP ALWAYS; ACTIVE ONLY FOR A NEW PLACEMENT (r2-3). A SKU already on one of
  -- this guide's lines is an existing placement the editor renders and the manager did not
  -- touch — retiring that SKU must not lock the whole guide against a section rename.
  if exists (select 1
               from jsonb_array_elements(p_sections) as s(e),
                    jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) as t(l)
              where nullif(l->>'skuId', '') is not null
                and not exists (
                  select 1 from public.vendor_items vi
                   where vi.id = (l->>'skuId')::uuid
                     and vi.vendor_id = v_vendor_id
                     and (vi.active or exists (
                           select 1 from public.order_guide_lines gl
                             join public.order_guide_sections gs on gs.id = gl.section_id
                            where gs.guide_id = p_guide_id and gl.sku_id = vi.id)))) then
    raise exception 'foreign_sku' using errcode = 'P0001';
  end if;

  -- ── THE REWRITE, in one transaction; the deferrable uniques let positions, names and SKUs
  -- swap inside it, so there is no parking pass and no window on a parked position.
  delete from public.order_guide_lines l
   using public.order_guide_sections s
   where s.id = l.section_id
     and s.guide_id = p_guide_id
     and not (l.id = any(v_line_ids));

  delete from public.order_guide_sections s
   where s.guide_id = p_guide_id
     and not (s.id = any(v_section_ids));

  insert into public.order_guide_sections (id, guide_id, name, position)
  select (e->>'id')::uuid, p_guide_id, btrim(e->>'name'), (e->>'position')::int
    from jsonb_array_elements(p_sections) as t(e)
      on conflict (id) do update
     set guide_id = excluded.guide_id, name = excluded.name, position = excluded.position;

  insert into public.order_guide_lines (id, section_id, position, sku_id, label, item_number, note)
  select (l->>'id')::uuid, (s.e->>'id')::uuid, (l->>'position')::int,
         nullif(l->>'skuId', '')::uuid, l->>'label', l->>'itemNumber', l->>'note'
    from jsonb_array_elements(p_sections) as s(e),
         jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) as t(l)
      on conflict (id) do update
     set section_id = excluded.section_id, position = excluded.position, sku_id = excluded.sku_id,
         label = excluded.label, item_number = excluded.item_number, note = excluded.note;

  update public.vendor_order_guides
     set updated_at = v_now, name = btrim(p_name)
   where id = p_guide_id;

  return jsonb_build_object('updated_at', v_now);
exception
  when invalid_text_representation or datatype_mismatch or numeric_value_out_of_range then
    raise exception 'invalid_payload' using errcode = 'P0001';
end $$;

-- ── r2-1: the seed's rerun is ONE transaction, behind the SAME lock ──────────────────────
-- p_rematches: [{ "lineId": uuid, "skuId": uuid }]     — fill a line whose sku_id is still null
-- p_appends:   [{ "sectionName": text, "label": text,  — a sheet row that has no line yet
--                 "itemNumber": text|null, "skuId": uuid|null }]
-- The seed NEVER moves, relabels or removes an existing row (spec §5 rule 4), so this writer
-- has exactly two verbs and no delete path at all. Refusals raise their CODE as the message.
create or replace function public.rerun_order_guide(
  p_guide_id            uuid,
  p_expected_updated_at timestamptz,
  p_rematches           jsonb,
  p_appends             jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vendor_id  uuid;
  v_updated_at timestamptz;
  v_now        timestamptz := clock_timestamp(); -- see THE TOKEN IS A CLOCK, in the header
  v_rec        jsonb;
  v_section_id uuid;
  v_position   integer;
  v_rematched  integer := 0;
  v_appended   integer := 0;
  v_touched    integer;
begin
  if p_guide_id is null
     or jsonb_typeof(p_rematches) is distinct from 'array'
     or jsonb_typeof(p_appends) is distinct from 'array' then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;

  -- THE SAME LOCK THE EDITOR TAKES. A manager's save and a seed rerun now serialize against
  -- each other; whichever arrives second sees the other's token and refuses BEFORE writing.
  select g.vendor_id, g.updated_at into v_vendor_id, v_updated_at
    from public.vendor_order_guides g
   where g.id = p_guide_id
     for update;
  if not found then
    raise exception 'guide_not_found' using errcode = 'P0001';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'guide_stale' using errcode = 'P0001';
  end if;

  -- Every SKU a rerun places is a NEW placement: this vendor's, active, and on no line yet.
  if exists (select 1 from jsonb_array_elements(p_rematches || p_appends) as t(r)
              where nullif(r->>'skuId', '') is not null
                and not exists (select 1 from public.vendor_items vi
                                 where vi.id = (r->>'skuId')::uuid
                                   and vi.vendor_id = v_vendor_id and vi.active)) then
    raise exception 'foreign_sku' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rematches || p_appends) as t(r)
               join public.order_guide_lines gl on gl.sku_id = (r->>'skuId')::uuid
              where nullif(r->>'skuId', '') is not null) then
    raise exception 'sku_already_placed' using errcode = 'P0001';
  end if;

  for v_rec in select r from jsonb_array_elements(p_rematches) as t(r) loop
    -- `sku_id is null` is the whole idempotency rule: a line a manager already resolved by
    -- hand is NOT re-matched, it is a conflict, and the rerun refuses rather than overwrite.
    update public.order_guide_lines gl
       set sku_id = (v_rec->>'skuId')::uuid
      from public.order_guide_sections gs
     where gs.id = gl.section_id
       and gs.guide_id = p_guide_id
       and gl.id = (v_rec->>'lineId')::uuid
       and gl.sku_id is null;
    get diagnostics v_touched = row_count;
    if v_touched <> 1 then raise exception 'rematch_conflict' using errcode = 'P0001'; end if;
    v_rematched := v_rematched + 1;
  end loop;

  for v_rec in select r from jsonb_array_elements(p_appends) as t(r) loop
    if nullif(btrim(coalesce(v_rec->>'label', '')), '') is null
       or nullif(btrim(coalesce(v_rec->>'sectionName', '')), '') is null then
      raise exception 'invalid_payload' using errcode = 'P0001';
    end if;
    select s.id into v_section_id from public.order_guide_sections s
      where s.guide_id = p_guide_id and s.name = v_rec->>'sectionName';
    if not found then
      -- A section the laminate grew since the last run lands LAST, never among the manager's.
      select coalesce(max(s.position), 0) + 1 into v_position
        from public.order_guide_sections s where s.guide_id = p_guide_id;
      insert into public.order_guide_sections (guide_id, name, position)
        values (p_guide_id, v_rec->>'sectionName', v_position)
        returning id into v_section_id;
    end if;
    select coalesce(max(l.position), 0) + 1 into v_position
      from public.order_guide_lines l where l.section_id = v_section_id;
    insert into public.order_guide_lines (section_id, position, sku_id, label, item_number, note)
      values (v_section_id, v_position, nullif(v_rec->>'skuId', '')::uuid,
              v_rec->>'label', v_rec->>'itemNumber', null);
    v_appended := v_appended + 1;
  end loop;

  update public.vendor_order_guides set updated_at = v_now where id = p_guide_id;
  return jsonb_build_object('updated_at', v_now, 'rematched', v_rematched, 'appended', v_appended);
exception
  when invalid_text_representation or datatype_mismatch or numeric_value_out_of_range then
    raise exception 'invalid_payload' using errcode = 'P0001';
end $$;

comment on function public.rerun_order_guide(uuid, timestamptz, jsonb, jsonb) is
  'V3-A: the ONE transactional writer for a seed 37 rerun (Astra r2-1). Takes the same guide '
  'lock as save_order_guide, refuses a stale token before any write, fills null-SKU lines '
  '(0 rows = rematch_conflict), appends sheet rows dense, advances the token. Service-role only.';

revoke all on function public.save_order_guide(uuid, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_order_guide(uuid, timestamptz, text, jsonb) to service_role;
revoke all on function public.rerun_order_guide(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rerun_order_guide(uuid, timestamptz, jsonb, jsonb) to service_role;
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name in ('save_order_guide', 'rerun_order_guide')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0208: unexpected order-guide RPC execute grant';
  end if;
end $$;

commit;
