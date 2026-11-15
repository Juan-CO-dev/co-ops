/**
 * Local Postgres proof of migration 0308 (W08/B057: a shop-scoped vendor swap stays shop-scoped), SYNTHETIC
 * ROWS ONLY — PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0308.mjs
 *
 * Executes the REAL 0258 → 0264, 0265 and 0308 over tests/fixtures/recipe-versions-pglite-stub.sql (the same
 * chain and two-shop seed as tests/fixtures/shop-owned-pglite.ts), then proves:
 *   P0  the preflight refuses without 0265; 0308 applies over 0265 and re-applies cleanly
 *   P1  a SHOP-scoped swap of an EXISTING product with no default refuses swap:product_needs_primary and writes
 *       nothing (no primary, no membership, no journal, no recipe version) — the other shop does not move
 *   P2  a swap that CREATES the product still pins the default to the old item; Back removes it
 *   P3  a product that already has a default: no default write; Back leaves the default as it was
 *   P4  a GLOBAL swap of an existing product with no default is unchanged (no refusal, no default written)
 *   P5  Back on a PRE-0308 journal (default_created set, grouping_created false) deletes the stray default at
 *       its exact revision; a default re-chosen since (revision bumped) is KEPT
 *   P6  the ACL: definer, pinned search_path, service_role only, no PUBLIC; the stale-evidence checks still run
 *       first (product_changed beats product_needs_primary)
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/recipe-versions-pglite-stub.sql");
const CHAIN = ["0258_recipe_input_write_atomic", "0259_sku_shop_versions", "0260_sku_pack_versions_finalize",
  "0261_sku_pack_change_requests", "0262_recipe_shop_versions", "0263_menu_item_shop_settings", "0264_catalog_shop_owned"]
  .map((m) => read(`supabase/migrations/${m}.sql`));
const M0265 = read("supabase/migrations/0265_sku_swaps.sql");
const M0308 = read("supabase/migrations/0308_sku_swap_shop_scope.sql");

const I = {
  actor: "00000000-0000-4000-8000-0000000000a1",
  shopA: "00000000-0000-4000-8000-00000000a0a0",
  shopB: "00000000-0000-4000-8000-00000000b0b0",
  sharedSku: "00000000-0000-4000-8000-0000000000d1",
  sharedItem: "00000000-0000-4000-8000-0000000000d2",
  sharedRecipe: "00000000-0000-4000-8000-0000000000e1",
  sharedMenu: "00000000-0000-4000-8000-0000000000f1",
};
const NEXT = "00000000-0000-4000-8000-0000000000d3";
const THIRD = "00000000-0000-4000-8000-0000000000d4";
const SEED = `
  insert into public.users(id) values ('${I.actor}');
  insert into public.locations(id, name, active) values ('${I.shopA}', 'Shop A', true), ('${I.shopB}', 'Shop B', true);
  insert into public.measure_units(label, dimension, to_base_factor, active) values ('oz', 'weight', 1, true);
  insert into public.prep_sections(slug, label_en, columns) values ('prep', 'Prep', '[]');
  insert into public.vendor_items(id, name) values ('${I.sharedSku}', 'Shared turkey');
  insert into public.items(id, name) values ('${I.sharedItem}', 'Shared prep');
  insert into public.menu_items(id, name, menu_price) values ('${I.sharedMenu}', 'Shared sandwich', 12);
  insert into public.recipes(id, name, recipe_type, batch_yield, created_by)
    values ('${I.sharedRecipe}', 'Shared sandwich', 'consumer', 1, '${I.actor}');
  insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit, created_by)
    values ('${I.sharedRecipe}', '${I.sharedSku}', 4, 'oz', '${I.actor}');
  insert into public.recipe_outputs(recipe_id, output_menu_item_id, yield, created_by)
    values ('${I.sharedRecipe}', '${I.sharedMenu}', 1, '${I.actor}');
`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ m0265 = true, m0308 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const m of CHAIN) await db.exec(m);
  await db.exec(SEED);
  if (m0265) await db.exec(M0265);
  if (m0308) await db.exec(M0308);
  await db.query("insert into vendor_items(id, name) values ($1, 'Replacement'), ($2, 'Third')", [NEXT, THIRD]);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params = []) => Number((await one(db, `select count(*)::int n from (${sql}) x`, params)).n);
async function preview(db, scope) {
  return one(db, "select sku_swap_product_snapshot($1,$2,$3) p, sku_swap_recipe_snapshot($1,$2,$3) r", [I.sharedSku, NEXT, scope]);
}
async function start(db, p, scope, temporary = true) {
  const recipes = p.r.map((r) => ({ ...r, replacement_lines: r.lines.map((l) => ({ ...l, component_sku_id: l.component_sku_id === I.sharedSku ? NEXT : l.component_sku_id })) }));
  return (await one(db, "select start_sku_swap($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,null) r",
    [I.sharedSku, NEXT, scope, I.actor, JSON.stringify(p.p), JSON.stringify(recipes), temporary])).r;
}
const end = async (db, swap) => (await one(db, "select end_sku_swap($1,$2) r", [swap, I.actor])).r;
async function existingProduct(db, { withDefault = false } = {}) {
  const product = (await one(db, "insert into products(name) values ('Existing') returning id")).id;
  await db.query("update vendor_items set product_id=$1 where id in ($2,$3,$4)", [product, I.sharedSku, NEXT, THIRD]);
  if (withDefault) await db.query("insert into product_primaries(product_id, primary_sku_id, note) values ($1,$2,'Chosen')", [product, THIRD]);
  return product;
}

// ── P0 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base({ m0265: false, m0308: false });
  await refuses(() => db.exec(M0308), "0265 (sku swaps) must be applied first", "P0 the preflight refuses without 0265");
  await db.close();
  const db2 = await base();
  await db2.exec(M0308);
  check(true, "P0 0308 applies over 0265 and re-applies cleanly");
  await db2.close();
}

// ── P1 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  const product = await existingProduct(db);
  const p = await preview(db, I.shopA);
  const versionsBefore = await count(db, "select id from recipe_versions");
  await refuses(() => start(db, p, I.shopA), "swap:product_needs_primary", "P1 a shop-scoped swap of an existing product with no default refuses");
  check(await count(db, "select id from product_primaries where product_id=$1", [product]) === 0, "P1 no primary of any scope is written (the other shop does not move)");
  check(await count(db, "select id from sku_swaps") === 0, "P1 no journal row");
  check(await count(db, "select id from recipe_versions") === versionsBefore, "P1 no recipe version");
  await db.close();
}

// ── P2 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  const s = await start(db, await preview(db, I.shopA), I.shopA);
  const def = await one(db, "select primary_sku_id from product_primaries where product_id=$1 and location_id is null", [s.product_id]);
  check(def?.primary_sku_id === I.sharedSku, "P2 a swap that creates the product pins the default to the old item");
  const journal = await one(db, "select grouping_created, default_created is not null d from sku_swaps where id=$1", [s.swap_id]);
  check(journal.grouping_created === true && journal.d === true, "P2 the journal records the created grouping and its default");
  const r = await end(db, s.swap_id);
  check(r.grouping === "restored", "P2 Back restores the grouping");
  check(await count(db, "select id from product_primaries where product_id=$1", [s.product_id]) === 0, "P2 Back removes the default it created");
  await db.close();
}

// ── P3 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  const product = await existingProduct(db, { withDefault: true });
  const before = await one(db, "select id, revision, primary_sku_id from product_primaries where product_id=$1 and location_id is null", [product]);
  const s = await start(db, await preview(db, I.shopA), I.shopA);
  check((await one(db, "select default_created from sku_swaps where id=$1", [s.swap_id])).default_created === null, "P3 an existing default: no default write");
  await end(db, s.swap_id);
  const after = await one(db, "select id, revision, primary_sku_id from product_primaries where product_id=$1 and location_id is null", [product]);
  check(JSON.stringify(after) === JSON.stringify(before), "P3 Back leaves the existing default exactly as it was");
  check(await count(db, "select id from product_primaries where product_id=$1 and location_id=$2", [product, I.shopA]) === 0, "P3 Back removes the shop row");
  await db.close();
}

// ── P4 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  const product = await existingProduct(db);
  const s = await start(db, await preview(db, null), null, false);
  check(!!s.swap_id, "P4 a global swap of an existing product with no default still runs");
  const rows = (await db.query("select location_id, primary_sku_id from product_primaries where product_id=$1", [product])).rows;
  check(rows.length === 1 && rows[0].location_id === null && rows[0].primary_sku_id === NEXT, "P4 only the global primary the swap names is written");
  await db.close();
}

// ── P5 ──────────────────────────────────────────────────────────────────────────────────────────────────────
for (const bumped of [false, true]) {
  const db = await base();
  const product = await existingProduct(db);
  // A pre-0308 journal, hand-built exactly as 0265 wrote it: the global default (= old) AND the shop row.
  const def = (await one(db, "insert into product_primaries(product_id, primary_sku_id, updated_by) values ($1,$2,$3) returning to_jsonb(product_primaries) j", [product, I.sharedSku, I.actor])).j;
  const shop = (await one(db, "insert into product_primaries(product_id, location_id, primary_sku_id, updated_by) values ($1,$2,$3,$4) returning to_jsonb(product_primaries) j", [product, I.shopA, NEXT, I.actor])).j;
  const snap = (await one(db, "select sku_swap_product_snapshot($1,$2,$3) p", [I.sharedSku, NEXT, I.shopA])).p;
  const swap = (await one(db, `insert into sku_swaps(old_sku_id,new_sku_id,location_id,product_id,temporary,product_snapshot_before,product_snapshot_after,primary_before,primary_after,recipes,grouping_created,default_created,created_by)
    values ($1,$2,$3,$4,true,$5::jsonb,$5::jsonb,'null'::jsonb,$6::jsonb,'[]'::jsonb,false,$7::jsonb,$8) returning id`,
    [I.sharedSku, NEXT, I.shopA, product, JSON.stringify(snap), JSON.stringify(shop), JSON.stringify(def), I.actor])).id;
  if (bumped) await db.query("update product_primaries set primary_sku_id=primary_sku_id where id=$1", [def.id]);
  const r = await end(db, swap);
  check(r.primary === "restored", `P5${bumped ? "b" : "a"} Back restores the shop primary`);
  const left = await count(db, "select id from product_primaries where id=$1", [def.id]);
  if (bumped) check(left === 1, "P5b a stray default re-chosen since (revision bumped) is KEPT");
  else check(left === 0, "P5a Back deletes the pre-0308 stray default at its exact revision");
  check(await count(db, "select id from product_primaries where product_id=$1 and location_id=$2", [product, I.shopA]) === 0, `P5${bumped ? "b" : "a"} the shop row is gone`);
  await db.close();
}

// ── P6 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  for (const sig of ["start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb)", "end_sku_swap(uuid,uuid)"]) {
    const row = await one(db, `select has_function_privilege('anon',$1,'execute') a, has_function_privilege('authenticated',$1,'execute') b,
      has_function_privilege('service_role',$1,'execute') c, p.prosecdef d, p.proconfig::text e
      from pg_proc p where p.oid = $1::regprocedure`, [sig]);
    check(!row.a && !row.b && row.c, `P6 ${sig}: service_role only`);
    check(row.d && /search_path=pg_catalog, ?public/.test(row.e), `P6 ${sig}: definer with a pinned search_path`);
  }
  const product = await existingProduct(db);
  const p = await preview(db, I.shopA);
  await db.query("update vendor_items set name='Changed' where id=$1", [NEXT]);
  await refuses(() => start(db, p, I.shopA), "swap:product_changed", "P6 stale evidence is still refused first (product_changed)");
  check(await count(db, "select id from product_primaries where product_id=$1", [product]) === 0, "P6 nothing written");
  await db.close();
}

if (failures > 0) {
  console.error(`FAIL 0308: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS 0308: ${checks} checks`);
