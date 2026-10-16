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
-- public.user_locations (0001 lineage; 0269's helpers read the membership): the columns they use.
create table public.user_locations (
  user_id     uuid not null references public.users(id),
  location_id uuid not null references public.locations(id),
  active      boolean not null default true,
  primary key (user_id, location_id)
);
-- public.stations (0217) and public.station_positions (0219): the columns 0270's composite FKs and
-- writers use, with 0219's deny-all posture (service_role SELECT / INSERT / UPDATE, no DELETE).
create table public.stations (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  name        text not null default 'Station',
  name_es     text not null default 'Estación',
  sort        integer not null default 0,
  active      boolean not null default true,
  unique (id, location_id)
);
create table public.station_positions (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid not null,
  location_id uuid not null,
  name        text not null default 'Position',
  name_es     text,
  sort        smallint not null default 1,
  active      boolean not null default true,
  foreign key (station_id, location_id) references public.stations(id, location_id),
  unique (station_id, name), unique (id, station_id, location_id)
);
alter table public.stations enable row level security;
alter table public.station_positions enable row level security;
revoke all on public.stations, public.station_positions from public, anon, authenticated;
revoke delete, truncate on public.stations, public.station_positions from service_role;
-- public.station_events (0217 + 0219 position_id + 0228/0230/0233 reason_code, effective_at, prior_position_id):
-- the columns 0271's `pm_subject_worked_position` and the people loaders read. Service role SELECT + INSERT (0217).
create table public.station_events (
  id                uuid primary key default gen_random_uuid(),
  sequence          bigint generated always as identity unique,
  location_id       uuid not null references public.locations(id),
  business_date     date not null,
  user_id           uuid not null references public.users(id),
  station_id        uuid,
  position_id       uuid references public.station_positions(id),
  kind              text not null check (kind in ('assign','claim','move','release')),
  actor_id          uuid references public.users(id),
  at                timestamptz not null default clock_timestamp(),
  source            text check (source in ('assigned','claimed')),
  reason_code       text,
  effective_at      timestamptz,
  prior_position_id uuid references public.station_positions(id),
  foreign key (station_id, location_id) references public.stations(id, location_id)
);
alter table public.station_events enable row level security;
revoke all on public.station_events from public, anon, authenticated;
revoke update, delete, truncate on public.station_events from service_role;
