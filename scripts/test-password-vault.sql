-- CC SIM ONLY, after 0235. Owner connection; every fixture change rolls back.
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
  assert to_regprocedure('public.vault_write_secret(uuid,uuid,text,text,text,text,text,text,text)') is not null,'0235 required';
  assert not exists(select 1 from information_schema.routine_privileges
    where routine_schema='public' and routine_name in ('vault_write_secret','vault_take_reveal_slot','vault_scrub_expired_secrets')
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
set local role authenticated;
do $$ begin
  begin perform public.vault_write_secret(gen_random_uuid(),gen_random_uuid(),'a','b','c','d','e','f','v1');
    raise exception 'staff write RPC allowed'; exception when insufficient_privilege then null; end;
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
  r:=public.vault_write_secret(entry,actor,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
  assert (r->>'version')::int=1 and (r->>'superseded')::boolean=false, 'v1: '||r::text;
  r:=public.vault_write_secret(entry,actor,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
  assert (r->>'version')::int=2 and (r->>'superseded')::boolean=true, 'v2: '||r::text;
  assert (select count(*) from public.vault_secrets where entry_id=entry and superseded_at is null)=1,'one current';
  assert (select count(*) from public.vault_secrets where entry_id=entry)=2,'two versions kept';
  begin
    insert into public.vault_secrets(entry_id,version,ciphertext,iv,tag,wrapped_key,key_iv,key_tag,master_key_id,created_by)
      values(entry,3,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1',actor);
    raise exception 'second current version accepted'; exception when unique_violation then null; end;
  begin
    perform public.vault_write_secret(entry,actor,f_ct,'short',f_tag,f_key,f_iv,f_tag,'v1');
    raise exception 'malformed iv accepted'; exception when check_violation then null; end;
  begin
    perform public.vault_write_secret(gen_random_uuid(),actor,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
    raise exception 'unknown entry accepted'; exception when others then assert sqlerrm='entry_not_found', sqlerrm; end;

  -- C. the 30-day scrub: age v1 artificially, write v3 -> v1 is a scrubbed shell, v2 (fresh) stays whole
  update public.vault_secrets set superseded_at=clock_timestamp()-interval '31 days' where entry_id=entry and version=1;
  r:=public.vault_write_secret(entry,actor,f_ct,f_iv,f_tag,f_key,f_iv,f_tag,'v1');
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
  raise notice 'password vault harness: PASS';
end $$;
rollback;
