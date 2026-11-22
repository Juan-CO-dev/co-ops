/**
 * Offline proof of migration 0354_schedule_early_open_mode (PR SCH-2, plan r5 sections 6, 9, 17, 20.6, 20.7) — SYNTHETIC
 * ROWS ONLY, PGlite in memory. Never touches a real database; CC owns the sim / prod gate.
 *
 *   node scripts/sql-harness-0354.mjs
 *
 * The chain: tests/fixtures/scheduling-pglite-stub.sql (the Supabase roles and their default privileges), the real level
 * helpers (0217 / 0228 / 0233, extracted), the REAL 0270, the 0272 posture, the REAL 0274 (schedule_structures, its table
 * CHECK and save_schedule_structure), then 0346's valid_schedule_structure (extracted verbatim, as
 * tests/labor-burden-0346-migration.test.ts does: 0346's own file needs the labor parents), then the REAL 0354. Nav PR 6's
 * 0353 is NOT in the chain: 0354 does not depend on it.
 *
 *   S0  the pre-flight: refused on 0274's validator (0346 missing), on a drifted 0346 body, and on a second apply
 *   S1  BEFORE the apply (the readiness gate's SQL backstop): the sentinel is "function not found" (42883, what the app
 *       reads as not ready), and no structure carrying catering.earlyOpenMode can be stored: the function, the table
 *       CHECK and save_schedule_structure all refuse every early-open case that carries the key
 *   S2  the apply: the sentinel answers {early_open_mode} to service_role only; stable; search_path pinned; the verify
 *       queries; the live body's md5 is the file's
 *   S3  THREE case lists against the function AND the table CHECK: the shared file (0274's), the crew list (0283) and the
 *       versioned early-open list (0354, earlyOpenStructureCases); the writer stores a mode
 *   S4  identity: every structure WITHOUT the key is judged by 0354 exactly as by 0346 (every list, both validators)
 *   S5  the rollback property (plan section 17): a live head saved WITHOUT the key after one with a mode is valid under
 *       0346's validator (the TS twin an older deployment runs), the historical row with the mode is not, so the
 *       migration is KEPT (re-installing 0346's body would leave a stored row the validator refuses)
 *   S6  broken variants, each printed as EXPECTED FAIL: no value check; no exact-keys change; a sentinel open to
 *       `authenticated` (the ceiling refuses its own apply)
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { crewStructureCases, earlyOpenStructureCases, loadStructureCases, materializeStructureCase } from "./schedule-structure-cases.mjs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0270 = read("supabase/migrations/0270_people_layer.sql");
const M0274 = read("supabase/migrations/0274_schedule_settings.sql");
const M0346 = read("supabase/migrations/0346_labor_burden_follow_company.sql");
const M0354 = read("supabase/migrations/0354_schedule_early_open_mode.sql");
function extract(sql, start, end = "end $$;") {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start} not found`);
  return sql.slice(i, sql.indexOf(end, i) + end.length);
}
const HELPERS = [
  extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
  extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
  extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
].join("\n");
const LOCKDOWN_0272 = "revoke insert, update, delete, truncate on public.locations, public.user_locations from anon, authenticated;";
const V0346 = extract(M0346, "create or replace function public.valid_schedule_structure(");
const V0354 = extract(M0354, "create or replace function public.valid_schedule_structure(");
const ACL = "revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated; grant execute on function public.valid_schedule_structure(jsonb) to service_role;";

let checks = 0, failures = 0;
const check = (ok, what) => { checks++; if (ok) console.log(`ok   ${what}`); else { failures++; console.error(`FAIL ${what}`); } };
async function attempt(db, sql, params) {
  try { await (params ? db.query(sql, params) : db.exec(sql)); return { ok: true }; }
  catch (e) { if (db.isInTransaction()) await db.exec("rollback"); return { ok: false, code: e.code ?? "", message: e.message }; }
}

/** The chain up to `to`: "0274" (0274's own validator) or "0346" (0346's validator over 0274's table). */
async function chain(to = "0346", validator = V0346) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(HELPERS);
  await db.exec(M0270);
  await db.exec(LOCKDOWN_0272);
  await db.exec(M0274);
  if (to === "0346") { await db.exec(validator); await db.exec(ACL); }
  const shop = (await db.query("insert into public.locations (name) values ('Shop') returning id")).rows[0].id;
  const moo = (await db.query("insert into public.users (name, role) values ('MoO', 'moo') returning id")).rows[0].id;
  return { db, shop, moo };
}
const judge = async (db, v) => (await db.query("select public.valid_schedule_structure($1::jsonb) ok", [JSON.stringify(v)])).rows[0].ok;
/** The table CHECK, inside a rolled-back transaction: true = stored, false = check_violation. */
async function stores(c, v) {
  await c.db.exec("begin");
  let r;
  try { await c.db.query("insert into public.schedule_structures (location_id, structure, created_by) values ($1, $2::jsonb, $3)", [c.shop, JSON.stringify(v), c.moo]); r = true; }
  catch (e) { r = e.code === "23514" ? false : `error ${e.code} ${e.message}`; }
  await c.db.exec("rollback");
  return r;
}
async function save(c, v) {
  const live = (await c.db.query("select id from public.schedule_structures where location_id = $1 order by created_at desc, id desc limit 1", [c.shop])).rows[0]?.id ?? null;
  await c.db.exec("set role service_role");
  try {
    const r = (await c.db.query("select public.save_schedule_structure(p_actor => $1, p_location => $2, p_expected => $3, p_structure => $4::jsonb) r",
      [c.moo, c.shop, live, JSON.stringify(v)])).rows[0].r;
    return { ok: true, id: r.after_id };
  } catch (e) { return { ok: false, message: e.message }; }
  finally { await c.db.exec("reset role"); }
}

