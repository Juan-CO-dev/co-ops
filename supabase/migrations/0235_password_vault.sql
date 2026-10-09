-- Migration 0235_password_vault
-- AUTHORED ONLY 2026-10-08 (CO Claude builder, feat/password-vault). NOT APPLIED. GATE: CC sim + Astra review, then Juan's apply gate.
-- 0234 is reserved for the parallel customer-profiles build; nothing here touches it.
--
-- Password vault (Juan 2026-10-08: "Build the vault"; spec docs/superpowers/specs/2026-10-08-password-vault-design.md,
-- approved by Juan, PR #426). App features behind VAULT_ENABLED=1; the master key is VAULT_MASTER_KEY in server env ONLY.
--
-- Envelope encryption lives in the app (lib/vault-crypto.ts, AES-256-GCM): a per-entry data key encrypts the secret,
-- the data key is wrapped by the master key. The database stores ciphertext + the wrapped key and NEVER the master key,
-- so a dump of these tables reveals nothing. Nothing here decrypts; nothing here can.
--
-- A. vault_entries: the metadata (name, type, username, url, notes, shop, floor, owner). Never a secret column.
--    kind shared  -> min_level (4 KH+, 5 SL+, 6 AGM+, 7 GM+, 8 level 8+, 9 owner/cgs), location_id or null = both shops.
--    kind personal -> owner_id, no shop, no floor. Deactivation is active=false (append-only; no DELETE grant).
--    Written by the service role (lib/vault.ts) after the app-layer floors; deny-all RLS.
-- B. vault_secrets: append-only VERSIONS of the envelope. The current version is the one with superseded_at null
--    (partial unique index). Written ONLY by vault_write_secret (service_role holds SELECT only): it supersedes the
--    current version, appends the next, and crypto-shreds (scrubs in place) this entry's versions superseded more than
--    30 days ago. A scrubbed row keeps its history (version, who, when) and loses every byte of the envelope.
--    vault_scrub_expired_secrets() is the same sweep for every entry (called daily by /api/cron/prune-sessions, independently of VAULT_ENABLED).
-- C. vault_reveals: append-only record of SHARED reveals and of recoveries (viewer, entry, shop, time, version, burst
--    flag). Never the secret. service_role SELECT + INSERT only = append-only by grant (0218 pattern).
--    CHECK: a kind='reveal' row must be a SHARED entry -> a personal reveal cannot be recorded (spec: no record).
-- D. vault_reveal_counters: per-user hourly ATTEMPT counter for the reveal cap (PIN tries + reveals, shared + personal).
--    Names no entry, so a personal reveal leaves no record of WHAT was viewed. Written only by vault_take_reveal_slot.
begin;

do $$ declare entry text; tab text; col text; begin
  foreach entry in array array[
    'locations.id','locations.code','locations.active',
    'users.id','users.role','users.active','users.name',
    'user_locations.user_id','user_locations.location_id','user_locations.active'
  ] loop
    tab:=split_part(entry,'.',1); col:=split_part(entry,'.',2);
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=tab and column_name=col) then
      raise exception '0235: missing expected column %',entry;
    end if;
  end loop;
  if to_regclass('public.vault_entries') is not null or to_regclass('public.vault_secrets') is not null
    or to_regclass('public.vault_reveals') is not null or to_regclass('public.vault_reveal_counters') is not null then
    raise exception '0235: already applied';
  end if;
end $$;

