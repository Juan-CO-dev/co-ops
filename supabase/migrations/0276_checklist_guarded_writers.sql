-- Migration 0276_checklist_guarded_writers
-- AUTHORED 2026-10-19. FILE ONLY; NOT APPLIED. CC review -> sim -> prod on Juan's word.
-- R7 prerequisite for the application cutover; 0277 is the separate lockdown.
-- No table grants/policies or existing writers change here. Old deployment writers
-- must be drained before claiming serialization. PIN, assignments, answer validation,
-- lock-up/cash/hard gates and exact required-reason validation remain in the app.
-- Actor UUID is trusted ONLY from the verified server session, never request JSON.
-- SQL independently checks current active status, plain membership and role.
-- SECURITY INVOKER: only service_role may call these functions. They depend on
-- service_role retaining table DML; a future service-role ceiling must account
-- for these writers rather than assuming SECURITY DEFINER elevates them.
begin;

-- Reuse 0228's role map, not assignment_user_level (that helper has owner bypass
-- and active-membership semantics which differ from current_user_locations).
create function public.checklist_actor_level(p_actor uuid, p_location uuid)
returns integer language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_level integer;
begin
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  perform 1 from public.user_locations where user_id = p_actor and location_id = p_location for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  return v_level;
end $$;

create function public.checklist_write_completion(
  p_actor uuid, p_instance uuid, p_template_item uuid,
  p_count_value numeric default null, p_photo_id uuid default null, p_notes text default null
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype;
  v_item public.checklist_template_items%rowtype;
  v_prior public.checklist_completions%rowtype;
  v_new public.checklist_completions%rowtype;
  v_level integer; v_n integer; v_expected integer; v_ids uuid[];
  v_at timestamptz; v_completed_at timestamptz;
begin
  select * into v_instance from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  v_level := public.checklist_actor_level(p_actor, v_instance.location_id);
  select * into v_item from public.checklist_template_items where id = p_template_item;
  if not found or v_item.template_id is distinct from v_instance.template_id then
    raise exception 'item_mismatch';
  end if;
  -- Baseline INSERT OR closing-staff INSERT: the baseline permits every item
  -- meeting its floor. Do not accidentally AND the stricter closing alternative.
  -- active/report-reference/manual-item checks remain the existing app prechecks.
  if v_level < v_item.min_role_level or v_item.min_role_level is null then
    raise exception 'not_authorized';
  end if;
  v_at := clock_timestamp(); -- after waiting for the parent, never before its prior writer
  -- Generic completeItem replaces all phase heads, as the existing writer does.
  -- 0196 permits at most two; do not silently take the first of an unknown set.
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_ids
    from public.checklist_completions where instance_id = p_instance
      and template_item_id = p_template_item and superseded_at is null and revoked_at is null;
  v_expected := cardinality(v_ids);
  if v_expected > 2 then raise exception 'completion_cardinality'; end if;
  if v_expected = 1 then
    select * into strict v_prior from public.checklist_completions where id = v_ids[1];
    -- B8 notes-only timestamp preservation, identical to carriedCompletedAt.
    if v_prior.completed_by = p_actor and v_item.input_type is distinct from 'free_text'
      and v_prior.actual_completer_id is null
      and v_prior.count_value is not distinct from p_count_value
      and v_prior.photo_id is not distinct from p_photo_id then
      v_completed_at := v_prior.completed_at;
    end if;
  end if;
  update public.checklist_completions set superseded_at = v_at
    where id = any(v_ids) and superseded_at is null and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n <> v_expected then raise exception 'completion_cardinality'; end if;
  insert into public.checklist_completions
    (instance_id, template_item_id, completed_by, completed_at, count_value, photo_id, notes)
    values (p_instance, p_template_item, p_actor, coalesce(v_completed_at, v_at), p_count_value, p_photo_id, p_notes)
    returning * into strict v_new;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'completion_cardinality'; end if;
  update public.checklist_completions set superseded_by = v_new.id
    where id = any(v_ids) and superseded_at = v_at and superseded_by is null;
  get diagnostics v_n = row_count;
  if v_n <> v_expected then raise exception 'completion_cardinality'; end if;
  return jsonb_build_object('completion', to_jsonb(v_new), 'superseded_ids', to_jsonb(v_ids),
    'kept_completed_at', v_completed_at is not null);
end $$;

create function public.checklist_submit_batch(p_actor uuid, p_instance uuid, p_completion_ids uuid[])
returns public.checklist_submissions
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_instance public.checklist_instances%rowtype; v_new public.checklist_submissions%rowtype;
  v_n integer; v_expected integer;
begin
  select * into v_instance from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  perform public.checklist_actor_level(p_actor, v_instance.location_id);
  if coalesce(cardinality(p_completion_ids), 0) = 0 then raise exception 'empty_batch'; end if;
  select count(distinct id) into v_expected from unnest(p_completion_ids) id;
  if array_position(p_completion_ids, null) is not null then raise exception 'completion_not_found'; end if;
  select count(*) into v_n from public.checklist_completions where id = any(p_completion_ids);
  if v_n <> v_expected then raise exception 'completion_not_found'; end if;
  if exists(select 1 from public.checklist_completions where id = any(p_completion_ids)
    and instance_id <> p_instance) then raise exception 'completion_wrong_instance'; end if;
  if exists(select 1 from public.checklist_completions where id = any(p_completion_ids)
    and completed_by <> p_actor) then raise exception 'completion_wrong_author'; end if;
  insert into public.checklist_submissions(instance_id, submitted_by, completion_ids, is_final_confirmation)
    values (p_instance, p_actor, p_completion_ids, false) returning * into strict v_new;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'submission_cardinality'; end if;
  return v_new;
end $$;

create function public.checklist_confirm_instance(
  p_actor uuid, p_instance uuid, p_confirmed_at timestamptz,
  p_reasons jsonb, p_expected_completion_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype; v_submission public.checklist_submissions%rowtype;
  v_reason jsonb; v_reasons jsonb := '[]'::jsonb; v_row public.checklist_incomplete_reasons%rowtype;
  v_live uuid[]; v_expected uuid[]; v_n integer; v_count integer;
begin
  select * into v_instance from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  if public.checklist_actor_level(p_actor, v_instance.location_id) < 3 then raise exception 'not_authorized'; end if;
  -- p_confirmed_at is retained for call compatibility but intentionally ignored.
  if jsonb_typeof(p_reasons) is distinct from 'array'
    or p_expected_completion_ids is null or array_position(p_expected_completion_ids, null) is not null then
    raise exception 'invalid_payload';
  end if;
  -- App gates/PIN run BEFORE this transaction. Bind their exact completion snapshot
  -- so a replacement winning the lock before us requires validation again.
  -- Match confirmInstance's existing superseded_at-only live query (incl revoked).
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_live
    from public.checklist_completions where instance_id = p_instance and superseded_at is null;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_expected
    from unnest(p_expected_completion_ids) id;
  if v_live is distinct from v_expected then raise exception 'completion_set_changed'; end if;
  v_count := jsonb_array_length(p_reasons);
  if (select count(distinct r->>'templateItemId') from jsonb_array_elements(p_reasons) r) <> v_count then
    raise exception 'invalid_reasons';
  end if;
  for v_reason in select value from jsonb_array_elements(p_reasons) loop
    if jsonb_typeof(v_reason->'reason') is distinct from 'string'
      or btrim(v_reason->>'reason') = '' or not exists(select 1 from public.checklist_template_items
        where id = (v_reason->>'templateItemId')::uuid and template_id = v_instance.template_id) then
      raise exception 'invalid_reasons';
    end if;
  end loop;
  update public.checklist_instances set status = case when v_count > 0 then 'incomplete_confirmed' else 'confirmed' end,
    confirmed_at = clock_timestamp(), confirmed_by = p_actor
    where id = p_instance and status = 'open' returning * into strict v_instance;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'instance_cardinality'; end if;
  for v_reason in select value from jsonb_array_elements(p_reasons) loop
    -- Reuse a reason saved by an earlier attempt, matching the former app path.
    select * into v_row from public.checklist_incomplete_reasons
      where instance_id = p_instance and template_item_id = (v_reason->>'templateItemId')::uuid
        and reported_by = p_actor order by reported_at, id limit 1;
    if not found then
      insert into public.checklist_incomplete_reasons(instance_id, template_item_id, reason, reported_by)
        values (p_instance, (v_reason->>'templateItemId')::uuid, v_reason->>'reason', p_actor)
        returning * into strict v_row;
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'reason_cardinality'; end if;
    end if;
    v_reasons := v_reasons || jsonb_build_array(to_jsonb(v_row));
  end loop;
  insert into public.checklist_submissions(instance_id, submitted_by, completion_ids, is_final_confirmation)
    values (p_instance, p_actor, '{}'::uuid[], true) returning * into strict v_submission;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'submission_cardinality'; end if;
  return jsonb_build_object('instance', to_jsonb(v_instance), 'reasons', v_reasons, 'submission', to_jsonb(v_submission));
end $$;

-- PostgREST value filters cannot express now()-3h. Keep the predicate and the
-- counter increment in ONE UPDATE; row locking makes concurrent increments safe.
-- p_actor comes only from the verified server actor, as with checklist writers.
create function public.written_report_update_self(
  p_actor uuid, p_id uuid, p_title text, p_body text, p_category text, p_visibility_min_level integer
) returns integer language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_n integer;
begin
  update public.written_reports set title = p_title, body = p_body, category = p_category,
    visibility_min_level = p_visibility_min_level, last_edited_at = clock_timestamp(),
    edit_count = coalesce(edit_count, 0) + 1
    where id = p_id and submitted_by = p_actor and submitted_at > now() - interval '3 hours';
  get diagnostics v_n = row_count;
  if v_n not in (0, 1) then raise exception 'report_cardinality'; end if;
  return v_n;
end $$;

revoke all on function public.written_report_update_self(uuid,uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.written_report_update_self(uuid,uuid,text,text,text,integer) to service_role;

revoke all on function public.checklist_actor_level(uuid,uuid),
  public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text),
  public.checklist_submit_batch(uuid,uuid,uuid[]),
  public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.checklist_actor_level(uuid,uuid),
  public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text),
  public.checklist_submit_batch(uuid,uuid,uuid[]),
  public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) to service_role;

do $$
declare f regprocedure;
begin
  if not has_function_privilege('service_role', 'public.assignment_author_level(uuid)', 'EXECUTE') then
    raise exception '0276: service_role cannot execute assignment_author_level';
  end if;
  foreach f in array array[
    'public.written_report_update_self(uuid,uuid,text,text,text,integer)'::regprocedure,
    'public.checklist_actor_level(uuid,uuid)'::regprocedure,
    'public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)'::regprocedure,
    'public.checklist_submit_batch(uuid,uuid,uuid[])'::regprocedure,
    'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0276: RPC execution grant escaped';
    end if;
    if exists(select 1 from pg_proc where oid = f and (prosecdef or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0276: RPC execution context escaped';
    end if;
  end loop;
end $$;
INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'checklist_instances', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0276_checklist_guarded_writers',
    'change', 'service-only guarded checklist writers and atomic written-report self-edit',
    'scope', 'replacement + confirm through 0276; existing revoke/tag/reference writers excluded'));
commit;
