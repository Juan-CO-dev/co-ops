-- Migration 0241_vault_hardening
-- APPLIED TO PROD 2026-10-10 (20261010044236; sim 20261010043200 harness pass; prod dry run pass). Apply BEFORE the app change (app sends _audit).
-- Re-emits 0235's six-argument vault_update_entry; 0235 is already applied and unchanged.
-- Edit and rotation audit rows commit with the mutation (fail-closed here, unlike app audit()).
-- Apply before the accompanying app change; VAULT_ENABLED remains off.
begin;

do $$ declare col text; begin
  if to_regprocedure('public.vault_update_entry(uuid,uuid,integer,jsonb,integer,jsonb)') is null then
    raise exception '0241: 0235 required';
  end if;
  foreach col in array array['actor_id','actor_role','action','resource_table','resource_id','metadata','destructive'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='audit_log' and column_name=col) then
      raise exception '0241: missing audit_log column %',col;
    end if;
  end loop;
end $$;

create or replace function public.vault_update_entry(p_entry_id uuid,p_actor_id uuid,p_expected_revision integer,
  p_patch jsonb,p_version integer,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_entry public.vault_entries%rowtype;
  v_actor_role public.users.role%type; v_changed jsonb; v_metadata jsonb; v_context jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 1 or p_patch is null
    or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_payload'; end if;
  select role into v_actor_role from public.users where id=p_actor_id and active;
  if not found then raise exception 'role_insufficient'; end if;
  -- Optional request context from the service-only app caller. Never copy arbitrary JSON to audit.
  v_context := jsonb_build_object('ip_address',p_patch->'_audit'->>'ip_address',
    'user_agent',p_patch->'_audit'->>'user_agent');
  p_patch := p_patch - '_audit';
  if exists(select 1 from jsonb_object_keys(p_patch) as k(key)
    where key not in ('name','entry_type','username','url','notes','location_id','min_level')) then
    raise exception 'invalid_payload';
  end if;
  select * into v_entry from public.vault_entries where id=p_entry_id for update;
  if not found or not v_entry.active then raise exception 'entry_not_found'; end if;
  if v_entry.revision <> p_expected_revision then raise exception 'version_conflict'; end if;
  if (p_version is null) <> (p_envelope is null) then raise exception 'invalid_payload'; end if;
  if p_version is not null then
    perform public.vault_write_secret(p_entry_id,p_actor_id,p_version,
      p_envelope->>'ciphertext',p_envelope->>'iv',p_envelope->>'tag',
      p_envelope->>'wrappedKey',p_envelope->>'keyIv',p_envelope->>'keyTag',p_envelope->>'masterKeyId');
  end if;
  select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into v_changed
    from jsonb_each(p_patch) where value is distinct from to_jsonb(v_entry)->key;
  v_entry := jsonb_populate_record(v_entry,p_patch);
  update public.vault_entries set name=v_entry.name,entry_type=v_entry.entry_type,
    username=v_entry.username,url=v_entry.url,notes=v_entry.notes,location_id=v_entry.location_id,
    min_level=v_entry.min_level,revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()
    where id=p_entry_id returning * into v_entry;
  -- Explicit allowlist: no envelope, secret, username, URL, notes or personal entry name.
  v_metadata := jsonb_build_object('kind',v_entry.kind,'entry_id',v_entry.id,'entry_type',v_entry.entry_type) || v_context;
  if v_entry.kind='shared' then
    v_metadata := v_metadata || jsonb_build_object('name',v_entry.name,'location_id',v_entry.location_id,'min_level',v_entry.min_level);
  end if;
  if v_changed <> '[]'::jsonb or p_version is not null then
    insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
      values(p_actor_id,v_actor_role,'vault_entry.update','vault_entries',p_entry_id,
        v_metadata || jsonb_build_object('changed',v_changed,'secret_rotated',p_version is not null,'secret_version',p_version),true);
  end if;
  if p_version is not null then
    insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
      values(p_actor_id,v_actor_role,'vault_secret.rotate','vault_secrets',p_entry_id,
        v_metadata || jsonb_build_object('secret_version',p_version),true);
  end if;
  return to_jsonb(v_entry);
end $$;

revoke all on function public.vault_update_entry(uuid,uuid,integer,jsonb,integer,jsonb) from public,anon,authenticated;
grant execute on function public.vault_update_entry(uuid,uuid,integer,jsonb,integer,jsonb) to service_role;
do $$ begin
  if exists(select 1 from information_schema.routine_privileges
    where routine_schema='public' and routine_name='vault_update_entry'
      and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE') then
    raise exception '0241: RPC grant escaped';
  end if;
end $$;
commit;
