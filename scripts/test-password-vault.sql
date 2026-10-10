-- CC SIM ONLY, after 0235 + 0241. Owner connection; every fixture change rolls back.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-password-vault.sql
-- Do not run against production. Requires the existing named sim sentinel.
-- Covers: grants and RLS as authenticated/anon (tables and RPCs), vault_write_secret (versions, supersede, the
-- one-current index, scrub of an artificially aged previous version), vault_scrub_expired_secrets, the reveal
-- counter per hour-bucket, and the vault_reveals CHECKs (a personal reveal cannot be recorded; an owner recovery
-- is personal). Nothing here decrypts: the envelope fields are random base64 of the right lengths.
begin;
set local plpgsql.check_asserts=on;
do $$ begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then
    raise exception 'SIM ONLY';
  end if;
  assert to_regprocedure('public.vault_write_secret(uuid,uuid,integer,text,text,text,text,text,text,text)') is not null,'0235 required';
  assert not exists(select 1 from information_schema.routine_privileges
    where routine_schema='public' and routine_name in ('vault_write_secret','vault_update_entry','vault_take_reveal_slot','vault_scrub_expired_secrets')
      and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE'), 'RPC grants';
  assert (select bool_and(relrowsecurity) from pg_class where oid in
    ('public.vault_entries'::regclass,'public.vault_secrets'::regclass,'public.vault_reveals'::regclass,'public.vault_reveal_counters'::regclass)),'vault RLS';
  assert not exists(select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name in ('vault_entries','vault_secrets','vault_reveals','vault_reveal_counters')
      and grantee in ('PUBLIC','anon','authenticated')), 'staff grants';
  assert not exists(select 1 from information_schema.role_table_grants
    where table_schema='public' and grantee='service_role' and (
      (table_name in ('vault_entries','vault_secrets','vault_reveals','vault_reveal_counters') and privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      or (table_name='vault_secrets' and privilege_type in ('INSERT','UPDATE'))
      or (table_name='vault_reveals' and privilege_type='UPDATE')
      or (table_name='vault_reveal_counters' and privilege_type in ('INSERT','UPDATE')))), 'service grants';
end $$;
-- Fixture-only failure injection. The enclosing rollback removes trigger and function.
create function public.vault_test_reject_audit() returns trigger language plpgsql as $$ begin
  if new.action='vault_secret.rotate' and current_setting('vault_test.fail_rotation_audit',true)='1' then
    raise exception 'forced_audit_failure';
  end if;
  return new;
end $$;
create trigger vault_test_reject_audit before insert on public.audit_log
  for each row execute function public.vault_test_reject_audit();

set local role authenticated;
do $$ begin
  begin perform public.vault_write_secret(gen_random_uuid(),gen_random_uuid(),1,'a','b','c','d','e','f','v1');
    raise exception 'staff write RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.vault_update_entry(gen_random_uuid(),gen_random_uuid(),1,'{}'::jsonb,null,null);
    raise exception 'staff edit RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.vault_take_reveal_slot(gen_random_uuid());
    raise exception 'staff slot RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.vault_entries; raise exception 'staff entries read allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.vault_secrets; raise exception 'staff secrets read allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.vault_reveals; raise exception 'staff reveals read allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.vault_reveal_counters; raise exception 'staff counters read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.vault_scrub_expired_secrets(); raise exception 'anon scrub RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.vault_secrets; raise exception 'anon secrets read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare
  loc uuid; actor uuid; owner_user uuid; entry uuid; personal uuid; r jsonb; n integer; bucket timestamptz;
  -- Random base64 of the envelope's exact shapes; never a real ciphertext.
  f_iv text:=encode(gen_random_bytes(12),'base64'); f_tag text:=encode(gen_random_bytes(16),'base64');
  f_key text:=encode(gen_random_bytes(32),'base64'); f_ct text:=encode(gen_random_bytes(48),'base64');
begin
  select ul.location_id, ul.user_id into loc, actor from public.user_locations ul join public.users u on u.id=ul.user_id
    where ul.active and u.active order by ul.location_id, ul.user_id limit 1;
  assert loc is not null,'requires an active sim membership';
  select id into owner_user from public.users where active and id<>actor order by id limit 1;

  -- A. shared entry metadata (service-role style write; RLS is bypassed by the owner connection, grants proven above)
  insert into public.vault_entries(kind,entry_type,name,username,location_id,min_level,created_by)
    values('shared','login','SIM vault '||gen_random_uuid(),'ops',loc,4,actor) returning id into entry;
  begin
    insert into public.vault_entries(kind,entry_type,name,location_id,min_level,created_by) values('shared','login','bad',loc,3,actor);
    raise exception 'floor 3 accepted'; exception when check_violation then null; end;
  begin
    insert into public.vault_entries(kind,entry_type,name,owner_id,location_id,created_by) values('personal','login','bad',owner_user,loc,actor);
    raise exception 'personal entry with a shop accepted'; exception when check_violation then null; end;
  insert into public.vault_entries(kind,entry_type,name,owner_id,created_by) values('personal','login','SIM mine',owner_user,owner_user) returning id into personal;

  -- B. versions: v1, then v2 supersedes v1; one current per entry
  r:=public.vault_write_secret(entry,actor,1,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
  assert (r->>'version')::int=1 and (r->>'superseded')::boolean=false, 'v1: '||r::text;
  begin
    perform public.vault_write_secret(entry,actor,1,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
    raise exception 'stale version accepted'; exception when others then assert sqlerrm='version_conflict', sqlerrm; end;
  r:=public.vault_write_secret(entry,actor,2,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
  assert (r->>'version')::int=2 and (r->>'superseded')::boolean=true, 'v2: '||r::text;
  assert (select count(*) from public.vault_secrets where entry_id=entry and superseded_at is null)=1,'one current';
  assert (select count(*) from public.vault_secrets where entry_id=entry)=2,'two versions kept';
  begin
    insert into public.vault_secrets(entry_id,version,ciphertext,iv,tag,wrapped_key,key_iv,key_tag,master_key_id,created_by)
      values(entry,3,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1',actor);
    raise exception 'second current version accepted'; exception when unique_violation then null; end;
  begin
    perform public.vault_write_secret(entry,actor,3,f_ct,'short',f_tag,f_key,f_iv,f_tag,'v1');
    raise exception 'malformed iv accepted'; exception when check_violation then null; end;
  begin
    perform public.vault_write_secret(gen_random_uuid(),actor,1,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
    raise exception 'unknown entry accepted'; exception when others then assert sqlerrm='entry_not_found', sqlerrm; end;

  -- Review regressions #1/#3: failed rotations roll metadata back; stale metadata edits refuse.
  update public.vault_entries set min_level=9 where id=entry;
  begin
    perform public.vault_update_entry(entry,actor,1,'{"min_level":4}'::jsonb,2,
      jsonb_build_object('ciphertext',f_ct,'iv',f_iv,'tag',f_tag,'wrappedKey',f_key,'keyIv',f_iv,'keyTag',f_tag,'masterKeyId','v1'));
    raise exception 'conflicting rotation accepted';
  exception when others then assert sqlerrm='version_conflict',sqlerrm; end;
  assert (select min_level=9 and revision=1 from public.vault_entries where id=entry),'failed rotation changed access';
  assert (select version=2 from public.vault_secrets where entry_id=entry and superseded_at is null),'failed rotation changed secret';
  -- Even a constraint failure after the inner secret write rolls the whole transaction back.
  begin
    perform public.vault_update_entry(entry,actor,1,'{"min_level":3}'::jsonb,3,
      jsonb_build_object('ciphertext',f_ct,'iv',f_iv,'tag',f_tag,'wrappedKey',f_key,'keyIv',f_iv,'keyTag',f_tag,'masterKeyId','v1'));
    raise exception 'invalid floor accepted';
  exception when check_violation then null; end;
  assert (select count(*) from public.vault_secrets where entry_id=entry)=2,'rotation escaped rollback';
  r:=public.vault_update_entry(entry,actor,1,'{"name":"Newer"}'::jsonb,null,null);
  assert (r->>'revision')::int=2,'revision did not advance';
  begin
    perform public.vault_update_entry(entry,actor,1,'{"name":"Stale"}'::jsonb,null,null);
    raise exception 'stale metadata accepted';
  exception when others then assert sqlerrm='version_conflict',sqlerrm; end;
  assert (select name='Newer' and revision=2 from public.vault_entries where id=entry),'stale editor overwrote metadata';

  -- 0241: one edit row, one rotation row, atomic with the secret. No duplicates on stale retry.
  assert (select count(*) from public.audit_log where resource_id=entry and action='vault_entry.update')=1,'metadata edit audited once';
  assert not exists(select 1 from public.audit_log where resource_id=entry and action='vault_secret.rotate'),'failed rotations left no audit';
  begin
    perform public.vault_update_entry(entry,actor,2,'{}'::jsonb,3,
      jsonb_build_object('ciphertext',f_ct,'iv',f_iv,'tag',f_tag,'wrappedKey',f_key,'keyIv',f_iv,'keyTag',f_tag,'masterKeyId','v1'));
    assert (select count(*) from public.audit_log where resource_id=entry and action='vault_secret.rotate')=1,'rotation audited once inside transaction';
    assert (select count(*) from public.audit_log where resource_id=entry and action='vault_entry.update')=2,'edit audited once inside transaction';
    raise exception 'forced_rollback';
  exception when others then assert sqlerrm='forced_rollback',sqlerrm; end;
  assert not exists(select 1 from public.audit_log where resource_id=entry and action='vault_secret.rotate'),'rollback left no rotation audit';
  assert (select count(*) from public.audit_log where resource_id=entry and action='vault_entry.update')=1,'rollback left no edit audit';
  assert (select revision=2 from public.vault_entries where id=entry),'rollback restored revision';
  assert (select version=2 from public.vault_secrets where entry_id=entry and superseded_at is null),'rollback restored secret';

  -- C. the 30-day scrub: age v1 artificially, write v3 -> v1 is a scrubbed shell, v2 (fresh) stays whole
  update public.vault_secrets set superseded_at=clock_timestamp()-interval '31 days' where entry_id=entry and version=1;
  r:=public.vault_write_secret(entry,actor,3,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
  assert (r->>'version')::int=3 and (r->>'scrubbed')::int=1, 'v3 scrub: '||r::text;
  assert (select ciphertext is null and wrapped_key is null and scrubbed_at is not null from public.vault_secrets where entry_id=entry and version=1),'v1 scrubbed';
  assert (select ciphertext is not null and scrubbed_at is null from public.vault_secrets where entry_id=entry and version=2),'v2 whole';
  assert (select count(*) from public.vault_secrets where entry_id=entry)=3,'rows never deleted';
  update public.vault_secrets set superseded_at=clock_timestamp()-interval '31 days' where entry_id=entry and version=2;
  assert public.vault_scrub_expired_secrets()>=1,'sweep scrubs v2';
  assert (select scrubbed_at is not null from public.vault_secrets where entry_id=entry and version=2),'v2 scrubbed by sweep';
  begin
    update public.vault_secrets set scrubbed_at=clock_timestamp() where entry_id=entry and version=3;
    raise exception 'current version scrubbed'; exception when check_violation then null; end;

  -- D. the reveal counter: one bucket per hour, counts attempts
  r:=public.vault_take_reveal_slot(actor); assert (r->>'attempts')::int>=1,'slot 1';
  n:=(r->>'attempts')::int; bucket:=(r->>'bucket_start')::timestamptz;
  r:=public.vault_take_reveal_slot(actor); assert (r->>'attempts')::int=n+1 and (r->>'bucket_start')::timestamptz=bucket,'slot 2';
  assert bucket=date_trunc('hour',bucket),'hour bucket';

  -- E. the record: shared reveal ok; personal reveal impossible; owner recovery must be personal
  insert into public.vault_reveals(entry_id,entry_kind,entry_type,location_id,viewer_id,kind,secret_version,burst)
    values(entry,'shared','login',loc,actor,'reveal',3,false);
  begin
    insert into public.vault_reveals(entry_id,entry_kind,entry_type,viewer_id,kind,secret_version)
      values(personal,'personal','login',owner_user,'reveal',1);
    raise exception 'personal reveal recorded'; exception when check_violation then null; end;
  begin
    insert into public.vault_reveals(entry_id,entry_kind,entry_type,location_id,viewer_id,kind,secret_version)
      values(entry,'shared','login',loc,actor,'owner_recovery',3);
    raise exception 'owner recovery of a shared entry recorded'; exception when check_violation then null; end;
  insert into public.vault_reveals(entry_id,entry_kind,entry_type,viewer_id,kind,secret_version)
    values(personal,'personal','login',actor,'owner_recovery',1);
  -- Commit a successful rotation through the app RPC as its service-role caller.
  set local role service_role;
  perform public.vault_update_entry(entry,actor,2,
    '{"notes":"CANARY-audit-notes","_audit":{"ip_address":"127.0.0.1","user_agent":"harness","secret":"CANARY-context"}}'::jsonb,4,
    jsonb_build_object('ciphertext',f_ct,'iv',f_iv,'tag',f_tag,'wrappedKey',f_key,'keyIv',f_iv,'keyTag',f_tag,'masterKeyId','v1'));
  reset role;
  assert (select count(*) from public.audit_log where resource_id=entry and action='vault_secret.rotate')=1,'exactly one rotation audit';
  assert (select count(*) from public.audit_log where resource_id=entry and action='vault_entry.update')=2,'exactly one new edit audit';
  assert (select bool_and(destructive and actor_id=actor and actor_role=(select role from public.users where id=actor))
    from public.audit_log where resource_id=entry),'audit actor and destructive';
  assert not exists(select 1 from public.audit_log where resource_id=entry and
    (metadata::text like '%CANARY-%' or metadata::text like '%'||f_ct||'%' or metadata::text like '%'||f_key||'%')),'audit allowlist';
  begin
    perform public.vault_update_entry(entry,actor,2,'{}'::jsonb,null,null);
    raise exception 'stale retry accepted';
  exception when others then assert sqlerrm='version_conflict',sqlerrm; end;
  assert (select count(*) from public.audit_log where resource_id=entry and action='vault_secret.rotate')=1,'retry did not duplicate audit';

  -- Force the SECOND audit insert to fail after metadata, secret and edit audit writes.
  perform set_config('vault_test.fail_rotation_audit','1',true);
  begin
    perform public.vault_update_entry(entry,actor,3,'{"name":"must roll back"}'::jsonb,5,
      jsonb_build_object('ciphertext',f_ct,'iv',f_iv,'tag',f_tag,'wrappedKey',f_key,'keyIv',f_iv,'keyTag',f_tag,'masterKeyId','v1'));
    raise exception 'audit failure accepted';
  exception when others then assert sqlerrm='forced_audit_failure',sqlerrm; end;
  perform set_config('vault_test.fail_rotation_audit','0',true);
  assert (select revision=3 and name<>'must roll back' from public.vault_entries where id=entry),'audit failure rolled back metadata';
  assert (select version=4 from public.vault_secrets where entry_id=entry and superseded_at is null),'audit failure rolled back secret';
  assert (select count(*) from public.audit_log where resource_id=entry)=3,'audit failure rolled back first audit too';

  -- Personal edits preserve privacy (no personal name, login, URL or notes in audit).
  perform public.vault_update_entry(personal,owner_user,1,'{"name":"CANARY-personal-name","username":"CANARY-login"}'::jsonb,null,null);
  assert (select count(*) from public.audit_log where resource_id=personal and action='vault_entry.update')=1,'personal edit audited';
  assert not exists(select 1 from public.audit_log where resource_id=personal and metadata::text like '%CANARY-%'),'personal audit privacy';
  raise notice 'password vault harness: PASS';
end $$;
rollback;
