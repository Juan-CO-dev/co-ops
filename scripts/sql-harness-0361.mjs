/**
 * Local Postgres proof of migration 0361 (Toast labor "only if newer": the guarded writer
 * public.toast_time_entries_apply_newer(jsonb)). SYNTHETIC ROWS ONLY — PGlite, in memory, one connection. CC owns the
 * Supabase sim / prod gate; this never touches a real database. Two-session races are out of scope here (PGlite is
 * one connection): scripts/sim/toast-labor-0361-two-sessions.mjs proves them on sim.
 *
 *   node scripts/sql-harness-0361.mjs
 *
 * Base: roles anon / authenticated / service_role (BYPASSRLS, asserted), minimal locations / users / user_locations,
 * the REAL 0224, the REAL section A of 0233 (extracted from the file; two level helpers stubbed), then the REAL 0361.
 * Every guarded call runs AS service_role through ONE helper (H9).
 *   H0 pre-flight refusals (each keeps nothing)      H5 refusals, constraint failures, U2
 *   H1 THE DECISION (hand-written table) + named     H6 catalog, EXECUTE, digest of everything else, default privileges
 *   H2 duplicates inside one payload                 H7 the header's rollback
 *   H3 order and replay                              H8 the control: main's unconditional upsert reopens a shift
 *   H4 the other writers (0233 link/unlink, main's   H9 the sums on every guarded call
 *      upsert, the sim seed's upsert)
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const M0224 = read("0224_toast_time_entries.sql");
const M0233 = read("0233_whos_here.sql");
const M0361 = read("0361_toast_time_entries_newer.sql");

// ── 0233 section A, extracted by its markers (fail loudly when an anchor is missing) ──────────────
const A_START = "create table public.toast_employee_links (";
const A_END = "-- ── B.";
const iStart = M0233.indexOf(A_START);
const iEnd = M0233.indexOf(A_END);
if (iStart < 0 || iEnd < 0 || iEnd <= iStart) throw new Error(`harness: 0233 section A anchors not found (start ${iStart}, end ${iEnd})`);
const SECTION_A = M0233.slice(iStart, iEnd);
for (const needle of [
  "create function public.toast_time_entry_link_user()",
  "create trigger toast_time_entries_link_user before insert or update on public.toast_time_entries",
  "create trigger toast_time_entries_link_lock before insert or update on public.toast_time_entries",
  "create function public.link_toast_employee(",
  "create function public.unlink_toast_employee(",
]) if (!SECTION_A.includes(needle)) throw new Error(`harness: 0233 section A extraction lacks: ${needle}`);
if (!SECTION_A.trimEnd().endsWith("end $$;")) throw new Error("harness: 0233 section A does not end with unlink_toast_employee's body");

/** Stubs of the two level helpers section A calls (0217 / 0228 role -> level mapping, synthetic users table). */
const LEVEL_STUBS = `
create function public.assignment_author_level(p_user_id uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select role into v_role from public.users where id = p_user_id;
  return case v_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8 when 'gm' then 7 when 'agm' then 6
    when 'shift_lead' then 5 when 'key_holder' then 4 when 'employee' then 3 else null end;
end $$;
create function public.assignment_user_level(p_user_id uuid, p_location_id uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer;
begin
  v_level := public.assignment_author_level(p_user_id);
  if v_level is null or not exists (select 1 from public.users where id = p_user_id and active) then raise exception 'assignee_unavailable'; end if;
  if v_level < 9 and not exists (select 1 from public.user_locations where user_id = p_user_id and location_id = p_location_id and active) then
    raise exception 'assignee_not_at_location';
  end if;
  return v_level;
end $$;`;

