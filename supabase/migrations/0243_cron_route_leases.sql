-- Migration 0243_cron_route_leases
-- Authored 2026-10-10; APPLIED TO PROD 2026-10-10 (sim 20261010210622 + prod, dry run pass) BEFORE the cron cutover app.
-- Scheduler coordination only, not operational history. At most two bounded rows.
begin;

create table public.cron_route_leases (
  job text primary key check (job in ('toast-sales-today', 'toast-catering-scan')),
  lease_until timestamptz not null
);
alter table public.cron_route_leases enable row level security;
create policy cron_route_leases_no_user_delete on public.cron_route_leases for delete using (false);
revoke all on public.cron_route_leases from public, anon, authenticated, service_role;

create function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today', 'toast-catering-scan') then
    raise exception 'invalid_cron_route';
  end if;
  -- ON CONFLICT locks the single route row and rechecks the expiry under that lock.
  -- Use the database clock, never caller timestamps or a ten-minute fixed bucket.
  insert into public.cron_route_leases (job, lease_until)
    values (p_job, clock_timestamp() + interval '330 seconds')
  on conflict (job) do update
    set lease_until = clock_timestamp() + interval '330 seconds'
    where cron_route_leases.lease_until <= clock_timestamp()
  returning job into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_cron_route(text) from public, anon, authenticated;
grant execute on function public.claim_cron_route(text) to service_role;

commit;
