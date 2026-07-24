-- Migration 0149_ezcater_intake
-- STAGED in PR (EZCater live intake, spec #2c); prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-24-ezcater-live-intake-design.md
--
-- Webhook-only order feed (no list-orders query exists on ezCater's Public API
-- generation) -> an append-only raw event ledger is the forensic backbone.
-- Deny-all RLS; lib/catering/ezcater-intake.ts is the sole authority.

alter table public.locations add column ezcater_caterer_uuid text;
alter table public.catering_pipeline add column external_ref text;
create unique index catering_pipeline_external_ref_uq on public.catering_pipeline(external_ref)
  where external_ref is not null;

create table public.ezcater_events (
  id uuid primary key default gen_random_uuid(),
  notification_id text,
  parent_id text,
  entity_id text,
  event_key text,
  occurred_at timestamptz,
  raw jsonb not null,
  signature_valid boolean not null,
  processing_result text,
  lead_id uuid references public.catering_pipeline(id),
  received_at timestamptz not null default now()
);
alter table public.ezcater_events enable row level security;
create policy ezcater_events_no_user_insert on public.ezcater_events for insert with check (false);
create policy ezcater_events_no_user_update on public.ezcater_events for update using (false);
create policy ezcater_events_no_user_delete on public.ezcater_events for delete using (false);
create index ezcater_events_received_idx on public.ezcater_events(received_at desc);