// BEGIN toastInstant replica (lib/toast/labor-shared.ts toastInstant; tests/toast-labor-0361-migration.test.ts holds it equal)
function toastInstant(x) {
  if (x == null || x === "") return null; if (typeof x !== "string") throw new Error("toast_labor_invalid_timestamp");
  const t = Date.parse(x.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")); if (!Number.isFinite(t)) throw new Error("toast_labor_invalid_timestamp");
  return new Date(t).toISOString();
}
// END toastInstant replica

// ── check helpers ───────────────────────────────────────────────────────────────────────────────
let failures = 0;
let checks = 0;
const byId = new Map();
const tally = (what) => { const id = what.split(" ")[0]; byId.set(id, (byId.get(id) ?? 0) + 1); };
const check = (ok, what) => { checks++; tally(what); if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
/** Counted like any check, printed only when it fails (the per-call H9 sums). */
const quiet = (ok, what) => { checks++; tally(what); if (!ok) { failures++; console.error(`FAIL ${what}`); } };
async function refuses(fn, needle, what) {
  try { await fn(); check(false, `${what} (no error; expected ${needle})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message} ${e.detail ?? ""}`; check(s.includes(needle), `${what} -> ${needle}${s.includes(needle) ? "" : ` (got: ${s})`}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const tick = () => new Promise((r) => setTimeout(r, 3));

// ── the base database ───────────────────────────────────────────────────────────────────────────
const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";

/**
 * The base is built ONCE (one initdb is the slow part of PGlite) and dumped at its three stages: the minimal tables,
 * + the REAL 0224, + the REAL 0233 section A. A fresh database is a copy of the stage it needs (cheap).
 */
let stages = null;
async function buildStages() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key default gen_random_uuid(), code text, active boolean not null default true);
    create table public.users (id uuid primary key default gen_random_uuid(), role text not null, active boolean not null default true);
    create table public.user_locations (user_id uuid not null references public.users(id), location_id uuid not null references public.locations(id),
      active boolean not null default true, primary key (user_id, location_id));
    insert into public.locations (id, code) values ('${L1}', 'S1'), ('${L2}', 'S2');`);
  const bare = await db.dumpDataDir("none");
  await db.exec(M0224);
  const with0224 = await db.dumpDataDir("none");
  await db.exec(`begin; ${LEVEL_STUBS}\n${SECTION_A}\ncommit;`);
  const with0233 = await db.dumpDataDir("none");
  await db.close();
  return { bare, with0224, with0233 };
}
async function base({ with0224 = true, with0233 = true, with0361 = false, beforeApply = null } = {}) {
  stages ??= await buildStages();
  const dir = !with0224 ? stages.bare : !with0233 ? stages.with0224 : stages.with0233;
  const db = new PGlite({ loadDataDir: dir });
  await db.exec("set timezone to 'UTC'");
  if (beforeApply) await db.exec(beforeApply);
  if (with0361) await db.exec(M0361);
  return db;
}

/** Everything in `public` (optionally except one function name): functions, relations, columns, triggers, policies,
 *  constraints, indexes, comments, default ACLs. */
const digest = async (db, exceptFn = "toast_time_entries_apply_newer") => one(db, `select
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || p.prosrc || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '')
     || '|' || p.prosecdef::text || p.provolatile::text || p.prokind::text || '|' || p.proowner::regrole::text || '|' || p.prorettype::regtype::text, '#' order by p.oid::regprocedure::text), ''))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> $1) as fns,
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> $1) as fn_count,
  (select md5(coalesce(string_agg(c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text || c.relforcerowsecurity::text, '|' order by c.relname), ''))
     from pg_class c where c.relnamespace = 'public'::regnamespace) as rels,
  (select md5(coalesce(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
     || coalesce(a.attacl::text, '') || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), '|' order by a.attrelid::regclass::text, a.attnum), ''))
     from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped) as cols,
  (select md5(coalesce(string_agg(t.tgrelid::regclass::text || '.' || t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':' || t.tgfoid::regprocedure::text,
     '|' order by t.tgrelid::regclass::text, t.tgname), ''))
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) as trgs,
  (select md5(coalesce(string_agg(p.tablename || '.' || p.policyname || ':' || p.permissive || ':' || p.roles::text || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
     '|' order by p.tablename, p.policyname), '')) from pg_policies p where p.schemaname = 'public') as pols,
  (select md5(coalesce(string_agg(n.conrelid::regclass::text || '.' || n.conname || ':' || pg_get_constraintdef(n.oid), '|' order by n.conrelid::regclass::text, n.conname), ''))
     from pg_constraint n where n.connamespace = 'public'::regnamespace) as cons,
  (select md5(coalesce(string_agg(pg_get_indexdef(i.indexrelid), '|' order by i.indexrelid::regclass::text), ''))
     from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace) as idx,
  (select md5(coalesce(string_agg(d.classoid::regclass::text || ':' || coalesce(c.relname, p.proname) || ':' || d.objsubid::text || ':' || d.description, '|'
     order by d.classoid::regclass::text, coalesce(c.relname, p.proname), d.objsubid), ''))
     from pg_description d left join pg_class c on d.classoid = 'pg_class'::regclass and c.oid = d.objoid and c.relnamespace = 'public'::regnamespace
     left join pg_proc p on d.classoid = 'pg_proc'::regclass and p.oid = d.objoid and p.pronamespace = 'public'::regnamespace
    where (c.oid is not null or (p.oid is not null and p.proname <> $1))) as comments,
  (select md5(coalesce(string_agg(coalesce(da.defaclacl::text, ''), '|' order by da.oid), '')) from pg_default_acl da) as defacl`, [exceptFn]);
const tableAcl = async (db) => (await one(db, "select coalesce(relacl::text, '(default)') as acl from pg_class where oid = 'public.toast_time_entries'::regclass")).acl;
const fnCount = async (db) => Number((await one(db, "select count(*) as n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'toast_time_entries_apply_newer'")).n);
const dataDigest = async (db) => (await one(db, `select count(*)::int as n, md5(coalesce(string_agg(t::text || '@' || t.xmin::text, '|' order by t.location_id, t.time_entry_guid), '')) as h
  from public.toast_time_entries t`));

// ── rows ────────────────────────────────────────────────────────────────────────────────────────
const COLS14 = ["location_id", "time_entry_guid", "business_date", "employee_guid", "employee_first_name", "job_guid", "job_name",
  "in_at", "out_at", "hours", "overtime_hours", "auto_clocked_out", "deleted", "source_modified_at"];
const TYPED14 = `location_id uuid, time_entry_guid text, business_date date, employee_guid text, employee_first_name text, job_guid text, job_name text,
  in_at timestamptz, out_at timestamptz, hours numeric, overtime_hours numeric, auto_clocked_out boolean, deleted boolean, source_modified_at timestamptz`;
const TEXT14 = COLS14.map((c) => `x.${c}::text as ${c}`).join(", ");

const BASE = {
  location_id: L1, business_date: "2026-11-01", employee_guid: "emp-testa", employee_first_name: "Testa", job_guid: "job-line", job_name: "Line",
  in_at: "2026-11-01T14:00:00.000Z", out_at: "2026-11-01T22:00:00.000Z", hours: 8, overtime_hours: 0, auto_clocked_out: false, deleted: false,
  source_modified_at: null,
};
const R = (guid, over = {}) => ({ ...BASE, time_entry_guid: guid, ...over });
const M1 = "2026-11-01T22:05:00.000Z";
const M2 = "2026-11-01T22:10:00.000Z";
const M3 = "2026-11-02T03:00:00.000Z";

/** The stored row, every column as text (+ xmin). */
const stored = async (db, loc, guid) => one(db, `select ${COLS14.map((c) => `x.${c}::text as ${c}`).join(", ")}, x.user_id::text as user_id, x.pulled_at::text as pulled_at,
  x.xmin::text as xmin from public.toast_time_entries x where x.location_id = $1 and x.time_entry_guid = $2`, [loc, guid]);
/** A payload element read the way Postgres types it (only the type parse; no decision logic). */
const canon = async (db, row) => one(db, `select ${TEXT14} from jsonb_to_record($1::jsonb) as x(${TYPED14})`, [JSON.stringify(row)]);

async function expectRow(db, label, want, { pulled, before = null, userId = null }) {
  const got = await stored(db, want.location_id, want.time_entry_guid);
  if (!got) { check(false, `${label}: the row is missing`); return; }
  const exp = await canon(db, want);
  const bad = [];
  for (const k of COLS14) if (got[k] !== exp[k]) bad.push(`${k}: ${got[k]} != ${exp[k]}`);
  if (got.user_id !== userId) bad.push(`user_id: ${got.user_id} != ${userId}`);
  if (pulled === "set" && !got.pulled_at) bad.push("pulled_at unset");
  if (pulled === "moved" && (!before || !(got.pulled_at > before.pulled_at))) bad.push(`pulled_at did not move (${before?.pulled_at} -> ${got.pulled_at})`);
  if (pulled === "kept" && (!before || got.pulled_at !== before.pulled_at || got.xmin !== before.xmin)) bad.push("the row was rewritten (pulled_at / xmin moved)");
  check(bad.length === 0, `${label}${bad.length ? ` [${bad.join("; ")}]` : ""}`);
}

// ── H9: the ONE helper every guarded call goes through ──────────────────────────────────────────
const KEYS = ["received", "inserted", "updated", "unchanged", "skipped_same_stamp", "skipped_older", "skipped_no_stamp", "duplicates"];
let guardedCalls = 0;
function h9(r, sent, label) {
  guardedCalls++;
  const keysOk = r !== null && typeof r === "object" && same(Object.keys(r).sort(), [...KEYS].sort());
  const intsOk = keysOk && KEYS.every((k) => Number.isInteger(r[k]) && r[k] >= 0);
  const sumOk = intsOk && r.received === sent && r.received === KEYS.slice(1).reduce((a, k) => a + r[k], 0);
  quiet(sumOk, `H9 sums (${label}): ${JSON.stringify(r)} for ${sent} sent`);
}
/** One guarded call AS service_role: begin; set local role service_role; select …; commit. */
async function call(db, rows, label, { raw } = {}) {
  await tick();
  const payload = raw !== undefined ? raw : JSON.stringify(rows);
  await db.exec("begin; set local role service_role;");
  let r;
  try {
    r = (await db.query("select public.toast_time_entries_apply_newer($1::jsonb) as r", [payload])).rows[0].r;
    await db.exec("commit");
  } catch (e) { await db.exec("rollback"); throw e; }
  h9(r, Array.isArray(rows) ? rows.length : JSON.parse(payload).length, label);
  return r;
}
const counts = (n, partial) => Object.fromEntries(KEYS.map((k) => [k, k === "received" ? n : (partial[k] ?? 0)]));
async function expectCall(db, rows, partial, label) {
  const r = await call(db, rows, label);
  check(same(Object.fromEntries(KEYS.map((k) => [k, r[k]])), counts(rows.length, partial)), `${label}: ${JSON.stringify(partial)}${same(Object.fromEntries(KEYS.map((k) => [k, r[k]])), counts(rows.length, partial)) ? "" : ` (got ${JSON.stringify(r)})`}`);
  return r;
}
/** A guarded call that must fail: refusal by name / code, and the table is exactly as it was. */
async function expectRefused(db, rows, needle, label, { raw } = {}) {
  const before = await dataDigest(db);
  await refuses(() => call(db, rows, label, { raw }), needle, label);
  check(same(await dataDigest(db), before), `${label}: nothing stored (the table is byte for byte as it was)`);
}

/** Main's unconditional statement (lib/toast/labor.ts: PostgREST upsert on (location_id, time_entry_guid), every sent column + pulled_at). */
async function mainUpsert(db, rows) {
  await db.exec("begin; set local role service_role;");
  try {
    await db.query(`insert into public.toast_time_entries (${COLS14.join(", ")}, pulled_at)
      select x.*, now() from jsonb_to_recordset($1::jsonb) as x(${TYPED14})
      on conflict (location_id, time_entry_guid) do update set ${[...COLS14, "pulled_at"].map((c) => `${c} = excluded.${c}`).join(", ")}`, [JSON.stringify(rows)]);
    await db.exec("commit");
  } catch (e) { await db.exec("rollback"); throw e; }
}
/** The sim seed's shape (scripts/sim/seed-scheduling.ts: upsert of EntryPlan's 13 keys; no stamp, no pulled_at). */
const SEED13 = COLS14.filter((c) => c !== "source_modified_at");
async function seedUpsert(db, rows) {
  await db.exec("begin; set local role service_role;");
  try {
    await db.query(`insert into public.toast_time_entries (${SEED13.join(", ")})
      select ${SEED13.map((c) => `x.${c}`).join(", ")} from jsonb_to_recordset($1::jsonb) as x(${TYPED14})
      on conflict (location_id, time_entry_guid) do update set ${SEED13.map((c) => `${c} = excluded.${c}`).join(", ")}`,
    [JSON.stringify(rows.map((r) => Object.fromEntries(SEED13.map((c) => [c, r[c]]))))]);
    await db.exec("commit");
  } catch (e) { await db.exec("rollback"); throw e; }
}

// ── H0 helper: apply 0361 to a database that must refuse it, prove it by name and that nothing was kept ──
async function refusedApply(label, needle, { opts = {}, drift = null } = {}) {
  const db = await base(opts);
  try {
    if (drift) await db.exec(drift);
    const before = await digest(db, "");
    const fnBefore = await fnCount(db);
    await refuses(() => db.exec(M0361), needle, label);
    await db.exec("rollback");
    check(same(await digest(db, ""), before) && (await fnCount(db)) === fnBefore, `${label}: nothing kept (function count ${fnBefore}, every object as it was)`);
  } finally { await db.close(); }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
let db;
let dbB;
try {
  // ── base sanity ───────────────────────────────────────────────────────────────────────────────
  {
    const b = await base();
    check((await one(b, "select rolbypassrls from pg_roles where rolname = 'service_role'")).rolbypassrls === true, "H0 (base) service_role has BYPASSRLS, as on Supabase");
    check((await one(b, "select current_user as u")).u === "postgres", "H0 (base) the migrations run as postgres");
    await b.close();
  }

  // ── H0 pre-flight ───────────────────────────────────────────────────────────────────────────
  await refusedApply("H0 no toast_time_entries", "0361: missing public.toast_time_entries (0224). Refusing.", { opts: { with0224: false } });
  await refusedApply("H0 a column missing (overtime_hours)", "0361: missing expected column toast_time_entries.overtime_hours (numeric). Refusing.",
    { drift: "alter table public.toast_time_entries drop column overtime_hours" });
  await refusedApply("H0 a column missing (pulled_at)", "0361: missing expected column toast_time_entries.pulled_at (timestamp with time zone). Refusing.",
    { drift: "alter table public.toast_time_entries drop column pulled_at" });
  await refusedApply("H0 a column of another type (time_entry_guid varchar)", "0361: missing expected column toast_time_entries.time_entry_guid (text). Refusing.",
    { drift: "alter table public.toast_time_entries alter column time_entry_guid type varchar(64)" });
  await refusedApply("H0 a column of another type (source_modified_at timestamp)", "0361: missing expected column toast_time_entries.source_modified_at (timestamp with time zone). Refusing.",
    { drift: "alter table public.toast_time_entries alter column source_modified_at type timestamp" });
  await refusedApply("H0 another primary key (reversed columns)", "0361: the primary key of toast_time_entries is not (location_id, time_entry_guid). Refusing.",
    { drift: "alter table public.toast_time_entries drop constraint toast_time_entries_pkey; alter table public.toast_time_entries add primary key (time_entry_guid, location_id)" });
  await refusedApply("H0 no primary key", "0361: the primary key of toast_time_entries is not (location_id, time_entry_guid). Refusing.",
    { drift: "alter table public.toast_time_entries drop constraint toast_time_entries_pkey" });
  await refusedApply("H0 0233 section A not applied (no triggers)", "0361: missing or disabled 0233 trigger toast_time_entries_link_user. Refusing.", { opts: { with0233: false } });
  await refusedApply("H0 the row trigger missing", "0361: missing or disabled 0233 trigger toast_time_entries_link_user. Refusing.",
    { drift: "drop trigger toast_time_entries_link_user on public.toast_time_entries" });
  await refusedApply("H0 the statement trigger missing", "0361: missing or disabled 0233 trigger toast_time_entries_link_lock. Refusing.",
    { drift: "drop trigger toast_time_entries_link_lock on public.toast_time_entries" });
  await refusedApply("H0 the statement trigger disabled", "0361: missing or disabled 0233 trigger toast_time_entries_link_lock. Refusing.",
    { drift: "alter table public.toast_time_entries disable trigger toast_time_entries_link_lock" });
  await refusedApply("H0 the row trigger set to fire on replica only", "0361: missing or disabled 0233 trigger toast_time_entries_link_user. Refusing.",
    { drift: "alter table public.toast_time_entries enable replica trigger toast_time_entries_link_user" });
  await refusedApply("H0 a second apply", "0361: already applied", { opts: { with0361: true } });
  await refusedApply("H0 another overload of the name exists", "0361: already applied",
    { drift: "create function public.toast_time_entries_apply_newer(p text) returns int language sql as 'select 1'" });

  // ── the main database: digest, apply, H6 catalog, H7 rollback ────────────────────────────────
  db = await base();
  const digestBefore = await digest(db);
  const aclBefore = await tableAcl(db);
  await db.exec(M0361);
  check((await fnCount(db)) === 1, "H6 0361 applied: exactly one function of that name");
  const digestAfter = await digest(db);
  check(same(digestAfter, digestBefore), "H6 every OTHER object in public (functions incl. bodies / ACLs / settings, relations + ACL + RLS, columns, triggers, policies, constraints, indexes, comments) is identical before and after 0361");
  check((await tableAcl(db)) === aclBefore, `H6 the table grants on toast_time_entries are unchanged (${aclBefore})`);
  check(!same(await digest(db, ""), await (async () => digestBefore)()), "H6 control: the digest WITH the new function differs (the digest can see a function)");

  const FN = "public.toast_time_entries_apply_newer(jsonb)";
  const cat = await one(db, `select p.prosecdef, p.provolatile::text as vol, p.prorettype::regtype::text as ret, p.proconfig, l.lanname, p.proowner::regrole::text as owner,
      p.proretset, p.proisstrict, p.prokind::text as kind, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = '${FN}'::regprocedure`);
  check(Number((await one(db, "select count(*) as n from pg_proc where proname = 'toast_time_entries_apply_newer'")).n) === 1, "H6 exactly one overload (any schema)");
  check(cat.prosecdef === false, "H6 SECURITY INVOKER");
  check(same(cat.proconfig, ["search_path=pg_catalog, public"]), `H6 proconfig is exactly the pinned search_path (${JSON.stringify(cat.proconfig)})`);
  check(cat.vol === "v", "H6 volatile");
  check(cat.lanname === "plpgsql", "H6 plpgsql");
  check(cat.ret === "jsonb" && cat.proretset === false && cat.kind === "f" && cat.args === "p_rows jsonb", "H6 returns jsonb (one row, a function, one jsonb argument)");
  check(cat.owner === "postgres", "H6 owned by postgres");
  const acl = (await one(db, `select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
      || case when a.is_grantable then '*' else '' end || '/' || a.grantor::regrole::text, ',' order by 1) as acl
    from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${FN}'::regprocedure`)).acl;
  check(acl === "postgres=EXECUTE/postgres,service_role=EXECUTE/postgres", `H6 the whole ACL is postgres + service_role (${acl})`);
  for (const role of ["public", "anon", "authenticated"]) {
    check((await one(db, `select has_function_privilege('${role}', '${FN}', 'execute') as ok`)).ok === false, `H6 ${role === "public" ? "PUBLIC" : role} cannot execute it (has_function_privilege)`);
  }
  check((await one(db, `select has_function_privilege('service_role', '${FN}', 'execute') as ok`)).ok === true, "H6 service_role can execute it (has_function_privilege)");

  // ── H7 the header's rollback ───────────────────────────────────────────────────────────────────
  {
    const rollback = "drop function public.toast_time_entries_apply_newer(jsonb);";
    check(M0361.includes(`For completeness: ${rollback}`), "H7 (setup) the header carries the rollback statement");
    await db.exec(`begin; ${rollback} commit;`);
    check((await fnCount(db)) === 0, "H7 the rollback removes the function");
    check(same(await digest(db, ""), await (async () => digestBefore)()) && same(await digest(db, ""), digestBefore), "H7 …and nothing else: the whole of public is as it was before 0361 (function count included)");
    await db.exec(M0361);
    check((await fnCount(db)) === 1 && same(await digest(db), digestBefore), "H7 0361 applies again after the rollback");
  }

  // ── H6 EXECUTE by actually calling ─────────────────────────────────────────────────────────────
  await db.exec("create function public.h0361_open() returns int language sql as 'select 1'; create role h0361_nobody; grant usage on schema public to h0361_nobody");
  for (const role of ["anon", "authenticated", "h0361_nobody"]) {
    const who = role === "h0361_nobody" ? "a role that belongs to nothing (PUBLIC)" : role;
    await db.exec(`set role ${role}`);
    try {
      check((await one(db, "select public.h0361_open() as v")).v === 1, `H6 control: ${who} can run an un-revoked function in the same schema`);
      await refuses(() => db.query("select public.toast_time_entries_apply_newer('[]'::jsonb)"), "42501", `H6 calling it as ${who} is permission denied`);
    } finally { await db.exec("reset role"); }
  }
  {
    const r = await call(db, [], "H6 service_role call");
    check(same(Object.fromEntries(KEYS.map((k) => [k, r[k]])), counts(0, {})), `H6 calling it as service_role answers (${JSON.stringify(r)})`);
  }
  await db.exec("drop function public.h0361_open(); revoke usage on schema public from h0361_nobody; drop role h0361_nobody");
  check(same(await digest(db), digestBefore), "H6 (cleanup) the probe objects are gone again");

  // ── H6 Supabase default privileges granted BEFORE 0361 ───────────────────────────────────────
  {
    const d = await base({ beforeApply: "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role" });
    try {
      await d.exec("create function public.h0361_ctl() returns int language sql as 'select 1'");
      check((await one(d, "select has_function_privilege('anon', 'public.h0361_ctl()', 'execute') as a, has_function_privilege('authenticated', 'public.h0361_ctl()', 'execute') as b")).a === true,
        "H6 (setup) with the default privileges a new function IS executable by anon");
      await d.exec("drop function public.h0361_ctl()");
      let applied = true;
      try { await d.exec(M0361); } catch (e) { applied = false; check(false, `H6 0361 applies under default privileges (got: ${e.message})`); await d.exec("rollback"); }
      if (applied) check(true, "H6 0361 applies under Supabase-like default privileges (its own ACL assertion passes)");
      const acl2 = (await one(d, `select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
          || case when a.is_grantable then '*' else '' end || '/' || a.grantor::regrole::text, ',' order by 1) as acl
        from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${FN}'::regprocedure`)).acl;
      check(acl2 === "postgres=EXECUTE/postgres,service_role=EXECUTE/postgres", `H6 under default privileges the ACL still ends as postgres + service_role only (${acl2})`);
    } finally { await d.close(); }
  }

  // ── H1 THE DECISION: the hand-written table ──────────────────────────────────────────────────
  // stored     incoming  content  -> expected key         the row afterwards
  const DECISION = `
    none       later     same      inserted              incoming
    none       later     toast     inserted              incoming
    none       later     name      inserted              incoming
    none       equal     same      inserted              incoming
    none       equal     toast     inserted              incoming
    none       equal     name      inserted              incoming
    none       earlier   same      inserted              incoming
    none       earlier   toast     inserted              incoming
    none       earlier   name      inserted              incoming
    none       none      same      inserted              incoming
    none       none      toast     inserted              incoming
    none       none      name      inserted              incoming
    stamped    later     same      updated               incoming
    stamped    later     toast     updated               incoming
    stamped    later     name      updated               incoming
    stamped    equal     same      unchanged             stored
    stamped    equal     toast     skipped_same_stamp    stored
    stamped    equal     name      unchanged             stored
    stamped    earlier   same      skipped_older         stored
    stamped    earlier   toast     skipped_older         stored
    stamped    earlier   name      skipped_older         stored
    stamped    none      same      skipped_no_stamp      stored
    stamped    none      toast     skipped_no_stamp      stored
    stamped    none      name      skipped_no_stamp      stored
    unstamped  later     same      updated               incoming
    unstamped  later     toast     updated               incoming
    unstamped  later     name      updated               incoming
    unstamped  equal     same      updated               incoming
    unstamped  equal     toast     updated               incoming
    unstamped  equal     name      updated               incoming
    unstamped  earlier   same      updated               incoming
    unstamped  earlier   toast     updated               incoming
    unstamped  earlier   name      updated               incoming
    unstamped  none      same      skipped_no_stamp      stored
    unstamped  none      toast     skipped_no_stamp      stored
    unstamped  none      name      skipped_no_stamp      stored
  `.trim().split("\n").map((l) => l.trim().split(/\s+/));
  check(DECISION.length === 36 && DECISION.every((c) => c.length === 5), "H1 (setup) the decision table has 36 cells of 5 fields");
  const STORED_STAMP = { stamped: M2, unstamped: null };
  const INCOMING_STAMP = { later: M3, equal: M2, earlier: M1, none: null };
  const CONTENT = {
    same: {},
    toast: { hours: 7.5, out_at: "2026-11-01T21:30:00.000Z" },
    name: { employee_first_name: "Mocko", job_name: "Prep" },
  };
  let cell = 0;
  for (const [st, inc, content, key, final] of DECISION) {
    const guid = `h1-${String(++cell).padStart(2, "0")}`;
    const label = `H1 cell ${st}/${inc}/${content}`;
    let seeded = null;
    let before = null;
    if (st !== "none") {
      seeded = R(guid, { source_modified_at: STORED_STAMP[st] });
      await expectCall(db, [seeded], { inserted: 1 }, `${label} (seed)`);
      before = await stored(db, L1, guid);
    }
    const incoming = R(guid, { ...CONTENT[content], source_modified_at: INCOMING_STAMP[inc] });
    await expectCall(db, [incoming], { [key]: 1 }, `${label} -> ${key}`);
    if (final === "incoming") await expectRow(db, `${label}: the stored row is the incoming one, every column`, incoming, st === "none" ? { pulled: "set" } : { pulled: "moved", before });
    else await expectRow(db, `${label}: the stored row stands, every column, pulled_at and xmin untouched`, seeded, { pulled: "kept", before });
  }

  // ── H1 named cases ──────────────────────────────────────────────────────────────────────────
  {
    const open = (g) => R(g, { out_at: null, hours: null, source_modified_at: M1 });
    const closed = (g) => R(g, { source_modified_at: M2 });
    await expectCall(db, [open("dr2-a")], { inserted: 1 }, "H1 D-R2 open then closed: open m1");
    await expectCall(db, [closed("dr2-a")], { updated: 1 }, "H1 D-R2 open then closed: closed m2");
    await expectRow(db, "H1 D-R2 open then closed: the shift ends CLOSED", closed("dr2-a"), { pulled: "set" });
    await expectCall(db, [closed("dr2-b")], { inserted: 1 }, "H1 D-R2 closed then open: closed m2");
    const b = await stored(db, L1, "dr2-b");
    await expectCall(db, [open("dr2-b")], { skipped_older: 1 }, "H1 D-R2 closed then open: the stale open m1");
    await expectRow(db, "H1 D-R2 closed then open: the shift ends CLOSED", closed("dr2-b"), { pulled: "kept", before: b });
  }
  {
    const live = (g) => R(g, { source_modified_at: M1 });
    const arch = (g) => R(g, { deleted: true, source_modified_at: M2 });
    await expectCall(db, [live("arc-a")], { inserted: 1 }, "H1 archive after live: live m1");
    await expectCall(db, [arch("arc-a")], { updated: 1 }, "H1 archive after live: archive m2");
    await expectRow(db, "H1 archive after live: the tombstone is stored", arch("arc-a"), { pulled: "set" });
    await expectCall(db, [arch("arc-b")], { inserted: 1 }, "H1 live after archive: archive m2");
    const b = await stored(db, L1, "arc-b");
    await expectCall(db, [live("arc-b")], { skipped_older: 1 }, "H1 live after archive: the stale live m1");
    await expectRow(db, "H1 live after archive: the tombstone stands", arch("arc-b"), { pulled: "kept", before: b });
    // Un-archive and re-open with a later stamp: applied.
    await expectCall(db, [arch("arc-c")], { inserted: 1 }, "H1 un-archive later: archive m2");
    const c = await stored(db, L1, "arc-c");
    const reopened = R("arc-c", { deleted: false, out_at: null, hours: null, source_modified_at: M3 });
    await expectCall(db, [reopened], { updated: 1 }, "H1 un-archive and re-open with a later stamp");
    await expectRow(db, "H1 un-archive later: the row is live and open again", reopened, { pulled: "moved", before: c });
    // Un-archive with the SAME stamp: skipped_same_stamp, the tombstone stands.
    await expectCall(db, [arch("arc-d")], { inserted: 1 }, "H1 un-archive same stamp: archive m2");
    const d = await stored(db, L1, "arc-d");
    await expectCall(db, [R("arc-d", { deleted: false, source_modified_at: M2 })], { skipped_same_stamp: 1 }, "H1 un-archive with the SAME stamp");
    await expectRow(db, "H1 un-archive same stamp: the tombstone stands", arch("arc-d"), { pulled: "kept", before: d });
  }
  {
    const first = R("clk-a", { source_modified_at: M2 });
    await expectCall(db, [first], { inserted: 1 }, "H1 corrected clock-out: stored m2");
    const b = await stored(db, L1, "clk-a");
    const later = R("clk-a", { out_at: "2026-11-01T22:30:00.000Z", hours: 8.5, source_modified_at: M3 });
    await expectCall(db, [later], { updated: 1 }, "H1 a corrected clock-out with a LATER stamp is applied");
    await expectRow(db, "H1 corrected clock-out later: stored", later, { pulled: "moved", before: b });
    const b2 = await stored(db, L1, "clk-a");
    await expectCall(db, [R("clk-a", { out_at: "2026-11-01T21:00:00.000Z", hours: 7, source_modified_at: M1 })], { skipped_older: 1 }, "H1 a corrected clock-out with an EARLIER stamp is skipped");
    await expectRow(db, "H1 corrected clock-out earlier: the later correction stands", later, { pulled: "kept", before: b2 });
  }
  {
    // U5, both orders.
    await expectCall(db, [R("mx-a", { hours: 6 })], { inserted: 1 }, "H1 U5 unstamped first");
    const a = await stored(db, L1, "mx-a");
    await expectCall(db, [R("mx-a", { source_modified_at: M1 })], { updated: 1 }, "H1 U5 stamped over unstamped = updated");
    await expectRow(db, "H1 U5 stamped over unstamped: the stamped row is stored", R("mx-a", { source_modified_at: M1 }), { pulled: "moved", before: a });
    await expectCall(db, [R("mx-b", { source_modified_at: M1 })], { inserted: 1 }, "H1 U5 stamped first");
    const b = await stored(db, L1, "mx-b");
    await expectCall(db, [R("mx-b", { hours: 6 })], { skipped_no_stamp: 1 }, "H1 U5 unstamped over stamped = skipped_no_stamp");
    await expectRow(db, "H1 U5 unstamped over stamped: the stamped row stands", R("mx-b", { source_modified_at: M1 }), { pulled: "kept", before: b });
    await expectCall(db, [R("mx-c", { hours: 6 })], { inserted: 1 }, "H1 U5 unstamped first (again)");
    const c = await stored(db, L1, "mx-c");
    await expectCall(db, [R("mx-c", { hours: 7 })], { skipped_no_stamp: 1 }, "H1 U5 unstamped over unstamped = skipped_no_stamp");
    await expectRow(db, "H1 U5 unstamped over unstamped: the first unstamped row stands", R("mx-c", { hours: 6 }), { pulled: "kept", before: c });
  }
  {
    await expectCall(db, [R("hrs-a", { source_modified_at: M2 })], { inserted: 1 }, "H1 hours changed under the same stamp: stored 8 h");
    const b = await stored(db, L1, "hrs-a");
    await expectCall(db, [R("hrs-a", { hours: 9.25, source_modified_at: M2 })], { skipped_same_stamp: 1 }, "H1 hours changed under the same stamp");
    await expectRow(db, "H1 hours changed under the same stamp: the stored hours stand", R("hrs-a", { source_modified_at: M2 }), { pulled: "kept", before: b });
    await expectCall(db, [R("nm-a", { source_modified_at: M2 })], { inserted: 1 }, "H1 replay with only a name changed: stored");
    const n = await stored(db, L1, "nm-a");
    await expectCall(db, [R("nm-a", { employee_first_name: "Mocko", source_modified_at: M2 })], { unchanged: 1 }, "H1 a replay with only a name changed");
    await expectRow(db, "H1 replay with only a name changed: the stored name stands", R("nm-a", { source_modified_at: M2 }), { pulled: "kept", before: n });
  }
  {
    const s123 = "2026-11-01T10:00:00.123Z";
    const s124 = "2026-11-01T10:00:00.124Z";
    await expectCall(db, [R("ms-a", { source_modified_at: s123 })], { inserted: 1 }, "H1 .123 stored");
    const a = await stored(db, L1, "ms-a");
    await expectCall(db, [R("ms-a", { hours: 7, source_modified_at: s124 })], { updated: 1 }, "H1 .124 over .123 is later");
    await expectRow(db, "H1 .124 over .123: stored", R("ms-a", { hours: 7, source_modified_at: s124 }), { pulled: "moved", before: a });
    await expectCall(db, [R("ms-b", { source_modified_at: s124 })], { inserted: 1 }, "H1 .124 stored");
    const b = await stored(db, L1, "ms-b");
    await expectCall(db, [R("ms-b", { hours: 7, source_modified_at: s123 })], { skipped_older: 1 }, "H1 .123 over .124 is older");
    await expectRow(db, "H1 .123 over .124: the .124 row stands", R("ms-b", { source_modified_at: s124 }), { pulled: "kept", before: b });
  }
  {
    // The REAL normalizer's output (replica of toastInstant, held equal to it by the vitest file).
    const rawA = "2026-11-01T10:00:00.123100+0000";
    const rawB = "2026-11-01T10:00:00.123900+0000";
    const nA = toastInstant(rawA);
    const nB = toastInstant(rawB);
    check(nA === "2026-11-01T10:00:00.123Z" && nB === nA, `H1 the normalizer turns ${rawA} and ${rawB} into the SAME instant (${nA}, ${nB})`);
    await expectCall(db, [R("nz-a", { source_modified_at: nA })], { inserted: 1 }, "H1 normalized .123100 stored");
    const a = await stored(db, L1, "nz-a");
    await expectCall(db, [R("nz-a", { hours: 7, source_modified_at: nB })], { skipped_same_stamp: 1 }, "H1 normalized .123900 over .123100 is an EQUAL stamp");
    await expectRow(db, "H1 normalized stamps equal: the stored row stands", R("nz-a", { source_modified_at: nA }), { pulled: "kept", before: a });
    // Observation (not a normalizer path): the raw microsecond strings, sent unnormalized, are ORDERED by Postgres.
    const fix = (s) => s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    await expectCall(db, [R("nz-b", { source_modified_at: fix(rawA) })], { inserted: 1 }, "H1 observation: raw .123100 stored");
    await expectCall(db, [R("nz-b", { hours: 7, source_modified_at: fix(rawB) })], { updated: 1 }, "H1 observation: raw .123900 over raw .123100 is LATER (microseconds kept when not normalized)");
  }

  // ── H2 duplicates ───────────────────────────────────────────────────────────────────────────
  {
    const v1 = (g) => R(g, { hours: 6, source_modified_at: M1 });
    const v2 = (g) => R(g, { hours: 7, source_modified_at: M2 });
    const v3 = (g) => R(g, { hours: 9, source_modified_at: M3 });
    await expectCall(db, [v3("d2-a"), v2("d2-a")], { inserted: 1, duplicates: 1 }, "H2 twice, later stamp first");
    await expectRow(db, "H2 twice, later stamp first: the later stamp wins", v3("d2-a"), { pulled: "set" });
    await expectCall(db, [v2("d2-b"), v3("d2-b")], { inserted: 1, duplicates: 1 }, "H2 twice, later stamp last");
    await expectRow(db, "H2 twice, later stamp last: the later stamp wins", v3("d2-b"), { pulled: "set" });
    const perms = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
    for (const p of perms) {
      const g = `d3-${p.join("")}`;
      const make = { 1: v1, 2: v2, 3: v3 };
      await expectCall(db, p.map((i) => make[i](g)), { inserted: 1, duplicates: 2 }, `H2 three times, order ${p.join("")}`);
      await expectRow(db, `H2 three times, order ${p.join("")}: the latest stamp wins whatever its position`, v3(g), { pulled: "set" });
    }
    await expectCall(db, [R("d3-st", { hours: 5, source_modified_at: M1 })], { inserted: 1 }, "H2 three times on a stored key: stored m1");
    const st = await stored(db, L1, "d3-st");
    await expectCall(db, [v1("d3-st"), v3("d3-st"), v2("d3-st")], { updated: 1, duplicates: 2 }, "H2 three times on a stored key");
    await expectRow(db, "H2 three times on a stored key: the latest stamp is stored", v3("d3-st"), { pulled: "moved", before: st });

    // Equal stamps: the LATER element wins.
    const nA = R("eq-n1", { employee_first_name: "Mocko-A", source_modified_at: M2 });
    const nB = R("eq-n1", { employee_first_name: "Mocko-B", source_modified_at: M2 });
    await expectCall(db, [nA, nB], { inserted: 1, duplicates: 1 }, "H2 equal stamps, differing name, absent key (A, B)");
    await expectRow(db, "H2 equal stamps (A, B): the LATER element's name is stored", nB, { pulled: "set" });
    await expectCall(db, [{ ...nB, time_entry_guid: "eq-n2" }, { ...nA, time_entry_guid: "eq-n2" }], { inserted: 1, duplicates: 1 }, "H2 equal stamps, differing name, absent key (B, A)");
    await expectRow(db, "H2 equal stamps (B, A): the LATER element's name is stored", { ...nA, time_entry_guid: "eq-n2" }, { pulled: "set" });
    const cA = R("eq-c1", { hours: 7, source_modified_at: M2 });
    const cB = R("eq-c1", { hours: 9, out_at: "2026-11-01T23:00:00.000Z", source_modified_at: M2 });
    await expectCall(db, [cA, cB], { inserted: 1, duplicates: 1 }, "H2 equal stamps, differing content, absent key (A, B)");
    await expectRow(db, "H2 equal stamps, differing content (A, B): the LATER element is stored", cB, { pulled: "set" });
    await expectCall(db, [{ ...cB, time_entry_guid: "eq-c2" }, { ...cA, time_entry_guid: "eq-c2" }], { inserted: 1, duplicates: 1 }, "H2 equal stamps, differing content, absent key (B, A)");
    await expectRow(db, "H2 equal stamps, differing content (B, A): the LATER element is stored", { ...cA, time_entry_guid: "eq-c2" }, { pulled: "set" });
    // On a STORED key the chosen element shows in the classification.
    await expectCall(db, [R("eq-s", { source_modified_at: M2 })], { inserted: 1 }, "H2 equal stamps on a stored key: stored 8 h m2");
    const es = await stored(db, L1, "eq-s");
    await expectCall(db, [R("eq-s", { hours: 9, source_modified_at: M2 }), R("eq-s", { source_modified_at: M2 })], { unchanged: 1, duplicates: 1 },
      "H2 equal stamps on a stored key, the stored content LAST -> unchanged (the later element was chosen)");
    await expectCall(db, [R("eq-s", { source_modified_at: M2 }), R("eq-s", { hours: 9, source_modified_at: M2 })], { skipped_same_stamp: 1, duplicates: 1 },
      "H2 equal stamps on a stored key, the differing content LAST -> skipped_same_stamp (the later element was chosen)");
    await expectRow(db, "H2 equal stamps on a stored key: nothing written", R("eq-s", { source_modified_at: M2 }), { pulled: "kept", before: es });

    // Stamped beats unstamped, whatever the position; two unstamped: the later.
    await expectCall(db, [R("su-a", { hours: 7, source_modified_at: M1 }), R("su-a", { hours: 9 })], { inserted: 1, duplicates: 1 }, "H2 stamped then unstamped");
    await expectRow(db, "H2 stamped then unstamped: the stamped element is stored", R("su-a", { hours: 7, source_modified_at: M1 }), { pulled: "set" });
    await expectCall(db, [R("su-b", { hours: 9 }), R("su-b", { hours: 7, source_modified_at: M1 })], { inserted: 1, duplicates: 1 }, "H2 unstamped then stamped");
    await expectRow(db, "H2 unstamped then stamped: the stamped element is stored", R("su-b", { hours: 7, source_modified_at: M1 }), { pulled: "set" });
    await expectCall(db, [R("su-c", { hours: 7 }), R("su-c", { hours: 9 })], { inserted: 1, duplicates: 1 }, "H2 two unstamped");
    await expectRow(db, "H2 two unstamped: the later element is stored", R("su-c", { hours: 9 }), { pulled: "set" });

    // The same duplicate-carrying payload twice in a row.
    const P = [v3("dd-a"), v2("dd-a")];
    await expectCall(db, P, { inserted: 1, duplicates: 1 }, "H2 a duplicate-carrying payload, first call");
    const dd = await stored(db, L1, "dd-a");
    await expectCall(db, P, { unchanged: 1, duplicates: 1 }, "H2 the same payload again: unchanged + duplicates, never an error");
    await expectRow(db, "H2 the same payload again: nothing written", v3("dd-a"), { pulled: "kept", before: dd });
  }

  // ── H3 order and replay ─────────────────────────────────────────────────────────────────────
  {
    const SEED = [
      R("h3-a", { source_modified_at: M2 }),
      R("h3-b", { source_modified_at: M2 }),
      R("h3-c", { location_id: L2 }),
      R("h3-d", { location_id: L2, source_modified_at: M2 }),
    ];
    const P = [
      R("h3-a", { hours: 9, source_modified_at: M3 }),             // updated (wins its duplicate)
      R("h3-a", { hours: 6, source_modified_at: M1 }),             // duplicate
      R("h3-b", { hours: 6, source_modified_at: M1 }),             // skipped_older
      R("h3-c", { location_id: L2, hours: 5, source_modified_at: M1 }), // updated (stamped over unstamped)
      R("h3-d", { location_id: L2, hours: 7, source_modified_at: M2 }), // skipped_same_stamp
      R("h3-E", { employee_first_name: "Mocko", source_modified_at: M2 }), // inserted (wins its duplicate)
      R("h3-E", { hours: 4 }),                                       // duplicate
      R("h3-f", { location_id: L2, hours: 3 }),                      // inserted (unstamped)
    ];
    const FIRST = { inserted: 2, updated: 2, skipped_older: 1, skipped_same_stamp: 1, duplicates: 2 };
    const REPLAY = { unchanged: 3, skipped_older: 1, skipped_same_stamp: 1, skipped_no_stamp: 1, duplicates: 2 };
    dbB = await base({ with0361: true });
    await expectCall(db, SEED, { inserted: 4 }, "H3 seed (A)");
    await expectCall(dbB, SEED, { inserted: 4 }, "H3 seed (B)");
    const seedA = new Map();
    for (const s of SEED) seedA.set(s.time_entry_guid, await stored(db, s.location_id, s.time_entry_guid));
    const seedB = new Map();
    for (const s of SEED) seedB.set(s.time_entry_guid, await stored(dbB, s.location_id, s.time_entry_guid));
    const rA = await expectCall(db, P, FIRST, "H3 the payload (A, in order)");
    const rB = await expectCall(dbB, [...P].reverse(), FIRST, "H3 the same payload reversed (B)");
    check(same(rA, rB), "H3 the two orders give identical counts");
    const keysOf = [...new Map(P.map((p) => [p.time_entry_guid, p.location_id])).entries()];
    const rows = async (d, seeds) => {
      const out = [];
      for (const [g, loc] of keysOf) {
        const s = await stored(d, loc, g);
        const before = seeds.get(g);
        out.push({ ...s, pulled_at: undefined, xmin: undefined, moved: before ? s.pulled_at !== before.pulled_at : "new" });
      }
      return out;
    };
    const rowsA = await rows(db, seedA);
    const rowsB = await rows(dbB, seedB);
    check(same(rowsA, rowsB), "H3 the two orders give identical rows (every column but the pulled_at instant; which rows moved is identical too)");
    const winners = [P[0], SEED[1], P[3], SEED[3], P[5], P[7]];
    let allOk = true;
    for (const w of winners) {
      const got = await stored(db, w.location_id, w.time_entry_guid);
      const exp = await canon(db, w);
      if (!COLS14.every((k) => got[k] === exp[k])) allOk = false;
    }
    check(allOk, "H3 the stored rows are the hand-picked winners (a: m3, b: seed, c: m1, d: seed, E: stamped, f: unstamped)");
    const snap = new Map();
    for (const [g, loc] of keysOf) snap.set(g, await stored(db, loc, g));
    await expectCall(db, P, REPLAY, "H3 a replay of the whole payload counts each element by its own case (older + newer of one key = duplicates + unchanged)");
    let untouched = true;
    for (const [g, loc] of keysOf) {
      const s = await stored(db, loc, g);
      const b = snap.get(g);
      if (s.xmin !== b.xmin || s.pulled_at !== b.pulled_at) untouched = false;
    }
    check(untouched, "H3 the replay wrote nothing: every row's xmin AND pulled_at unchanged");
  }

  // ── H4 the other writers ────────────────────────────────────────────────────────────────────
  {
    const gm = (await one(db, "insert into public.users (role) values ('gm') returning id::text as id")).id;
    const crew = (await one(db, "insert into public.users (role) values ('employee') returning id::text as id")).id;
    await db.query("insert into public.user_locations (user_id, location_id) values ($1, $3), ($2, $3)", [gm, crew, L1]);
    const E = "emp-h4";
    const row = (g, over = {}) => R(g, { employee_guid: E, ...over });
    await expectCall(db, [row("h4-a", { source_modified_at: M1 })], { inserted: 1 }, "H4 before the link: inserted");
    await expectRow(db, "H4 before the link: user_id null", row("h4-a", { source_modified_at: M1 }), { pulled: "set", userId: null });
    // The link (0233's real function, as service_role).
    await db.exec("begin; set local role service_role;");
    const link = (await db.query("select public.link_toast_employee($1, $2, $3, $4, 'manual') as r", [gm, L1, E, crew])).rows[0].r;
    await db.exec("commit");
    check(link.changed === true && link.backfilled === 1, `H4 link_toast_employee links and backfills the one stored row (${JSON.stringify(link)})`);
    await expectRow(db, "H4 the link backfilled user_id", row("h4-a", { source_modified_at: M1 }), { pulled: "set", userId: crew });
    await expectCall(db, [row("h4-b", { source_modified_at: M1 })], { inserted: 1 }, "H4 a row the function INSERTS");
    await expectRow(db, "H4 user_id is filled by 0233's row trigger on a row the function inserts", row("h4-b", { source_modified_at: M1 }), { pulled: "set", userId: crew });
    const b = await stored(db, L1, "h4-b");
    await expectCall(db, [row("h4-b", { hours: 7, source_modified_at: M2 })], { updated: 1 }, "H4 a case-2 update");
    await expectRow(db, "H4 user_id is kept by a case-2 update", row("h4-b", { hours: 7, source_modified_at: M2 }), { pulled: "moved", before: b, userId: crew });
    // Main's direct upsert and the sim seed's shape, after 0361, with the link active.
    const main = row("h4-main", { source_modified_at: M1 });
    await mainUpsert(db, [main]);
    await mainUpsert(db, [{ ...main, hours: 6.5 }]);
    await expectRow(db, "H4 main's direct upsert still writes and re-runs after 0361 (and the link trigger fills user_id)", { ...main, hours: 6.5 }, { pulled: "set", userId: crew });
    const seedRow = row("h4-seed", { source_modified_at: null });
    await seedUpsert(db, [seedRow]);
    await seedUpsert(db, [{ ...seedRow, hours: 5 }]);
    await expectRow(db, "H4 the sim seed's upsert shape still writes and re-runs after 0361", { ...seedRow, hours: 5 }, { pulled: "set", userId: crew });
    // The unlink.
    await db.exec("begin; set local role service_role;");
    const unlink = (await db.query("select public.unlink_toast_employee($1, $2, $3) as r", [gm, L1, link.id])).rows[0].r;
    await db.exec("commit");
    check(unlink.changed === true && unlink.cleared === 4, `H4 unlink_toast_employee clears every row of that employee (${JSON.stringify(unlink)})`);
    await expectRow(db, "H4 user_id is cleared by the unlink", row("h4-b", { hours: 7, source_modified_at: M2 }), { pulled: "set", userId: null });
    const b2 = await stored(db, L1, "h4-b");
    await expectCall(db, [row("h4-b", { hours: 7.5, source_modified_at: M3 })], { updated: 1 }, "H4 a case-2 update after the unlink");
    await expectRow(db, "H4 after the unlink a case-2 update leaves user_id null", row("h4-b", { hours: 7.5, source_modified_at: M3 }), { pulled: "moved", before: b2, userId: null });
    // An element that carries user_id and pulled_at: neither is read.
    await expectCall(db, [{ ...row("h4-c", { source_modified_at: M1 }), user_id: crew, pulled_at: "2000-01-01T00:00:00Z" }], { inserted: 1 }, "H4 an element carrying user_id and pulled_at");
    const c = await stored(db, L1, "h4-c");
    check(c.user_id === null && !c.pulled_at.startsWith("2000-"), `H4 the function reads neither user_id nor pulled_at from a payload (user_id ${c.user_id}, pulled_at ${c.pulled_at})`);
    const src = (await one(db, `select prosrc from pg_proc where oid = '${FN}'::regprocedure`)).prosrc;
    check(!/user_id/i.test(src), "H4 the function body (pg_proc.prosrc) never names user_id");
    check(!/\bpulled_at\b\s*=\s*r\./.test(src) && /pulled_at = clock_timestamp\(\)/.test(src), "H4 the function sets pulled_at only to clock_timestamp() (never from the payload)");
  }

  // ── H5 refusals and U2 ──────────────────────────────────────────────────────────────────────
  {
    const sql = async (label, payloadSql) => {
      const before = await dataDigest(db);
      await refuses(async () => {
        await db.exec("begin; set local role service_role;");
        try { await db.query(`select public.toast_time_entries_apply_newer(${payloadSql})`); await db.exec("commit"); }
        catch (e) { await db.exec("rollback"); throw e; }
      }, "toast_labor_invalid_payload", label);
      check(same(await dataDigest(db), before), `${label}: nothing stored`);
    };
    await sql("H5 a SQL NULL payload", "null::jsonb");
    await sql("H5 a JSON null payload", "'null'::jsonb");
    await sql("H5 an object payload", `'${JSON.stringify(R("inv-o"))}'::jsonb`);
    await sql("H5 a string payload", `'"x"'::jsonb`);
    await sql("H5 a number payload", "'5'::jsonb");
    await sql("H5 an element that is not an object (a number)", `'[${JSON.stringify(R("inv-a"))}, 1]'::jsonb`);
    await sql("H5 an element that is not an object (an array)", `'[[${JSON.stringify(R("inv-b"))}]]'::jsonb`);
    const { location_id: _l, ...noLoc } = R("inv-c");
    const { time_entry_guid: _g, ...noGuid } = R("inv-d");
    await expectRefused(db, [R("inv-c0"), noLoc], "toast_labor_invalid_payload", "H5 an element without location_id");
    await expectRefused(db, [R("inv-d0"), noGuid], "toast_labor_invalid_payload", "H5 an element without time_entry_guid");
    await expectRefused(db, [R("inv-e", { location_id: "" })], "toast_labor_invalid_payload", "H5 an element with an empty location_id");
    await expectRefused(db, [R("", {})], "toast_labor_invalid_payload", "H5 an element with an empty time_entry_guid");
    await expectRefused(db, [R("inv-f", { location_id: null })], "toast_labor_invalid_payload", "H5 an element with a JSON null location_id");

    // A row CHOSEN for writing that breaks a table constraint, with valid rows around it in the same payload. What these
    // checks prove is ATOMICITY: the call is one statement, so no row of it is kept whatever order the walk takes. They
    // do NOT prove the walk's order (fix round, review GLM P3): the lock-order proof is the two-session script on the
    // sim (scripts/sim/toast-labor-0361-two-sessions.mjs, cases 8a / 8b / 9), which a single-session harness cannot give.
    const absent = (p) => [R(`${p}-a`, { source_modified_at: M1 }), R(`${p}-c`, { source_modified_at: M1 })];
    const mid = (p, bad) => { const [a, c] = absent(p); return [c, bad, a]; };
    await expectRefused(db, mid("c49", R("c49-b", { hours: 49, source_modified_at: M1 })), "23514", "H5 hours 49 on an absent key, mid-payload: the whole call fails");
    check(!(await stored(db, L1, "c49-a")), "H5 hours 49: the row walked before it (c49-a) was NOT kept");
    await expectRefused(db, mid("cio", R("cio-b", { out_at: "2026-11-01T13:00:00.000Z", source_modified_at: M1 })), "23514", "H5 out_at before in_at on an absent key, mid-payload");
    check(!(await stored(db, L1, "cio-a")), "H5 out_at before in_at: the row walked before it was NOT kept");
    await expectCall(db, [R("cup-b", { source_modified_at: M1 })], { inserted: 1 }, "H5 case-2 hours 49: the stored row");
    const cupB = await stored(db, L1, "cup-b");
    await expectRefused(db, mid("cup", R("cup-b", { hours: 49, source_modified_at: M2 })), "23514", "H5 a case-2 update with hours 49, mid-payload");
    check(!(await stored(db, L1, "cup-a")), "H5 case-2 hours 49: the row walked before it was NOT kept");
    await expectRow(db, "H5 case-2 hours 49: the stored row is untouched", R("cup-b", { source_modified_at: M1 }), { pulled: "kept", before: cupB });
    const { employee_guid: _e, ...noEmp } = R("cnn-b", { source_modified_at: M1 });
    await expectRefused(db, mid("cnn", noEmp), "23502", "H5 no employee_guid (NOT NULL) on an absent key, mid-payload");
    check(!(await stored(db, L1, "cnn-a")), "H5 no employee_guid: the row walked before it was NOT kept");

    // U2, the binding case: a stale version of K1 with hours 49 + a valid later update of K2.
    await expectCall(db, [R("u2-k1", { source_modified_at: M2 }), R("u2-k2", { source_modified_at: M1 })], { inserted: 2 }, "H5 U2 stored K1 at m2 and K2 at m1");
    const k1 = await stored(db, L1, "u2-k1");
    const k2 = await stored(db, L1, "u2-k2");
    const k2new = R("u2-k2", { hours: 7, source_modified_at: M3 });
    await expectCall(db, [R("u2-k1", { hours: 49, source_modified_at: M1 }), k2new], { skipped_older: 1, updated: 1 },
      "H5 U2 a stale K1 with hours 49 + a valid later K2: the call SUCCEEDS");
    await expectRow(db, "H5 U2 K1 untouched", R("u2-k1", { source_modified_at: M2 }), { pulled: "kept", before: k1 });
    await expectRow(db, "H5 U2 K2 written", k2new, { pulled: "moved", before: k2 });
    const k1b = await stored(db, L1, "u2-k1");
    await expectCall(db, [R("u2-k1", { job_name: "J".repeat(121), employee_first_name: "N".repeat(61), source_modified_at: M2 })], { unchanged: 1 },
      "H5 U2 an equal-stamp replay of K1 with a 121-char job_name and a 61-char first name -> unchanged");
    await expectCall(db, [R("u2-k1", { hours: 49 })], { skipped_no_stamp: 1 }, "H5 U2 an unstamped row with hours 49 over a stored row -> skipped_no_stamp");
    await expectCall(db, [R("u2-k1", { hours: 49, source_modified_at: M2 })], { skipped_same_stamp: 1 }, "H5 U2 an equal-stamp row with hours 49 where stored hours are 8 -> skipped_same_stamp");
    await expectRow(db, "H5 U2 K1 still untouched after the three skips", R("u2-k1", { source_modified_at: M2 }), { pulled: "kept", before: k1b });
  }

  // ── H8 the control ──────────────────────────────────────────────────────────────────────────
  {
    const open = (g) => R(g, { out_at: null, hours: null, source_modified_at: M1 });
    const closed = (g) => R(g, { source_modified_at: M2 });
    await mainUpsert(db, [closed("h8-main")]);
    await mainUpsert(db, [open("h8-main")]);
    const m = await stored(db, L1, "h8-main");
    check(m.out_at === null && m.source_modified_at === (await canon(db, open("h8-main"))).source_modified_at,
      "H8 main's unconditional upsert, the older write LAST, leaves the shift OPEN (the bug, shown)");
    await expectCall(db, [closed("h8-fn")], { inserted: 1 }, "H8 the function: closed m2");
    await expectCall(db, [open("h8-fn")], { skipped_older: 1 }, "H8 the function: the older open m1 LAST");
    await expectRow(db, "H8 the function on the same fixture and order leaves the shift CLOSED", closed("h8-fn"), { pulled: "set" });
  }

  check(guardedCalls > 0, `H9 every guarded call (${guardedCalls}) went through the one helper and returned eight non-negative integers, received = sent = the sum of the other seven`);
} catch (e) {
  failures++;
  console.error(`FAIL 0361 harness: ${e.stack ?? e}`);
} finally {
  if (db) await db.close();
  if (dbB) await dbB.close();
}
console.log(`checks by id: ${[...byId].sort().map(([k, v]) => `${k}=${v}`).join(" ")}`);
if (failures) { console.error(`FAIL 0361 harness: ${checks} checks, ${failures} failures`); process.exitCode = 1; }
else console.log(`PASS 0361 harness: ${checks} checks, 0 failures (single-session PGlite, the REAL 0224 + 0233 section A + 0361)`);
