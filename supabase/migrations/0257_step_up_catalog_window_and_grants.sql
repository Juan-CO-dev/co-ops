-- Migration 0257_step_up_catalog_window_and_grants
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE the code merges).
-- Provenance: catalog redesign Phase 1 (docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md),
--   Astra r1 P1-1 (an edit unlock must never satisfy an always-prompt act) and P2-3 (the edit
--   window needs its own clock, independent of the shared step-up flag); Astra r2 #3 (explicit
--   service_role privilege ceiling on the new table).
--
-- WHAT:
--   1. sessions.catalog_edit_unlocked_at — the 15-minute catalog/recipe EDIT WINDOW's own clock.
--      Stamped ONLY by a password typed on the admin surface (POST /api/auth/step-up with
--      catalogWindow=true → lib/session.ts unlockStepUp). A FIXED window: never extended, never
--      cleared by navigation; it ends 15 minutes after that password, or with the session
--      (logout / revoke / expiry). Read by assertStepUp(ctx, "E") only.
--   2. public.step_up_grants — ONE-SHOT, action-bound authorizations for the always-prompt
--      catalog acts (product.retire, recipe.delete, sku.deactivate). Minted by the step-up POST
--      when it carries a purpose (lib/admin/step-up-grants.ts mintStepUpGrant); consumed by the
--      destructive route with ONE conditional UPDATE (same session + user + action + target,
--      consumed_at IS NULL, expires_at > now → consumed_at = now; a row lock re-checks the
--      predicate, so a concurrent second consume matches 0 rows). 120 s TTL. A consumed or
--      expired row is history: no DELETE grant, no cascade.
--
-- WHO READS / WRITES (service role only, through the lib):
--     lib/session.ts             unlockStepUp / requireSessionCore   ← sessions.catalog_edit_unlocked_at
--     lib/admin/step-up-grants.ts mintStepUpGrant / consumeStepUpGrant ← step_up_grants
--
-- The staff JWT is a valid PostgREST bearer (AGENTS.md), so no PostgREST role gets any grant on
-- step_up_grants; RLS is enabled with no policies (no grant → no policy; the 0203/0214 precedent).
-- service_role gets an explicit CEILING (the 0218 pattern): everything is revoked first —
-- Supabase's default privileges hand it ALL on a new table — then exactly SELECT, INSERT, UPDATE
-- are granted, and the guard proves it holds no DELETE / TRUNCATE / REFERENCES / TRIGGER.
-- sessions: NO grant change. The new column inherits the table's existing grants and RLS; the
-- guard refuses to commit unless RLS is on for sessions (the 0200 posture).
--
-- PRE-FLIGHT (MCP, before apply — AGENTS.md "pre-flight every SQL emission"):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'sessions';            -- no catalog_edit_unlocked_at yet
--   select to_regclass('public.step_up_grants');                             -- NULL
--
-- VERIFY AFTER APPLY:
--   select data_type from information_schema.columns
--    where table_name = 'sessions' and column_name = 'catalog_edit_unlocked_at';  -- timestamp with time zone
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'step_up_grants' order by 1, 2;
--     -- service_role INSERT / SELECT / UPDATE only (plus the owner)
--   select has_table_privilege('service_role', 'public.step_up_grants', 'DELETE'),
--          has_table_privilege('service_role', 'public.step_up_grants', 'TRUNCATE');   -- f, f
--   select relrowsecurity from pg_class where oid = 'public.step_up_grants'::regclass;  -- t

begin;

alter table public.sessions
  add column if not exists catalog_edit_unlocked_at timestamptz;
comment on column public.sessions.catalog_edit_unlocked_at is
  'Catalog/recipe edit window (Tier E): a fixed 15 minutes from a password typed on the admin surface; never extended, never cleared by navigation; ends with the session. 0257.';

create table public.step_up_grants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  user_id uuid not null references public.users(id),
  action text not null check (action in ('product.retire', 'recipe.delete', 'sku.deactivate')),
  target_id uuid not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint step_up_grants_expiry_after_create check (expires_at > created_at)
);
comment on table public.step_up_grants is
  'One-shot, action-bound step-up grants for always-prompt catalog acts (0257). Service role only; consumed by a conditional UPDATE; never deleted.';

create index step_up_grants_open_idx
  on public.step_up_grants (session_id, action, target_id)
  where consumed_at is null;

alter table public.step_up_grants enable row level security;
revoke all on public.step_up_grants from public, anon, authenticated, service_role;
grant select, insert, update on public.step_up_grants to service_role;

do $$ begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'step_up_grants'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0257: unexpected step_up_grants table grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'step_up_grants'
                and grantee = 'service_role'
                and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')) then
    raise exception '0257: service_role above its ceiling on step_up_grants';
  end if;
  if has_table_privilege('service_role', 'public.step_up_grants', 'DELETE')
     or has_table_privilege('service_role', 'public.step_up_grants', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.step_up_grants', 'REFERENCES')
     or has_table_privilege('service_role', 'public.step_up_grants', 'TRIGGER') then
    raise exception '0257: service_role above its ceiling on step_up_grants';
  end if;
  if not (has_table_privilege('service_role', 'public.step_up_grants', 'SELECT')
          and has_table_privilege('service_role', 'public.step_up_grants', 'INSERT')
          and has_table_privilege('service_role', 'public.step_up_grants', 'UPDATE')) then
    raise exception '0257: service_role is missing a privilege the grant lib needs';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sessions'::regclass) then
    raise exception '0257: sessions must keep RLS enabled';
  end if;
end $$;

commit;
