-- Scheduling Phase 1 — the PGlite stub the 0268–0271 harnesses apply BEFORE the real migrations.
-- SYNTHETIC: the Supabase roles, Supabase's default privileges (a new table or function is granted to
-- anon / authenticated / service_role unless a migration revokes it — which is exactly what the
-- ceilings must undo), and the base tables the migrations reference, with the columns they use.
-- Later chunks add the tables 0269–0271 reference (station_positions, pm_reports, …) here.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- public.users (0001 lineage): only the key the migrations reference.
create table public.users (
  id     uuid primary key default gen_random_uuid(),
  name   text not null default 'stub',
  role   text not null default 'employee',
  active boolean not null default true
);
create table public.locations (
  id     uuid primary key default gen_random_uuid(),
  name   text not null default 'stub',
  active boolean not null default true
);
