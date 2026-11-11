-- Migration 0301_sevenshifts_per_shop_links
-- AUTHORED 2026-11-11. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0269).
-- Provenance: Juan's ruling 2026-11-11 — each shop is its own LLC, so one employee can hold a SEPARATE
--   7shifts account per shop, while a few accounts (the owner, the catering manager, the ops director)
--   are ONE 7shifts account assigned to BOTH 7shifts locations. CO-OPS must therefore allow ONE CO-OPS
--   user ↔ MULTIPLE 7shifts accounts (one per shop) AND one 7shifts account ↔ the same user at two shops.
--
-- WHAT:
--   1. sevenshifts_user_links: uniqueness becomes PER SHOP ON BOTH SIDES.
--        drop   sevenshifts_user_links_one_live_user   (user_id) where active
--        drop   sevenshifts_user_links_one_live_remote (sevenshifts_user_id) where active
--        create sevenshifts_user_links_one_live_user_shop   (user_id, linked_at_location_id) where active
--        create sevenshifts_user_links_one_live_remote_shop (sevenshifts_user_id, linked_at_location_id) where active
--      A link COUNTS ONLY AT ITS linked_at_location_id: a person with one account per shop holds two links
--      (one remote each); a both-shops account linked to one person holds two links (the same remote at
--      each shop). The non-unique sevenshifts_user_links_shop index is kept.
--   2. link_sevenshifts_user is RE-EMITTED:
--        · the same (remote, user) at THIS shop → `changed: false` (idempotent, as before);
--        · a 7shifts account still belongs to ONE person: a live link of that remote to a DIFFERENT user,
--          at ANY shop, is `remote_already_linked`;
--        · `user_already_linked` is judged per (user, shop): a second account for the same person at the
--          SAME shop is refused; one at another shop is a new row.
--      Everything else in 0269 is identical: the one global link lock, the actor / subject levels through
--      the 0233 / 0217 helpers, ruling (a) `remote_not_at_shop` below level 8, ids only, never a name.
--      unlink_sevenshifts_user is untouched.
--   The tables stay APPEND-ONLY BY GRANT (service_role SELECT only; the RPCs are the only writers).
--
-- EXISTING ROWS: prod already holds single links made through the 0269 RPC. They are kept as they are
--   (each one is a per-shop link already); the pre-flight DATA CHECK proves no two live rows share a
--   (user, shop) or a (remote, shop), so both new unique indexes build on the live data.
--
-- CONSUMERS (same commit): every reader of sevenshifts_user_links picks the link for the shop in question,
--   never "any link of the user": wages by (user, shop) in lib/scheduling/inputs.ts, the reconciliation's
--   `here` link in lib/scheduling/reconcile*.ts, the link screen listing every link of a person with its shop.
--
-- DEPENDS ON: 0269 (both link tables, the four RPCs), and through it 0268 and the 0217 / 0228 / 0233 helpers.
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regclass('public.sevenshifts_user_links'), to_regprocedure('public.link_sevenshifts_user(uuid,uuid,bigint,uuid)'); -- both present
--   select indexname from pg_indexes where schemaname = 'public' and tablename = 'sevenshifts_user_links' order by 1;
--     -- EXACTLY: sevenshifts_user_links_one_live_remote, sevenshifts_user_links_one_live_user,
--     --          sevenshifts_user_links_pkey, sevenshifts_user_links_shop   (the preflight block refuses otherwise)
--   select user_id, linked_at_location_id, count(*) from public.sevenshifts_user_links where active group by 1, 2 having count(*) > 1;  -- none
--   select sevenshifts_user_id, linked_at_location_id, count(*) from public.sevenshifts_user_links where active group by 1, 2 having count(*) > 1;  -- none
--
-- VERIFY AFTER APPLY:
--   select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'sevenshifts_user_links' order by 1;
--     -- one_live_remote_shop (sevenshifts_user_id, linked_at_location_id) where active · one_live_user_shop (user_id, linked_at_location_id) where active · pkey · shop
--   select count(*) from public.sevenshifts_user_links where active;  -- unchanged from before the apply
--   select prosecdef, proconfig from pg_proc where oid = 'public.link_sevenshifts_user(uuid,uuid,bigint,uuid)'::regprocedure;  -- t, {search_path=pg_catalog, public}
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name = 'link_sevenshifts_user' order by 2;  -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT: 0269 applied, its live index set EXACTLY, and the live rows already per-shop-unique ──
do $$
declare
  v_idx text[];
  v_def text;
  v_dup integer;
