import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import rawCatalog from "../scripts/sim/launch-readiness/fixtures/manifest.json";
import { canonical, classifyTables, fingerprint, loadSnapshot, loadSnapshotManifest, ordered, parseExactJson, resolveHandle, sha256, sortedRows, stableId, synthesize, type Catalog, type FingerprintState, type Inventory, type SnapshotManifest } from "../scripts/sim/launch-readiness/fixtures";
import { deriveOrders, leafFirst, planConfig, type SchemaMeta } from "../scripts/sim/launch-readiness/schema-order";
import { exactCount } from "../scripts/sim/launch-readiness/reset";
import { SIM_LOCATIONS } from "../scripts/sim/personas-shared";

const catalog = JSON.parse(JSON.stringify(rawCatalog)) as Catalog;
const snapshot = { vendors: [{ id: "test-vendor", name: "PFG" }], vendor_items: [{ id: "test-ham", name: "Ham", vendor_id: "test-vendor" }], products: [{ id: "test-product", name: "HAM" }] };
const personas = { rosa: "test-rosa", angel: "test-angel" };
const state: FingerprintState = { schemaDigest: sha256("reviewed schema"), rosterDigest: sha256("roster"), snapshotHashes: { vendors: sha256("config") }, recipeVersion: "test-v1", anchorDateEt: "2026-09-08", primaryKeys: { ledger: ["id"] }, tables: { ledger: [{ id: "b", amount: "12.34000000000000000001" }, { id: "a", amount: null }] } };
function manifestFor(inventory: Inventory): SnapshotManifest {
  return { sanitized_at: "2026-09-09T00:00:00Z", source_export: "synthetic-test", dropped: [], tables: Object.fromEntries(inventory.CONFIG.map(table => [table, { rows: 0, sha256: sha256("[]") }])) };
}