-- ── A. Entries (metadata only) ───────────────────────────────────────────────────────────────
create table public.vault_entries (
  id uuid primary key default gen_random_uuid(),
  revision integer not null default 1 check (revision >= 1),
  kind text not null check (kind in ('shared','personal')),
  entry_type text not null check (entry_type in ('login','code','ai_key')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  username text check (char_length(username) <= 200),
  url text check (char_length(url) <= 500),
  notes text check (char_length(notes) <= 2000),
  location_id uuid references public.locations(id),
  min_level integer check (min_level in (4,5,6,7,8,9)),
  owner_id uuid references public.users(id),
  active boolean not null default true,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.users(id),
  updated_at timestamptz,
  deactivated_by uuid references public.users(id),
  deactivated_at timestamptz,
  check ((kind='personal') = (owner_id is not null)),
  check ((kind='shared') = (min_level is not null)),
  check (kind='shared' or location_id is null),
  check (active = (deactivated_at is null)),
  check ((deactivated_at is null) = (deactivated_by is null))
);
create index vault_entries_shared_live on public.vault_entries(location_id,min_level) where kind='shared' and active;
create index vault_entries_personal_live on public.vault_entries(owner_id) where kind='personal' and active;
comment on table public.vault_entries is
  '0235: password vault entry METADATA (never a secret). shared = floor + shop (null both); personal = owner. Deactivate, never delete. Deny-all RLS; service-role writer behind lib/vault.ts floors.';
alter table public.vault_entries enable row level security;
create policy vault_entries_no_user_select on public.vault_entries for select using (false);
create policy vault_entries_no_user_insert on public.vault_entries for insert with check (false);
create policy vault_entries_no_user_update on public.vault_entries for update using (false) with check (false);
create policy vault_entries_no_user_delete on public.vault_entries for delete using (false);
revoke all on public.vault_entries from public,anon,authenticated,service_role;
grant select, insert, update on public.vault_entries to service_role;

-- ── B. Secret versions (the envelope; append-only; scrubbed in place after 30 days) ──────────
create table public.vault_secrets (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.vault_entries(id),
  version integer not null check (version >= 1),
  ciphertext text check (ciphertext is null or char_length(ciphertext) between 1 and 32768),
  iv text check (iv is null or char_length(iv) = 16),
  tag text check (tag is null or char_length(tag) = 24),
  wrapped_key text check (wrapped_key is null or char_length(wrapped_key) = 44),
  key_iv text check (key_iv is null or char_length(key_iv) = 16),
  key_tag text check (key_tag is null or char_length(key_tag) = 24),
  master_key_id text not null check (char_length(master_key_id) between 1 and 32),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  scrubbed_at timestamptz,
  unique (entry_id, version),
  -- A row is either a whole envelope or a scrubbed shell; never half.
  check ((scrubbed_at is null) = (ciphertext is not null and iv is not null and tag is not null
    and wrapped_key is not null and key_iv is not null and key_tag is not null)),
  -- Only a superseded (previous) version can be scrubbed; the current one never is.
  check (scrubbed_at is null or superseded_at is not null)
);
create unique index vault_secrets_one_current on public.vault_secrets(entry_id) where superseded_at is null;
create index vault_secrets_previous on public.vault_secrets(entry_id,superseded_at desc) where superseded_at is not null;
comment on table public.vault_secrets is
  '0235: append-only envelope versions (AES-256-GCM ciphertext + data key wrapped by the server-env master key; base64). Current = superseded_at null. Written only by vault_write_secret; previous versions scrubbed in place after 30 days. Deny-all RLS.';
alter table public.vault_secrets enable row level security;
create policy vault_secrets_no_user_select on public.vault_secrets for select using (false);
create policy vault_secrets_no_user_insert on public.vault_secrets for insert with check (false);
create policy vault_secrets_no_user_update on public.vault_secrets for update using (false) with check (false);
create policy vault_secrets_no_user_delete on public.vault_secrets for delete using (false);
revoke all on public.vault_secrets from public,anon,authenticated,service_role;
grant select on public.vault_secrets to service_role;

-- ── C. Reveal / recovery record (append-only by grant; never the secret) ─────────────────────
create table public.vault_reveals (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.vault_entries(id),
  entry_kind text not null check (entry_kind in ('shared','personal')),
  entry_type text not null check (entry_type in ('login','code','ai_key')),
  location_id uuid references public.locations(id),
  viewer_id uuid not null references public.users(id),
  kind text not null check (kind in ('reveal','owner_recovery','previous_recovery')),
  secret_version integer not null check (secret_version >= 1),
  burst boolean not null default false,
  at timestamptz not null default clock_timestamp(),
  -- A personal reveal is never recorded (spec); an owner recovery is always of a personal entry.
  check (kind <> 'reveal' or entry_kind = 'shared'),
  check (kind <> 'owner_recovery' or entry_kind = 'personal')
);
create index vault_reveals_entry on public.vault_reveals(entry_id,at desc);
create index vault_reveals_viewer on public.vault_reveals(viewer_id,at desc);
comment on table public.vault_reveals is
  '0235: append-only record of shared reveals and of recoveries (who, which entry, shop, when, version, burst). Never the secret. service_role SELECT + INSERT only. Deny-all RLS.';
alter table public.vault_reveals enable row level security;
create policy vault_reveals_no_user_select on public.vault_reveals for select using (false);
create policy vault_reveals_no_user_insert on public.vault_reveals for insert with check (false);
create policy vault_reveals_no_user_update on public.vault_reveals for update using (false) with check (false);
create policy vault_reveals_no_user_delete on public.vault_reveals for delete using (false);
revoke all on public.vault_reveals from public,anon,authenticated,service_role;
grant select, insert on public.vault_reveals to service_role;

-- ── D. Hourly attempt counter (names no entry) ───────────────────────────────────────────────
create table public.vault_reveal_counters (
  user_id uuid not null references public.users(id),
  bucket_start timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  primary key (user_id, bucket_start)
);
comment on table public.vault_reveal_counters is
  '0235: per-user hourly reveal ATTEMPT counter for the cap (PIN tries + reveals, shared + personal). Names no entry. Written only by vault_take_reveal_slot. Deny-all RLS.';
alter table public.vault_reveal_counters enable row level security;
create policy vault_reveal_counters_no_user_select on public.vault_reveal_counters for select using (false);
create policy vault_reveal_counters_no_user_insert on public.vault_reveal_counters for insert with check (false);
create policy vault_reveal_counters_no_user_update on public.vault_reveal_counters for update using (false) with check (false);
create policy vault_reveal_counters_no_user_delete on public.vault_reveal_counters for delete using (false);
revoke all on public.vault_reveal_counters from public,anon,authenticated,service_role;
grant select on public.vault_reveal_counters to service_role;

-- ── Writers ──────────────────────────────────────────────────────────────────────────────────
-- Appends the next envelope version for an entry under the entry row lock: supersedes the current
-- version, inserts the new one, scrubs this entry's versions superseded more than 30 days ago.
-- p_version is the version the app encrypted FOR (the AAD binds the ciphertext to it): when it is not
-- the next version, a concurrent write got there first and this one is refused ('version_conflict')
-- rather than stored under a version it cannot decrypt as.
-- Field shapes are checked by the table; the function never inspects a byte of the envelope.
create function public.vault_write_secret(p_entry_id uuid,p_actor_id uuid,p_version integer,p_ciphertext text,p_iv text,p_tag text,
  p_wrapped_key text,p_key_iv text,p_key_tag text,p_master_key_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_entry public.vault_entries%rowtype; v_version integer; v_superseded integer; v_scrubbed integer;
begin
  if p_entry_id is null or p_actor_id is null or p_version is null or p_ciphertext is null or p_iv is null or p_tag is null
    or p_wrapped_key is null or p_key_iv is null or p_key_tag is null or p_master_key_id is null then
    raise exception 'invalid_payload';
  end if;
  if not exists(select 1 from public.users where id=p_actor_id and active) then raise exception 'role_insufficient'; end if;
  select * into v_entry from public.vault_entries where id=p_entry_id for update;
  if not found or not v_entry.active then raise exception 'entry_not_found'; end if;
  select coalesce(max(version),0)+1 into v_version from public.vault_secrets where entry_id=p_entry_id;
  if p_version <> v_version then raise exception 'version_conflict'; end if;
  update public.vault_secrets set superseded_at=clock_timestamp() where entry_id=p_entry_id and superseded_at is null;
  get diagnostics v_superseded = row_count;
  insert into public.vault_secrets(entry_id,version,ciphertext,iv,tag,wrapped_key,key_iv,key_tag,master_key_id,created_by)
    values(p_entry_id,v_version,p_ciphertext,p_iv,p_tag,p_wrapped_key,p_key_iv,p_key_tag,p_master_key_id,p_actor_id);
  update public.vault_secrets set ciphertext=null,iv=null,tag=null,wrapped_key=null,key_iv=null,key_tag=null,scrubbed_at=clock_timestamp()
    where entry_id=p_entry_id and scrubbed_at is null and superseded_at < clock_timestamp() - interval '30 days';
  get diagnostics v_scrubbed = row_count;
  return jsonb_build_object('version',v_version,'superseded',v_superseded>0,'scrubbed',v_scrubbed);
end $$;

-- Metadata and optional rotation are one transaction. The client-observed revision guards
-- metadata-only edits as well as rotations; the entry lock serializes all secret writers.
create function public.vault_update_entry(p_entry_id uuid,p_actor_id uuid,p_expected_revision integer,
  p_patch jsonb,p_version integer,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_entry public.vault_entries%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 1 or p_patch is null
    or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_payload'; end if;
  if not exists(select 1 from public.users where id=p_actor_id and active) then raise exception 'role_insufficient'; end if;
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
  v_entry := jsonb_populate_record(v_entry,p_patch);
  update public.vault_entries set name=v_entry.name,entry_type=v_entry.entry_type,
    username=v_entry.username,url=v_entry.url,notes=v_entry.notes,location_id=v_entry.location_id,
    min_level=v_entry.min_level,revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()
    where id=p_entry_id returning * into v_entry;
  return to_jsonb(v_entry);
end $$;

-- One attempt in the caller's current hour-bucket; returns the count INCLUDING this attempt.
-- The app decides the verdict (cap, burst) from the count; the table never learns what was revealed.
create function public.vault_take_reveal_slot(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_bucket timestamptz:=date_trunc('hour',clock_timestamp()); v_attempts integer;
begin
  if p_user_id is null then raise exception 'invalid_payload'; end if;
  insert into public.vault_reveal_counters(user_id,bucket_start,attempts) values(p_user_id,v_bucket,1)
    on conflict (user_id,bucket_start) do update set attempts=public.vault_reveal_counters.attempts+1
    returning attempts into v_attempts;
  return jsonb_build_object('attempts',v_attempts,'bucket_start',v_bucket);
end $$;

-- The retention sweep for every entry (spec: the previous secret is kept 30 days). Rows stay; bytes go.
create function public.vault_scrub_expired_secrets()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_rows integer;
begin
  update public.vault_secrets set ciphertext=null,iv=null,tag=null,wrapped_key=null,key_iv=null,key_tag=null,scrubbed_at=clock_timestamp()
    where scrubbed_at is null and superseded_at < clock_timestamp() - interval '30 days';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Definer helpers are private even on Supabase's default ACLs.
do $$ declare f regprocedure; r text; tab text; begin
  foreach f in array array[
    'public.vault_write_secret(uuid,uuid,integer,text,text,text,text,text,text,text)'::regprocedure,
    'public.vault_update_entry(uuid,uuid,integer,jsonb,integer,jsonb)'::regprocedure,
    'public.vault_take_reveal_slot(uuid)'::regprocedure,
    'public.vault_scrub_expired_secrets()'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not has_function_privilege('service_role',f,'EXECUTE') then raise exception '0235: RPC grant escaped'; end if;
  end loop;
  foreach tab in array array['vault_entries','vault_secrets','vault_reveals','vault_reveal_counters'] loop
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r,'public.'||tab,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r,'public.'||tab,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception '0235: vault grant escaped';
      end if;
    end loop;
    if has_table_privilege('service_role','public.'||tab,'DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '0235: vault grant escaped';
    end if;
  end loop;
  if has_table_privilege('service_role','public.vault_secrets','INSERT,UPDATE')
    or has_table_privilege('service_role','public.vault_reveals','UPDATE')
    or has_table_privilege('service_role','public.vault_reveal_counters','INSERT,UPDATE') then
    raise exception '0235: vault grant escaped';
  end if;
end $$;
commit;
