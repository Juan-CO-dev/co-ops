-- Migration 0224_toast_time_entries
-- APPLIED TO PROD 2026-10-08 (schema_migrations version 20261008133144, name '0224_toast_time_entries'; sim first, version 20261008133105). Authoring-gate notes kept as history.
-- AUTHORED 2026-10-08 (digest v2 labor, CO Claude builder). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod.
-- Number per CC's note GO-coops-digest-v2-migration-note.md (0223 = the ezCater enrichment build).
--
-- Toast time entries for the nightly digest's LABOR section (Juan 2026-10-08): who worked, hours by
-- job, sales per labor hour, overtime flags. MINIMAL FIELDS ONLY: employee guid (+ our user when a
-- mapping exists; none is populated by this build), the employee's FIRST name, job guid + title,
-- in / out, hours. NO wages, tips, cash / non-cash sales, last names or contact fields — the
-- normalizer (lib/toast/labor-shared.ts) drops them before the write.
--
-- A provider MIRROR (Toast edits time entries after the fact): one row per (location, time entry
-- guid), upserted by the service-role pull (lib/toast/labor.ts). Toast's own `deleted` flag is kept
-- as a column; nothing is ever deleted here.
--
-- Binding rule 10-08 (no digest emails before launch): this migration touches NO report_settings and
-- NO report_recipients row; it only adds a data table.
begin;
create table public.toast_time_entries (
 location_id uuid not null references public.locations(id),
 time_entry_guid text not null,
 business_date date not null,
 employee_guid text not null,
 employee_first_name text check (employee_first_name is null or char_length(employee_first_name) <= 60),
 user_id uuid null references public.users(id),
 job_guid text,
 job_name text check (job_name is null or char_length(job_name) <= 120),
 in_at timestamptz not null,
 out_at timestamptz,
 hours numeric check (hours is null or (hours >= 0 and hours <= 48)),
 overtime_hours numeric check (overtime_hours is null or overtime_hours >= 0),
 auto_clocked_out boolean not null default false,
 deleted boolean not null default false,
 source_modified_at timestamptz,
 pulled_at timestamptz not null default now(),
 primary key (location_id, time_entry_guid),
 check (out_at is null or out_at >= in_at)
);
create index toast_time_entries_location_date on public.toast_time_entries (location_id, business_date);

comment on table public.toast_time_entries is
 '0224: Toast labor time entries (minimal: no wages/tips/sales). Service-role mirror written by lib/toast/labor.ts (TOAST_LABOR_PULL=1); read by the nightly digest LABOR section. Deny-all RLS.';

-- Deny-all RLS: no allow policies, explicit DELETE denial; the service role reads and upserts only.
alter table public.toast_time_entries enable row level security;
create policy toast_time_entries_no_user_select on public.toast_time_entries for select using (false);
create policy toast_time_entries_no_user_insert on public.toast_time_entries for insert with check (false);
create policy toast_time_entries_no_user_update on public.toast_time_entries for update using (false);
create policy toast_time_entries_no_user_delete on public.toast_time_entries for delete using (false);
revoke all on public.toast_time_entries from public, anon, authenticated, service_role;
grant select, insert, update on public.toast_time_entries to service_role;

do $$ begin
 if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'toast_time_entries'
   and (grantee in ('PUBLIC', 'anon', 'authenticated') or (grantee = 'service_role' and privilege_type in ('DELETE', 'TRUNCATE'))))
 then raise exception '0224 unexpected toast_time_entries grant'; end if;
end $$;
commit;