describe("F2 pure fixtures", () => {
  it("canonicalizes nested key order while preserving null, zero and exact decimals", () => {
    expect(canonical({ b: { z: null, a: 0 }, a: 1 })).toBe(canonical({ a: 1, b: { a: 0, z: null } }));
    expect(canonical(null)).not.toBe(canonical(0));
    expect(canonical("0")).not.toBe(canonical(0));
    expect(parseExactJson('{"value":12.34000000000000000001,"count":1205,"text":"1.234"}')).toEqual({ value: "12.34000000000000000001", count: 1205, text: "1.234" });
    expect(() => canonical(undefined)).toThrow();
    expect(() => canonical(NaN)).toThrow();
  });
  it("fingerprints shuffled tables/rows identically and detects every input tamper", () => {
    expect(fingerprint({ ...state, tables: { ledger: [...state.tables.ledger!].reverse() } })).toBe(fingerprint(state));
    const variants: FingerprintState[] = [
      { ...state, schemaDigest: sha256("other schema") }, { ...state, rosterDigest: sha256("other roster") },
      { ...state, recipeVersion: "test-v2" }, { ...state, anchorDateEt: "2026-09-09" },
      { ...state, snapshotHashes: { vendors: sha256("tampered") } },
      { ...state, tables: { ledger: [{ id: "a", amount: 0 }, state.tables.ledger![0]!] } },
      { ...state, tables: { ledger: [state.tables.ledger![0]!] } },
    ];
    for (const variant of variants) expect(fingerprint(variant)).not.toBe(fingerprint(state));
    expect(() => sortedRows([{ id: "x" }, { id: "x" }], ["id"])).toThrow(/Duplicate/);
  });
  it("loads a tiny synthetic snapshot in .private and refuses byte tampering", () => {
    const dir = resolve("scripts/sim/launch-readiness/.private/snapshot-test");
    mkdirSync(dir, { recursive: true });
    const bytes = JSON.stringify(snapshot.vendors);
    const manifest: SnapshotManifest = { sanitized_at: "2026-09-09T00:00:00Z", source_export: "synthetic-test", dropped: [], tables: { vendors: { rows: 1, sha256: sha256(bytes) } } };
    writeFileSync(resolve(dir, "vendors.json"), bytes);
    writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest));
    expect(readFileSync(resolve(dir, "vendors.json"), "utf8")).toBe(bytes);
    const loaded = loadSnapshotManifest(dir);
    expect(loadSnapshot(dir, loaded)).toEqual({ vendors: snapshot.vendors });
    writeFileSync(resolve(dir, "vendors.json"), "[]");
    expect(() => loadSnapshot(dir, loaded)).toThrow(/hash mismatch/);
    writeFileSync(resolve(dir, "vendors.json"), bytes);
    expect(loadSnapshot(dir, loaded).vendors).toEqual(snapshot.vendors);
  });
  it("requires recipe handles to resolve exactly once, including the vendor", () => {
    const handle = { resolve: "snapshot" as const, table: "vendor_items", vendor: "PFG", match: { name: "Ham" } };
    expect(resolveHandle(snapshot, handle).id).toBe("test-ham");
    expect(() => resolveHandle(snapshot, { ...handle, vendor: "missing" })).toThrow();
    expect(() => resolveHandle({ ...snapshot, vendor_items: [] }, handle)).toThrow(/exactly once/);
    expect(() => resolveHandle({ ...snapshot, vendor_items: [...snapshot.vendor_items, ...snapshot.vendor_items] }, handle)).toThrow(/exactly once/);
    expect(() => resolveHandle({ ...snapshot, vendors: [...snapshot.vendors, ...snapshot.vendors] }, handle)).toThrow(/exactly once/);
  });
  it("classifies the authoritative 141-table set without overlaps", () => {
    expect(new Set(Object.values(catalog.inventory).flat()).size).toBe(141);
    expect(catalog.inventory.HISTORY).toContain("deep_clean_assignments");
    expect(catalog.blocked).toEqual([]);
    expect(classifyTables(manifestFor(catalog.inventory), catalog.inventory).size).toBe(141);
    expect(() => classifyTables(manifestFor(catalog.inventory), { ...catalog.inventory, AUTH: [...catalog.inventory.AUTH, "users"] })).toThrow(/disjoint/);
    const extra = manifestFor(catalog.inventory); extra.tables.sessions = { rows: 0, sha256: sha256("[]") };
    expect(() => classifyTables(extra, catalog.inventory)).toThrow(/unexpected table/);
  });
  it("deletes children before parents for the relevant FK families, and refuses cycles", () => {
    const foreignKeys = [
      ["checklist_completions", "checklist_instances"], ["po_lines", "purchase_orders"],
      ["vendor_delivery_items", "vendor_deliveries"], ["sku_count_lines", "sku_count_events"],
      ["catering_quote_items", "catering_quotes"], ["catering_pipeline_events", "catering_pipeline"],
      ["user_locations", "users"], ["product_primaries", "products"], ["product_primaries", "vendor_items"],
      ["sku_pack_levels", "vendor_items"], ["recipe_inputs", "recipes"], ["recipe_outputs", "recipes"],
    ].map(([child, parent]) => ({ child: child!, parent: parent! }));
    const tables = [...new Set(foreignKeys.flatMap(fk => [fk.child, fk.parent]))];
    const order = ordered(tables, foreignKeys).reverse();
    for (const fk of foreignKeys) expect(order.indexOf(fk.child)).toBeLessThan(order.indexOf(fk.parent));
    expect(() => ordered(["a", "b"], [{ child: "a", parent: "b" }, { child: "b", parent: "a" }])).toThrow(/cycle/);
  });
  it("produces stable v5 IDs and exactly 1205 header/item planning rows with the sentinel after1000", () => {
    const recipe = catalog.recipes.find(row => row.id === "over-1000")!;
    const one = synthesize(recipe, snapshot, personas), two = synthesize(recipe, snapshot, personas);
    expect(one).toEqual(two);
    expect(one.map(batch => [batch.table, batch.rows.length])).toEqual([["vendor_deliveries", 1205], ["vendor_delivery_items", 1205]]);
    const items = sortedRows(one[1]!.rows, ["id"]);
    expect(items[1204]!.created_at).toBe(recipe.expected.lastReceivedAt);
    expect(items.slice(0, 1000).some(row => row.created_at === recipe.expected.lastReceivedAt)).toBe(false);
    expect(new Set(one[0]!.rows.map(row => row.id)).size).toBe(1205);
    expect(stableId("v1", "fixture:x")).toMatch(/^[a-f0-9-]{14}5[a-f0-9]{3}-[89ab]/);
    expect(recipe.blocked).toBeTruthy(); // Planning fragment is not evidence of complete failover.
  });
  it("keys divergent count scope by the two actual location UUIDs", () => {
    const recipe = catalog.recipes.find(row => row.id === "two-shop-divergent")!;
    const rows = synthesize(recipe, snapshot, personas)[0]!.rows;
    expect(rows.map(row => row.location_id).sort()).toEqual(Object.values(SIM_LOCATIONS).map(row => row.id).sort());
    expect(rows[0]!.counted_at).not.toBe(rows[1]!.counted_at);
  });
  it("requires exact Content-Range, never treats missing or wildcard totals as zero", () => {
    expect(exactCount(new Response(null, { headers: { "content-range": "*/0" } }))).toBe(0);
    expect(exactCount(new Response(null, { headers: { "content-range": "0-499/1205" } }))).toBe(1205);
    for (const value of ["", "*/*", "0-499/*"]) expect(() => exactCount(new Response(null, { headers: { "content-range": value } }))).toThrow();
  });
});

