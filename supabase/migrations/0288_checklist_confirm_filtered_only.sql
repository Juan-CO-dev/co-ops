-- Migration 0288_checklist_confirm_filtered_only
-- AUTHORED 2026-11-01. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0287.
-- Provenance: planned post-drain tightening of 0287, PR #508 (merge a6b2a0ca).
-- ROLLOUT: apply only after every deployment older than #508's merge a6b2a0ca
-- has drained. The app already sends filtered snapshots and needs no change.
-- VERIFY AFTER APPLY:
--   select pg_get_functiondef('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure);
--     Must contain the filtered query (superseded_at is null and revoked_at is null)
--     and must NOT contain v_live.
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name = 'checklist_confirm_instance'; -- service_role (+ postgres) only
--   The post-grant DO block asserts SECURITY INVOKER and search_path = pg_catalog, public.
-- ROLLBACK: re-emit the 0287 dual-accept body in a NEW migration; never rewrite history.
begin;

do $$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure);
  if strpos(v_definition, 'v_filtered') = 0 or strpos(v_definition,
    'v_live is distinct from v_expected and v_filtered is distinct from v_expected') = 0 then
    raise exception '0288: expected 0287 dual-accept confirmation';
  end if;
end $$;

create or replace function public.checklist_confirm_instance(
  p_actor uuid, p_instance uuid, p_confirmed_at timestamptz,
  p_reasons jsonb, p_expected_completion_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype; v_submission public.checklist_submissions%rowtype;
  v_reason jsonb; v_reasons jsonb := '[]'::jsonb; v_row public.checklist_incomplete_reasons%rowtype;
  v_filtered uuid[]; v_expected uuid[]; v_n integer; v_count integer;
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
  -- The expected set is the unrevoked live heads.
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_filtered
    from public.checklist_completions where instance_id = p_instance
      and superseded_at is null and revoked_at is null;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_expected
    from unnest(p_expected_completion_ids) id;
  if v_filtered is distinct from v_expected then raise exception 'completion_set_changed'; end if;
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

revoke all on function public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) to service_role;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0288: RPC execution grant escaped';
    end if;
    if exists(select 1 from pg_proc where oid = f and (prosecdef or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0288: RPC execution context escaped';
    end if;
  end loop;
end $$;
INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'checklist_instances', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0288_checklist_confirm_filtered_only',
    'change', 'confirmation accepts only unrevoked live heads'));
commit;
