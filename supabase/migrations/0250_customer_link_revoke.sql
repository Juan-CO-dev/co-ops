-- Migration 0250_customer_link_revoke
-- AUTHORED 2026-10-12, NOT YET APPLIED -- GATE CC: sim first, then prod.
-- APPLIED TO PROD 2026-10-12 (schema_migrations version 20261012142701, name '0250_customer_link_revoke'); sim applied first (20261012141853 + the revoked-pair trigger); prod dry run first.
begin;

create function public.customer_probable_link_revoke(p_link_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_link public.customer_probable_links%rowtype;
begin
  perform public.customer_identity_lock();
  select * into v_link from public.customer_probable_links where id = p_link_id for update;
  if not found then raise exception 'customer_probable_link_not_found'; end if;
  if v_link.revoked_at is not null then return jsonb_build_object('revoked', false); end if;
  update public.customer_probable_links set revoked_at = now(), revoked_by = p_actor_id where id = p_link_id;
  return jsonb_build_object('revoked', true, 'guest_id', v_link.guest_id, 'customer_id', v_link.customer_id);
end $$;

-- A revoked pair stays revoked: a later linking run can never re-create a link a person rejected.
create function public.customer_probable_link_not_revoked() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists(select 1 from public.customer_probable_links where guest_id = new.guest_id and customer_id = new.customer_id
    and revoked_at is not null) then
    raise exception 'customer_probable_link_revoked';
  end if;
  return new;
end $$;
create trigger customer_probable_links_not_revoked before insert on public.customer_probable_links
  for each row execute function public.customer_probable_link_not_revoked();

revoke all on function public.customer_probable_link_not_revoked() from public, anon, authenticated, service_role;
revoke all on function public.customer_probable_link_revoke(uuid,uuid) from public, anon, authenticated;
grant execute on function public.customer_probable_link_revoke(uuid,uuid) to service_role;

do $$ begin
  if exists(select 1 from information_schema.routine_privileges where routine_schema = 'public'
    and ((routine_name = 'customer_probable_link_revoke' and grantee in ('PUBLIC','anon','authenticated'))
      or (routine_name = 'customer_probable_link_not_revoked' and grantee in ('PUBLIC','anon','authenticated','service_role')))) then
    raise exception '0250: RPC grant escaped';
  end if;
end $$;
commit;
