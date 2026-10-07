-- Migration 0220_report_recipients_digests
-- AUTHORED 2026-10-07. NOT YET APPLIED — GATE (CC/JUAN). Sim first, prod on Juan's word.
-- Provenance: Reports hub v2 pieces 2 + 3 (GO-coops-reports-digests-exports-2026-10-07 + the spec
--   2026-10-07-spec-reports-h2-h3-digest-export + the plan 2026-10-07-reports-digests-plan §2).
--   Juan, 2026-10-07: digest = "a summary and then a link to each report saying things like all good,
--   no issues, or listing the issues for them to drill down into"; timing "Once the shop officially
--   closes"; "Director of operations and up should get the unified digest of all shops."
--   CATERING (added by Juan the same day): "we also need a catering digest in the morning (yesterday's
--   summary and today's outlook) to Keith, each GM and Cristian and above…"
--   Accountant: "design it without the accountants email, once we have it we can just plug it in".
--
-- This migration carries everything PR1 (digests) AND PR2 (exports + accountant package) need, so
-- PR2 needs no 0221: the package columns (packages, cadence, formats) ship here and PR2 only reads
-- them.
--
--   1. report_recipients — the OVERRIDE and EXTERNAL rows of the "Report recipients" admin page.
--      Role-based recipients (GM → own shop, level ≥ 8 → all shops, catering_mgr → catering) are
--      DERIVED in code (lib/report-digests-shared.ts resolveDigestRecipients), never stored.
--        kind 'internal' = one staff user (user_id): `active=false` switches every digest off for
--          them; `catering_digest` / `shop_digest` add them to a digest their role does not get;
--          `location_ids` narrows/widens the shops (null = derive from memberships/role);
--          `packages` + `cadence` + `formats` = the CSV/PDF package at close (Pete, PR2).
--        kind 'external' = an email outside the app (the accountant): packages only, never a
--          digest, never an app link. An external row with NO email can never be active (CHECK),
--          which is what "disabled until the email is plugged in" means in the database.
--   2. report_digest_sends — the send LOG and the IDEMPOTENCY KEY. One row per attempt; the partial
--      unique index over outcome in ('claimed','sent') makes "one digest per recipient × kind ×
--      business_day × revision" a constraint, not a reasoning: a retry or a double cron fire loses
--      the INSERT with 23505 and logs itself as skipped/already_sent. 'failed' rows do not hold the
--      key, so the next tick retries. 'skipped' rows record every deliberate non-send with a reason.
--   3. report_settings — key/value tunables: the catering digest time (default 07:00 ET), the
--      unified fallback time (03:00 ET), the digest-watch grace (60 min) and THE SWITCH:
--      digest_delivery_mode off | preview | live, seeded OFF (CC answers 2026-10-07: "the feature
--      must ship behind a setting that is OFF until CC/Juan turn it on (send to Juan only in a
--      preview mode first)"). off = nothing composed, sent or expected; preview = every digest is
--      composed for its real recipient and delivered to the operator address only; live = sent.
--      The send log carries the mode in its key, so a preview day never blocks the live send.
--
-- RLS posture (all three): RLS on, NO policies, REVOKE ALL from public/anon/authenticated — the
--   0203 / 0214 / 0218 idiom; the only reader and writer is service-role. service_role holds
--   SELECT + INSERT + UPDATE (recipients deactivate via active=false; a send row flips
--   claimed → sent|failed once) and NO DELETE / TRUNCATE: nothing here is ever deleted.
--   LOCATION SCOPING is app-layer, inside the lib writer (lib/report-recipients.ts → level 9 +
--   lockLocationContext on every location_ids element before any I/O);
--   tests/location-bind-differential.test.ts lists report_recipients and that file.
--   report_digest_sends is SYSTEM-written (no actor) and is deliberately not listed there.
-- No functions: the claim is a plain INSERT against the partial unique index.
--
-- Seed: ONE external row, display_name 'Accountant', email NULL, active=false, every package,
--   daily_close, csv+pdf. Tenant-neutral: no names, no UUIDs, no addresses. Pete's internal package
--   row is created on the admin page, never in SQL (AGENTS.md "no location UUIDs in code").
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class
--    where oid in ('public.report_recipients'::regclass, 'public.report_digest_sends'::regclass,
--                  'public.report_settings'::regclass);                                         -- all t
--   select tablename, policyname from pg_policies
--    where tablename in ('report_recipients','report_digest_sends','report_settings');           -- NO ROWS
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('report_recipients','report_digest_sends','report_settings')
--      and grantee in ('anon','authenticated','PUBLIC');                                         -- NO ROWS
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_name in ('report_recipients','report_digest_sends','report_settings')
--      and grantee = 'service_role' order by 1, 2;                    -- INSERT, SELECT, UPDATE each
--   select display_name, email, active from public.report_recipients where kind = 'external';   -- Accountant | null | f
--   select key, value from public.report_settings order by key;                                 -- 4 rows; digest_delivery_mode = "off"

begin;

-- ── Pre-flight (AGENTS.md: pre-flight every SQL emission against the live schema) ───────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'language') then
    raise exception '0220 pre-flight: users.language missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_locations' and column_name = 'active') then
    raise exception '0220 pre-flight: user_locations.active missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_pipeline' and column_name = 'external_ref') then
    raise exception '0220 pre-flight: catering_pipeline.external_ref missing';
  end if;
  if to_regclass('public.report_recipients') is not null
     or to_regclass('public.report_digest_sends') is not null
     or to_regclass('public.report_settings') is not null then
    raise exception '0220 pre-flight: a 0220 table already exists — 0220 applied twice?';
  end if;
