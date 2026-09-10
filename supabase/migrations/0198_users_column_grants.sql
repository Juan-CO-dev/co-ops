-- Migration 0198_users_column_grants
-- Applied via Supabase MCP 2026-09-10 (sim first, prod on Juan's word). Provenance: LRA Wave A, rows LRA-001 + LRA-214.
--
-- WHAT: replace the default table-level ACL on public.users for the PostgREST roles with column-level grants.
--
-- WHY (two P1s, both live on prod 2026-09-10, read-only probes in the LRA ledger):
--   LRA-001 — `authenticated` held SELECT on every users column, and users_read_self reads all rows at level >= 7,
--             so any GM token could read pin_hash + password_hash for every account via PostgREST.
--   LRA-214 — `authenticated` held UPDATE on every users column, users_update_self checks only `id = current_user_id()`,
--             there is no trigger on users, and current_user_role_level() reads users.role from the TABLE (0189) — so one
--             `PATCH /rest/v1/users?id=eq.<self> {"role":"owner"}` with a staff JWT made every RLS policy treat that token
--             as level 9 immediately. active / email_verified / locked_until / failed_login_count / both hashes were
--             writable the same way. The app-layer self-update allowlist (/api/users/me/*) never sees the curl path.
--
-- HOW: Postgres column privileges. A table-level grant cannot be partially revoked, so revoke the table grants from
-- anon + authenticated, then grant back exactly what user-context code needs (census 2026-09-10, every users read on a
-- createAuthedClient client selects a subset of the SELECT list below; the only user-context writes are
-- /api/users/me/language and /api/users/me/profile-blurb). service_role and postgres keep their full ACL — every auth,
-- admin and credential path already runs service-role. The one user-context pin_hash reader (lib/checklists.ts confirm
-- attestation) moves to the service-role client in the same PR.
--
-- Row policies are unchanged: users_read_self / users_update_self / users_update_admin / users_insert_admin /
-- users_no_user_delete still gate rows; the column grants now bound WHICH columns a self-update may touch.
--
-- VERIFY AFTER APPLY (the 0132/0189 law: verify grants, never assume):
--   select grantee, privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'users' and grantee in ('anon', 'authenticated')
--    group by 1, 2 order by 1, 2;
--   → anon: no rows. authenticated: SELECT on the 15 columns below, UPDATE on language,profile_blurb. Nothing else.
--
-- Rollback (if ever needed): grant select, insert, update, delete, references on public.users to authenticated, anon —
-- which re-opens both P1s; prefer fixing forward.

begin;

revoke all privileges on table public.users from anon;
revoke all privileges on table public.users from authenticated;

grant select (
  id, name, email, role, active, language, phone, profile_blurb,
  created_at, created_by, last_login_at,
  email_verified, email_verified_at, sms_consent, sms_consent_at
) on table public.users to authenticated;

grant update (language, profile_blurb) on table public.users to authenticated;

-- Guard: the credential and lockout columns must not be reachable by either PostgREST role.
do $$
declare bad text;
begin
  select string_agg(grantee || ':' || privilege_type || ':' || column_name, ', ')
    into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'users'
     and grantee in ('anon', 'authenticated')
     and (column_name in ('pin_hash', 'password_hash', 'locked_until', 'failed_login_count')
          or privilege_type not in ('SELECT', 'UPDATE')
          or (privilege_type = 'UPDATE' and column_name not in ('language', 'profile_blurb'))
          or grantee = 'anon');
  if bad is not null then
    raise exception '0198: unexpected users grant(s): %', bad;
  end if;
end $$;

insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
values (
  null, null, 'security.grants_change', 'users', null, true,
  jsonb_build_object(
    'actor_context', 'migration_apply',
    'migration', '0198_users_column_grants',
    'table', 'public.users',
    'revoked_from', jsonb_build_array('anon', 'authenticated'),
    'granted', jsonb_build_object(
      'authenticated', jsonb_build_object(
        'select', jsonb_build_array('id','name','email','role','active','language','phone','profile_blurb','created_at','created_by','last_login_at','email_verified','email_verified_at','sms_consent','sms_consent_at'),
        'update', jsonb_build_array('language','profile_blurb'))),
    'ledger', jsonb_build_array('LRA-001', 'LRA-214')
  )
);

commit;
