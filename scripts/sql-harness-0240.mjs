#!/usr/bin/env node
/**
 * 0240 SQL harness on PGlite (in-process Postgres, no network, no prod). Applies the migration against
 * the minimum schema it depends on and proves, as the ROLES the app uses:
 *   - service_role can INSERT notes/acks/layouts, UPDATE only the granted columns, never DELETE;
 *   - the supersede trigger refuses anyone but the author or a HIGHER level and refuses content edits;
 *   - an upsert that touches key columns is refused (Astra #1), while insert + column-scoped update works;
 *   - anon / authenticated see nothing (deny-all RLS + no grants).
 * Run: node scripts/sql-harness-0240.mjs   (exit 0 = every check passed)
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const expectError = async (name, sql, pattern) => {
  try { await db.exec(sql); check(name, false, "no error raised"); }
  catch (e) {
    const msg = String(e.message ?? e);
    check(name, pattern.test(msg), msg.split("\n")[0]);
    // A statement that failed inside an explicit transaction (the migration file begins with `begin;`) leaves
    // the session aborted; clear it so the next check runs against a clean session.
    await db.exec("rollback").catch(() => {});
  }
};
const expectOk = async (name, sql) => {
  try { await db.exec(sql); check(name, true); } catch (e) { check(name, false, String(e.message ?? e).split("\n")[0]); }
};

// ── Minimum schema the migration references ─────────────────────────────────────────────────
await db.exec(`
  -- Supabase's service_role carries BYPASSRLS (the app's writer); anon/authenticated are the staff-JWT roles.
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.locations (id uuid primary key default gen_random_uuid(), name text);
  create table public.users (id uuid primary key default gen_random_uuid(), role text not null, name text);
  create table public.stations (id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id), name text, unique (id, location_id));
  create function public.assignment_author_level(p_user_id uuid) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
  declare v_role text; begin
    select role into v_role from public.users where id=p_user_id;
    return case v_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8 when 'gm' then 7 when 'agm' then 6
      when 'catering_mgr' then 6 when 'prep_mgr' then 6 when 'social_media_mgr' then 6 when 'shift_lead' then 5 when 'key_holder' then 4
      when 'trainer' then 4 when 'employee' then 3 when 'trainee' then 2 when 'hired_not_yet_worked' then 1 when 'prospect' then 0 else null end;
  end $$;
  revoke all on function public.assignment_author_level(uuid) from public, anon, authenticated;
  grant execute on function public.assignment_author_level(uuid) to service_role;
  grant usage on schema public to anon, authenticated, service_role;
  insert into public.locations (id, name) values ('11111111-1111-4111-8111-111111111111','Shop A'), ('22222222-2222-4222-8222-222222222222','Shop B');
  insert into public.users (id, role, name) values
    ('aaaaaaaa-0000-4000-8000-000000000009','owner','Pete'), ('aaaaaaaa-0000-4000-8000-000000000007','gm','Alex'),
    ('aaaaaaaa-0000-4000-8000-000000000006','agm','Avery'), ('aaaaaaaa-0000-4000-8000-000000000003','employee','Val');
  insert into public.stations (id, location_id, name) values
    ('bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Line'),
    ('bbbbbbbb-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','Line B');
`);

// ── Apply 0240 ──────────────────────────────────────────────────────────────────────────────
const sql = readFileSync(new URL("../supabase/migrations/0240_pulse_v2.sql", import.meta.url), "utf8");
await expectOk("0240 applies in one transaction (preflight, tables, policies, grants, trigger, grant proof)", sql);
await expectError("0240 refuses to apply twice", sql, /already applied/);

const SHOP = "'11111111-1111-4111-8111-111111111111'";
const OWNER = "'aaaaaaaa-0000-4000-8000-000000000009'", GM = "'aaaaaaaa-0000-4000-8000-000000000007'", AGM = "'aaaaaaaa-0000-4000-8000-000000000006'";
const S1 = "'bbbbbbbb-0000-4000-8000-000000000001'", SB = "'bbbbbbbb-0000-4000-8000-000000000002'";

// ── As the app's writer (service_role) ─────────────────────────────────────────────────────
await db.exec("set role service_role");
await expectOk("service_role inserts a GM's note", `insert into public.pulse_handoff_notes (id, location_id, business_date, author_id, audience, body) values ('cccccccc-0000-4000-8000-000000000001', ${SHOP}, '2026-10-09', ${GM}, 'managers', 'Walk-in compressor is loud')`);
await expectError("Astra #6: an AGM cannot supersede a GM's note", `update public.pulse_handoff_notes set superseded_at = now(), superseded_by = ${AGM} where id = 'cccccccc-0000-4000-8000-000000000001'`, /supersede_forbidden/);
await expectError("Astra #6: a same-level GM (not the author) cannot supersede", `update public.pulse_handoff_notes set superseded_at = now(), superseded_by = 'aaaaaaaa-0000-4000-8000-000000000003' where id = 'cccccccc-0000-4000-8000-000000000001'`, /supersede_forbidden/);
await expectError("note content is immutable (body edit refused by the trigger even for the author)", `update public.pulse_handoff_notes set superseded_at = now(), superseded_by = ${GM}, body = 'edited' where id = 'cccccccc-0000-4000-8000-000000000001'`, /permission denied|handoff_note_immutable/);
await expectOk("Astra #6: the author supersedes their own note", `update public.pulse_handoff_notes set superseded_at = now(), superseded_by = ${GM} where id = 'cccccccc-0000-4000-8000-000000000001'`);
await expectError("a superseded note cannot be superseded again", `update public.pulse_handoff_notes set superseded_at = now(), superseded_by = ${OWNER} where id = 'cccccccc-0000-4000-8000-000000000001'`, /already_superseded/);
await expectOk("second note by the GM", `insert into public.pulse_handoff_notes (id, location_id, business_date, author_id, audience, body) values ('cccccccc-0000-4000-8000-000000000002', ${SHOP}, '2026-10-09', ${GM}, 'crew', 'Back fryer only')`);
await expectOk("Astra #6: the OWNER (higher level) supersedes the GM's note", `update public.pulse_handoff_notes set superseded_at = now(), superseded_by = ${OWNER} where id = 'cccccccc-0000-4000-8000-000000000002'`);
await expectError("notes cannot be deleted by the writer (append-only by grant)", `delete from public.pulse_handoff_notes where id = 'cccccccc-0000-4000-8000-000000000002'`, /permission denied/);
await expectOk("ack insert", `insert into public.pulse_handoff_acks (note_id, user_id) values ('cccccccc-0000-4000-8000-000000000002', ${AGM})`);
await expectError("ack is one per (note, user)", `insert into public.pulse_handoff_acks (note_id, user_id) values ('cccccccc-0000-4000-8000-000000000002', ${AGM})`, /duplicate key|unique/);
await expectError("acks are insert-only (no update grant)", `update public.pulse_handoff_acks set acked_at = now()`, /permission denied/);

await expectOk("layout insert (new row) with all columns", `insert into public.pulse_station_layouts (location_id, station_id, x, y, updated_by) values (${SHOP}, ${S1}, 1, 2, ${GM})`);
await expectOk("Astra #1: column-scoped update (x, y, updated_by, updated_at) succeeds", `update public.pulse_station_layouts set x = 3, y = 1.5, updated_by = ${GM}, updated_at = now() where location_id = ${SHOP} and station_id = ${S1}`);
await expectError("Astra #1: an UPSERT that merges key columns is refused (the c5f3f6c writer's shape)", `insert into public.pulse_station_layouts (location_id, station_id, x, y, updated_by) values (${SHOP}, ${S1}, 4, 4, ${GM}) on conflict (location_id, station_id) do update set location_id = excluded.location_id, station_id = excluded.station_id, x = excluded.x, y = excluded.y, updated_by = excluded.updated_by`, /permission denied/);
await expectError("a station of another shop cannot be placed on this shop's floor (composite FK)", `insert into public.pulse_station_layouts (location_id, station_id, x, y, updated_by) values (${SHOP}, ${SB}, 0, 0, ${GM})`, /foreign key|violates/);
await expectError("coordinates are bounded 0..12", `update public.pulse_station_layouts set x = 13 where location_id = ${SHOP} and station_id = ${S1}`, /check constraint|violates/);
await expectError("layouts cannot be deleted", `delete from public.pulse_station_layouts`, /permission denied/);
await db.exec("reset role");

// ── As the staff JWT roles: nothing is readable or writable ─────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  for (const tab of ["pulse_handoff_notes", "pulse_handoff_acks", "pulse_station_layouts"]) {
    await expectError(`${role} cannot select ${tab}`, `select * from public.${tab}`, /permission denied/);
  }
  await expectError(`${role} cannot insert a note`, `insert into public.pulse_handoff_notes (location_id, business_date, author_id, audience, body) values (${SHOP}, '2026-10-09', ${GM}, 'all', 'x')`, /permission denied/);
  await db.exec("reset role");
}

// ── Final state ─────────────────────────────────────────────────────────────────────────────
const live = await db.query("select count(*)::int as n from public.pulse_handoff_notes where superseded_at is null");
check("both notes are superseded (0 live)", live.rows[0].n === 0, `live=${live.rows[0].n}`);
const pt = await db.query(`select x::float as x, y::float as y from public.pulse_station_layouts where station_id = ${S1}`);
check("the layout point is the updated one (3, 1.5)", pt.rows[0]?.x === 3 && pt.rows[0]?.y === 1.5, JSON.stringify(pt.rows[0]));

await db.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n0240 harness: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