end $$;

-- ── 1. report_recipients ────────────────────────────────────────────────────────────────────
create table public.report_recipients (
  id               uuid        primary key default gen_random_uuid(),
  kind             text        not null check (kind in ('internal', 'external')),
  user_id          uuid        null references public.users(id),
  -- Lowercased at write time (lib/report-recipients.ts); external rows only.
  email            text        null check (email is null or (email = lower(email) and char_length(email) between 3 and 254)),
  display_name     text        not null check (char_length(btrim(display_name)) between 1 and 120),
  active           boolean     not null default true,
  -- The Keith flag: send this person the morning catering digest even if their role does not.
  catering_digest  boolean     not null default false,
  -- The per-shop closing digest for someone who is not role gm (an AGM, Q2): off by default.
  shop_digest      boolean     not null default false,
  -- null = derive the shops from memberships / role; otherwise exactly these shops.
  location_ids     uuid[]      null,
  -- PR2 (exports): which package sections, how often, which formats.
  packages         text[]      not null default '{}'
                     check (packages <@ array['sales','cash','catering','purchases','waste','inventory']::text[]),
  cadence          text        null check (cadence in ('daily_close', 'weekly_mon', 'monthly_1st')),
  formats          text[]      not null default '{csv,pdf}'
                     check (formats <@ array['csv','pdf']::text[] and cardinality(formats) >= 1),
  created_by       uuid        null references public.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid        null references public.users(id),
  updated_at       timestamptz not null default now(),
  constraint report_recipients_internal_has_user check ((kind = 'internal') = (user_id is not null)),
  constraint report_recipients_email_external_only check (kind = 'external' or email is null),
  -- An external row with no email cannot be active: the accountant row stays disabled until
  -- someone plugs the address in (spec: "Accountant row created with email EMPTY = disabled").
  constraint report_recipients_external_active_needs_email check (not active or kind = 'internal' or email is not null),
  -- Digest flags are for staff; an external address only ever receives files.
  constraint report_recipients_external_no_digest check (kind = 'internal' or (not catering_digest and not shop_digest))
);
comment on table public.report_recipients is
  '0220: override + external rows of the Report recipients admin page. Role-based recipients are derived in code (lib/report-digests-shared.ts), never stored. Deny-all RLS; written only by lib/report-recipients.ts (level 9 + lockLocationContext). Deactivate = active=false; no delete.';
create unique index report_recipients_one_per_user on public.report_recipients (user_id) where user_id is not null;
create unique index report_recipients_one_per_email on public.report_recipients (lower(email)) where email is not null;

alter table public.report_recipients enable row level security;
revoke all on public.report_recipients from public, anon, authenticated;
grant select, insert, update on public.report_recipients to service_role;
revoke delete, truncate on public.report_recipients from service_role;

