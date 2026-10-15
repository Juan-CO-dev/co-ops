/**
 * Local Postgres proof of migration 0262 (catalog Phase 3a), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC still owns the Supabase sim/prod gate (plan Task 12); this never touches a real database.
 *
 *   node scripts/sql-harness-0262.mjs
 *
 * Executes the REAL 0258 + 0259 + 0260 + 0261 + 0262 (over tests/fixtures/recipe-versions-pglite-stub.sql, with
 * recipes and lines seeded BEFORE 0262 so its backfill has something to copy), then proves the plan's SQL claims:
 *   B   the backfill: one live global version per recipe from 2000-01-01, lines = recipe_inputs (an empty recipe too).
 *   J   the JOURNAL is complete: every insert / update / delete of a line, a moved line, a new recipe — journaled at
 *       COMMIT, once per transaction, never for an unchanged set or a rolled-back one; the 0258 writers, the 16- and
 *       17-argument update and remove_recipe_input_atomic record their actor (or none).
 *   C   the CYCLE LAW PER SHOP, under the graph lock 7258025800: save_recipe_version (shop and global), Back to default
 *       and the four re-emitted 0258 writers refuse a loop that exists only in an active shop's graph; an inactive shop
 *       is not swept; the advisory lock is held by every writer.
 *   W   every writer refusal, by name — and a refused call writes nothing.
 *   P   provenance follows the content (adopt / edit / restore / back to default), its END is recorded and never
 *       overwritten (adoption_ended_from_version_id coalesce), and PROMOTE returns its source shop to the default in
 *       the same transaction at the same instant.
 *   S   the dependency snapshot is SCOPED (an unrelated SKU never stales it; a closure SKU, a flat-pack measure, a
 *       riding shop's change does; an untouched shop's ingredient does not stale a global preview).
 *   V   privilege ceilings on the three tables, RLS deny-all, helpers callable by nobody, writers by service_role only.
 *   O   the update_recipe_input_atomic overload PAIR: the 16-argument writer kept, the 17-argument + p_actor beside it.
 * NOT provable here: 'recipe_version:dependencies_busy' (NOWAIT against ANOTHER session's lock) — PGlite is one
 * session. It is pinned textually in tests/recipe-versions-migration.test.ts and exercised on the sim (Task 12).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = u(1), ACTOR2 = u(2);
const NIL = "00000000-0000-0000-0000-000000000000";
const S1 = u(11), S2 = u(12), S3 = u(13), S_OFF = u(14);
const V1 = u(21);
const P1 = u(31), P_OFF = u(32);
const K1 = u(41), K2 = u(42), K3 = u(43), K4 = u(44), K_UNREL = u(45), K_OTHER = u(46), K_MEMBER = u(47), K_MEMBER2 = u(48);
const I_SLAW = u(51), I_DRESS = u(52), I_X = u(53), I_Q = u(54), I_Q2 = u(55);
const M1 = u(61);
const R_SLAW = u(71), R_DRESS = u(72), R_ITAL = u(73), R_EMPTY = u(74), R_X = u(75), R_Z = u(76), R_OFF = u(77), R_DUP = u(78);
const LOCK_KEY = 7258025800n;

const db = new PGlite();
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) {
    const msg = String(e.message);
    const ok = code instanceof RegExp ? code.test(msg) : msg.includes(code);
    check(ok, `${what} → ${code}${ok ? "" : ` (got: ${msg})`}`);
  }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const asOwner = async (fn) => { await db.exec("reset role;"); try { return await fn(); } finally { await db.exec("set role service_role;"); } };

const line = (o) => ({ component_sku_id: null, component_item_id: null, component_product_id: null, quantity: 1, unit: "oz",
  each_container_label: null, portioned: false, ...o });
const J = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const snapshot = async (recipe, shop, lines) =>
  (await one("select public.recipe_change_snapshot($1::uuid, $2::uuid, $3::jsonb) as s", [recipe, shop, J(lines)])).s;
/** The REAL save_recipe_version with a FRESH snapshot over the same line set (the preview's, unless `snap` overrides). */
async function save(a) {
  const snapLines = a.snapLines !== undefined ? a.snapLines : a.lines ?? [];
  const snap = a.snap !== undefined ? a.snap : await snapshot(a.recipe, a.shop, snapLines);
  return (await one(
    `select public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, $4::uuid, $5::uuid, $6, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11::jsonb) as r`,
    [a.recipe, a.shop, J(a.lines ?? null), a.expected ?? null, a.basedOn ?? null, a.note ?? null, a.actor ?? ACTOR,
     a.restoredFrom ?? null, a.adoptedFrom ?? null, a.promotedFrom ?? null, J(snap)],
  )).r;
}
async function retire(a) {
  const snap = a.snap !== undefined ? a.snap : await snapshot(a.recipe, a.shop, await defaultLines(a.recipe));
  return (await one("select public.retire_recipe_version($1::uuid, $2::uuid, $3::uuid, $4::jsonb) as r",
    [a.version, a.shop, a.actor ?? ACTOR, J(snap)])).r;
}
const defaultLines = async (recipe) => (await all(
  "select component_sku_id, component_item_id, component_product_id, unit from public.recipe_inputs where recipe_id = $1 order by id", [recipe]));
const head = async (recipe) => one(
  "select id, created_by, based_on_version_id, valid_from::text as valid_from from public.recipe_versions where recipe_id = $1 and location_id is null and active", [recipe]);
const shopLive = async (recipe, shop) => one(
  "select id from public.recipe_versions where recipe_id = $1 and location_id = $2 and active", [recipe, shop]);
const versionCount = async (recipe) => Number((await one("select count(*)::int as n from public.recipe_versions where recipe_id = $1", [recipe])).n);
const headEqualsInputs = async (recipe) =>
  (await asOwner(async () => one("select public.recipe_journal_lines_equal($1, (select id from public.recipe_versions where recipe_id = $1 and location_id is null and active)) as eq", [recipe]))).eq;
/** Everything a refused write must leave untouched. */
const state = async () => JSON.stringify({
  v: await all("select id, recipe_id, location_id, active, valid_to::text from public.recipe_versions order by id"),
  l: await all("select count(*)::int as n from public.recipe_version_lines"),
  i: await all("select id, recipe_id, quantity::text, component_item_id from public.recipe_inputs order by id"),
});
const lockHeld = async () => Boolean((await one(
  `select exists (select 1 from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()
                    and ((classid::bigint << 32) | objid::bigint) = $1) as held`, [String(LOCK_KEY)])).held);
/** Run fn inside an explicit transaction, report whether the graph lock is held after it, then roll back. */
async function lockedInTxn(fn) {
  await db.exec("begin;");
  try { await fn(); return await lockHeld(); } finally { await db.exec("rollback;"); }
}

