-- Migration 0269_sevenshifts_links
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0268 and BEFORE SEVENSHIFTS_SYNC=1).
-- APPLIED TO SIM 2026-10-16 (schema_migrations version 20261016082525, name 'sevenshifts_links')
-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016084018, name 'sevenshifts_links')
-- Provenance: Smart Scheduling Phase 1, Task 9 (docs/superpowers/plans/2026-10-15-scheduling-phase1-BUILD.md),
--   R4 (the link screen shows the 7shifts employee id + name + roles; NO auto-match by name; a manager
--   confirms every link), the GO law "a person is matched across systems ONLY through a link a manager
--   confirms".
--
-- WHAT:
--   1. sevenshifts_location_links: a CO-OPS shop ↔ a 7shifts location. One LIVE link per shop and one per
--      7shifts location. MoO (8)+ only — company-level config.
--   2. sevenshifts_user_links: a 7shifts user ↔ a CO-OPS user. One LIVE link per 7shifts user and one per
--      CO-OPS user (7shifts user ids are company-wide). `linked_at_location_id` = the shop the linking
--      manager acted for. GM (7) at their own shop, MoO (8)+ at any shop; the actor's level ≥ the subject's.
--   Both are APPEND-ONLY BY GRANT: service_role holds SELECT only; the four SECURITY DEFINER RPCs below
--   are the only writers. Unlink = active false + unlinked_by/unlinked_at; a relink is a NEW row
--   (history kept). There is NO `source` column: every link is manual, and `linked_by` is NOT NULL, so
--   the database itself refuses a machine link. No function here compares names (pinned by the harness).
--   The link is joined at READ time (Phase 1: punches as presence evidence only), so an unlink takes the
--   attribution away at once with nothing to backfill.
--
-- REFUSALS (raise exception '<code>', P0001; mapped by lib/sevenshifts/links.ts):
--   invalid_payload · role_insufficient · location_access_denied · assignee_unavailable (subject inactive)
--   remote_unknown (not in the 0268 mirror) · remote_not_at_shop (below level 8, the 7shifts person must
--   hold a LIVE assignment at the 7shifts location LIVE-linked to that shop; CC ruling (a) 2026-10-15,
--   enforced here AND in the lib) · shop_already_linked · remote_already_linked ·
--   user_already_linked · link_not_found.
--
-- WHO READS / WRITES (service role only, through the lib; no PostgREST role holds anything):
--     lib/sevenshifts/links.ts  → link_sevenshifts_location / unlink_sevenshifts_location /
--                                 link_sevenshifts_user / unlink_sevenshifts_user; reads both tables for
--                                 /admin/sevenshifts.
--   Both tables: RLS on with NO policy (the 0203/0257 posture), the service_role CEILING = SELECT.
--
-- DEPENDS ON: 0268 (sevenshifts_locations, sevenshifts_users, sevenshifts_user_assignments),
--   0217 assignment_user_level, 0228 assignment_author_level, 0233 toast_link_actor_level (reused, not copied).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regclass('public.sevenshifts_users'), to_regclass('public.sevenshifts_user_assignments');   -- both present (0268)
--   select to_regprocedure('public.toast_link_actor_level(uuid,uuid)'), to_regprocedure('public.assignment_user_level(uuid,uuid)'),
--          to_regprocedure('public.assignment_author_level(uuid)');                                       -- all present
--   select to_regclass('public.sevenshifts_location_links'), to_regclass('public.sevenshifts_user_links'); -- both NULL
--   (the preflight block below asserts all of it and refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class where relname in ('sevenshifts_location_links', 'sevenshifts_user_links');  -- t, t
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'sevenshifts\_%links' order by 1, 2;   -- service_role SELECT only
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name like '%sevenshifts_%link%' order by 1, 2;  -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.sevenshifts_locations') is null or to_regclass('public.sevenshifts_users') is null
     or to_regclass('public.sevenshifts_user_assignments') is null then
    raise exception '0269: 0268 (the 7shifts mirrors) must be applied first';
  end if;
  if to_regprocedure('public.toast_link_actor_level(uuid,uuid)') is null
     or to_regprocedure('public.assignment_user_level(uuid,uuid)') is null
     or to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0269: the 0217 / 0228 / 0233 level helpers must exist';
  end if;
  if to_regclass('public.sevenshifts_location_links') is not null or to_regclass('public.sevenshifts_user_links') is not null then
    raise exception '0269: already applied';
  end if;
end $$;

-- ── THE LINK TABLES ─────────────────────────────────────────────────────────────────────────────
create table public.sevenshifts_location_links (
  id                      uuid        primary key default gen_random_uuid(),
  location_id             uuid        not null references public.locations(id),
  sevenshifts_location_id bigint      not null check (sevenshifts_location_id > 0),
  active                  boolean     not null default true,
  linked_by               uuid        not null references public.users(id),
  linked_at               timestamptz not null default clock_timestamp(),
  unlinked_by             uuid        references public.users(id),
  unlinked_at             timestamptz,
  constraint sevenshifts_location_links_live check (active = (unlinked_at is null)),
  constraint sevenshifts_location_links_unlink_pair check ((unlinked_at is null) = (unlinked_by is null))
);
create unique index sevenshifts_location_links_one_live_shop on public.sevenshifts_location_links (location_id) where active;
create unique index sevenshifts_location_links_one_live_remote on public.sevenshifts_location_links (sevenshifts_location_id) where active;
comment on table public.sevenshifts_location_links is
  '0269: CO-OPS shop <-> 7shifts location, set by a manager (MoO+). Append-only by grant (unlink = active false; a relink is a new row). Written only by link_sevenshifts_location / unlink_sevenshifts_location. Deny-all RLS.';

create table public.sevenshifts_user_links (
  id                    uuid        primary key default gen_random_uuid(),
  sevenshifts_user_id   bigint      not null check (sevenshifts_user_id > 0),
  user_id               uuid        not null references public.users(id),
  linked_at_location_id uuid        not null references public.locations(id),
  active                boolean     not null default true,
  linked_by             uuid        not null references public.users(id),
  linked_at             timestamptz not null default clock_timestamp(),
  unlinked_by           uuid        references public.users(id),
  unlinked_at           timestamptz,
  constraint sevenshifts_user_links_live check (active = (unlinked_at is null)),
  constraint sevenshifts_user_links_unlink_pair check ((unlinked_at is null) = (unlinked_by is null))
);
create unique index sevenshifts_user_links_one_live_remote on public.sevenshifts_user_links (sevenshifts_user_id) where active;
create unique index sevenshifts_user_links_one_live_user on public.sevenshifts_user_links (user_id) where active;
create index sevenshifts_user_links_shop on public.sevenshifts_user_links (linked_at_location_id, active);
comment on table public.sevenshifts_user_links is
  '0269: 7shifts user <-> CO-OPS user, confirmed by a manager (GM own shop, MoO+ any). NEVER matched by name; linked_by is NOT NULL, so no machine link exists. Append-only by grant (unlink = active false; a relink is a new row). Written only by link_sevenshifts_user / unlink_sevenshifts_user. Joined at read time. Deny-all RLS.';

alter table public.sevenshifts_location_links enable row level security;
alter table public.sevenshifts_user_links enable row level security;
revoke all on public.sevenshifts_location_links, public.sevenshifts_user_links from public, anon, authenticated, service_role;
grant select on public.sevenshifts_location_links, public.sevenshifts_user_links to service_role;

-- ── THE WRITERS ─────────────────────────────────────────────────────────────────────────────────
-- One global link lock serialises every link writer, so the one-live-link indexes never race.

-- Shop links: company-level config, MoO (8)+. An active account only; an active shop only.
create function public.link_sevenshifts_location(p_actor uuid, p_location uuid, p_remote bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer; v_live public.sevenshifts_location_links%rowtype; v_id uuid;
begin
  if p_actor is null or p_location is null or p_remote is null or p_remote <= 0 then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0));
  if not exists (select 1 from public.users where id = p_actor and active) then raise exception 'role_insufficient'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null or v_level < 8 then raise exception 'role_insufficient'; end if;
  if not exists (select 1 from public.locations where id = p_location and active) then raise exception 'location_access_denied'; end if;
  if not exists (select 1 from public.sevenshifts_locations where id = p_remote) then raise exception 'remote_unknown'; end if;
  select * into v_live from public.sevenshifts_location_links where location_id = p_location and active;
  if found then
    if v_live.sevenshifts_location_id = p_remote then
      return jsonb_build_object('id', v_live.id, 'changed', false);
    end if;
    raise exception 'shop_already_linked';
  end if;
  if exists (select 1 from public.sevenshifts_location_links where sevenshifts_location_id = p_remote and active) then
    raise exception 'remote_already_linked';
  end if;
  insert into public.sevenshifts_location_links (location_id, sevenshifts_location_id, linked_by)
    values (p_location, p_remote, p_actor) returning id into v_id;
  return jsonb_build_object('id', v_id, 'changed', true, 'location_id', p_location, 'sevenshifts_location_id', p_remote);