const LISTS = {
  shared: loadStructureCases().map((c) => ({ name: c.name, value: materializeStructureCase(c), valid: c.valid })),
  crew: crewStructureCases().map((c) => ({ name: c.name, value: c.value, valid: c.key === null })),
  early: earlyOpenStructureCases().map((c) => ({ name: c.name, value: c.value, valid: c.key === null })),
};
const carries = (v) => !!v && typeof v === "object" && v.catering && typeof v.catering === "object" && Object.hasOwn(v.catering, "earlyOpenMode");
/** The defaults-shaped structure (no positions) the writer can store without a station fixture. */
const writable = (mode) => {
  const v = structuredClone(LISTS.crew.find((c) => c.name === "new defaults").value);
  if (mode !== undefined) v.catering.earlyOpenMode = mode;
  return v;
};

/** Every case of a list against one chain: { fn, check } agreement counts with `want(case)`. */
async function agree(c, list, want) {
  let fn = 0, chk = 0;
  const bad = [];
  for (const k of list) {
    const w = want(k);
    if ((await judge(c.db, k.value)) === w) fn++; else bad.push(`fn:${k.name}`);
    if ((await stores(c, k.value)) === w) chk++; else bad.push(`check:${k.name}`);
  }
  return { fn, chk, bad };
}

