-- Migration 0240_pulse_v2
-- AUTHORED 2026-10-09 (CO Claude builder, feat/pulse-v2). APPLIED TO PROD 2026-10-09 (20261009190456; sim 20261009185827, real-PG posture verified; prod dry run pass).
-- 0238 (station schedules) and 0239 (Sales true net) are Astra's lanes; nothing here touches them.
--
-- Mid-shift Pulse v2 (Juan 2026-10-09: "let's supercharge mid shift pulse"; spec
-- docs/superpowers/specs/2026-10-09-midshift-pulse-v2-design.md). Everything in the app sits behind
-- PULSE_V2=1 and every reader degrades to an explicit "not installed" state while this is unapplied.
--
-- A. pulse_handoff_notes — the AM→PM handoff note (spec "Handoff"): one shop, one business day, an
--    author (AGM+ in the app, level 6), a body and an AUDIENCE ('crew' | 'managers' | 'all') so crew
--    only ever read notes addressed to them. Append-only: a note is never edited or deleted; the
--    author (or a higher level) SUPERSEDES it (superseded_at/by), and the pulse shows live notes only.
--    r1 (Astra #6): a BEFORE UPDATE trigger refuses a supersede by anyone but the author or a HIGHER
--    level (0228's assignment_author_level oracle) and refuses any change to the note's content.
-- B. pulse_handoff_acks — the incoming manager's "Got it": one row per (note, user), insert-only.
-- C. pulse_station_layouts — the 3D floor's saved arrangement (GM+ drags once; spec "3D shop floor:
--    saved per shop, audited"): one row per (location, station) with grid-unit coordinates. The ONLY
--    table here that UPDATEs (a re-drag moves the point); the audit row carries before/after.
--    r1 (Astra #1): the writer INSERTs new rows and UPDATEs existing rows with exactly (x, y,
--    updated_by, updated_at) — never an upsert, whose merge would need UPDATE on the key columns.
--
-- RLS: deny-all on every table (the staff JWT is a valid PostgREST bearer; nothing here is readable
-- on the curl path). Writes go through the service role from lib/pulse/handoff.ts and
-- lib/pulse/layout.ts, which carry the level floor and the location bind BEFORE any I/O. Grants are
-- the minimum each table's contract needs: notes SELECT + INSERT + UPDATE(superseded_at, superseded_by)
-- only; acks SELECT + INSERT only; layouts SELECT + INSERT + UPDATE(x, y, updated_by, updated_at).
-- No DELETE anywhere (append-only by grant, the 0218 pattern). The final DO block proves the grants.
--
-- Verification (sim, after apply):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name like 'pulse_%' and grantee in ('anon','authenticated','PUBLIC');   -- NO ROWS
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_name like 'pulse_%' and grantee = 'service_role' order by 1,2;          -- see above
begin;

do $$ begin
  if to_regclass('public.pulse_handoff_notes') is not null
    or to_regclass('public.pulse_handoff_acks') is not null
    or to_regclass('public.pulse_station_layouts') is not null then
    raise exception '0240: already applied';
  end if;
  if to_regclass('public.stations') is null or to_regclass('public.locations') is null or to_regclass('public.users') is null then
    raise exception '0240: requires stations, locations, users';
  end if;
  -- The supersede guard reuses 0228's level oracle (SECURITY DEFINER, service_role-only EXECUTE).
  if to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0240: requires assignment_author_level(uuid) (0228)';
  end if;
end $$;

-- ── A. Handoff notes ─────────────────────────────────────────────────────────────────────────
create table public.pulse_handoff_notes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  business_date date not null,
  author_id uuid not null references public.users(id),
  audience text not null check (audience in ('crew','managers','all')),
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  superseded_by uuid references public.users(id),
  check ((superseded_at is null) = (superseded_by is null))
);
create index pulse_handoff_notes_day on public.pulse_handoff_notes (location_id, business_date, created_at desc);
comment on table public.pulse_handoff_notes is
  'Mid-shift Pulse v2 AM→PM handoff notes. Append-only: supersede, never edit/delete. Deny-all RLS; service role only.';

alter table public.pulse_handoff_notes enable row level security;
create policy pulse_handoff_notes_no_user_select on public.pulse_handoff_notes for select using (false);
create policy pulse_handoff_notes_no_user_insert on public.pulse_handoff_notes for insert with check (false);
create policy pulse_handoff_notes_no_user_update on public.pulse_handoff_notes for update using (false);
create policy pulse_handoff_notes_no_user_delete on public.pulse_handoff_notes for delete using (false);
revoke all on public.pulse_handoff_notes from public, anon, authenticated, service_role;
grant select, insert on public.pulse_handoff_notes to service_role;
grant update (superseded_at, superseded_by) on public.pulse_handoff_notes to service_role;

-- Supersede guard (Astra #6, r1): only the AUTHOR or a HIGHER level may retract a note, and a note's
-- content is immutable once written (the column grant already limits the writer; this closes the
-- "any AGM retracts an owner's instruction" hole at the row level, mirroring lib/pulse/handoff.ts).
-- Plain plpgsql (no SECURITY DEFINER): it runs as the writer (service_role), which already holds
-- EXECUTE on 0228's definer oracle assignment_author_level(uuid).
create function public.pulse_handoff_notes_supersede_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.body <> old.body or new.audience <> old.audience or new.author_id <> old.author_id
     or new.location_id <> old.location_id or new.business_date <> old.business_date or new.created_at <> old.created_at then
    raise exception 'handoff_note_immutable';
  end if;
  if old.superseded_at is not null then
    raise exception 'handoff_note_already_superseded';
  end if;
  if new.superseded_at is not null then
    if new.superseded_by is null then raise exception 'supersede_actor_required'; end if;
    if new.superseded_by <> old.author_id
       and coalesce(public.assignment_author_level(new.superseded_by), -1) <= coalesce(public.assignment_author_level(old.author_id), 1000) then
      raise exception 'supersede_forbidden';
    end if;
  end if;
  return new;
end $$;
create trigger pulse_handoff_notes_supersede_guard before update on public.pulse_handoff_notes
  for each row execute function public.pulse_handoff_notes_supersede_guard();
revoke all on function public.pulse_handoff_notes_supersede_guard() from public, anon, authenticated;

-- ── B. Handoff acknowledgements ("Got it") ───────────────────────────────────────────────────
create table public.pulse_handoff_acks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.pulse_handoff_notes(id),
  user_id uuid not null references public.users(id),
  acked_at timestamptz not null default clock_timestamp(),
  unique (note_id, user_id)
);
comment on table public.pulse_handoff_acks is
  'Mid-shift Pulse v2: one "Got it" per (note, user). Insert-only. Deny-all RLS; service role only.';

alter table public.pulse_handoff_acks enable row level security;
create policy pulse_handoff_acks_no_user_select on public.pulse_handoff_acks for select using (false);
create policy pulse_handoff_acks_no_user_insert on public.pulse_handoff_acks for insert with check (false);
create policy pulse_handoff_acks_no_user_update on public.pulse_handoff_acks for update using (false);
create policy pulse_handoff_acks_no_user_delete on public.pulse_handoff_acks for delete using (false);
revoke all on public.pulse_handoff_acks from public, anon, authenticated, service_role;
grant select, insert on public.pulse_handoff_acks to service_role;

-- ── C. Saved floor layout ────────────────────────────────────────────────────────────────────
create table public.pulse_station_layouts (
  location_id uuid not null references public.locations(id),
  station_id uuid not null,
  x numeric(5,2) not null check (x >= 0 and x <= 12),
  y numeric(5,2) not null check (y >= 0 and y <= 12),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (location_id, station_id),
  -- A station belongs to exactly one shop (0217's unique(id, location_id)); the layout cannot cross shops.
  foreign key (station_id, location_id) references public.stations(id, location_id)
);
comment on table public.pulse_station_layouts is
  'Mid-shift Pulse v2: the 3D floor arrangement a GM saved for the shop, grid units. Audited station.layout_update. Deny-all RLS; service role only.';

alter table public.pulse_station_layouts enable row level security;
create policy pulse_station_layouts_no_user_select on public.pulse_station_layouts for select using (false);
create policy pulse_station_layouts_no_user_insert on public.pulse_station_layouts for insert with check (false);
create policy pulse_station_layouts_no_user_update on public.pulse_station_layouts for update using (false);
create policy pulse_station_layouts_no_user_delete on public.pulse_station_layouts for delete using (false);
revoke all on public.pulse_station_layouts from public, anon, authenticated, service_role;
grant select, insert on public.pulse_station_layouts to service_role;
grant update (x, y, updated_by, updated_at) on public.pulse_station_layouts to service_role;

-- ── Prove the grants ─────────────────────────────────────────────────────────────────────────
do $$ declare tab text; r text; begin
  foreach tab in array array['pulse_handoff_notes','pulse_handoff_acks','pulse_station_layouts'] loop
    foreach r in array array['anon','authenticated'] loop
      if has_any_column_privilege(r,'public.'||tab,'SELECT,INSERT,UPDATE,REFERENCES')
        or has_table_privilege(r,'public.'||tab,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception '0240: % grant escaped to %', tab, r;
      end if;
    end loop;
    if has_table_privilege('service_role','public.'||tab,'DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '0240: service_role may not delete/truncate %', tab;
    end if;
    if not has_table_privilege('service_role','public.'||tab,'SELECT') or not has_table_privilege('service_role','public.'||tab,'INSERT') then
      raise exception '0240: service_role lost select/insert on %', tab;
    end if;
  end loop;
  if has_table_privilege('service_role','public.pulse_handoff_acks','UPDATE') then raise exception '0240: acks must be insert-only'; end if;
  if has_table_privilege('service_role','public.pulse_handoff_notes','UPDATE') then raise exception '0240: notes update must be column-scoped'; end if;
  if not has_column_privilege('service_role','public.pulse_handoff_notes','superseded_at','UPDATE')
    or has_column_privilege('service_role','public.pulse_handoff_notes','body','UPDATE') then
    raise exception '0240: notes supersede grant wrong';
  end if;
  if not has_column_privilege('service_role','public.pulse_station_layouts','x','UPDATE')
    or has_column_privilege('service_role','public.pulse_station_layouts','station_id','UPDATE') then
    raise exception '0240: layout update grant wrong';
  end if;
end $$;
commit;
