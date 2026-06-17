-- Migration 0072_pm_report_tables
-- Applied via Supabase MCP apply_migration on 2026-06-17.
-- PM Report (Wave 2): pm_reports + pm_employee_evals (append-only, split RLS).
-- Canonical reference: lib/pm-report.ts. Employee note-hiding is app-layer
-- (loaders never select pm_employee_evals.note for the employee surface).

create table public.pm_reports (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  report_date date not null,
  status text not null default 'open'
    check (status in ('open','submitted','incomplete_confirmed','auto_finalized')),
  mvp_user_id uuid references public.users(id),
  mvp_note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by uuid references public.users(id),
  superseded_at timestamptz
);
create unique index pm_reports_one_live
  on public.pm_reports(location_id, report_date) where superseded_at is null;
alter table public.pm_reports enable row level security;
create policy pm_reports_read on public.pm_reports for select
  using (current_user_role_level() >= 4 and location_id = any(current_user_locations()));
create policy pm_reports_insert on public.pm_reports for insert
  with check (current_user_role_level() >= 4 and location_id = any(current_user_locations()));
create policy pm_reports_update on public.pm_reports for update
  using (current_user_role_level() >= 4 and location_id = any(current_user_locations()))
  with check (current_user_role_level() >= 4 and location_id = any(current_user_locations()));
create policy pm_reports_no_user_delete on public.pm_reports for delete using (false);

create table public.pm_employee_evals (
  id uuid primary key default gen_random_uuid(),
  pm_report_id uuid not null references public.pm_reports(id),
  location_id uuid not null references public.locations(id),
  employee_id uuid not null references public.users(id),
  on_time boolean not null,
  attitude text not null check (attitude in ('great','good','needs_work')),
  area_to_improve text,
  note text,
  author_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create index pm_evals_by_report on public.pm_employee_evals(pm_report_id) where superseded_at is null;
create index pm_evals_by_employee on public.pm_employee_evals(employee_id) where superseded_at is null;
alter table public.pm_employee_evals enable row level security;
-- KH+ at location read all; employee reads OWN rows (note column-hiding is app-layer in the loader)
create policy pm_evals_read_mgr on public.pm_employee_evals for select
  using (current_user_role_level() >= 4 and location_id = any(current_user_locations()));
create policy pm_evals_read_self on public.pm_employee_evals for select
  using (employee_id = current_user_id());
create policy pm_evals_insert on public.pm_employee_evals for insert
  with check (current_user_role_level() >= 4 and location_id = any(current_user_locations()));
create policy pm_evals_no_user_update on public.pm_employee_evals for update using (false);
create policy pm_evals_no_user_delete on public.pm_employee_evals for delete using (false);
