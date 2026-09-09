import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import rawCatalog from "../scripts/sim/launch-readiness/fixtures/manifest.json";
import { canonical, classifyTables, deleteOrder, fingerprint, loadSnapshot, loadSnapshotManifest, ordered, parseExactJson, resolveHandle, sha256, sortedRows, stableId, synthesize, type Catalog, type FingerprintState, type Inventory, type SnapshotManifest } from "../scripts/sim/launch-readiness/fixtures";
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
  it("enforces exactly 141 disjoint classifications; supplied 140-table inventory stays blocked", () => {
    expect(new Set(Object.values(catalog.inventory).flat()).size).toBe(140);
    expect(() => classifyTables(manifestFor(catalog.inventory), catalog.inventory)).toThrow(/141 tables; found 140/);
    expect(catalog.blocked.length).toBeGreaterThan(0);
    // Pure validator positive control, NOT a claim that this is the missing real table.
    const complete = { ...catalog.inventory, HISTORY: [...catalog.inventory.HISTORY, "synthetic_validator_only"] };
    expect(classifyTables(manifestFor(complete), complete).size).toBe(141);
    expect(() => classifyTables(manifestFor(complete), { ...complete, AUTH: [...complete.AUTH, "users"] })).toThrow(/disjoint/);
    const extra = manifestFor(complete); extra.tables.sessions = { rows: 0, sha256: sha256("[]") };
    expect(() => classifyTables(extra, complete)).toThrow(/unexpected table/);
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
    expect(() => deleteOrder(catalog)).toThrow(/cycle/);
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
