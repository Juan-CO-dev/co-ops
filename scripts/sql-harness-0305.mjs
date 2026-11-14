/**
 * Offline proof of migration 0305 (bug audit 2026-11-14, fix wave W05). SYNTHETIC ROWS ONLY: PGlite,
 * in memory, no credentials, no network. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0305.mjs
 *
 * The base is hand-built tables plus the REAL definitions the migration stands on, extracted from their
 * sources, never forked: current_user_id (0200), current_user_role_level (0189), the live
 * current_user_locations body (Foundation Spec v1.3 §5, never re-emitted by a migration until 0305) and the
 * cash_reports policies (0067). Every request runs as PostgREST runs it: `set local role authenticated` plus
 * the JWT claims in `request.jwt.claims`.
 *
 *   A  B009  current_user_locations() counts ACTIVE memberships only: a removed shop closes on the curl path
 *            while the kept shop stays open; helper shape, grants and the refusal guards.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const mig = (name) => read(`supabase/migrations/${name}`);
const M0305 = mig("0305_rls_membership_and_read_floors.sql");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} -> ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
/** A refused apply leaves its `begin` open and aborted: roll it back so the database stays usable. */
async function applyRefuses(db, code, what) {
  await refuses(() => db.exec(M0305), code, what);
  await db.exec("rollback");
}
function grab(sql, re, what) {
  const m = sql.match(re);
  if (!m) throw new Error(`extract: ${what} not found`);
  return m[0];
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
const SHOP_A = id(101), SHOP_B = id(102);
/** [user id, session id, role]. Everyone starts as an ACTIVE member of both shops unless a test says otherwise. */
const PEOPLE = {
  employee: [id(1), id(201), "employee"],
  keyHolder: [id(2), id(202), "key_holder"],
  shiftLead: [id(3), id(203), "shift_lead"],
  cateringMgr: [id(4), id(204), "catering_mgr"],
  gm: [id(5), id(205), "gm"],
  moo: [id(6), id(206), "moo"],
  owner: [id(7), id(207), "owner"],
};

/** Run `fn` as one PostgREST request of `who` (a PEOPLE key, or "anon"), rolled back afterwards. */
async function request(db, who, fn) {
  await db.exec("begin");
  try {
    if (who === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else {
      const [user, session] = PEOPLE[who];
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ user_id: user, session_id: session, role: "authenticated" })}', true);`);
    }
    return await fn();
  } finally { await db.exec("rollback"); }
}
const rows = async (db, who, sql) => request(db, who, async () => (await db.query(sql)).rows);