end $$;

create function public.unlink_sevenshifts_location(p_actor uuid, p_link uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer; v_link public.sevenshifts_location_links%rowtype;
begin
  if p_actor is null or p_link is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0));
  if not exists (select 1 from public.users where id = p_actor and active) then raise exception 'role_insufficient'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null or v_level < 8 then raise exception 'role_insufficient'; end if;
  select * into v_link from public.sevenshifts_location_links where id = p_link for update;
  if not found then raise exception 'link_not_found'; end if;
  if not v_link.active then return jsonb_build_object('id', v_link.id, 'changed', false); end if;
  update public.sevenshifts_location_links set active = false, unlinked_by = p_actor, unlinked_at = clock_timestamp()
   where id = v_link.id;
  return jsonb_build_object('id', v_link.id, 'changed', true, 'location_id', v_link.location_id,
    'sevenshifts_location_id', v_link.sevenshifts_location_id);
end $$;

-- Person links. The actor through 0233's toast_link_actor_level (GM own shop / 8+ any; active only);
-- the subject through 0217's assignment_user_level (an active member of that shop, or 9+); subject ≤ actor.
-- Below level 8 the 7shifts person must hold a LIVE assignment at the 7shifts location linked to that
-- shop, so a GM cannot claim another shop's 7shifts person. Identity is ids only.
create function public.link_sevenshifts_user(p_actor uuid, p_location uuid, p_remote_user bigint, p_user uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor integer; v_subject integer; v_live public.sevenshifts_user_links%rowtype; v_id uuid;
begin
  if p_actor is null or p_location is null or p_remote_user is null or p_remote_user <= 0 or p_user is null then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0));
  v_actor := public.toast_link_actor_level(p_actor, p_location);
  v_subject := public.assignment_user_level(p_user, p_location);
  if v_subject > v_actor then raise exception 'role_insufficient'; end if;
  if not exists (select 1 from public.sevenshifts_users where id = p_remote_user) then raise exception 'remote_unknown'; end if;
  if v_actor < 8 and not exists (
      select 1 from public.sevenshifts_location_links l
        join public.sevenshifts_user_assignments a on a.location_id = l.sevenshifts_location_id
       where l.location_id = p_location and l.active and a.user_id = p_remote_user and a.active) then
    raise exception 'remote_not_at_shop';
  end if;
  select * into v_live from public.sevenshifts_user_links where sevenshifts_user_id = p_remote_user and active;
  if found then
    if v_live.user_id = p_user then return jsonb_build_object('id', v_live.id, 'changed', false); end if;
    raise exception 'remote_already_linked';
  end if;
  if exists (select 1 from public.sevenshifts_user_links where user_id = p_user and active) then
    raise exception 'user_already_linked';
  end if;
  insert into public.sevenshifts_user_links (sevenshifts_user_id, user_id, linked_at_location_id, linked_by)
    values (p_remote_user, p_user, p_location, p_actor) returning id into v_id;
  return jsonb_build_object('id', v_id, 'changed', true, 'sevenshifts_user_id', p_remote_user, 'user_id', p_user);
