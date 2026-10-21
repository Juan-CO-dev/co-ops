-- The production columns 0279's user-admin writers use that the scheduling PGlite stub does not model (users: 0001
-- lineage + 0198 / dormancy; user_locations.assigned_by). Applied by scripts/sql-harness-0279.mjs and the schema checks
-- BEFORE 0279 (its pre-flight refuses without them). SYNTHETIC: names and types only.
alter table public.users add column if not exists email text, add column if not exists phone text,
  add column if not exists pin_hash text, add column if not exists password_hash text,
  add column if not exists dormant_at timestamptz, add column if not exists dormant_by uuid;
alter table public.user_locations add column if not exists assigned_by uuid;
create table if not exists public.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), revoked_at timestamptz);
alter table public.users add column if not exists email_verified boolean not null default false,
  add column if not exists email_verified_at timestamptz, add column if not exists created_by uuid;
-- 0233's links (the rehire match reads employee_guid / user_id); the real table where a test applies 0233's own.
create table if not exists public.toast_employee_links (id uuid primary key default gen_random_uuid(), location_id uuid,
  employee_guid text not null, user_id uuid not null references public.users(id), active boolean not null default true);
