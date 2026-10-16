import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedShopOwnedDb, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
let db: PGlite;
let recipe: string;
let item: string;
async function write(operation: string, payload: Record<string, unknown>, owner: string = ID.shopA) {
  return (await db.query<{ result: unknown }>("select public.write_owned_recipe($1,$2,$3,$4::jsonb,$5) result",
    [recipe, owner, operation, JSON.stringify(payload), ID.actor])).rows[0]!.result;
}
beforeAll(async () => {
  db = await migratedShopOwnedDb();
  await db.exec("alter table public.recipes add column updated_at timestamptz not null default now(), add column updated_by uuid references public.users(id)");
  // Execute original definitions, never simplified stand-ins. The common fixture
  // already carries the real 0258/0262 input/output writers and journal.
  for (const [file, name] of [["0215_batch_vs_bottle", "update_recipe_atomic"],
    ["0215_batch_vs_bottle", "remove_recipe_output"], ["0218_yield_retrain_notes", "update_recipe_output_yield"]]) {
    const sql = readFileSync(`supabase/migrations/${file}.sql`, "utf8");
    const start = sql.indexOf(`create or replace function public.${name}(`);
    await db.exec(sql.slice(start, sql.indexOf("end $$;", start) + 7));
  }
  const created = (await db.query<{ result: { id: string; output_item_ids: string[] } }>(
    "select public.create_shop_recipe($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [
      JSON.stringify({ name: "Owned batch", recipe_type: "production", batch_yield: 1, batch_mode: true }),
      JSON.stringify([{ component_sku_id: ID.sharedSku, quantity: 2, unit: "oz" }]),
      JSON.stringify([{ new_item: { name: "New prep", section: "prep" }, yield: 1 }]), ID.actor, ID.shopA,
    ])).rows[0]!.result;
  recipe = created.id; item = created.output_item_ids[0]!;
}, 120_000);
afterAll(async () => { await db?.close(); });
it("edits the committed header and batch yield through original guarded writers", async () => {
  await write("update_recipe_atomic", { p_patch: { name: "Updated batch" }, p_batch_mode: true });
  expect((await db.query("select name, location_id from recipes where id=$1", [recipe])).rows)
    .toEqual([{ name: "Updated batch", location_id: ID.shopA }]);
  expect(await write("update_recipe_output_yield", { p_output_item_id: item, p_yield: 3 }))
    .toMatchObject({ before: 1, after: 3 });
  expect((await db.query("select yield from recipe_outputs where recipe_id=$1", [recipe])).rows).toEqual([{ yield: "3" }]);
});
it("adds, edits and removes default inputs with a journal and positional ownership refusal", async () => {
  const line = await write("add_recipe_input_atomic", { p_component_sku_id: ID.sharedSku, p_quantity: 4, p_unit: "oz", p_portioned: false });
  expect(typeof line).toBe("string");
  await write("update_recipe_input_atomic", { p_input_id: line, p_component_sku_id: ID.sharedSku, p_quantity: 5, p_unit: "oz", p_portioned: false,
    p_expected_component_sku_id: ID.sharedSku, p_expected_quantity: 4, p_expected_unit: "oz", p_expected_portioned: false });
  expect((await db.query("select quantity from recipe_inputs where id=$1", [line])).rows).toEqual([{ quantity: "5" }]);
  await write("remove_recipe_input_atomic", { p_input_id: line });
  expect((await db.query("select id from recipe_inputs where id=$1", [line])).rows).toEqual([]);
  const foreign = (await db.query<{ id: string }>("insert into vendor_items(name,location_id) values ('Foreign',$1) returning id", [ID.shopB])).rows[0]!.id;
  await expect(write("add_recipe_input_atomic", { p_component_sku_id: foreign, p_quantity: 1, p_unit: "oz", p_portioned: false }))
    .rejects.toMatchObject({ message: "shop_owned:line_other_shop:2" });
  expect((await db.query("select id from recipe_inputs where recipe_id=$1", [recipe])).rows).toHaveLength(1);
  expect((await db.query("select id from recipe_versions where recipe_id=$1 and active", [recipe])).rows).toHaveLength(1);
});
it("refuses shared output and preserves batch output-removal law", async () => {
  await expect(write("add_recipe_output", { p_output_item_id: ID.sharedItem, p_yield: 1 }))
    .rejects.toMatchObject({ message: "batch_mode_single_output" });
  const output = (await db.query<{ id: string }>("select id from recipe_outputs where recipe_id=$1", [recipe])).rows[0]!.id;
  await expect(write("remove_recipe_output", { p_output_id: output })).rejects.toMatchObject({ message: "batch_mode_single_output" });
  await write("update_recipe_atomic", { p_patch: {}, p_batch_mode: false });
  await expect(write("add_recipe_output", { p_output_item_id: ID.sharedItem, p_yield: 1 })).rejects.toMatchObject({ message: "shop_owned:output_other_shop" });
  const owned = (await db.query<{ id: string }>("insert into items(name,location_id) values ('Second prep',$1) returning id", [ID.shopA])).rows[0]!.id;
  const added = await write("add_recipe_output", { p_output_item_id: owned, p_yield: 2 });
  expect(typeof added).toBe("string");
  await write("remove_recipe_output", { p_output_id: added });
  expect((await db.query("select id from recipe_outputs where recipe_id=$1", [recipe])).rows).toHaveLength(1);
});
it.each([
  { p_component_sku_id: "not-a-uuid", p_quantity: 1 },
  { p_component_sku_id: ID.sharedSku, p_quantity: "not-a-number" },
])("names malformed payload casts without mutating inputs", async payload => {
  const before = (await db.query("select * from recipe_inputs where recipe_id=$1", [recipe])).rows;
  await expect(write("add_recipe_input_atomic", { ...payload, p_unit: "oz", p_portioned: false }))
    .rejects.toMatchObject({ message: "shop_owned:invalid_payload", code: "P0001" });
  expect((await db.query("select * from recipe_inputs where recipe_id=$1", [recipe])).rows).toEqual(before);
});
it("refuses a share between owner read and write without mutation", async () => {
  await db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],$5::uuid[])", [recipe, ID.shopA, ID.actor, [item], []]);
  await expect(write("update_recipe_atomic", { p_patch: { name: "Stale forbidden edit" } }))
    .rejects.toMatchObject({ message: "shop_owned:ownership_changed" });
  expect((await db.query("select name, location_id from recipes where id=$1", [recipe])).rows)
    .toEqual([{ name: "Updated batch", location_id: null }]);
});
