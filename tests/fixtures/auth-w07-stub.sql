-- The production columns and tables migration 0307 (audit wave W07) reads and writes that the scheduling PGlite stub
-- and tests/fixtures/user-admin-columns-stub.sql do not model. Applied by scripts/sql-harness-0307.mjs AFTER those two
-- and BEFORE the real 0076 / 0279 / 0307. SYNTHETIC: names, types and the constraints 0307 leans on, nothing else.
-- Shapes follow docs/CO-OPS_Foundation_Spec_v1.3.md §4.1 (users, sessions, email_verifications, password_resets).
alter table public.users
  add column if not exists failed_login_count integer default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists last_login_at timestamptz;
alter table public.sessions
  add column if not exists token_hash text not null default gen_random_uuid()::text,
  add column if not exists auth_method text not null default 'pin' check (auth_method in ('pin', 'password')),
  add column if not exists step_up_unlocked boolean default false,
  add column if not exists step_up_unlocked_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists last_activity_at timestamptz default now(),
  add column if not exists expires_at timestamptz not null default (now() + interval '12 hours'),
  add column if not exists ip_address inet,
  add column if not exists user_agent text;
create unique index if not exists sessions_token_hash_key on public.sessions (token_hash);
create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
