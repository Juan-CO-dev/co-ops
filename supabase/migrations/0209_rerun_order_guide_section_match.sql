-- 0209_rerun_order_guide_section_match.sql — Vendor Ordering V3-A follow-up, round 3
-- Astra third pass 2026-09-17, the one remaining finding (P2, BC-036/BC-042).
-- AUTHORED 2026-09-17. CC applies to sim; production on Juan's word. No data moves here.
-- 0208 is already applied to the sim and is NEVER edited — this migration supersedes its
-- `rerun_order_guide` with `create or replace`. The body is 0208's, unchanged but for the
-- section lookup and the trim on a freshly created section's name.
--
-- THE FINDING — a sibling-path mismatch, carried into 0208 rather than introduced by it. The
-- rerun resolved an existing section by EXACT name, while the editor's reducer
-- (`assertSectionNameFree`) and `save_order_guide` both enforce `lower(btrim(name))`
-- uniqueness. So: a manager renames "Produce" to "produce"; the next rerun appends a laminate
-- row targeting "Produce", finds no exact match, and creates a SECOND section. That commits —
-- the DB's `unique (guide_id, name)` is case-SENSITIVE and the two spellings differ — and from
-- then on every editor save of that guide is refused `section_name_taken`, with nothing on the
-- screen explaining why. The guide is locked until someone renames or merges the pair by hand.
--
-- THE FIX — match on `lower(btrim(...))` on both sides. The existing section keeps its id and
-- the manager's own spelling (a rerun never relabels what a manager wrote, spec §5 rule 4);
-- only the appended rows move into it. A new section is created only when no case-insensitive
-- match exists at all.
begin;

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
    -- CASE-INSENSITIVE, LIKE EVERY OTHER WRITER (Astra r3). The editor's reducer and
    -- `save_order_guide` both enforce `lower(btrim(name))` uniqueness; matching exactly here
    -- meant a guide whose "Produce" a manager had renamed to "produce" gained a SECOND
    -- "Produce" from the next rerun — legal for the DB's case-sensitive unique, and fatal to
    -- every later editor save, which refuses the pair with `section_name_taken`. The existing
    -- section keeps its id AND the manager's spelling; only the rows move.
    -- `order by` makes the pick deterministic if a guide already carries such a pair.
    select s.id into v_section_id from public.order_guide_sections s
      where s.guide_id = p_guide_id
        and lower(btrim(s.name)) = lower(btrim(v_rec->>'sectionName'))
      order by s.position, s.id
      limit 1;
    if not found then
      -- A section the laminate grew since the last run lands LAST, never among the manager's.
      select coalesce(max(s.position), 0) + 1 into v_position
        from public.order_guide_sections s where s.guide_id = p_guide_id;
      -- btrim on the way in, so the name we store is the name the ci match normalises and the
      -- one `save_order_guide` would have written for the same text.
      insert into public.order_guide_sections (guide_id, name, position)
        values (p_guide_id, btrim(v_rec->>'sectionName'), v_position)
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
  'V3-A: the ONE transactional writer for a seed 37 rerun (Astra r2-1, section match r3). Takes '
  'the same guide lock as save_order_guide, refuses a stale token before any write, fills '
  'null-SKU lines (0 rows = rematch_conflict), appends sheet rows dense into the section whose '
  'name matches case-insensitively, advances the token. Service-role only.';

revoke all on function public.rerun_order_guide(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rerun_order_guide(uuid, timestamptz, jsonb, jsonb) to service_role;
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name = 'rerun_order_guide'
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0209: unexpected rerun_order_guide execute grant';
  end if;
end $$;

commit;