try {
  // S0 — the pre-flight
  {
    const c = await chain("0274");
    const r = await attempt(c.db, M0354);
    check(!r.ok && r.message.includes("0354: 0346 must be applied first"), "S0 refused on 0274's validator (0346 missing)");
    await c.db.close();
    const d = await chain("0346", V0346.replace("  return true;\nend $$;", () => "  return true; -- a later definer\nend $$;"));
    const r2 = await attempt(d.db, M0354);
    check(!r2.ok && r2.message.includes("is not its 0346 definition"), "S0 refused on a drifted 0346 body (a later definer would be lost)");
    await d.db.close();
  }

  const c = await chain("0346");
  const before = await chain("0346"); // stays at 0346: the reference every identity check compares with
  const stored = (await c.db.query("insert into public.schedule_structures (location_id, structure, created_by) values ($1, $2::jsonb, $3) returning id",
    [c.shop, JSON.stringify(writable()), c.moo])).rows[0].id;

  // S1 — before the apply: no mode can be stored, and the sentinel is missing
  {
    const r = await attempt(c.db, "select public.schedule_structure_features()");
    check(!r.ok && r.code === "42883", `S1 before the apply the sentinel is "function not found" (42883): the app reads not ready (got ${r.code})`);
    const keyed = LISTS.early.filter((k) => carries(k.value));
    let fn = 0, chk = 0;
    for (const k of keyed) { if ((await judge(c.db, k.value)) === false) fn++; if ((await stores(c, k.value)) === false) chk++; }
    check(fn === keyed.length && chk === keyed.length, `S1 before the apply 0346 refuses all ${keyed.length} structures carrying catering.earlyOpenMode (function and table CHECK), the valid modes included`);
    const w = await save(c, writable("semi"));
    check(!w.ok && w.message.includes("structure_invalid"), "S1 before the apply save_schedule_structure refuses a mode: structure_invalid");
    check((await c.db.query("select count(*)::int n from public.schedule_structures")).rows[0].n === 1, "S1 nothing was written");
  }

  // S2 — the apply
  {
    const r = await attempt(c.db, M0354);
    check(r.ok, `S2 0354 applies on 0346 (no 0353 in the chain)${r.ok ? "" : `: ${r.message}`}`);
    const f = (await c.db.query("select public.schedule_structure_features() f")).rows[0].f;
    check(JSON.stringify(f) === JSON.stringify(["early_open_mode"]), "S2 the sentinel answers {early_open_mode}");
    for (const sig of ["public.schedule_structure_features()", "public.valid_schedule_structure(jsonb)"]) {
      const p = (await c.db.query("select provolatile v, proconfig c, has_function_privilege('anon', oid, 'EXECUTE') a, has_function_privilege('authenticated', oid, 'EXECUTE') u, has_function_privilege('service_role', oid, 'EXECUTE') s, exists(select 1 from aclexplode(proacl) x where x.grantee = 0) pub from pg_proc where oid = $1::regprocedure", [sig])).rows[0];
      check(p.v === (sig.includes("features") ? "s" : "i") && JSON.stringify(p.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !p.a && !p.u && p.s && !p.pub,
        `S2 ${sig}: ${sig.includes("features") ? "stable" : "immutable"}, search_path pinned, EXECUTE for service_role only`);
    }
    for (const role of ["anon", "authenticated"]) {
      await c.db.exec(`set role ${role}`);
      const x = await attempt(c.db, "select public.schedule_structure_features()");
      await c.db.exec("reset role");
      check(!x.ok && x.code === "42501", `S2 ${role} cannot call the sentinel (42501)`);
    }
    check((await c.db.query("select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0354 early open mode') > 0 ok")).rows[0].ok, "S2 verify: the 0354 marker");
    check((await c.db.query("select count(*)::int n from public.schedule_structures where not public.valid_schedule_structure(structure)")).rows[0].n === 0, "S2 verify: every stored structure is valid (the stored pre-apply row included)");
    const md5 = (await c.db.query("select md5(regexp_replace(prosrc, '[^\\x21-\\x7E]+', '', 'g')) m from pg_proc where oid = 'public.valid_schedule_structure(jsonb)'::regprocedure")).rows[0].m;
    const want = (await before.db.query("select md5(regexp_replace($1, '[^\\x21-\\x7E]+', '', 'g')) m", [V0354.slice(V0354.indexOf("$$") + 2, V0354.lastIndexOf("$$"))])).rows[0].m;
    check(md5 === want, "S2 the live body is the file's body");
    const again = await attempt(c.db, M0354);
    check(!again.ok && again.message.includes("0354: already applied"), "S2 a second apply is refused by name");
    check(!!stored, "S2 (a structure stored before the apply is untouched)");
  }

  // S3 — the three lists against the function and the table CHECK; the writer stores a mode
  for (const [name, list] of Object.entries(LISTS)) {
    const a = await agree(c, list, (k) => k.valid);
    check(a.fn === list.length && a.chk === list.length, `S3 ${name} list (${list.length} cases, ${list.filter((k) => k.valid).length} valid): function and table CHECK agree${a.bad.length ? ` — ${a.bad.join("; ")}` : ""}`);
  }
  for (const mode of ["manual", "semi", "auto"]) {
    const w = await save(c, writable(mode));
    check(w.ok, `S3 save_schedule_structure stores catering.earlyOpenMode = ${mode}`);
  }
  const wBad = await save(c, writable("Auto"));
  check(!wBad.ok && wBad.message.includes("structure_invalid"), "S3 save_schedule_structure refuses \"Auto\": structure_invalid");

  // S4 — identity for every structure without the key
  {
    let n = 0, same = 0;
    for (const list of Object.values(LISTS)) for (const k of list) {
      if (carries(k.value)) continue;
      n++;
      if ((await judge(c.db, k.value)) === (await judge(before.db, k.value))) same++;
    }
    check(n > 100 && same === n, `S4 every structure without the key (${n}) is judged by 0354 exactly as by 0346`);
  }

  // S5 — the rollback property (plan section 17)
  {
    const withMode = await save(c, writable("auto"));
    const without = await save(c, writable());
    const rows = (await c.db.query("select id, structure from public.schedule_structures where location_id = $1 order by created_at desc, id desc", [c.shop])).rows;
    check(withMode.ok && without.ok && rows[0].id === without.id, "S5 rollback step 1: a new version WITHOUT the key is saved over a mode (append-only; the mode row stays as history)");
    check(await judge(before.db, rows[0].structure) === true, "S5 the live head is valid under 0346's validator (the SQL twin of the TS validator an older deployment runs)");
    check(await judge(before.db, rows.find((r) => r.id === withMode.id).structure) === false, "S5 the historical row with the mode is not: so the migration is KEPT on a code rollback");
    const reverted = (await c.db.query("select count(*)::int n from public.schedule_structures s where not public.valid_schedule_structure(s.structure)")).rows[0].n;
    check(reverted === 0, "S5 under 0354 every stored row (history included) stays valid");
    await c.db.exec(V0346);
    const after0346 = (await c.db.query("select count(*)::int n from public.schedule_structures s where not public.valid_schedule_structure(s.structure)")).rows[0].n;
    check(after0346 > 0, `S5 re-installing 0346's body would leave ${after0346} stored row(s) its own validator refuses: never revert 0354 while a mode was ever saved`);
  }
  await c.db.close();
  await before.db.close();

  // S6 — broken variants (each must FAIL a check, or the harness fails)
  const variants = [
    ["without the value check, catering.earlyOpenMode \"Auto\" is accepted",
      M0354.replace(/  if v_cat \? 'earlyOpenMode' and[\s\S]*?then return false; end if;\n/, "")],
    ["without the exact-keys change, catering.earlyOpenMode \"semi\" is refused",
      M0354.replace("v_cat - 'crewShift' - 'earlyOpenMode' else", "v_cat - 'crewShift' else")],
    ["a sentinel granted to authenticated is refused by the file's own ceiling (0354: RPC escape)",
      M0354.replace("grant execute on function public.schedule_structure_features() to service_role;", "grant execute on function public.schedule_structure_features() to service_role, authenticated;")],
  ];
  for (const [label, sql] of variants) {
    if (sql === M0354) { check(false, `S6 the variant "${label}" did not change the file`); continue; }
    const v = await chain("0346");
    const r = await attempt(v.db, sql);
    let failed;
    if (!r.ok) failed = r.message.includes("0354: RPC escape");
    else {
      const a = await agree(v, LISTS.early, (k) => k.valid);
      failed = a.bad.length > 0;
    }
    await v.db.close();
    if (failed) console.log(`EXPECTED FAIL 0354 broken variant: ${label}`);
    check(failed, `S6 the broken variant is caught: ${label}`);
  }
  console.log("NOT RUN here (sim, by CC at apply time): the MCP pre-flight and verify queries in the 0354 header");
} catch (e) {
  failures++;
  console.error(`FAIL 0354 harness: ${e.stack ?? e}`);
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0354: ${checks} checks`);