-- ── 2. report_digest_sends — the send log + idempotency key ─────────────────────────────────
create table public.report_digest_sends (
  id            uuid        primary key default gen_random_uuid(),
  kind          text        not null check (kind in ('gm_shop', 'unified', 'catering', 'package_daily', 'package_weekly', 'package_monthly')),
  business_day  date        not null,
  -- 'user:<uuid>' for a staff recipient, 'ext:<report_recipients.id>' for an external one.
  recipient_ref text        not null check (recipient_ref ~ '^(user|ext):[0-9a-f-]{36}$'),
  -- The shop of a per-shop digest; null for every other kind.
  location_id   uuid        null references public.locations(id),
  -- 1 = the digest; 2+ = an "updated" digest after a post-send correction (follow-up PR).
  revision      integer     not null default 1 check (revision >= 1),
  -- preview = delivered to the operator address instead of the recipient (digest_delivery_mode).
  mode          text        not null default 'live' check (mode in ('preview', 'live')),
  outcome       text        not null check (outcome in ('claimed', 'sent', 'skipped', 'failed')),
  skip_reason   text        null check (skip_reason is null or skip_reason in
                  ('no_email', 'inactive', 'recipient_disabled', 'no_locations', 'already_sent', 'not_due', 'shop_not_finalized')),
  email_id      text        null,
  error         text        null check (error is null or char_length(error) <= 500),
  content_sha   text        null,
  attempted_at  timestamptz not null default now(),
  completed_at  timestamptz null,
  constraint report_digest_sends_shop_kind check ((kind = 'gm_shop') = (location_id is not null)),
  constraint report_digest_sends_skip_reason check ((outcome = 'skipped') = (skip_reason is not null))
);
comment on table public.report_digest_sends is
  '0220: every digest send attempt and every deliberate skip. The partial unique index report_digest_sends_once IS the idempotency guard (claim = INSERT outcome claimed; 23505 = already claimed/sent). Failed rows release the key so the next tick retries. System-written by lib/report-digests.ts (service-role, no actor). Deny-all RLS.';
-- THE idempotency key: at most one live claim-or-send per recipient × kind × day × revision.
-- location_id is part of the key so a GM of two shops gets one per-shop digest for each.
create unique index report_digest_sends_once
  on public.report_digest_sends (recipient_ref, kind, business_day, revision, mode, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where outcome in ('claimed', 'sent');
create index report_digest_sends_day_kind_ix on public.report_digest_sends (business_day, kind);
create index report_digest_sends_recipient_ix on public.report_digest_sends (recipient_ref, attempted_at desc);

alter table public.report_digest_sends enable row level security;
revoke all on public.report_digest_sends from public, anon, authenticated;
grant select, insert, update on public.report_digest_sends to service_role;
revoke delete, truncate on public.report_digest_sends from service_role;

-- ── 3. report_settings ──────────────────────────────────────────────────────────────────────
create table public.report_settings (
  key         text        primary key check (key in ('digest_delivery_mode', 'catering_digest_time_et', 'unified_fallback_time_et', 'digest_watch_grace_minutes')),
  value       jsonb       not null,
  updated_by  uuid        null references public.users(id),
  updated_at  timestamptz not null default now()
);
comment on table public.report_settings is
  '0220: digest tunables (delivery mode off|preview|live, seeded off; HH:MM ET times as JSON strings; grace minutes as a JSON number). Read by lib/report-digests.ts; written by lib/report-recipients.ts updateReportSettings (level 9). Deny-all RLS.';

alter table public.report_settings enable row level security;
revoke all on public.report_settings from public, anon, authenticated;
grant select, insert, update on public.report_settings to service_role;
revoke delete, truncate on public.report_settings from service_role;

-- ── Seeds (tenant-neutral) ──────────────────────────────────────────────────────────────────
insert into public.report_settings (key, value) values
  ('digest_delivery_mode', '"off"'::jsonb),
  ('catering_digest_time_et', '"07:00"'::jsonb),
  ('unified_fallback_time_et', '"03:00"'::jsonb),
  ('digest_watch_grace_minutes', '60'::jsonb);

insert into public.report_recipients (kind, email, display_name, active, packages, cadence, formats)
values ('external', null, 'Accountant', false,
        array['sales','cash','catering','purchases','waste','inventory']::text[], 'daily_close', array['csv','pdf']::text[]);

-- ── Grant self-check (the 0132/0189 law — verify, never assume) ─────────────────────────────
do $$ begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public'
                and table_name in ('report_recipients', 'report_digest_sends', 'report_settings')
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0220: unexpected PostgREST-role grant on a 0220 table';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public'
                and table_name in ('report_recipients', 'report_digest_sends', 'report_settings')
                and grantee = 'service_role' and privilege_type in ('DELETE', 'TRUNCATE')) then
    raise exception '0220: 0220 tables must not be deletable by service_role';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('report_recipients', 'report_digest_sends', 'report_settings')) then
    raise exception '0220: 0220 tables must carry no policies (deny-all)';
  end if;
end $$;

commit;
