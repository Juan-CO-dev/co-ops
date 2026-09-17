-- 0207_save_order_guide_rpc.sql — Vendor Ordering V3-A follow-up
-- Astra adversarial review 2026-09-17, findings 1 (P1, BC-007) and 2 (P1, BC-022).
-- AUTHORED 2026-09-17. CC applies to sim; production on Juan's word. No data moves here.
--
-- FINDING 1 — a rejected save could overwrite a successful one. `saveOrderGuide` read the
-- `updated_at` token, then issued a delete, a "+100000 park" upsert and a final upsert as
-- SEPARATE PostgREST requests. Two saves could both pass the token check and interleave; the
-- loser was told 409 only AFTER its writes had committed, with no audit row, and a concurrent
-- `guideKeysFor` could snapshot a parked +100000 position onto a PO line. Deferrable
-- constraints do not join separate HTTP requests into a transaction — spec §6 asked for one.
--
-- FINDING 2 — submitted ids could re-parent another vendor's guide. The service-role upserts
-- validated no ownership: a section id from vendor B saved against vendor A's guide had its
-- `guide_id` rewritten by the upsert, with B's token and audit untouched. A foreign line id
-- and a SKU from another vendor's catalog passed the same way.
--
-- The answer is the house SECURITY DEFINER shape (0188, 0201): ONE transactional writer that
-- locks the guide row, checks the token, validates the WHOLE payload before it writes a byte,
-- then rewrites the children and advances the token. No app role may execute it (0132/0189).
begin;

-- The whole rewrite now happens inside ONE transaction, so a section NAME or a SKU can move
-- between two rows mid-statement (rename A→B while B→A; a SKU re-pinned from one line to the
-- next). 0205 made the POSITION uniques deferrable for exactly that reason; these two need the
-- same treatment. Deferrable does not weaken them — they are still enforced, at commit.
alter table public.order_guide_sections drop constraint order_guide_sections_guide_id_name_key;
alter table public.order_guide_sections
  add constraint order_guide_sections_guide_id_name_key unique (guide_id, name) deferrable initially deferred;
alter table public.order_guide_lines drop constraint order_guide_lines_sku_id_key;
alter table public.order_guide_lines
  add constraint order_guide_lines_sku_id_key unique (sku_id) deferrable initially deferred;

-- p_sections is the editor's own `GuideModel.sections` JSON, unchanged:
--   [{ id, name, position, lines: [{ id, position, skuId, label, itemNumber, note }] }]
-- Every refusal is `raise exception ... using errcode = 'P0001'` with the CODE as the message;
-- lib/order-guides.ts maps those messages to OrderGuideError(409|400, code).
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
  v_now         timestamptz := now();
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
  -- instead of interleaving its deletes and upserts with ours (finding 1).
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

  -- ── VALIDATE EVERYTHING BEFORE WRITING ANYTHING (finding 2) ──────────────────────────
  -- Section shape: an object, a non-empty name, a dense position equal to its array index.
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

  -- Section names are unique case-insensitively — the reducer's rule, enforced server-side.
  select count(*) - count(distinct lower(btrim(e->>'name'))) into v_bad
    from jsonb_array_elements(p_sections) as t(e);
  if v_bad > 0 then raise exception 'section_name_taken' using errcode = 'P0001'; end if;

  -- Line shape: an object, a non-empty label, a dense position within its own section.
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

  -- One SKU, one line (the deferrable unique is the floor; this is the readable refusal).
  select count(*) - count(distinct sku) into v_bad
    from (select (l->>'skuId')::uuid as sku
            from jsonb_array_elements(p_sections) as s(e),
                 jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) as t(l)
           where nullif(l->>'skuId', '') is not null) as d;
  if v_bad > 0 then raise exception 'sku_already_placed' using errcode = 'P0001'; end if;

  -- OWNERSHIP. An id that already exists must belong to THIS guide; a SKU must belong to this
  -- guide's vendor and still be active. Anything else is another vendor's row and is refused.
  if exists (select 1 from public.order_guide_sections s
              where s.id = any(v_section_ids) and s.guide_id <> p_guide_id) then
    raise exception 'foreign_section' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_guide_lines l
               join public.order_guide_sections s on s.id = l.section_id
              where l.id = any(v_line_ids) and s.guide_id <> p_guide_id) then
    raise exception 'foreign_line' using errcode = 'P0001';
  end if;
  if exists (select 1
               from jsonb_array_elements(p_sections) as s(e),
                    jsonb_array_elements(coalesce(s.e->'lines', '[]'::jsonb)) as t(l)
              where nullif(l->>'skuId', '') is not null
                and not exists (select 1 from public.vendor_items vi
                                 where vi.id = (l->>'skuId')::uuid
                                   and vi.vendor_id = v_vendor_id
                                   and vi.active)) then
    raise exception 'foreign_sku' using errcode = 'P0001';
  end if;

  -- ── THE REWRITE. Delete what the payload dropped, then upsert what it carries. The
  -- deferrable uniques let positions, names and SKUs swap inside the transaction, so there is
  -- no +100000 parking pass and no window in which a reader can see a parked position.
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
  -- A malformed id/position in the payload is a bad request, not a 500. Our own refusals are
  -- raise_exception (P0001) and pass straight through.
  when invalid_text_representation or datatype_mismatch or numeric_value_out_of_range then
    raise exception 'invalid_payload' using errcode = 'P0001';
end $$;

comment on function public.save_order_guide(uuid, timestamptz, text, jsonb) is
  'V3-A: the ONE transactional writer for a vendor order guide (Astra findings 1 + 2). Locks the '
  'guide, checks the updated_at token, validates ownership of every section/line/SKU in the '
  'payload, rewrites the children, advances the token. Service-role only.';

revoke all on function public.save_order_guide(uuid, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_order_guide(uuid, timestamptz, text, jsonb) to service_role;
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name = 'save_order_guide'
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0207: unexpected save_order_guide execute grant';
  end if;
end $$;

commit;
