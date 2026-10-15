/**
 * Catalog Phase 3a — 0258 → 0259 → 0260 → 0261 → 0262 AS COMMITTED, in PGlite (no network, no real database), over
 * the minimum stub base tables they read (tests/fixtures/recipe-versions-pglite-stub.sql), and helpers that call the REAL
 * writers. Nothing here fabricates a version row: every row a test
 * reads was written by save_recipe_version / retire_recipe_version / the journal.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** The minimum base schema the REAL 0258 → 0262 read and write (shared with scripts/sql-harness-0262.mjs). */
const STUB = readFileSync("tests/fixtures/recipe-versions-pglite-stub.sql", "utf8");
/** Every migration 0262 builds on, then 0262 itself — as committed (0259–0261: the pack/price tables its snapshot reads). */
const CHAIN = ["0258_recipe_input_write_atomic", "0259_sku_shop_versions", "0260_sku_pack_versions_finalize",
  "0261_sku_pack_change_requests", "0262_recipe_shop_versions"];

export const ID = {
  actor: "00000000-0000-4000-8000-0000000000a1",
  source: "00000000-0000-4000-8000-0000000000b0", // the shop others adopt from
  adopters: ["00000000-0000-4000-8000-0000000000c1", "00000000-0000-4000-8000-0000000000c2",
             "00000000-0000-4000-8000-0000000000c3", "00000000-0000-4000-8000-0000000000c4"],
  sku: "00000000-0000-4000-8000-0000000000d1",
  recipe: "00000000-0000-4000-8000-0000000000e1",
} as const;

/** Stub base tables → 0258 … 0262, as committed; one recipe (one SKU line), the source shop and four adopters. */
export async function migratedRecipeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB);
  for (const m of CHAIN) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, "utf8"));
  const shops = [ID.source, ...ID.adopters].map((id, i) => `('${id}', '${i === 0 ? "Source shop" : `Adopter ${i}`}', true)`).join(", ");
  await db.exec(`
    insert into public.users(id) values ('${ID.actor}');
    insert into public.locations(id, name, active) values ${shops};
    insert into public.measure_units(label, dimension, to_base_factor, active) values ('oz', 'weight', 1, true);
    insert into public.vendor_items(id, name) values ('${ID.sku}', 'Turkey');
    begin;
    insert into public.recipes(id, name) values ('${ID.recipe}', 'Italian');
    insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ('${ID.recipe}', '${ID.sku}', 1, 'oz');
    commit;
  `);
  return db;
}

const SNAP_LINES = JSON.stringify([{ component_sku_id: ID.sku }]); // every set here names only this SKU: the same closure
const lines = (qty: number) => JSON.stringify([{ component_sku_id: ID.sku, quantity: qty, unit: "oz", portioned: false }]);

export async function globalHead(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from public.recipe_versions where recipe_id = $1 and location_id is null and active`, [ID.recipe]);
  return r.rows[0]!.id;
}

/** The REAL save_recipe_version; returns the new version id. */
export async function save(db: PGlite, a: {
  shop: string | null; expected: string | null; basedOn?: string | null; qty?: number;
  restoredFrom?: string; adoptedFrom?: string; promotedFrom?: string;
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select (public.save_recipe_version($1::uuid, $2::uuid, $3::jsonb, $4::uuid, $5::uuid, null, $6::uuid, $7::uuid, $8::uuid, $9::uuid,
              public.recipe_change_snapshot($1::uuid, $2::uuid, $10::jsonb))) ->> 'version_id' as id`,
    [ID.recipe, a.shop, a.qty === undefined ? null : lines(a.qty), a.expected, a.basedOn ?? null, ID.actor,
     a.restoredFrom ?? null, a.adoptedFrom ?? null, a.promotedFrom ?? null, SNAP_LINES],
  );
  return r.rows[0]!.id;
}

/** The REAL retire_recipe_version (back to default). */
export async function backToDefault(db: PGlite, versionId: string, shop: string): Promise<void> {
  await db.query(`select public.retire_recipe_version($1::uuid, $2::uuid, $3::uuid, public.recipe_change_snapshot($4::uuid, $2::uuid, $5::jsonb))`,
    [versionId, shop, ID.actor, ID.recipe, SNAP_LINES]);
}

export interface WrittenVersion {
  id: string; location_id: string | null; active: boolean; based_on_version_id: string | null;
  adopted_from_version_id: string | null; adoption_ended_from_version_id: string | null;
}

export async function versionRows(db: PGlite): Promise<WrittenVersion[]> {
  const r = await db.query<WrittenVersion>(
    `select id, location_id, active, based_on_version_id, adopted_from_version_id, adoption_ended_from_version_id
       from public.recipe_versions where recipe_id = $1 order by created_at, id`, [ID.recipe]);
  return r.rows;
}

/** The four sequences (Astra r7), through the real writers; returns the ids each test asserts on. */
export async function runProvenanceSequences(db: PGlite) {
  const [a1, a2, a3, a4] = ID.adopters;
  const head = await globalHead(db);
  const vSource = await save(db, { shop: ID.source, expected: null, basedOn: head, qty: 3 });
  // (1) adopt → restore a PRE-adoption version
  const pre1 = await save(db, { shop: a1!, expected: null, basedOn: head, qty: 2 });
  const adopted1 = await save(db, { shop: a1!, expected: pre1, adoptedFrom: vSource });
  const restoredPre = await save(db, { shop: a1!, expected: adopted1, restoredFrom: pre1 });
  // (2) adopt → restore GLOBAL history
  const adopted2 = await save(db, { shop: a2!, expected: null, adoptedFrom: vSource });
  const restoredGlobal = await save(db, { shop: a2!, expected: adopted2, restoredFrom: head });
  // (3) adopt → back to default
  const adopted3 = await save(db, { shop: a3!, expected: null, adoptedFrom: vSource });
  await backToDefault(db, adopted3, a3!);
  // (4) adopt → edit → restore the ADOPTED lineage: the link is kept, nothing ends
  const adopted4 = await save(db, { shop: a4!, expected: null, adoptedFrom: vSource });
  const edited4 = await save(db, { shop: a4!, expected: adopted4, qty: 5 });
  const restoredLineage = await save(db, { shop: a4!, expected: edited4, restoredFrom: adopted4 });
  // (5) adopt → restore pre-adoption → BACK TO DEFAULT (Astra r8): the restore's "link ended" record must survive
  // the later retirement of that same row (it carries no pointer, so Back to default ends nothing new).
  await backToDefault(db, restoredPre, a1!);
  return { vSource, pre1, adopted1, restoredPre, adopted2, restoredGlobal, adopted3, adopted4, edited4, restoredLineage };
}
