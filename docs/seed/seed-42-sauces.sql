-- Seed 42, authored 2026-10-07. CC applies sim first, then prod after review.
-- Management API: send BEGIN; SET LOCAL seed42.target = 'sim'; this file body;
-- COMMIT as ONE query. Production requires the explicit value 'prod'.
-- Opening is processed after AM Prep so its reference points to the new AM row.
do $seed42$
declare
  v_target text := current_setting('seed42.target', true);
  v_kind text;
  v_template record;
  v_sauce record;
  v_new record;
  v_order integer;
  v_base integer;
  v_ref uuid;
  v_inserted uuid;
begin
  if v_target not in ('sim', 'prod') or v_target is null then
    raise exception 'set seed42.target explicitly to sim or prod';
  end if;
  if exists (select 1 from public.users where email='maya@sim.co-ops') is distinct from (v_target='sim') then
    raise exception 'seed42 target % does not match database sim persona marker', v_target;
  end if;
  -- Correct Juan's original recipe typo only for the Caesar output item.
  for v_new in select r.id from public.recipes r
    join public.recipe_outputs ro on ro.recipe_id = r.id
    where r.name = 'Cesear Dressing'
      and ro.output_item_id = '06c1a1b4-a51e-49a8-917a-2ebf6e844205'::uuid
  loop
    update public.recipes set name = 'Caesar Dressing' where id = v_new.id;
    insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values(null, null, 'recipe.update', 'recipes', v_new.id, true,
      jsonb_build_object('actor_context','seed_42','target',v_target,
        'old_name','Cesear Dressing','new_name','Caesar Dressing'));
  end loop;
  if (select count(*) from public.checklist_templates where active and
      ((type='opening' and name='Standard Opening v1') or
       (type='prep' and name in ('Standard AM Prep v1','Standard Mid-day Prep v1')))) <> 6 then
    raise exception 'expected exactly six active Standard templates';
  end if;
  foreach v_kind in array array['Standard AM Prep v1','Standard Mid-day Prep v1','Standard Opening v1'] loop
    for v_template in select id, location_id, name from public.checklist_templates
      where active and name = v_kind and
        ((v_kind='Standard Opening v1' and type='opening') or
         (v_kind<>'Standard Opening v1' and type='prep'))
      order by location_id
    loop
      select * into v_sauce from public.checklist_template_items
      where template_id = v_template.id and active and station='Sauces' and label='Vin'
      limit 1;
      if v_sauce.id is null then raise exception 'Vin sibling missing on %', v_template.id; end if;
      v_base := v_sauce.display_order + 1;
      -- Shift only once: a rerun has both inserted rows and skips this block.
      if not exists (select 1 from public.checklist_template_items
        where template_id=v_template.id and item_id='06c1a1b4-a51e-49a8-917a-2ebf6e844205'::uuid) then
        update public.checklist_template_items set display_order=display_order+2
        where template_id=v_template.id and display_order>=v_base;
      end if;
      for v_new in select * from (values
        ('Caesar Dressing','Aderezo César','06c1a1b4-a51e-49a8-917a-2ebf6e844205'::uuid,0),
        ('Lemon Oil','Aceite de limón','06aaab2f-8552-423d-a9d1-22f3ff944db2'::uuid,1)
      ) as x(label,label_es,item_id,offset_n)
      loop
        if not exists (select 1 from public.items where id=v_new.item_id and active) then
          raise exception 'active item % missing', v_new.item_id;
        end if;
        if exists (select 1 from public.checklist_template_items
          where template_id=v_template.id and item_id=v_new.item_id) then continue; end if;
        v_order := v_base + v_new.offset_n;
        if exists (select 1 from public.checklist_template_items
          where template_id=v_template.id and active and display_order=v_order) then
          raise exception 'order % occupied on template %', v_order, v_template.id;
        end if;
        v_ref := null;
        if v_kind='Standard Opening v1' then
          select ai.id into v_ref from public.checklist_template_items ai
          join public.checklist_templates at on at.id=ai.template_id
          where at.location_id=v_template.location_id and at.active
            and at.name='Standard AM Prep v1' and ai.active and ai.item_id=v_new.item_id limit 1;
          if v_ref is null then raise exception 'AM reference missing for %', v_new.label; end if;
        end if;
        insert into public.checklist_template_items
          (template_id, station, display_order, label, description, min_role_level,
           required, expects_count, expects_photo, active, item_id, translations,
           prep_meta, references_template_item_id)
        values (v_template.id, 'Sauces', v_order, v_new.label, v_sauce.description, 3,
          true, v_sauce.expects_count, v_sauce.expects_photo, true, v_new.item_id,
          jsonb_build_object('es', jsonb_build_object('label',v_new.label_es,
            'station',v_sauce.translations->'es'->>'station')),
          case when v_kind='Standard Opening v1' then
            '{"parUnit":"Bottle","section":"Sauces","parValue":1,"openingPhase2":true}'::jsonb
          else '{"columns":["par","line","back_up","total"],"parUnit":"Bottle","section":"Sauces","parValue":1,"specialInstruction":null}'::jsonb end,
          v_ref)
        returning id into v_inserted;
        insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
        values(null,null,'checklist_template_item.create','checklist_template_items',v_inserted,true,
          jsonb_build_object('actor_context','seed_42','target',v_target,'template_id',v_template.id,
            'location_id',v_template.location_id,'item_id',v_new.item_id,'label',v_new.label));
      end loop;
      if exists (select 1 from public.checklist_template_items
        where template_id=v_template.id and active
        group by display_order having count(*) > 1) then
        raise exception 'active display_order collision on template %', v_template.id;
      end if;
    end loop;
  end loop;
end $seed42$;

select t.location_id, t.name as template, i.label, i.item_id, i.display_order, i.prep_meta,
  i.references_template_item_id
from public.checklist_template_items i join public.checklist_templates t on t.id=i.template_id
where t.active and i.item_id in ('06c1a1b4-a51e-49a8-917a-2ebf6e844205'::uuid,
  '06aaab2f-8552-423d-a9d1-22f3ff944db2'::uuid)
order by t.location_id, t.name, i.display_order;
