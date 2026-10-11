-- Seed 48: prep items that share a name with a purchased product read "(portioned)".
-- APPLIED TO PROD 2026-10-10 (dry run PASS items=10 lines=34 audit=10, then applied; verified all 34 lines in step).
-- Juan 2026-10-10: Admin showed Ham / Turkey / Provolone / ... on BOTH Products and Items.
-- A product (0179) is what we buy; an item (0079) is what we prep and count. Juan chose
-- "Match the recipes": each item takes its producing recipe's own wording, "<name> (portioned)".
--
-- Writes, per item (by id; the old name is a guard, not the key):
--   items.name / name_es / updated_at                      (the global definition; checklists display this)
--   checklist_template_items.label + translations.es.label (the line's stored copy, kept in step so an
--                                                           unlink later freezes the new name, not the old)
--   audit_log item.update with before/after                (actor_context seed_48)
-- Idempotent: an item already renamed is skipped. Aborts if an item is missing, inactive, or has a third name.

begin;

create temp table s48(id uuid primary key, old_name text, new_name text, old_es text, new_es text) on commit drop;
insert into s48 values
 ('2239bae2-43d7-49f2-bd3a-3561887337db','Capicola','Capicola (portioned)','Capicola','Capicola (porcionada)'),
 ('6a44a662-f1c2-4aa0-ac1e-77fba1d38e0f','Ham','Ham (portioned)','Jamón','Jamón (porcionado)'),
 ('f7731046-5b83-4a51-8754-dc792d5780ae','Pepperoni','Pepperoni (portioned)','Pepperoni','Pepperoni (porcionado)'),
 ('0a126698-4f3b-40e2-8086-8322205b2313','Provolone','Provolone (portioned)','Provolone','Provolone (porcionado)'),
 ('a4f0e7ea-f1d4-4a82-b917-4973322f11d2','Roast Beef','Roast Beef (portioned)','Roast beef','Roast beef (porcionado)'),
 ('f22d8360-43b8-4ae0-b763-1607b33acc71','Turkey','Turkey (portioned)','Pavo','Pavo (porcionado)'),
 ('84ccaf84-ed35-4031-bb88-e19536042bd5','Fresh Mozzarella','Fresh Mozzarella (portioned)','Mozzarella fresca','Mozzarella fresca (porcionada)'),
 ('9195bf47-4a74-466b-97f7-27718fbb79bb','Hot Peppers','Hot Peppers (portioned)','Pimientos picantes','Pimientos picantes (porcionados)'),
 ('7206485d-5b37-4f44-bfe6-5211480d6ce0','Iceberg','Iceberg (portioned)','Lechuga iceberg','Lechuga iceberg (porcionada)'),
 ('9910920a-0cba-4108-8f27-a16a8dacb5d9','Sweet Peppers','Sweet Peppers (portioned)','Pimientos dulces','Pimientos dulces (porcionados)');

do $guard$
declare r record;
begin
  for r in select s.*, i.name cur, i.active from s48 s left join public.items i on i.id = s.id loop
    if r.cur is null then raise exception 'seed48: item % (%) not found', r.id, r.old_name; end if;
    if not r.active then raise exception 'seed48: item % (%) is inactive', r.id, r.old_name; end if;
    if r.cur not in (r.old_name, r.new_name) then
      raise exception 'seed48: item % is named %, expected % or %', r.id, r.cur, r.old_name, r.new_name;
    end if;
  end loop;
end $guard$;

-- Only the rows still carrying the old name (idempotent re-run = no-op).
create temp table s48_todo on commit drop as
  select s.* from s48 s join public.items i on i.id = s.id where i.name = s.old_name;

insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
select null, null, 'item.update', 'items', t.id,
  jsonb_build_object('actor_context', 'seed_48', 'item_fields', jsonb_build_array('name', 'name_es'),
    'before', jsonb_build_object('name', t.old_name, 'name_es', i.name_es),
    'after',  jsonb_build_object('name', t.new_name, 'name_es', t.new_es),
    'reason', 'Prep item shares a name with a purchased product; renamed to match its producing recipe (Juan 2026-10-10)'),
  false
from s48_todo t join public.items i on i.id = t.id;

update public.checklist_template_items c
   set label = t.new_name,
       translations = jsonb_set(coalesce(c.translations, '{}'::jsonb), '{es}',
                                coalesce(c.translations->'es', '{}'::jsonb) || jsonb_build_object('label', t.new_es))
  from s48_todo t
 where c.item_id = t.id;

update public.items i
   set name = t.new_name, name_es = t.new_es, updated_at = now()
  from s48_todo t
 where i.id = t.id;

commit;