describe("F2 schema-derived restore plan", () => {
  const inventory: Inventory = { CONFIG: ["checklist_template_items", "maintenance_equipment"], AUTH: [], HISTORY: [] };
  const schema: SchemaMeta = {
    tables: [...inventory.CONFIG], primary_keys: { checklist_template_items: ["id"], maintenance_equipment: ["id"] },
    foreign_keys: [
      { child: "checklist_template_items", parent: "maintenance_equipment", name: "equipment_fk", columns: ["equipment_id"] },
      { child: "maintenance_equipment", parent: "checklist_template_items", name: "template_fk", columns: ["template_item_id"] },
    ],
    columns_nullable: { "checklist_template_items.equipment_id": true, "maintenance_equipment.template_item_id": true },
  };
  it("breaks only the approved mutual edge, and refuses NOT NULL or unknown nullability", () => {
    const plan = deriveOrders(schema, inventory);
    expect(plan.loadOrder).toEqual(["checklist_template_items", "maintenance_equipment"]);
    expect(plan.deleteOrder).toEqual([...plan.loadOrder].reverse());
    expect(plan.loadStages.map(s => `${s.child}.${s.column}`)).toEqual(["checklist_template_items.equipment_id"]);
    expect(() => deriveOrders({ ...schema, columns_nullable: { ...schema.columns_nullable, "checklist_template_items.equipment_id": false } }, inventory)).toThrow(/NOT NULL/);
    expect(() => deriveOrders({ ...schema, columns_nullable: {} }, inventory)).toThrow(/incomplete/);
    expect(() => deriveOrders({ ...schema, tables: [...schema.tables, "extra"] }, inventory)).toThrow(/table set/);
    const unknown = { ...schema, foreign_keys: schema.foreign_keys.map(f => ({ ...f, child: f.child === "checklist_template_items" ? "other" : f.child, parent: f.parent === "checklist_template_items" ? "other" : f.parent })), tables: ["other", "maintenance_equipment"], primary_keys: { other: ["id"], maintenance_equipment: ["id"] }, columns_nullable: { "other.equipment_id": true, "maintenance_equipment.template_item_id": true } };
    expect(() => deriveOrders(unknown, { CONFIG: unknown.tables, AUTH: [], HISTORY: [] })).toThrow(/cycle/);
  });
  const self = [{ child: "sku_pack_levels", parent: "sku_pack_levels", name: "contains_fk", columns: ["contains_level_id"] }];
  it("preserves the XOR check and every value across a reverse-ordered 1002-row chain", () => {
    const rows = Array.from({ length: 1002 }, (_, index) => ({ id: String(index).padStart(4, "0"), contains_level_id: index === 1001 ? null : String(index + 1).padStart(4, "0"), contains_measure_unit: index === 1001 ? "oz" : null, amount: "1.000000000000000001" }));
    const before = canonical(rows), result = leafFirst("sku_pack_levels", rows, ["id"], self);
    const seen = new Set<unknown>();
    for (const row of result) {
      expect(Number(row.contains_level_id !== null) + Number(row.contains_measure_unit !== null)).toBe(1);
      if (row.contains_level_id !== null) expect(seen.has(row.contains_level_id)).toBe(true);
      seen.add(row.id);
    }
    expect(canonical(rows)).toBe(before);
    expect(sortedRows(result, ["id"])).toEqual(rows);
  });
  it("fails closed with the unresolved row PK for dangling, cyclic, missing and self pointers", () => {
    for (const rows of [
      [{ id: "a", contains_level_id: "missing" }],
      [{ id: "a", contains_level_id: "b" }, { id: "b", contains_level_id: "a" }],
      [{ id: "a", contains_level_id: "a" }], [{ id: "a" }],
    ]) expect(() => leafFirst("sku_pack_levels", rows, ["id"], self)).toThrow(/PK=\["a"\]/);
  });
  // The private receipt is intentionally absent in CI; synthetic graph tests always run.
  it.skipIf(!existsSync(resolve("scripts/sim/launch-readiness/.private/snapshot/schema-meta.json")))("validates the real schema and all snapshot files without database access", () => {
    const dir = resolve("scripts/sim/launch-readiness/.private/snapshot");
    const real = JSON.parse(readFileSync(resolve(dir, "schema-meta.json"), "utf8")) as SchemaMeta;
    const manifest = loadSnapshotManifest(dir), snapshot = loadSnapshot(dir, manifest);
    expect(classifyTables(manifest, catalog.inventory).size).toBe(141);
    expect(real.foreign_keys).toHaveLength(372);
    const before = canonical(snapshot), plan = planConfig(real, catalog.inventory, snapshot);
    expect(plan.deleteOrder).toHaveLength(141);
    expect(plan.loadOrder).toHaveLength(56);
    expect(plan.deleteStages.map(s => `${s.child}.${s.column}`)).toEqual([
      "catering_companies.claimed_by_customer_id", "email_receipts.linked_delivery_id", "checklist_template_items.equipment_id",
    ]);
    for (const fk of real.foreign_keys) {
      if (fk.child === fk.parent || plan.deleteStages.some(s => s.child === fk.child && s.parent === fk.parent)) continue;
      expect(plan.deleteOrder.indexOf(fk.child)).toBeLessThan(plan.deleteOrder.indexOf(fk.parent));
      if (plan.loadOrder.includes(fk.child) && plan.loadOrder.includes(fk.parent)) expect(plan.loadOrder.indexOf(fk.parent)).toBeLessThan(plan.loadOrder.indexOf(fk.child));
    }
    for (const [table, count] of Object.entries(plan.leafFirstCounts)) {
      expect(count).toBe(manifest.tables[table]!.rows);
      const seen = new Set<unknown>();
      for (const row of plan.rows[table]!) {
        for (const fk of real.foreign_keys.filter(f => f.child === table && f.parent === table)) {
          const pointer = row[fk.columns[0]!];
          if (pointer !== null) expect(seen.has(pointer)).toBe(true);
        }
        seen.add(row.id);
      }
    }
    expect(canonical(snapshot)).toBe(before);
    expect(real.primary_keys.toast_menu_cache).toEqual(["restaurant_guid"]);
    expect(real.primary_keys.user_locations).toEqual(["user_id", "location_id"]);
    expect(real.primary_keys.user_notification_prefs).toEqual(["user_id"]);
  });
});
