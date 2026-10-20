-- The production columns 0279's user-admin writers use that the scheduling PGlite stub does not model (users: 0001
-- lineage + 0198 / dormancy; user_locations.assigned_by). Applied by scripts/sql-harness-0279.mjs and the schema checks
-- BEFORE 0279 (its pre-flight refuses without them). SYNTHETIC: names and types only.
alter table public.users add column if not exists email text, add column if not exists phone text,
  add column if not exists pin_hash text, add column if not exists password_hash text,
  add column if not exists dormant_at timestamptz, add column if not exists dormant_by uuid;
alter table public.user_locations add column if not exists assigned_by uuid;
create table if not exists public.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), revoked_at timestamptz);