async function base() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase's explicit default ACLs (not merely PostgreSQL's PUBLIC grant).
    alter default privileges grant execute on functions to anon, authenticated, service_role;
    alter default privileges grant all on tables to anon, authenticated, service_role;
    create table audit_log(actor_id uuid, actor_role text, action text, resource_table text, resource_id uuid,
      destructive boolean, metadata jsonb);
    create table users(id uuid primary key, role text not null, active boolean not null default true);
    create table user_locations(user_id uuid not null references users, location_id uuid not null,
      active boolean not null default true);
    create table sessions(id uuid primary key, user_id uuid references users, revoked_at timestamptz, expires_at timestamptz);
    create table cash_reports(id uuid primary key default gen_random_uuid(), location_id uuid not null, note text);
    alter table cash_reports enable row level security;`);
  for (const [user, session, role] of Object.values(PEOPLE)) {
    await db.exec(`insert into users values('${user}','${role}',true);
      insert into user_locations values('${user}','${SHOP_A}',true),('${user}','${SHOP_B}',true);
      insert into sessions values('${session}','${user}',null,now()+interval '1 day');`);
  }
  await db.exec(`insert into cash_reports(location_id, note) values('${SHOP_A}','a'),('${SHOP_B}','b');`);
  // The REAL helpers. current_user_locations is the live body: no migration ever re-emitted it before 0305.
  await db.exec(grab(mig("0200_current_user_id_session_bound.sql"), /CREATE OR REPLACE FUNCTION public\.current_user_id\(\)[\s\S]*?\$function\$;/, "0200 current_user_id"));
  await db.exec(grab(mig("0189_rls_perimeter_revokes_and_read_floors.sql"), /create or replace function public\.current_user_role_level\(\)[\s\S]*?\$\$;/, "0189 current_user_role_level"));
  await db.exec(grab(read("docs/CO-OPS_Foundation_Spec_v1.3.md"), /CREATE OR REPLACE FUNCTION current_user_locations\(\)[\s\S]*?\$\$;/, "spec current_user_locations"));
  // 0029's grant posture for the three helpers: authenticated + service_role, never anon / PUBLIC.
  await db.exec(`revoke all on function current_user_id(), current_user_role_level(), current_user_locations() from public, anon;
    grant execute on function current_user_id(), current_user_role_level(), current_user_locations() to authenticated, service_role;`);
  await db.exec(grab(mig("0067_cash_reports.sql"), /CREATE POLICY cash_reports_read[\s\S]*?;/, "0067 cash_reports_read"));
  return db;
}

const removeFromShopA = (who) => `update user_locations set active = false where user_id = '${PEOPLE[who][0]}' and location_id = '${SHOP_A}';`;
const shops = (list) => list.map((r) => r.location_id).sort().join(",");

// ── A. B009 ─────────────────────────────────────────────────────────────────────────────────────
async function membership() {
  // The bug, on the pre-0305 schema: a removed membership still opens the shop.
  let db = await base();
  await db.exec(removeFromShopA("keyHolder"));
  check(shops(await rows(db, "keyHolder", "select location_id from cash_reports")) === [SHOP_A, SHOP_B].sort().join(","),
    "A0 before 0305: a key holder removed from shop A still reads shop A's cash reports (the bug)");
  await db.exec(M0305);
  check(shops(await rows(db, "keyHolder", "select location_id from cash_reports")) === SHOP_B,
    "A1 after 0305: the removed shop is closed, the kept shop still reads");
  const helper = (await rows(db, "keyHolder", "select public.current_user_locations() as l"))[0].l;
  check(Array.isArray(helper) && helper.length === 1 && helper[0] === SHOP_B, "A1 current_user_locations() = the active memberships only");
  check(shops(await rows(db, "gm", "select location_id from cash_reports")) === [SHOP_A, SHOP_B].sort().join(","),
    "A1 an untouched member of both shops still reads both");
  // No memberships at all: an empty array (never NULL), so `= ANY` is false rather than unknown.
  await db.exec(`update user_locations set active = false where user_id = '${PEOPLE.keyHolder[0]}';`);
  const none = (await rows(db, "keyHolder", "select public.current_user_locations() as l, public.current_user_locations() is null as n"))[0];
  check(Array.isArray(none.l) && none.l.length === 0 && none.n === false, "A1 no active membership = an empty array, not NULL");
  check((await rows(db, "keyHolder", "select 1 from cash_reports")).length === 0, "A1 no active membership reads nothing");
  // Re-adding the shop (active = true again) re-opens it: the helper reads the live table.
  await db.exec(`update user_locations set active = true where user_id = '${PEOPLE.keyHolder[0]}' and location_id = '${SHOP_A}';`);
  check(shops(await rows(db, "keyHolder", "select location_id from cash_reports")) === SHOP_A, "A1 a re-added shop opens again");
  // A revoked session is still nobody (0200 is untouched).
  await db.exec(`update sessions set revoked_at = now() where id = '${PEOPLE.gm[1]}';`);
  check((await rows(db, "gm", "select public.current_user_locations() as l"))[0].l.length === 0, "A1 a revoked session resolves no shops (0200 intact)");

  // Shape and grants.
  const fn = (await db.query(`select p.prosecdef, p.provolatile, p.proconfig, l.lanname, p.prorettype::regtype::text as ret, p.prosrc
    from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.current_user_locations()'::regprocedure`)).rows[0];
  check(fn.prosecdef && fn.provolatile === "s" && fn.lanname === "sql" && fn.ret === "uuid[]"
    && fn.proconfig.includes("search_path=pg_catalog, public"), "A2 still SECURITY DEFINER, STABLE, sql, uuid[], search_path pinned");
  const acl = (await db.query(`select has_function_privilege('anon', 'public.current_user_locations()', 'EXECUTE') as anon,
    has_function_privilege('authenticated', 'public.current_user_locations()', 'EXECUTE') as authed,
    has_function_privilege('service_role', 'public.current_user_locations()', 'EXECUTE') as service`)).rows[0];
  check(!acl.anon && acl.authed && acl.service, "A2 EXECUTE: authenticated + service_role, never anon");
  await refuses(() => request(db, "anon", () => db.query("select public.current_user_locations()")), "42501", "A2 anon cannot call the helper");
  const audit = (await db.query(`select count(*)::int as n from audit_log where action = 'security.grants_change'
    and metadata->>'migration' = '0305_rls_membership_and_read_floors' and metadata->>'actor_context' = 'migration_apply' and destructive`)).rows[0].n;
  check(audit >= 1, "A2 the apply wrote its security.grants_change audit row(s)");
  // A second apply refuses instead of stacking a second set of audit rows.
  await applyRefuses(db, "0305: already applied", "A3 a second apply refuses");
  await db.close();

  // Refusal guards: each on a fresh pre-0305 database.
  db = await base();
  await db.exec("alter table user_locations drop column active;");
  await applyRefuses(db, "0305:", "A3 refuses without user_locations.active (0078)");
  await db.close();
  db = await base();
  await db.exec("alter function public.current_user_locations() security invoker;");
  await applyRefuses(db, "0305:", "A3 refuses a helper that is not SECURITY DEFINER (drifted shape)");
  check((await db.query(`select prosrc from pg_proc where oid = 'public.current_user_locations()'::regprocedure`)).rows[0].prosrc.includes("active") === false,
    "A3 a refused apply changes nothing (one transaction)");
  await db.close();
  console.log("A  B009 current_user_locations(): active memberships only; shape, grants and refusals verified");
}

try {
  await membership();
  if (failures) { console.error(`FAIL 0305: ${failures} of ${checks} checks failed`); process.exitCode = 1; }
  else console.log(`PASS 0305: ${checks} checks`);
} catch (e) { console.error(`FAIL 0305: ${e.stack ?? e}`); process.exitCode = 1; }