try {
  await db.exec("set timezone = 'UTC';");
  await db.exec(readFileSync("tests/fixtures/recipe-versions-pglite-stub.sql", "utf8"));
  for (const m of ["0258_recipe_input_write_atomic", "0259_sku_shop_versions", "0260_sku_pack_versions_finalize", "0261_sku_pack_change_requests"]) {
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, "utf8"));
  }
  // ── the world BEFORE 0262 (so the backfill has rows to copy) ──────────────
  await db.exec(`
    insert into public.users values ('${ACTOR}'), ('${ACTOR2}');
    insert into public.locations(id, name, active) values ('${S1}', 'One', true), ('${S2}', 'Two', true), ('${S3}', 'Three', true), ('${S_OFF}', 'Closed', false);
    insert into public.measure_units(label, dimension, to_base_factor, active) values ('oz', 'weight', 1, true), ('lb', 'weight', 16, true),
      ('each', 'count', 1, true), ('gill', 'volume', 4, false);
    insert into public.vendors(id, name, source_kind, active) values ('${V1}', 'Vendor', 'regular', true);
    insert into public.products(id, name, active, unit_oz) values ('${P1}', 'Ham', true, 1), ('${P_OFF}', 'Retired thing', true, 1);
    insert into public.vendor_items(id, name, vendor_id, product_id, each_measure) values
      ('${K1}', 'Turkey', '${V1}', null, 'oz'), ('${K2}', 'Mayo', '${V1}', null, 'lb'), ('${K3}', 'Lettuce', '${V1}', null, 'lb'),
      ('${K4}', 'Pickle', '${V1}', null, 'oz'), ('${K_UNREL}', 'Unrelated', '${V1}', null, 'oz'), ('${K_OTHER}', 'Other-shop only', '${V1}', null, 'oz'),
      ('${K_MEMBER}', 'Ham member', '${V1}', '${P1}', 'lb'), ('${K_MEMBER2}', 'Second ham member', '${V1}', '${P1}', 'lb');
    insert into public.items(id, name) values ('${I_SLAW}', 'Slaw'), ('${I_DRESS}', 'Dressing'), ('${I_X}', 'X'), ('${I_Q}', 'Q'), ('${I_Q2}', 'Q2');
    insert into public.menu_items(id, name) values ('${M1}', 'Italian');
    insert into public.recipes(id, name) values ('${R_SLAW}', 'Slaw'), ('${R_DRESS}', 'Dressing'), ('${R_ITAL}', 'Italian'),
      ('${R_EMPTY}', 'Empty'), ('${R_X}', 'X'), ('${R_Z}', 'Z'), ('${R_DUP}', 'Duplicate lines');
    insert into public.recipes(id, name, active) values ('${R_OFF}', 'Retired recipe', false);
    insert into public.recipe_outputs(recipe_id, output_item_id, output_menu_item_id) values
      ('${R_SLAW}', '${I_SLAW}', null), ('${R_DRESS}', '${I_DRESS}', null), ('${R_ITAL}', null, '${M1}'), ('${R_X}', '${I_X}', null);
    insert into public.recipe_inputs(recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, display_order) values
      ('${R_SLAW}', '${K3}', null, null, 48, 'oz', 0), ('${R_SLAW}', null, '${I_DRESS}', null, 2, 'oz', 1),
      ('${R_DRESS}', '${K2}', null, null, 16, 'oz', 0),
      ('${R_ITAL}', '${K1}', null, null, 4, 'oz', 0), ('${R_ITAL}', null, '${I_SLAW}', null, 2, 'oz', 1), ('${R_ITAL}', null, null, '${P1}', 3, 'oz', 2),
      ('${R_X}', '${K4}', null, null, 1, 'oz', 0), ('${R_Z}', null, '${I_DRESS}', null, 1, 'oz', 0), ('${R_OFF}', '${K1}', null, null, 1, 'oz', 0),
      ('${R_DUP}', '${K1}', null, null, 1, 'oz', 0), ('${R_DUP}', '${K1}', null, null, 1, 'oz', 0);
  `);
  await db.exec(readFileSync("supabase/migrations/0262_recipe_shop_versions.sql", "utf8"));
  console.log("ok   0258 → 0262 applied over seeded recipes (0262's backfill assertions, cutover proof and privilege guards passed)");

  // ── B the backfill ────────────────────────────────────────────────────────
  {
    const r = await one(`select (select count(*)::int from public.recipes) as recipes,
      (select count(*)::int from public.recipe_versions where location_id is null and active) as live,
      (select count(*)::int from public.recipe_versions where valid_from <> '2000-01-01T00:00:00Z') as dated,
      (select count(*)::int from public.recipe_version_lines) as lines, (select count(*)::int from public.recipe_inputs) as inputs,
      (select count(*)::int from public.recipe_version_lines l join public.recipe_inputs ri on ri.id = l.source_line_id) as sourced`);
    check(r.recipes === 8 && r.live === 8 && r.dated === 0, "B: every recipe (inactive and line-less included) has ONE live global baseline from 2000-01-01");
    check(r.lines === r.inputs && r.sourced === r.inputs, "B: the baseline lines are a copy of recipe_inputs, each naming its source line");
    const bad = await one("select count(*)::int as n from public.recipe_versions v where v.location_id is null and v.active and not public.recipe_journal_lines_equal(v.recipe_id, v.id)");
    check(bad.n === 0, "B: every baseline equals recipe_inputs (the cutover proof's own query)");
    const dup = await one("select count(*)::int as n from public.recipe_version_lines l join public.recipe_versions v on v.id = l.version_id where v.recipe_id = $1", [R_DUP]);
    check(dup.n === 2, "B: a recipe with two IDENTICAL lines keeps both in its baseline (multiset copy, review P3f)");
    const trg = await all("select tgname from pg_trigger where tgrelid in ('public.recipe_inputs'::regclass, 'public.recipes'::regclass) and not tgisinternal and tgname like '%journal%' order by 1");
    check(JSON.stringify(trg.map((t) => t.tgname)) === JSON.stringify(["recipe_inputs_journal", "recipes_journal"]), "B: the two journal triggers exist");
    const def = await all("select tgname, tgdeferrable, tginitdeferred from pg_trigger where tgname in ('recipe_inputs_journal', 'recipes_journal')");
    check(def.length === 2 && def.every((t) => t.tgdeferrable && t.tginitdeferred), "B: both are DEFERRABLE INITIALLY DEFERRED (they run at COMMIT)");
  }

  await db.exec("set role service_role;");

  // ── J the journal is complete ─────────────────────────────────────────────
  {
    const h0 = await head(R_DRESS);
    await db.query("insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ($1, $2, 1, 'oz')", [R_DRESS, K4]);
    const h1 = await head(R_DRESS);
    const closed = await one("select active, valid_to::text as valid_to from public.recipe_versions where id = $1", [h0.id]);
    check(h1.id !== h0.id && h1.based_on_version_id === h0.id && !closed.active && closed.valid_to === h1.valid_from && await headEqualsInputs(R_DRESS),
      "J1: a raw INSERT of a line opens a new head (based on the old one, which closes exactly when it opens) holding recipe_inputs");
    check(h1.created_by === null, "J1: …a raw write names no actor (none was set)");
    await db.query("update public.recipe_inputs set quantity = quantity + 1 where recipe_id = $1 and component_sku_id = $2", [R_DRESS, K4]);
    const h2 = await head(R_DRESS);
    check(h2.id !== h1.id && await headEqualsInputs(R_DRESS), "J2: an UPDATE of a line opens a new head");
    await db.query("delete from public.recipe_inputs where recipe_id = $1 and component_sku_id = $2", [R_DRESS, K4]);
    const h3 = await head(R_DRESS);
    check(h3.id !== h2.id && await headEqualsInputs(R_DRESS), "J3: a DELETE of a line opens a new head");
    const n3 = await versionCount(R_DRESS);
    await db.query("update public.recipe_inputs set quantity = quantity where recipe_id = $1", [R_DRESS]);
    check(await versionCount(R_DRESS) === n3 && (await head(R_DRESS)).id === h3.id, "J4: an update that changes nothing opens nothing");
    await db.exec("begin;");
    await db.query("insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ($1, $2, 1, 'oz')", [R_DRESS, K4]);
    await db.query("update public.recipe_inputs set quantity = 7 where recipe_id = $1 and component_sku_id = $2", [R_DRESS, K4]);
    await db.query("update public.recipe_inputs set quantity = 17 where recipe_id = $1 and component_sku_id = $2", [R_DRESS, K2]);
    await db.exec("commit;");
    check(await versionCount(R_DRESS) === n3 + 1 && await headEqualsInputs(R_DRESS), "J5: three writes in ONE transaction journal ONCE, holding the final lines");
    await db.exec("begin;");
    await db.query("insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ($1, $2, 1, 'oz')", [R_DRESS, K1]);
    await db.exec("rollback;");
    check(await versionCount(R_DRESS) === n3 + 1, "J6: a rolled-back write leaves no version");
    await db.exec("begin;");
    const nr = (await one("insert into public.recipes(name) values ('Fresh') returning id")).id;
    await db.query("insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ($1, $2, 2, 'oz')", [nr, K1]);
    await db.exec("commit;");
    const fresh = await all("select valid_from::text as vf, active from public.recipe_versions where recipe_id = $1", [nr]);
    check(fresh.length === 1 && fresh[0].active && fresh[0].vf.startsWith("2000-01-01") && await headEqualsInputs(nr),
      "J7: a NEW recipe (with its lines, one transaction) gets ONE global version from 2000-01-01 — existence is not dated");
    const bare = (await one("insert into public.recipes(name) values ('Bare') returning id")).id;
    check(await versionCount(bare) === 1, "J7: …a recipe created with no lines still gets its (empty) version");
    const ital0 = await head(R_ITAL);
    const z0 = await head(R_Z);
    await db.query("update public.recipe_inputs set recipe_id = $1 where recipe_id = $2 and component_sku_id = $3", [R_Z, R_ITAL, K1]);
    check((await head(R_ITAL)).id !== ital0.id && (await head(R_Z)).id !== z0.id && await headEqualsInputs(R_ITAL) && await headEqualsInputs(R_Z),
      "J8: a line MOVED to another recipe journals BOTH recipes");
    await db.query("update public.recipe_inputs set recipe_id = $1 where recipe_id = $2 and component_sku_id = $3", [R_ITAL, R_Z, K1]);
  }
  // J10 multiplicity (review P3f): deleting ONE of two identical lines is a change; the head holds exactly one.
  {
    const before = await head(R_DUP);
    const oneLine = await one("select id from public.recipe_inputs where recipe_id = $1 order by id limit 1", [R_DUP]);
    await db.query("delete from public.recipe_inputs where id = $1", [oneLine.id]);
    const after = await head(R_DUP);
    const n = await one("select count(*)::int as n from public.recipe_version_lines where version_id = $1", [after.id]);
    check(after.id !== before.id && n.n === 1 && await headEqualsInputs(R_DUP), "J10: removing one of two identical lines journals a new head with ONE (EXCEPT ALL counts multiplicity)");
  }
  // J11 TRUNCATE is refused (review P3d) — even for the owner: it would skip the journal entirely.
  await refuses(async () => asOwner(() => db.query("truncate public.recipe_inputs")), "recipe_version:truncate_refused", "J11: TRUNCATE recipe_inputs is refused");
  await refuses(async () => asOwner(() => db.query("truncate public.recipes cascade")), "recipe_version:truncate_refused", "J11: TRUNCATE recipes CASCADE (which would wipe the journal) is refused");

  // J9 the 0258 writers (re-emitted) and the 0262 delete record their actor for the journal.
  {
    const before = await head(R_X);
    const newId = (await one("select public.add_recipe_input_atomic($1, $2, null, null, 3, 'oz', null, false, $3) as id", [R_X, K1, ACTOR])).id;
    const h = await head(R_X);
    const old = await one("select retired_by from public.recipe_versions where id = $1", [before.id]);
    check(h.id !== before.id && h.created_by === ACTOR && old.retired_by === ACTOR, "J9: add_recipe_input_atomic → the new head and the closed one name the actor");
    const r = await one("select * from public.recipe_inputs where id = $1", [newId]);
    await db.query("select * from public.update_recipe_input_atomic($1, $2, $3, null, null, 4, 'oz', null, false, $3, null, null, 3, 'oz', null, false)", [newId, R_X, K1]);
    const h16 = await head(R_X);
    check(h16.id !== h.id && h16.created_by === null && r.quantity !== undefined, "J9: the 16-argument update (pre-3a callers) still writes and journals — with no actor");
    await db.query("select * from public.update_recipe_input_atomic($1, $2, $3, null, null, 5, 'oz', null, false, $3, null, null, 4, 'oz', null, false, $4)", [newId, R_X, K1, ACTOR2]);
    const h17 = await head(R_X);
    check(h17.id !== h16.id && h17.created_by === ACTOR2, "J9: the 17-argument update (+ p_actor) records WHO");
    const removed = (await one("select public.remove_recipe_input_atomic($1, $2) as r", [newId, ACTOR])).r;
    const hr = await head(R_X);
    check(removed.id === newId && hr.id !== h17.id && hr.created_by === ACTOR && await headEqualsInputs(R_X), "J9: remove_recipe_input_atomic deletes, returns the row, and journals with its actor");
    await refuses(async () => db.query("select public.remove_recipe_input_atomic($1, $2)", [newId, ACTOR]), "edge_not_found", "J9: removing it again");
    const nr = (await one(`select public.create_recipe_full('{"name":"Made","recipe_type":"prep","batch_yield":1}'::jsonb,
      $1::jsonb, '[]'::jsonb, $2) as id`, [JSON.stringify([{ component_sku_id: K1, quantity: 1, unit: "oz" }]), ACTOR])).id;
    const hn = await head(nr);
    check(hn.created_by === ACTOR && hn.valid_from.startsWith("2000-01-01") && await headEqualsInputs(nr), "J9: create_recipe_full journals the new recipe once, from 2000-01-01, naming its creator");
  }

  // ── C the cycle law, per shop, under the graph lock ───────────────────────
  {
    const dressGlobal = await head(R_DRESS);
    // C1 a SHOP version that closes a loop through the global lines of another recipe.
    const before = await state();
    await refuses(async () => save({ recipe: R_DRESS, shop: S1, lines: [line({ component_item_id: I_SLAW })], basedOn: dressGlobal.id }),
      "recipe_version:would_create_cycle", "C1: S1's Dressing consuming Slaw (whose global lines consume Dressing) is refused in S1's graph");
    check(await state() === before, "C1: …nothing was written");
    // C2 S1's own Slaw drops the Dressing: the same Dressing version is now safe THERE.
    const slawS1 = (await save({ recipe: R_SLAW, shop: S1, lines: [line({ component_sku_id: K3, quantity: 48 })], basedOn: (await head(R_SLAW)).id })).version_id;
    const dressS1 = (await save({ recipe: R_DRESS, shop: S1, lines: [line({ component_item_id: I_SLAW })], basedOn: dressGlobal.id })).version_id;
    check(Boolean(slawS1 && dressS1), "C2: with S1's own Slaw, S1's Dressing may consume Slaw (no loop in S1's graph)");
    // C3 Back to default would put the global Slaw (consumes Dressing) back into S1's graph: a loop there.
    await refuses(async () => retire({ version: slawS1, recipe: R_SLAW, shop: S1 }), "recipe_version:would_create_cycle", "C3: Back to default that closes a loop in the shop's graph is refused");
    check((await shopLive(R_SLAW, S1))?.id === slawS1, "C3: …S1 keeps its version");
    // C4 the GLOBAL save sweeps every active shop riding the default: S2's own Dressing consumes X.
    const dressS2 = (await save({ recipe: R_DRESS, shop: S2, lines: [line({ component_item_id: I_X }), line({ component_item_id: I_Q })], basedOn: (await head(R_DRESS)).id })).version_id;
    check(Boolean(dressS2), "C4: S2's own Dressing consumes X and Q");
    const xHead = await head(R_X);
    await refuses(async () => save({ recipe: R_X, shop: null, expected: xHead.id, lines: [line({ component_sku_id: K4 }), line({ component_item_id: I_DRESS })] }),
      "recipe_version:would_create_cycle", "C4: a GLOBAL save of X consuming Dressing is refused — the loop exists only in S2's graph");
    // C5 the re-emitted line writers sweep too.
    await refuses(async () => db.query("select public.add_recipe_input_atomic($1, null, $2, null, 1, 'oz', null, false, $3)", [R_X, I_DRESS, ACTOR]),
      /^would_create_cycle$/, "C5: add_recipe_input_atomic refuses a loop only S2 sees (0258's unprefixed code)");
    const xLine = await one("select * from public.recipe_inputs where recipe_id = $1 order by id limit 1", [R_X]);
    await refuses(async () => db.query("select * from public.update_recipe_input_atomic($1, $2, null, $3, null, 1, 'oz', null, false, $4, null, null, $5, $6, null, false)",
      [xLine.id, R_X, I_DRESS, K4, xLine.quantity, xLine.unit]), /^would_create_cycle$/, "C5: the 16-argument update refuses it");
    await refuses(async () => db.query("select * from public.update_recipe_input_atomic($1, $2, null, $3, null, 1, 'oz', null, false, $4, null, null, $5, $6, null, false, $7)",
      [xLine.id, R_X, I_DRESS, K4, xLine.quantity, xLine.unit, ACTOR]), /^would_create_cycle$/, "C5: the 17-argument update refuses it");
    // C6 an INACTIVE shop is not swept: with S2 closed the same add is allowed (rolled back).
    await asOwner(() => db.query("update public.locations set active = false where id = $1", [S2]));
    await db.exec("begin;");
    const allowed = await one("select public.add_recipe_input_atomic($1, null, $2, null, 1, 'oz', null, false, $3) as id", [R_X, I_DRESS, ACTOR]);
    await db.exec("rollback;");
    await asOwner(() => db.query("update public.locations set active = true where id = $1", [S2]));
    check(Boolean(allowed.id), "C6: with S2 closed, the same line is allowed (only ACTIVE shops are swept)");
    // C7 the output writers: Z consumes Dressing; in S2 Dressing consumes Q — a new output Q on Z loops only in S2.
    await refuses(async () => db.query("select public.add_recipe_output($1, $2, null, 1, null, $3)", [R_Z, I_Q, ACTOR]), /^would_create_cycle$/,
      "C7: add_recipe_output refuses an output reachable only through S2's lines");
    await refuses(async () => db.query(`select public.create_recipe_full('{"name":"Loop","recipe_type":"prep","batch_yield":1}'::jsonb, $1::jsonb, $2::jsonb, $3)`,
      [JSON.stringify([{ component_item_id: I_DRESS, quantity: 1, unit: "oz" }]), JSON.stringify([{ output_item_id: I_Q, yield: 1 }]), ACTOR]),
      /^would_create_cycle$/, "C7: create_recipe_full refuses the same loop");
    await db.exec("begin;");
    const outOk = await one("select public.add_recipe_output($1, $2, null, 1, null, $3) as id", [R_Z, I_Q2, ACTOR]);
    await db.exec("rollback;");
    check(Boolean(outOk.id), "C7: an output no shop's graph reaches is allowed");
    // C8 every writer holds the graph lock 7258025800 (inside its transaction).
    check(!(await lockedInTxn(async () => db.query("select 1"))), "C8: (control) a transaction that writes nothing does not hold the graph lock");
    const italHead = (await head(R_ITAL)).id;
    check(await lockedInTxn(async () => save({ recipe: R_ITAL, shop: S3, lines: [line({ component_sku_id: K1, quantity: 5 })], basedOn: italHead })),
      "C8: save_recipe_version holds the graph lock");
    const slawS2 = (await save({ recipe: R_SLAW, shop: S2, lines: [line({ component_sku_id: K3 })], basedOn: (await head(R_SLAW)).id })).version_id;
    check(await lockedInTxn(async () => retire({ version: slawS2, recipe: R_SLAW, shop: S2 })), "C8: retire_recipe_version holds the graph lock");
    check(await lockedInTxn(async () => { await db.query("insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ($1, $2, 1, 'oz')", [R_EMPTY, K1]); await db.exec("set constraints all immediate;"); }),
      "C8: a RAW line write's journal (the deferred trigger) takes the graph lock too — the lock order never inverts");
    check(await lockedInTxn(async () => db.query("select public.add_recipe_input_atomic($1, $2, null, null, 1, 'oz', null, false, $3)", [R_EMPTY, K1, ACTOR])),
      "C8: add_recipe_input_atomic holds it");
    const anyInput = await one("select id from public.recipe_inputs where recipe_id = $1 limit 1", [R_ITAL]);
    check(await lockedInTxn(async () => db.query("select public.remove_recipe_input_atomic($1, $2)", [anyInput.id, ACTOR])), "C8: remove_recipe_input_atomic holds it");
  }

  // ── W every refusal, by name; a refused call writes nothing ───────────────
  {
    const ital = await head(R_ITAL);
    const sku = (o = {}) => line({ component_sku_id: K1, ...o });
    const s3v = (await save({ recipe: R_ITAL, shop: S3, basedOn: ital.id, lines: [sku({ quantity: 5 })] })).version_id;
    const before = await state();
    const shopSave = (o) => save({ recipe: R_ITAL, shop: S1, lines: [sku()], basedOn: ital.id, ...o });
    await refuses(async () => shopSave({ restoredFrom: ital.id, adoptedFrom: ital.id }), "recipe_version:invalid_payload", "W: restore AND adopt at once");
    await refuses(async () => save({ recipe: R_ITAL, shop: null, adoptedFrom: ital.id, expected: ital.id }), "recipe_version:invalid_payload", "W: adopt into the GLOBAL default");
    await refuses(async () => shopSave({ promotedFrom: ital.id }), "recipe_version:invalid_payload", "W: promote INTO a shop");
    await refuses(async () => save({ recipe: u(999), shop: S1, lines: [sku()] }), "recipe_version:recipe_not_found", "W: unknown recipe");
    await refuses(async () => save({ recipe: R_OFF, shop: S1, lines: [sku()], basedOn: (await head(R_OFF)).id }), "recipe_version:recipe_inactive", "W: a deleted (inactive) recipe");
    await refuses(async () => shopSave({ shop: S_OFF }), "recipe_version:location_not_found", "W: a closed shop");
    await refuses(async () => shopSave({ shop: u(998) }), "recipe_version:location_not_found", "W: an unknown shop");
    await refuses(async () => shopSave({ adoptedFrom: ital.id, lines: null }), "recipe_version:invalid_source", "W: adopt from the GLOBAL default");
    await refuses(async () => save({ recipe: R_ITAL, shop: S3, expected: s3v, adoptedFrom: s3v }), "recipe_version:invalid_source", "W: adopt from the shop's OWN version");
    await refuses(async () => shopSave({ adoptedFrom: (await head(R_DRESS)).id }), "recipe_version:invalid_source", "W: a source from ANOTHER recipe");
    await refuses(async () => shopSave({ restoredFrom: s3v, lines: null }), "recipe_version:restore_source_out_of_scope",
      "W: a shop RESTORE from ANOTHER shop's version (that is adopt's job)");
    await refuses(async () => save({ recipe: R_ITAL, shop: null, expected: ital.id, restoredFrom: s3v }), "recipe_version:restore_source_out_of_scope",
      "W: a GLOBAL restore from a shop's version (that is promote's job)");
    await refuses(async () => save({ recipe: R_ITAL, shop: null, expected: ital.id, promotedFrom: ital.id }), "recipe_version:invalid_source", "W: promote the GLOBAL default");
    for (const [lines, what] of [[[], "an empty set"], [Array.from({ length: 201 }, () => sku()), "201 lines"], [["x"], "a non-object line"],
      [[sku({ quantity: "2" })], "a string quantity"], [[sku({ quantity: 0 })], "a zero quantity"],
      [[sku({ component_item_id: I_SLAW })], "two components"], [[line({ component_item_id: I_SLAW, each_container_label: "tub" })], "a container label on a non-SKU line"],
      [[line({ component_item_id: I_SLAW, portioned: true })], "a portioned prep-item line"], [[line({ component_product_id: P1, unit: null })], "a product line with no unit"],
      [[sku({ keep_id: u(500) }), sku({ keep_id: u(500) })], "a duplicate kept-line id"]]) {
      await refuses(async () => shopSave({ lines }), "recipe_version:invalid_lines", `W: invalid_lines — ${what}`);
    }
    await refuses(async () => shopSave({ snap: null }), "recipe_version:dependencies_changed", "W: no snapshot at all");
    await refuses(async () => shopSave({ snap: { stale: true } }), "recipe_version:dependencies_changed", "W: a snapshot that is not the current one");
    await refuses(async () => shopSave({ expected: u(997) }), "recipe_version:version_changed", "W: a stale expected version");
    await refuses(async () => shopSave({ basedOn: (await all("select id from public.recipe_versions where recipe_id = $1 and location_id is null and not active", [R_ITAL]))[0].id }),
      "recipe_version:version_changed", "W: a shop forking a default that is no longer current");
    await refuses(async () => save({ recipe: R_ITAL, shop: null, expected: u(996), lines: [sku()] }), "recipe_version:version_changed", "W: a global save against a stale head");
    await refuses(async () => shopSave({ lines: [sku(), line({ component_product_id: P1, unit: "case" })] }), "recipe_version:product_line_invalid:2",
      "W: a product line in a vendor pack word — the refusal NAMES the line (position 2)");
    await refuses(async () => shopSave({ lines: [line({ component_product_id: P1, unit: "gill" })] }), "recipe_version:product_line_invalid:1", "W: a product line in an INACTIVE measure");
    check(await state() === before, "W: …and none of those refused calls wrote anything");
    // retire refusals
    await refuses(async () => retire({ version: u(995), recipe: R_ITAL, shop: S1, snap: {} }), "recipe_version:not_found", "W: retire an unknown version");
    await refuses(async () => retire({ version: ital.id, recipe: R_ITAL, shop: null }), "recipe_version:global_cannot_retire", "W: retire the GLOBAL default");
    await refuses(async () => retire({ version: s3v, recipe: R_ITAL, shop: S1 }), "recipe_version:not_found", "W: retire another shop's version");
    const z1 = (await save({ recipe: R_Z, shop: S1, basedOn: (await head(R_Z)).id, lines: [sku()] })).version_id;
    const z2 = (await save({ recipe: R_Z, shop: S1, expected: z1, lines: [sku({ quantity: 2 })] })).version_id;
    await refuses(async () => retire({ version: z1, recipe: R_Z, shop: S1 }), "recipe_version:not_live", "W: retire a version that is already closed (replaced by a newer one)");
    check((await shopLive(R_Z, S1))?.id === z2, "W: …the live one is untouched");
    await refuses(async () => retire({ version: s3v, recipe: R_ITAL, shop: S3, snap: { stale: true } }), "recipe_version:dependencies_changed", "W: retire with a stale snapshot");
    check((await shopLive(R_ITAL, S3))?.id === s3v, "W: …S3 still has its version");
  }
  // W2 the product rule: a broken line the set ALREADY holds may stay (with multiplicity); a copy carries nothing.
  {
    const r = (await one(`select public.create_recipe_full('{"name":"Ham sub","recipe_type":"menu","batch_yield":1}'::jsonb, $1::jsonb, '[]'::jsonb, $2) as id`,
      [JSON.stringify([{ component_product_id: P_OFF, quantity: 2, unit: "oz" }, { component_sku_id: K1, quantity: 1, unit: "oz" }]), ACTOR])).id;
    const base = await head(r);
    await asOwner(() => db.query("update public.products set active = false where id = $1", [P_OFF]));
    const broken = line({ component_product_id: P_OFF, quantity: 2, unit: "oz" });
    const shopV = (await save({ recipe: r, shop: S1, basedOn: base.id, lines: [broken, line({ component_sku_id: K1, quantity: 3 })] })).version_id;
    check(Boolean(shopV), "W2: an edit may KEEP a line that was already broken (retired product) — flagged elsewhere, never a wall");
    await refuses(async () => save({ recipe: r, shop: S1, expected: shopV, lines: [broken, broken, line({ component_sku_id: K1 })] }), "recipe_version:product_line_invalid:2",
      "W2: …but one existing broken line never licenses two (multiplicity) — the SECOND is named");
    await refuses(async () => save({ recipe: r, shop: S2, basedOn: base.id, adoptedFrom: shopV, snapLines: [broken, line({ component_sku_id: K1 })] }), "recipe_version:product_line_invalid:1",
      "W2: a COPY (adopt) carries nothing: the broken line it would bring is an addition");
    const pos = (await all("select component_product_id from public.recipe_version_lines where version_id = $1 order by display_order, id", [base.id]))
      .findIndex((l) => l.component_product_id === P_OFF) + 1;
    await refuses(async () => save({ recipe: r, shop: S1, expected: shopV, restoredFrom: base.id, snapLines: [broken] }), `recipe_version:product_line_invalid:${pos}`,
      "W2: a RESTORE of a version holding it is refused too — naming that line's position in the restored set");
    await asOwner(() => db.query("update public.products set active = true where id = $1", [P_OFF]));
  }

  // ── P provenance, its recorded end, and PROMOTE ───────────────────────────
  {
    const R = R_ITAL;
    const [a1, a2] = [S2, S3];
    const live = async (shop) => (await shopLive(R, shop))?.id ?? null;
    const row = async (id) => one("select id, location_id, active, based_on_version_id, adopted_from_version_id, adoption_ended_from_version_id, promoted_from_version_id, valid_from::text as vf, valid_to::text as vt from public.recipe_versions where id = $1", [id]);
    const base = (await head(R)).id;
    const vSource = (await save({ recipe: R, shop: S1, basedOn: base, lines: [line({ component_sku_id: K1, quantity: 9 })] })).version_id;
    const pre = (await save({ recipe: R, shop: a1, expected: await live(a1), basedOn: base, lines: [line({ component_sku_id: K1, quantity: 2 })] })).version_id;
    const adopted = (await save({ recipe: R, shop: a1, expected: pre, adoptedFrom: vSource, snapLines: [line({ component_sku_id: K1 })] })).version_id;
    let ar = await row(adopted);
    check(ar.adopted_from_version_id === vSource && ar.based_on_version_id === vSource, "P1: adopt records its source (adopted_from = based_on = the source)");
    const edited = (await save({ recipe: R, shop: a1, expected: adopted, lines: [line({ component_sku_id: K1, quantity: 10 })] })).version_id;
    check((await row(edited)).adopted_from_version_id === vSource && (await row(edited)).adoption_ended_from_version_id === null, "P2: an EDIT of an adopted version keeps the link");
    const restoredPre = (await save({ recipe: R, shop: a1, expected: edited, restoredFrom: pre, snapLines: [line({ component_sku_id: K1 })] })).version_id;
    ar = await row(restoredPre);
    check(ar.adopted_from_version_id === null && ar.adoption_ended_from_version_id === edited && ar.based_on_version_id === pre,
      "P3: a RESTORE from before the adoption ends the link, RECORDED as the replaced version (based_on is the restored one)");
    await retire({ version: restoredPre, recipe: R, shop: a1 });
    ar = await row(restoredPre);
    check(!ar.active && ar.adoption_ended_from_version_id === edited, "P4: Back to default on that row keeps its earlier end record (coalesce — never nulled, never overwritten)");
    const adopted2 = (await save({ recipe: R, shop: a1, expected: null, adoptedFrom: vSource, snapLines: [line({ component_sku_id: K1 })] })).version_id;
    await retire({ version: adopted2, recipe: R, shop: a1 });
    ar = await row(adopted2);
    check(!ar.active && ar.adoption_ended_from_version_id === adopted2, "P5: adopt → Back to default: the retired row records that ITS closing ended the link");
    const lineage = (await save({ recipe: R, shop: a1, expected: null, basedOn: (await head(R)).id, restoredFrom: adopted, snapLines: [line({ component_sku_id: K1 })] })).version_id;
    ar = await row(lineage);
    check(ar.adopted_from_version_id === vSource && ar.adoption_ended_from_version_id === null, "P6: restoring a version OF the adopted lineage takes its pointer back; nothing ends");
    // PROMOTE S1's version: one transaction writes the new default AND returns S1 to it, at the same instant.
    await retire({ version: lineage, recipe: R, shop: a1 }); // S2 rides the default again: its food WILL change
    const s3Live = await live(a2);
    const before = await head(R);
    const srcLines = await all("select component_sku_id, component_item_id, component_product_id, quantity::text as q, unit from public.recipe_version_lines where version_id = $1 order by display_order, id", [vSource]);
    const res = await save({ recipe: R, shop: null, expected: before.id, promotedFrom: vSource, lines: [], snapLines: srcLines.map((l) => ({ ...l })) , note: "promote" });
    const nh = await row(res.version_id);
    const src = await row(vSource);
    const inputs = await all("select component_sku_id, component_item_id, component_product_id, quantity::text as q, unit from public.recipe_inputs where recipe_id = $1 order by display_order, id", [R]);
    check(nh.promoted_from_version_id === vSource && nh.location_id === null && nh.active, "P7: promote opens a new GLOBAL head naming its source");
    check(!src.active && src.vt === nh.vf, "P7: …and retires the source shop's version, closing at the instant the new default opens");
    check(JSON.stringify(inputs) === JSON.stringify(srcLines) && await headEqualsInputs(R), "P7: the default's lines (recipe_inputs and the journal head) ARE the source's lines");
    check(res.returned_shop === S1 && res.returned_version_id === vSource && !res.changed_shops.includes(S1) && res.changed_shops.includes(a1),
      "P7: the result names the returned shop and leaves it out of the changed shops (its food did not change); a riding shop is in");
    check(s3Live !== null && !res.changed_shops.includes(a2), "P7: a shop with its own version is not reported as changed");
    check((await live(S1)) === null, "P7: S1 now rides the default");
    await refuses(async () => save({ recipe: R, shop: null, expected: res.version_id, promotedFrom: vSource, snapLines: srcLines }), "recipe_version:invalid_source", "P8: a retired version cannot be promoted again");
    check((await row(vSource)).adoption_ended_from_version_id === null, "P8: promoting a version that was never adopted records no adoption end");
    // P9 adopt → PROMOTE (review P2-3): the promoted version carried an adoption pointer, so its closing ENDS the link —
    // recorded on the retired row, exactly as Back to default does.
    const s1own = (await save({ recipe: R, shop: S1, expected: await live(S1), basedOn: (await head(R)).id, lines: [line({ component_sku_id: K1, quantity: 7 })] })).version_id;
    const adoptedForPromote = (await save({ recipe: R, shop: a1, expected: await live(a1), basedOn: (await head(R)).id, adoptedFrom: s1own, snapLines: [line({ component_sku_id: K1 })] })).version_id;
    const pl = await all("select component_sku_id, component_item_id, component_product_id, quantity::text as q, unit from public.recipe_version_lines where version_id = $1", [adoptedForPromote]);
    await save({ recipe: R, shop: null, expected: (await head(R)).id, promotedFrom: adoptedForPromote, lines: [], snapLines: pl });
    const pr = await row(adoptedForPromote);
    check(!pr.active && pr.adopted_from_version_id === s1own && pr.adoption_ended_from_version_id === adoptedForPromote,
      "P9: adopt → promote: the retired (promoted) row records that its closing ended the adoption link");
  }

  // ── S the dependency snapshot is SCOPED ───────────────────────────────────
  {
    const R = R_ITAL;
    const lines = [line({ component_sku_id: K1, quantity: 6 }), line({ component_product_id: P1, quantity: 3 })];
    const s0 = await snapshot(R, S1, lines);
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '1 second' where id = $1", [K_UNREL]));
    check(JSON.stringify(await snapshot(R, S1, lines)) === JSON.stringify(s0), "S1: an UNRELATED SKU's change leaves the snapshot alone");
    const ok = await save({ recipe: R, shop: S1, basedOn: (await head(R)).id, expected: (await shopLive(R, S1))?.id ?? null, lines, snap: s0 });
    check(Boolean(ok.version_id), "S1: …so a save bound to it still succeeds");
    const s1 = await snapshot(R, S1, lines);
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '2 seconds' where id = $1", [K_MEMBER]));
    check(JSON.stringify(await snapshot(R, S1, lines)) !== JSON.stringify(s1), "S2: a change to ANY member SKU of a pinned product moves it (product resolution picks among them)");
    const s2 = await snapshot(R, S1, lines);
    await asOwner(() => db.query("update public.measure_units set to_base_factor = to_base_factor * 2 where label = 'lb'"));
    check(JSON.stringify(await snapshot(R, S1, lines)) !== JSON.stringify(s2), "S3: a closure SKU's FLAT-PACK measure (the product member's each_measure, 'lb' — on no line) moves it");
    const s3 = await snapshot(R, S1, lines);
    await refuses(async () => save({ recipe: R, shop: S1, expected: ok.version_id, lines, snap: s0 }), "recipe_version:dependencies_changed", "S3: …and a save bound to the old one is refused");
    check(JSON.stringify(await snapshot(R, S1, lines)) === JSON.stringify(s3), "S3: …writing nothing");
    // An untouched shop never stales a GLOBAL preview: S3 rides its OWN Italian naming K_OTHER.
    const s3Own = (await shopLive(R, S3))?.id ?? null;
    await save({ recipe: R, shop: S3, expected: s3Own, basedOn: (await head(R)).id, lines: [line({ component_sku_id: K_OTHER })] });
    const g0 = await snapshot(R, null, lines);
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '3 seconds' where id = $1", [K_OTHER]));
    check(JSON.stringify(await snapshot(R, null, lines)) === JSON.stringify(g0), "S4: a shop with its OWN version is untouched by a global change — its ingredient never stales the global preview");
    const o0 = await snapshot(R, S3, [line({ component_sku_id: K_OTHER })]);
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '4 seconds' where id = $1", [K_OTHER]));
    check(JSON.stringify(await snapshot(R, S3, [line({ component_sku_id: K_OTHER })])) !== JSON.stringify(o0), "S4: (converse) …while S3's OWN preview does move with it");
    const g1 = await snapshot(R, null, lines);
    check((await shopLive(R, S2)) === undefined, "S5: S2 rides the default");
    await asOwner(() => db.query("insert into public.location_sku_settings (location_id, sku_id, active_override) values ($1, $2, false)", [S2, K1]));
    check(JSON.stringify(await snapshot(R, null, lines)) !== JSON.stringify(g1), "S5: a RIDING shop's activation overlay on a closure SKU moves the global preview");
    // S6 receipts are digested for PRODUCT MEMBERS only (review P3a): a plain SKU's delivery never stales a preview.
    const del = (await asOwner(() => one("insert into public.vendor_deliveries(location_id) values ($1) returning id", [S1]))).id;
    const r0 = await snapshot(R, S1, lines);
    await asOwner(() => db.query("insert into public.vendor_delivery_items(delivery_id, vendor_item_id) values ($1, $2)", [del, K1]));
    check(JSON.stringify(await snapshot(R, S1, lines)) === JSON.stringify(r0), "S6: a receipt of a plain (non-member) closure SKU leaves the snapshot alone");
    await asOwner(() => db.query("insert into public.vendor_delivery_items(delivery_id, vendor_item_id) values ($1, $2)", [del, K_MEMBER]));
    check(JSON.stringify(await snapshot(R, S1, lines)) !== JSON.stringify(r0), "S6: a receipt of a PRODUCT MEMBER moves it (product resolution's most-recently-received rung)");
    // A global preview resolves the latest product member across ALL shops, including NIL (menu promotion).
    const globalBefore = await snapshot(R, null, lines);
    const nilBefore = await snapshot(R, NIL, lines);
    const selectedMember = async () => (await one(`select di.vendor_item_id from public.vendor_delivery_items di
      join public.vendor_deliveries d on d.id = di.delivery_id
      join public.vendor_items vi on vi.id = di.vendor_item_id
      where vi.product_id = $1 order by di.created_at desc, di.id desc limit 1`, [P1]))?.vendor_item_id;
    check(await selectedMember() === K_MEMBER, "S7: the first member is selected before another shop receives a newer member");
    const otherDelivery = (await asOwner(() => one("insert into public.vendor_deliveries(location_id) values ($1) returning id", [S2]))).id;
    await asOwner(() => db.query("insert into public.vendor_delivery_items(delivery_id, vendor_item_id, created_at) values ($1, $2, now() + interval '1 hour')", [otherDelivery, K_MEMBER2]));
    check(await selectedMember() === K_MEMBER2, "S7: another shop's receipt changes the global selected member");
    check(JSON.stringify(await snapshot(R, null, lines)) !== JSON.stringify(globalBefore), "S7: the global recipe preview includes that receipt");
    check(JSON.stringify(await snapshot(R, NIL, lines)) !== JSON.stringify(nilBefore), "S7: the NIL menu-promotion preview includes that receipt");
    await refuses(async () => save({ recipe: R, shop: null, expected: (await head(R)).id, lines, snap: globalBefore }),
      "recipe_version:dependencies_changed", "S7: a global save refuses the preview taken before the selected member changed");
  }

  // ── V privilege ceilings, RLS, the helpers and the writers' grants ────────
  {
    const priv = async (t, p) => (await asOwner(() => one("select has_table_privilege('service_role', $1, $2) as ok", [`public.${t}`, p]))).ok;
    const want = { recipe_versions: ["SELECT", "INSERT", "UPDATE"], recipe_version_lines: ["SELECT", "INSERT"], recipe_notice_dismissals: ["SELECT", "INSERT"] };
    for (const [t, ps] of Object.entries(want)) {
      const has = [];
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) if (await priv(t, p)) has.push(p);
      check(JSON.stringify(has) === JSON.stringify(ps), `V: service_role on ${t} = exactly ${ps.join("/")} (got ${has.join("/")})`);
      const rls = await asOwner(() => one("select relrowsecurity as on from pg_class where oid = $1::regclass", [`public.${t}`]));
      check(rls.on, `V: RLS is on for ${t}`);
    }
    await refuses(async () => db.query("delete from public.recipe_version_lines"), "permission denied", "V: service_role cannot DELETE version lines");
    await refuses(async () => db.query("update public.recipe_version_lines set quantity = 1"), "permission denied", "V: …nor UPDATE them (immutable once committed)");
    await refuses(async () => db.query("delete from public.recipe_versions"), "permission denied", "V: …nor DELETE a version");
    await refuses(async () => db.query("truncate public.recipe_notice_dismissals"), "permission denied", "V: …nor TRUNCATE the dismissals");
    for (const f of ["recipe_global_journal($1, null, null, null)", "recipe_change_closure($1, null, '[]'::jsonb)", "recipe_change_lock($1, null, '[]'::jsonb)",
      "recipe_lines_would_cycle(null, $1, '{}'::uuid[], '{}'::uuid[])", "recipe_scope_lines(null)", "recipe_journal_lines_equal($1, $1)",
      "recipe_shops_input_would_cycle($1, $1, null)", "recipe_shops_output_would_cycle($1, $1)", "recipe_scope_item_edges(null)"]) {
      const sql = `select * from public.${f}`;
      await refuses(async () => db.query(sql, sql.includes("$1") ? [R_ITAL] : []), "permission denied", `V: service_role cannot call the helper ${f.split("(")[0]}`);
    }
    await db.exec("reset role; set role authenticated;");
    await refuses(async () => db.query("select * from public.recipe_versions"), "permission denied", "V: authenticated cannot read versions");
    await refuses(async () => db.query("select public.save_recipe_version(null, null, null, null, null, null, null, null, null, null, null)"), "permission denied", "V: authenticated cannot execute save_recipe_version");
    await refuses(async () => db.query("select public.retire_recipe_version(null, null, null, null)"), "permission denied", "V: …nor retire_recipe_version");
    await refuses(async () => db.query("select public.remove_recipe_input_atomic(null, null)"), "permission denied", "V: …nor remove_recipe_input_atomic");
    await refuses(async () => db.query("select public.recipe_change_snapshot(null, null, null)"), "permission denied", "V: …nor the snapshot");
    await db.exec("reset role; set role anon;");
    await refuses(async () => db.query("select * from public.update_recipe_input_atomic(null, null, null, null, null, 1, null, null, false, null, null, null, 1, null, null, false, null)"),
      "permission denied", "V: anon cannot execute the 17-argument overload");
    await db.exec("reset role;");
    const grants = await all(`select routine_name, grantee from information_schema.routine_privileges
      where routine_schema = 'public' and privilege_type = 'EXECUTE' and grantee in ('PUBLIC', 'anon', 'authenticated')
        and routine_name in ('save_recipe_version', 'retire_recipe_version', 'remove_recipe_input_atomic', 'recipe_change_snapshot',
          'add_recipe_input_atomic', 'update_recipe_input_atomic', 'create_recipe_full', 'add_recipe_output')`);
    check(grants.length === 0, "V: no writer is executable by PUBLIC / anon / authenticated (information_schema)");
  }

  // ── O the overload pair ───────────────────────────────────────────────────
  {
    const fns = await all(`select pronargs, prosecdef, proconfig::text as cfg, has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = 'update_recipe_input_atomic' order by pronargs`);
    check(fns.length === 2 && fns[0].pronargs === 16 && fns[1].pronargs === 17, "O: update_recipe_input_atomic exists as the 16-argument writer AND the 17-argument + p_actor overload");
    check(fns.every((f) => f.prosecdef && f.cfg.includes("search_path=pg_catalog, public") && f.svc && !f.auth), "O: both SECURITY DEFINER, search_path pinned, service_role only");
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nPASS 0262: backfill (B), journal completeness (J), the per-shop cycle law under the graph lock (C), every writer refusal by name (W), the product rule with multiplicity (W2), provenance + its recorded end + promote (P), the scoped snapshot (S), privilege ceilings (V), the overload pair (O)");
} finally { await db.close(); }
