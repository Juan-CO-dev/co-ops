-- Seed 49: salad prices follow the corresponding sub (Juan 2026-10-11).
-- AUTHORED, NOT YET APPLIED — GATE CC: sim first, then prod; requires 0245.
-- Exact active names; idempotent; refuses missing/ambiguous names or a different existing link.
begin;
-- Keep the guard, audit and write on the same catalog state.
lock table public.menu_items in share row exclusive mode;
create temp table s49(salad text primary key, sub text not null) on commit drop;
insert into s49 values
 ('Crunchy Boi Salad', 'Crunchy Boi'),
 ('Farmers Market After Dark Salad', 'Farmers Market After Dark'),
 ('It''s a BOI Salad', 'It''s a BOI'),
 ('Marisa Tomei Eats Free Salad', 'Marisa Tomei Eats Free'),
 ('Sicky Wicky Club Salad', 'Sicky Wicky Club'),
 ('The Frex Salad', 'The Frex'),
 ('The Teamster Salad', 'The Teamster');
do $guard$
declare r record; salad_id uuid; sub_id uuid; existing uuid;
begin
  for r in select * from s49 loop
    if (select count(*) from public.menu_items where name = r.salad and active) <> 1
       or (select count(*) from public.menu_items where name = r.sub and active) <> 1 then
      raise exception 'seed49: missing or ambiguous active pair: % / %', r.salad, r.sub;
    end if;
    select id, price_same_as_id into salad_id, existing from public.menu_items where name = r.salad and active;
    select id into sub_id from public.menu_items where name = r.sub and active;
    if existing is not null and existing <> sub_id then
      raise exception 'seed49: salad % already points elsewhere', r.salad;
    end if;
  end loop;
end $guard$;
create temp table s49_todo on commit drop as
 select salad.id, sub.id target_id from s49 s
 join public.menu_items salad on salad.name = s.salad and salad.active
 join public.menu_items sub on sub.name = s.sub and sub.active
 where salad.price_same_as_id is null;
insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
select null, null, 'menu_item.update', 'menu_items', id,
 jsonb_build_object('actor_context', 'seed_49', 'changed_fields', jsonb_build_array('price_same_as_id'),
   'before', jsonb_build_object('price_same_as_id', null),
   'after', jsonb_build_object('price_same_as_id', target_id),
   'reason', 'Salad selling price follows the sub (Juan 2026-10-11)'), true
from s49_todo;
update public.menu_items m set price_same_as_id = t.target_id, updated_at = now()
from s49_todo t where m.id = t.id;
commit;
