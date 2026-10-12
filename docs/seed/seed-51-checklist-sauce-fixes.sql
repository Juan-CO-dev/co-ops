-- Seed 51: checklist line fixes from the 2026-10-11 Reports hub audit (Juan 2026-10-12).
-- AUTHORED, NOT YET APPLIED — GATE CC: sim first, then prod.
-- APPLIED TO PROD 2026-10-12 (5 Capitol Hill lines off, Caesar default_par 1, 6 audit rows actor_context seed_51; prod dry run first; ids are prod-only so no sim run).
-- 1. Caesar Dressing (added by seed 42 with par 1 on every line) has items.default_par NULL, and the
--    forms read the par from the item, so its par cell renders blank. Set it to 1, like Lemon Oil.
-- 2. Capitol Hill no longer makes Ranch or Chicken Cutlet (Juan: "no longer making ranch or chix
--    cutlet"). Deactivate those five Capitol Hill lines in place (the same in-place deactivation the
--    admin template editor performs for an Opening mirror). P Street keeps both. History untouched.
-- Exact ids; refuses if any row drifted; one audit row per change, actor_context seed_51.
begin;
lock table public.checklist_template_items, public.items in share row exclusive mode;
create temp table s51_lines(id uuid primary key, label text not null) on commit drop;
insert into s51_lines values
 ('93127958-08ec-4b98-b8e9-426e2d57c874', 'Chicken Cutlet'),  -- AM prep
 ('f6e7da19-97a6-4350-b1a0-53f8cba95c1e', 'Ranch'),           -- AM prep
 ('71f0ae4d-ed80-4419-a476-6e9a095211c1', 'Chicken Cutlet'),  -- Mid-day prep
 ('e1f7540a-4d96-4d50-8dfb-5287ca4f7f68', 'Chicken Cutlet'),  -- Opening (mirror)
 ('e984661d-cfa6-43a1-a24b-927d8c38fa45', 'Ranch');           -- Opening (mirror)
do $guard$
begin
  if (select count(*) from public.checklist_template_items ti
        join s51_lines s on s.id = ti.id and s.label = ti.label
        join public.checklist_templates t on t.id = ti.template_id
        join public.locations l on l.id = t.location_id
       where ti.active and l.name = 'Capitol Hill') <> 5 then
    raise exception 'seed51: Capitol Hill Ranch/Chicken Cutlet lines drifted';
  end if;
  if (select count(*) from public.items where id = '06c1a1b4-a51e-49a8-917a-2ebf6e844205'
        and name = 'Caesar Dressing' and active and default_par is null) <> 1 then
    raise exception 'seed51: Caesar Dressing item drifted';
  end if;
end $guard$;
insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
select null, null, 'checklist_template_item.update', 'checklist_template_items', s.id,
 jsonb_build_object('actor_context', 'seed_51', 'changed_fields', jsonb_build_array('active'),
   'before', jsonb_build_object('active', true), 'after', jsonb_build_object('active', false),
   'label', s.label, 'reason', 'Capitol Hill no longer makes this (Juan 2026-10-12)'), true
from s51_lines s;
update public.checklist_template_items ti set active = false from s51_lines s where ti.id = s.id;
insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
values (null, null, 'item.update', 'items', '06c1a1b4-a51e-49a8-917a-2ebf6e844205',
 jsonb_build_object('actor_context', 'seed_51', 'changed_fields', jsonb_build_array('default_par'),
   'before', jsonb_build_object('default_par', null), 'after', jsonb_build_object('default_par', 1),
   'reason', 'Par matches its checklist lines (seed 42); blank par cell on the forms'), true);
update public.items set default_par = 1, updated_at = now() where id = '06c1a1b4-a51e-49a8-917a-2ebf6e844205';
commit;
