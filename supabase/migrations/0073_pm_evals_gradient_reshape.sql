-- Migration 0073_pm_evals_gradient_reshape
-- Applied via Supabase MCP apply_migration on 2026-06-17.
-- Canonical reference: lib/pm-report.ts (pm_employee_evals gradient dimensions).

-- Reshape pm_employee_evals from binary on_time+attitude to four gradient dimensions.
-- pm_employee_evals was empty (count=0 confirmed before apply) so column changes are safe.
-- Drop the binary on_time boolean; add three new gradient text columns with check constraints.
-- attitude (text not null, from 0072) is retained as-is — it's the fourth gradient dimension.
-- Final four gradient dimensions: arrived_ready, attitude, production, team_player.
-- Each allows 'great' | 'good' | 'needs_work'; defaults to 'good'.

alter table public.pm_employee_evals drop column on_time;
alter table public.pm_employee_evals add column arrived_ready text not null default 'good' check (arrived_ready in ('great','good','needs_work'));
alter table public.pm_employee_evals add column production text not null default 'good' check (production in ('great','good','needs_work'));
alter table public.pm_employee_evals add column team_player text not null default 'good' check (team_player in ('great','good','needs_work'));
