-- Migration 0287_checklist_corrections_serialized
-- AUTHORED 2026-11-01. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0286.
-- Provenance: Track 3 chunk 1, CC's binding track3-rulings.md after Opus plan review.
-- Global lock order: AM instance -> closing instance -> completion rows.
-- New parent locks use FOR NO KEY UPDATE; existing 0276 confirmation is preserved.
-- Actor UUID comes only from the verified server session. Task assignment gates
-- remain app prechecks. Correction membership mirrors the existing RLS read scope:
-- a location membership (including an inactive row) OR current level >= 8.
-- ROLLOUT: apply SQL before the app; CC first checks for revoked report-reference
-- heads in prod. Deploy filtered confirmation snapshots and serialized corrections,
-- then drain old deployments before claiming cooperating correction writers.
-- Confirmation accepts legacy unfiltered OR filtered expected IDs during the drain.
-- A later tightening migration MUST accept filtered-only after old deployments drain.
-- Transitional limitation: where the two snapshot sets were identical, a revoke
-- can still match the legacy set; full revoke-race detection requires tightening.
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure), 'v_filtered') > 0; -- true
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done'); -- service_role (+ postgres) only
--   Run scripts/preflight-0276.mjs and the sim-only two-session 0287 lock proof.
-- ROLLBACK: revert app first; retain these backward-compatible service-only RPCs
-- and dual-accept confirm while old deployments exist. Any removal/re-emission is
-- a new migration; never delete or rewrite historical completion/audit rows.
begin;

create function public.checklist_revoke_completion(p_completion uuid, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed numeric;
begin
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- Deliberately no active filter: parity with today's current_user_locations.
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  if v_completion.completed_by is distinct from p_actor then raise exception 'not_self'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := extract(epoch from (v_at - v_completion.completed_at)) * 1000;
  if v_elapsed >= 60000 then raise exception 'outside_quick_window'
    using detail = jsonb_build_object('elapsed_ms', v_elapsed)::text; end if;

  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = 'error_tap'
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create function public.checklist_revoke_with_reason(p_completion uuid, p_actor uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed numeric; v_note text;
begin
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- Deliberately no active filter: parity with today's current_user_locations.
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  if v_completion.completed_by is distinct from p_actor then raise exception 'not_self'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := extract(epoch from (v_at - v_completion.completed_at)) * 1000;
  if v_elapsed < 60000 then raise exception 'use_quick_revoke'; end if;
  v_note := btrim(coalesce(p_note, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if p_reason is null or p_reason not in ('not_actually_done', 'other') then raise exception 'invalid_payload'; end if;
  if p_reason = 'other' and v_note = '' then raise exception 'revocation_note_required'; end if;
  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = p_reason, revocation_note = case when p_reason = 'other' then v_note else null end
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create function public.checklist_mark_not_done(p_completion uuid, p_actor uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed numeric; v_note text;
begin
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- Deliberately no active filter: parity with today's current_user_locations.
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  if v_completion.completed_by = p_actor then raise exception 'use_self_revoke'; end if;
  if v_level < 4 then raise exception 'role_level_insufficient'
    using detail = jsonb_build_object('required', 4, 'actual', v_level)::text; end if;
  v_completer_level := public.assignment_author_level(v_completion.completed_by);
  if v_completer_level is null then raise exception 'completer_not_found'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := extract(epoch from (v_at - v_completion.completed_at)) * 1000;
  if v_elapsed < 60000 then raise exception 'use_quick_revoke'; end if;
  v_note := btrim(coalesce(p_note, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if v_note = '' then raise exception 'revocation_note_required'; end if;
  if v_level < v_completer_level then raise exception 'revoke_hierarchy_violation'
    using detail = jsonb_build_object('actor_level', v_level, 'completer_level', v_completer_level)::text; end if;
  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = 'not_actually_done', revocation_note = v_note
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create or replace function public.checklist_confirm_instance(
  p_actor uuid, p_instance uuid, p_confirmed_at timestamptz,
  p_reasons jsonb, p_expected_completion_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype; v_submission public.checklist_submissions%rowtype;
  v_reason jsonb; v_reasons jsonb := '[]'::jsonb; v_row public.checklist_incomplete_reasons%rowtype;
  v_live uuid[]; v_filtered uuid[]; v_expected uuid[]; v_n integer; v_count integer;
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
  -- 0287 transition: old deployments send all unsuperseded heads; new ones
  -- send only unrevoked heads. Tighten to filtered-only after the drain.
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_live
    from public.checklist_completions where instance_id = p_instance and superseded_at is null;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_filtered
    from public.checklist_completions where instance_id = p_instance
      and superseded_at is null and revoked_at is null;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_expected
    from unnest(p_expected_completion_ids) id;
  if v_live is distinct from v_expected and v_filtered is distinct from v_expected then raise exception 'completion_set_changed'; end if;
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

revoke all on function public.checklist_revoke_completion(uuid,uuid) from public, anon, authenticated;
grant execute on function public.checklist_revoke_completion(uuid,uuid) to service_role;
revoke all on function public.checklist_revoke_with_reason(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.checklist_revoke_with_reason(uuid,uuid,text,text) to service_role;
revoke all on function public.checklist_mark_not_done(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.checklist_mark_not_done(uuid,uuid,text) to service_role;
revoke all on function public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) to service_role;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.checklist_revoke_completion(uuid,uuid)'::regprocedure,
    'public.checklist_revoke_with_reason(uuid,uuid,text,text)'::regprocedure,
    'public.checklist_mark_not_done(uuid,uuid,text)'::regprocedure,
    'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0287: RPC execution grant escaped';
    end if;
    if exists(select 1 from pg_proc where oid = f and (prosecdef or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0287: RPC execution context escaped';
    end if;
  end loop;
end $$;
INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'checklist_instances', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0287_checklist_corrections_serialized',
    'change', 'service-only serialized corrections and transitional dual-accept confirmation',
    'scope', 'generic corrections only; reference replacement and prep retry locking deferred'));
commit;