end $$;

-- Unlinking is not acting up (0233's precedent): actor authority and the link's shop decide. Below
-- level 8 only a link made for the actor's shop is reachable (anything else reads as not found).
create function public.unlink_sevenshifts_user(p_actor uuid, p_location uuid, p_link uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor integer; v_link public.sevenshifts_user_links%rowtype;
begin
  if p_actor is null or p_location is null or p_link is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0));
  v_actor := public.toast_link_actor_level(p_actor, p_location);
  select * into v_link from public.sevenshifts_user_links where id = p_link for update;
  if not found or (v_actor < 8 and v_link.linked_at_location_id <> p_location) then raise exception 'link_not_found'; end if;
  if not v_link.active then return jsonb_build_object('id', v_link.id, 'changed', false); end if;
  update public.sevenshifts_user_links set active = false, unlinked_by = p_actor, unlinked_at = clock_timestamp()
   where id = v_link.id;
  return jsonb_build_object('id', v_link.id, 'changed', true, 'sevenshifts_user_id', v_link.sevenshifts_user_id,
    'user_id', v_link.user_id, 'linked_at_location_id', v_link.linked_at_location_id);
end $$;

-- ── GRANTS: the definer RPCs are service_role only; the tables sit at the SELECT ceiling ─────────
revoke all on function public.link_sevenshifts_location(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.unlink_sevenshifts_location(uuid, uuid) from public, anon, authenticated;
revoke all on function public.link_sevenshifts_user(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.unlink_sevenshifts_user(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_sevenshifts_location(uuid, uuid, bigint) to service_role;
grant execute on function public.unlink_sevenshifts_location(uuid, uuid) to service_role;
grant execute on function public.link_sevenshifts_user(uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.unlink_sevenshifts_user(uuid, uuid, uuid) to service_role;

do $$
declare
  t text;
  p text;
  f regprocedure;
begin
  foreach t in array array['sevenshifts_location_links', 'sevenshifts_user_links'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0269: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0269: % must have no policy', t;
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0269: a PostgREST role holds a grant on %', t;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) <> (p = 'SELECT') then
        raise exception '0269: service_role % on % is not at its ceiling (SELECT)', p, t;
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.link_sevenshifts_location(uuid, uuid, bigint)'::regprocedure,
    'public.unlink_sevenshifts_location(uuid, uuid)'::regprocedure,
    'public.link_sevenshifts_user(uuid, uuid, bigint, uuid)'::regprocedure,
    'public.unlink_sevenshifts_user(uuid, uuid, uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0269: RPC grant escaped on %', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f)
       or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0269: % must be SECURITY DEFINER with a pinned search_path', f;
    end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
              and routine_name in ('link_sevenshifts_location', 'unlink_sevenshifts_location', 'link_sevenshifts_user', 'unlink_sevenshifts_user')
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0269: a PostgREST role can execute a 0269 function';
  end if;
end $$;

commit;