begin
  if to_regclass('public.sevenshifts_user_links') is null or to_regclass('public.sevenshifts_location_links') is null
     or to_regprocedure('public.link_sevenshifts_user(uuid,uuid,bigint,uuid)') is null
     or to_regprocedure('public.unlink_sevenshifts_user(uuid,uuid,uuid)') is null then
    raise exception '0301: 0269 (the 7shifts links) must be applied first';
  end if;
  select array_agg(indexname order by indexname) into v_idx
    from pg_indexes where schemaname = 'public' and tablename = 'sevenshifts_user_links';
  if v_idx is distinct from array['sevenshifts_user_links_one_live_remote', 'sevenshifts_user_links_one_live_user',
                                   'sevenshifts_user_links_pkey', 'sevenshifts_user_links_shop']::text[] then
    raise exception '0301: the live index set on sevenshifts_user_links differs from 0269 (%): refusing', array_to_string(v_idx, ', ');
  end if;
  select indexdef into v_def from pg_indexes where schemaname = 'public' and indexname = 'sevenshifts_user_links_one_live_user';
  if v_def !~* 'unique index sevenshifts_user_links_one_live_user on public\.sevenshifts_user_links using btree \(user_id\) where active$' then
    raise exception '0301: sevenshifts_user_links_one_live_user is not the 0269 definition: refusing';
  end if;
  select indexdef into v_def from pg_indexes where schemaname = 'public' and indexname = 'sevenshifts_user_links_one_live_remote';
  if v_def !~* 'unique index sevenshifts_user_links_one_live_remote on public\.sevenshifts_user_links using btree \(sevenshifts_user_id\) where active$' then
    raise exception '0301: sevenshifts_user_links_one_live_remote is not the 0269 definition: refusing';
  end if;
  -- DATA CHECK: the existing single links are kept; none may collide under the per-shop indexes
  -- (impossible under 0269's one-per-side indexes, proven rather than assumed).
  select count(*) into v_dup from (
    select 1 from public.sevenshifts_user_links where active group by user_id, linked_at_location_id having count(*) > 1
    union all
    select 1 from public.sevenshifts_user_links where active group by sevenshifts_user_id, linked_at_location_id having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception '0301: % live (user, shop) / (remote, shop) collisions in sevenshifts_user_links: refusing', v_dup;
  end if;
end $$;

-- ── THE INDEXES: per shop on both sides ─────────────────────────────────────────────────────────
drop index public.sevenshifts_user_links_one_live_user;
drop index public.sevenshifts_user_links_one_live_remote;
create unique index sevenshifts_user_links_one_live_user_shop
  on public.sevenshifts_user_links (user_id, linked_at_location_id) where active;
create unique index sevenshifts_user_links_one_live_remote_shop
  on public.sevenshifts_user_links (sevenshifts_user_id, linked_at_location_id) where active;
comment on table public.sevenshifts_user_links is
  '0269 + 0301: 7shifts user <-> CO-OPS user, confirmed by a manager (GM own shop, MoO+ any). A link counts only at its linked_at_location_id: one live link per (CO-OPS user, shop) and one per (7shifts account, shop) — a person may hold one 7shifts account per shop, and a both-shops account is linked once at each shop, always to the same person (each shop is its own LLC, Juan 2026-11-11). NEVER matched by name; linked_by is NOT NULL, so no machine link exists. Append-only by grant (unlink = active false; a relink is a new row). Written only by link_sevenshifts_user / unlink_sevenshifts_user. Joined at read time, per shop. Deny-all RLS.';

-- ── THE WRITER, re-emitted ──────────────────────────────────────────────────────────────────────
-- Identical to 0269 but for the checks marked 0301. The actor through 0233's toast_link_actor_level
-- (GM own shop / 8+ any; active only); the subject through 0217's assignment_user_level (an active member of
-- that shop, or 9+); subject ≤ actor. Below level 8 the 7shifts person must hold a LIVE assignment at the
-- 7shifts location linked to that shop (ruling (a)). Identity is ids only.
create or replace function public.link_sevenshifts_user(p_actor uuid, p_location uuid, p_remote_user bigint, p_user uuid)
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
  -- 0301: the same account at THIS shop — the same person again is idempotent, another person is refused.
  select * into v_live from public.sevenshifts_user_links
   where sevenshifts_user_id = p_remote_user and linked_at_location_id = p_location and active;
  if found then
    if v_live.user_id = p_user then return jsonb_build_object('id', v_live.id, 'changed', false); end if;
    raise exception 'remote_already_linked';
  end if;
  -- 0301: a 7shifts account belongs to ONE person — a live link of it to another user at ANY shop refuses.
  if exists (select 1 from public.sevenshifts_user_links where sevenshifts_user_id = p_remote_user and user_id <> p_user and active) then
    raise exception 'remote_already_linked';
  end if;
  -- 0301: one live account per (CO-OPS user, shop) — a second account at the SAME shop is refused.
  if exists (select 1 from public.sevenshifts_user_links where user_id = p_user and linked_at_location_id = p_location and active) then
    raise exception 'user_already_linked';
  end if;
  insert into public.sevenshifts_user_links (sevenshifts_user_id, user_id, linked_at_location_id, linked_by)
    values (p_remote_user, p_user, p_location, p_actor) returning id into v_id;
  return jsonb_build_object('id', v_id, 'changed', true, 'sevenshifts_user_id', p_remote_user, 'user_id', p_user);
end $$;

-- ── GRANTS (re-emitted: create or replace keeps them, the guard proves it) ──────────────────────
revoke all on function public.link_sevenshifts_user(uuid, uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.link_sevenshifts_user(uuid, uuid, bigint, uuid) to service_role;

do $$
declare
  f regprocedure := 'public.link_sevenshifts_user(uuid, uuid, bigint, uuid)'::regprocedure;
  v_idx text[];
  v_src text;
  p text;
begin
  select array_agg(indexname order by indexname) into v_idx
    from pg_indexes where schemaname = 'public' and tablename = 'sevenshifts_user_links';
  if v_idx is distinct from array['sevenshifts_user_links_one_live_remote_shop', 'sevenshifts_user_links_one_live_user_shop',
                                   'sevenshifts_user_links_pkey', 'sevenshifts_user_links_shop']::text[] then
    raise exception '0301: the index set after apply is not the expected one (%)', array_to_string(v_idx, ', ');
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sevenshifts_user_links_one_live_user_shop'
                  and indexdef ~* 'unique index .* \(user_id, linked_at_location_id\) where active$') then
    raise exception '0301: one_live_user_shop is not UNIQUE (user_id, linked_at_location_id) WHERE active';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sevenshifts_user_links_one_live_remote_shop'
                  and indexdef ~* 'unique index .* \(sevenshifts_user_id, linked_at_location_id\) where active$') then
    raise exception '0301: one_live_remote_shop is not UNIQUE (sevenshifts_user_id, linked_at_location_id) WHERE active';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
     or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0301: RPC grant escaped on %', f;
  end if;
  if not (select prosecdef from pg_proc where oid = f)
     or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0301: % must be SECURITY DEFINER with a pinned search_path', f;
  end if;
  select prosrc into v_src from pg_proc where oid = f;
  if v_src !~ 'user_id = p_user and linked_at_location_id = p_location and active'
     or v_src !~ 'sevenshifts_user_id = p_remote_user and user_id <> p_user and active' then
    raise exception '0301: link_sevenshifts_user does not judge the links per shop';
  end if;
  if v_src ~* 'name' then
    raise exception '0301: link_sevenshifts_user must never mention a name';
  end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', 'public.sevenshifts_user_links', p) <> (p = 'SELECT') then
      raise exception '0301: service_role % on sevenshifts_user_links is not at its ceiling (SELECT)', p;
    end if;
  end loop;
end $$;

commit;
