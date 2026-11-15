/**
 * Local Postgres proof of migration 0322 (prep production ↔ completion link + the one prep fold writer, bug-audit
 * wave W16: B090 / B091, plus the B094 legacy exclusion step), SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns
 * the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0322.mjs
 *
 * Applies a small inline stub (Supabase roles + default privileges, users, locations, vendor_items, items, the
 * checklist tables the fold reads, audit_log), then the REAL 0101 + 0102 + 0107, 0215's productions column block,
 * 0147, and 0322, and proves:
 *   P0  the preflight refuses without 0215's columns; a second apply is a no-op (idempotent)
 *   P1  posture: one signature, SECURITY DEFINER, pinned search_path, EXECUTE for service_role only
 *   P2  a first fold records header + lines atomically, completion_id set, produced_at = the completion's time
 *   P3  B090: the fold of a SUPERSEDED completion writes nothing and leaves the newer production live
 *   P4  B091: a single-box re-save keeps the first save's produced_at; a batch row takes the session's
 *   P5  an empty line set clears only while the completion is live; a revoked completion is stale
 *   P6  refusals by name (completion_mismatch, location_mismatch, invalid_input) change nothing
 *   P7  atomicity: a failing line insert rolls the supersede back (the prior header stays live)
 *   P8  B094: exactly the two legacy business-wide dining-option rows deactivate, audited; others untouched;
 *       a third matching row refuses the whole migration
 * The two-session proof (a save waiting on the fold's completion lock) needs two connections and is sim-only:
 * scripts/sim/prep-production-0322-lock-check-management.mjs. P1 pins the lock in the body instead.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const M0101 = read("supabase/migrations/0101_productions.sql");
const M0102 = read("supabase/migrations/0102_production_header_lines.sql");
const M0107 = read("supabase/migrations/0107_productions_prep_live_unique.sql");
const M0147 = read("supabase/migrations/0147_toast_sales_ingest.sql");
const M0215_PRODUCTIONS = (() => {
  const src = read("supabase/migrations/0215_batch_vs_bottle.sql").replace(/\r\n/g, "\n");
  const i = src.indexOf("alter table public.productions\n");
  const j = src.indexOf(";", i);
  if (i < 0 || j < 0) throw new Error("expected 0215's productions column block");
  return src.slice(i, j + 1);
})();
const M0322 = read("supabase/migrations/0322_prep_production_completion_link.sql");

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.users (id uuid primary key default gen_random_uuid());
create table public.locations (id uuid primary key default gen_random_uuid());
create table public.vendor_items (id uuid primary key default gen_random_uuid());
create table public.items (id uuid primary key default gen_random_uuid());
create table public.checklist_instances (id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id));
create table public.checklist_template_items (id uuid primary key default gen_random_uuid());
create table public.checklist_completions (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.checklist_instances(id),
  template_item_id uuid not null references public.checklist_template_items(id),
  completed_at timestamptz not null default now(),
  superseded_at timestamptz, revoked_at timestamptz, prep_data jsonb
);
create table public.audit_log (actor_id uuid, actor_role text, action text, resource_table text, resource_id uuid,
  destructive boolean, metadata jsonb);
`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ m0215 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(M0101);
  await db.exec(M0102);
  await db.exec(M0107);
  if (m0215) await db.exec(M0215_PRODUCTIONS);
  await db.exec(M0147);
  return db;
}

const SIG = "uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb";
const db = await base();
try {
  // P0 — preflight + idempotent re-apply
  {
    const no0215 = await base({ m0215: false });
    await refuses(() => no0215.exec(M0322), "0322: productions is missing a 0102 / 0215 column", "P0 refuses without 0215's productions columns");
    await no0215.close();
    const again = await base();
    await again.exec(M0322);
    await again.exec(M0322);
    const n = (await again.query("select count(*)::int as n from pg_proc where proname = 'record_prep_production_atomic'")).rows[0].n;
    check(n === 1, "P0 a second apply is a no-op (one function, no error)");
    await again.close();
  }

  // fixtures (seeded BEFORE 0322 so its data step sees them)
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const L = await id("insert into public.locations default values returning id");
  const OTHER = await id("insert into public.locations default values returning id");
  const KH = await id("insert into public.users default values returning id");
  const ITEM = await id("insert into public.items default values returning id");
  const S1 = await id("insert into public.vendor_items default values returning id");
  const S2 = await id("insert into public.vendor_items default values returning id");
  const INST = await id("insert into public.checklist_instances (location_id) values ($1) returning id", [L]);
  const TI = await id("insert into public.checklist_template_items default values returning id");
  const TI2 = await id("insert into public.checklist_template_items default values returning id");
  const ex = async (location, kind, value, active = true) =>
    id("insert into public.toast_ingest_exclusions (location_id, kind, value, active) values ($1, $2, $3, $4) returning id", [location, kind, value, active]);
  const EZ = await ex(null, "dining_option", "Ezcater");
  const APP = await ex(null, "dining_option", " App Catering Delivery ");
  const EZ_SHOP = await ex(L, "dining_option", "Ezcater");
  const STAFF = await ex(null, "dining_option", "Staff Meal");
  const EZ_OLD = await ex(null, "dining_option", "Ezcater", false);
  const NAME = await ex(null, "item_name_contains", "Ezcater");

  await db.exec(M0322);
  check(true, "0322 applied with every SQL guard");

  // P8 — B094 legacy rows
  {
    const act = async (x) => (await db.query("select active from public.toast_ingest_exclusions where id = $1", [x])).rows[0].active;
    check(!(await act(EZ)) && !(await act(APP)), "P8 the two legacy business-wide dining-option rows are inactive");
    check((await act(EZ_SHOP)) && (await act(STAFF)) && (await act(NAME)) && !(await act(EZ_OLD)),
      "P8 a shop's own rule, another business-wide option, another kind and an already-inactive row are untouched");
    const audits = (await db.query("select resource_id, destructive, metadata from public.audit_log where action = 'toast_sales.exclusion_remove'")).rows;
    check(audits.length === 2 && audits.every((a) => a.destructive === false && a.metadata.actor_context === "migration_apply"
      && a.metadata.bug === "B094") && new Set(audits.map((a) => a.resource_id)).size === 2,
      "P8 one audit row per deactivated row (migration_apply, non-destructive)");
    await db.exec(M0322);
    check((await db.query("select count(*)::int as n from public.audit_log")).rows[0].n === 2, "P8 a re-apply touches nothing more");
    const three = await base();
    const L3 = (await three.query("insert into public.locations default values returning id")).rows[0].id;
    void L3;
    for (const v of ["Ezcater", "ezcater", "App Catering Delivery"]) {
      await three.query("insert into public.toast_ingest_exclusions (location_id, kind, value) values (null, 'dining_option', $1)", [v]);
    }
    await refuses(() => three.exec(M0322), "0322: expected at most the 2 legacy dining-option rows", "P8 a third matching row refuses the migration");
    await three.exec("rollback"); // the file's own begin is left aborted by the refusal
    check((await three.query("select count(*)::int as n from public.toast_ingest_exclusions where active")).rows[0].n === 3,
      "P8 … and the refusal rolls the whole file back (all three still active)");
    await three.close();
  }

  // P1 — posture
  {
    const f = `public.record_prep_production_atomic(${SIG})`;
    const p = (await db.query(`select has_function_privilege('anon', '${f}'::regprocedure, 'EXECUTE') as anon,
      has_function_privilege('authenticated', '${f}'::regprocedure, 'EXECUTE') as auth,
      has_function_privilege('service_role', '${f}'::regprocedure, 'EXECUTE') as svc,
      (select prosecdef from pg_proc where oid = '${f}'::regprocedure) as definer,
      (select proconfig from pg_proc where oid = '${f}'::regprocedure) as cfg,
      (select prosrc from pg_proc where oid = '${f}'::regprocedure) as src`)).rows[0];
    check(!p.anon && !p.auth && p.svc, "P1 EXECUTE: service_role only");
    check(p.definer === true && JSON.stringify(p.cfg) === JSON.stringify(["search_path=pg_catalog, public"]), "P1 SECURITY DEFINER, search_path pinned");
    check(/where id = p_completion_id for no key update/.test(p.src), "P1 the body locks the completion FOR NO KEY UPDATE before any write");
  }

  await db.exec("set role service_role");
  let clock = Date.parse("2026-11-10T11:00:00Z");
  const completion = async (o = {}) => {
    clock += 3600_000;
    return id(`insert into public.checklist_completions (instance_id, template_item_id, completed_at, prep_data)
      values ($1, $2, $3, $4) returning id`, [o.instance ?? INST, o.ti ?? TI, new Date(clock).toISOString(), JSON.stringify(o.prep ?? { phase2: { opener_prepped: 1 } })]);
  };
  const supersede = (c) => db.query("update public.checklist_completions set superseded_at = now() where id = $1", [c]);
  const line = (sku, oz, extra = {}) => ({ sku_id: sku, input_oz: oz, qty_entered: null, unit_entered: null, derived_oz: oz, ...extra });
  const fold = async (c, lines, o = {}) => (await db.query(
    `select public.record_prep_production_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r`,
    [c, o.loc ?? L, o.instance ?? INST, o.ti ?? TI, ITEM, o.qty ?? 2, o.source ?? "opening_p2", KH,
      JSON.stringify(lines), o.batch === undefined ? null : JSON.stringify(o.batch)])).rows[0].r;
  const live = async (ti = TI) => (await db.query(`select id, output_qty::float as qty, produced_at, completion_id, batches_made, made_by
    from public.productions where instance_id = $1 and template_item_id = $2 and superseded_at is null and revoked_at is null`, [INST, ti])).rows;
  const linesOf = async (pid) => (await db.query("select input_sku_id, input_oz::float as oz, qty_entered::float as qty, unit_entered from public.production_inputs where production_id = $1 order by input_oz", [pid])).rows;
  const total = async () => (await db.query("select (select count(*) from public.productions)::int as h, (select count(*) from public.production_inputs)::int as l")).rows[0];

  // P2 — a first fold
  const C1 = await completion();
  const C1_AT = (await db.query("select completed_at from public.checklist_completions where id = $1", [C1])).rows[0].completed_at;
  const r1 = await fold(C1, [line(S1, 32, { qty_entered: 2, unit_entered: "each" }), line(S2, 0)]);
  const h1 = await live();
  check(r1.status === "recorded" && h1.length === 1 && h1[0].id === r1.production_id && h1[0].completion_id === C1,
    "P2 recorded: one live header carrying completion_id");
  check(h1[0].produced_at.getTime() === C1_AT.getTime(), "P2 produced_at = the completion's completed_at (never the fold's clock)");
  const l1 = await linesOf(r1.production_id);
  check(l1.length === 1 && l1[0].oz === 32 && l1[0].qty === 2 && l1[0].unit_entered === "each", "P2 positive lines only, as sent");

  // P3 — B090: device 1 saved 2 (C2), device 2 saved 4 (C4); C4's fold lands first, then C2's stale fold resumes
  await supersede(C1);
  const C2 = await completion();
  await supersede(C2);
  const C4 = await completion();
  const r4 = await fold(C4, [line(S1, 64)], { qty: 4 });
  const before = await total();
  const r2 = await fold(C2, [line(S1, 32)], { qty: 2 });
  const h4 = await live();
  check(r2.status === "stale_completion" && r2.production_id === null, "P3 the superseded completion's fold answers stale_completion");
  check(h4.length === 1 && h4[0].id === r4.production_id && h4[0].qty === 4 && h4[0].completion_id === C4,
    "P3 the newer save's production (4) stays the live one");
  const after = await total();
  check(after.h === before.h && after.l === before.l, "P3 … and the stale fold wrote nothing");

  // P4 — B091: re-saving the same prep later keeps the first save's time
  check(h4[0].produced_at.getTime() === C1_AT.getTime(), "P4 C4's header inherited C1's produced_at through the re-saves");
  await supersede(C4);
  const C5 = await completion();
  const r5 = await fold(C5, [line(S1, 64)], { qty: 4 });
  const h5 = await live();
  check(r5.status === "recorded" && h5[0].produced_at.getTime() === C1_AT.getTime(), "P4 a later re-save (same qty) keeps the first save's produced_at");
  // batch: the session's time, not the prior header's
  const CB = await completion({ ti: TI2 });
  const rb = await fold(CB, [line(S2, 10)], { ti: TI2, qty: 6, batch: { produced_at: "2026-11-01T12:00:00Z", made_by: KH, batches_made: 2, came_out_to: 5.5, yield_at_time: 3 } });
  const hb = await live(TI2);
  check(rb.status === "recorded" && hb[0].produced_at.toISOString() === "2026-11-01T12:00:00.000Z" && hb[0].batches_made === 2 && hb[0].made_by === KH,
    "P4 a batch row carries the session's produced_at and batch columns");

  // P5 — empty lines / revoke
  await supersede(C5);
  const C6 = await completion();
  const r6 = await fold(C6, [line(S1, 0)]);
  check(r6.status === "cleared" && (await live()).length === 0, "P5 no positive line on a live completion clears the prior production");
  const r6b = await fold(C6, [line(S1, 16)], { qty: 1 });
  check(r6b.status === "recorded", "P5 the same completion folding again records");
  await supersede(C6);
  const C7 = await completion();
  const stale = await fold(C6, []);
  check(stale.status === "stale_completion" && (await live()).length === 1, "P5 an empty fold of a STALE completion clears nothing");
  await db.query("update public.checklist_completions set revoked_at = now() where id = $1", [C7]);
  check((await fold(C7, [line(S1, 8)])).status === "stale_completion", "P5 a revoked completion is stale");

  // P6 — refusals by name, nothing written
  const C8 = await completion();
  const t0 = await total();
  await refuses(() => fold(C8, [line(S1, 8)], { ti: TI2 }), "completion_mismatch", "P6 another template item's completion");
  const P1C = await completion({ prep: { phase1: {} } });
  await refuses(() => fold(P1C, [line(S1, 8)]), "completion_mismatch", "P6 a Phase 1 completion");
  await refuses(() => fold(C8, [line(S1, 8)], { loc: OTHER }), "location_mismatch", "P6 another shop");
  await refuses(() => fold(C8, [{ sku_id: S1, input_oz: "8" }]), "invalid_input", "P6 a line with a non-number oz");
  await refuses(() => fold(C8, [line(S1, 8)], { source: "manual" }), "invalid_input", "P6 source manual");
  await refuses(() => fold(C8, [line(S1, 8)], { qty: 0 }), "invalid_input", "P6 output_qty 0 with lines");
  await refuses(() => fold(C8, [line(S1, 8)], { batch: { produced_at: "2026-11-01T12:00:00Z" } }), "invalid_input", "P6 a batch with no maker");
  const t1 = await total();
  check(t0.h === t1.h && t0.l === t1.l, "P6 no refusal wrote a row");

  // P7 — atomicity
  const liveBefore = await live();
  await refuses(() => fold(C8, [line(S1, 8), line("00000000-0000-0000-0000-000000000000", 4)], { qty: 1 }), "23503", "P7 an unknown SKU fails the line insert");
  const liveAfter = await live();
  check(liveAfter.length === 1 && liveAfter[0].id === liveBefore[0].id, "P7 … and the supersede rolled back: the prior header stays live");
  await db.exec("reset role");
} catch (e) {
  failures++;
  console.error(`FAIL 0322 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0322: ${checks} checks`);
