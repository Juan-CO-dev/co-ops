/** Catalog Phase 3a — the ONE recipe-version resolver (pure): live, as of an instant, the line ops, the gate, the cycle mirror. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECIPE_GLOBAL_WRITE_MIN, RECIPE_SHOP_WRITE_MIN, RECIPE_VERSION_READ_MIN, applyRecipeLineOp, diffRecipeLineSets, parseRecipeLineOp,
  recipeVersionReadAllowed, RECIPE_VERSION_ERROR_CODES, parseRecipeVersionRefusal,
  pickLiveShopRecipeVersions, pickRecipeVersionsAsOf, recipeLineReplacements, recipeLinesWouldCycle,
  recipeVersionWriteGate, rpcRecipeLines, scopedItemEdges, versionIdsNeedingLines,
  type LiveRecipeLine, type RecipeVersionLineRow, type RecipeVersionRow,
} from "@/lib/recipe-versions-shared";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

const SHOP_A = "6f1d2c3e-0000-4000-8000-00000000000a";
const SHOP_B = "6f1d2c3e-0000-4000-8000-00000000000b";
const v = (id: string, recipe: string, loc: string | null, from: string, to: string | null): RecipeVersionRow =>
  ({ id, recipe_id: recipe, location_id: loc, valid_from: from, valid_to: to, active: to === null });
const line = (id: string, version: string, recipe: string, sku: string, qty: number, order: number): RecipeVersionLineRow => ({
  id, version_id: version, recipe_id: recipe, component_sku_id: sku, component_item_id: null, component_product_id: null,
  quantity: qty, unit: "oz", each_container_label: null, portioned: false, display_order: order,
});
const f = (sku: string, qty: number, unit = "oz"): RecipeLineFields =>
  ({ componentSkuId: sku, componentItemId: null, componentProductId: null, quantity: qty, unit, eachContainerLabel: null, portioned: false });

describe("live — a shop's own live version answers; the global head never needs lines", () => {
  const versions = [
    v("g-ital", "italian", null, "2000-01-01T00:00:00Z", null),
    v("s-ital", "italian", SHOP_A, "2026-10-10T00:00:00Z", null),
    v("s-old", "slaw", SHOP_A, "2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z"),
    v("b-ital", "italian", SHOP_B, "2026-10-11T00:00:00Z", null),
  ];
  it("shop A gets its own live Italian; its retired slaw version is not live; B's version is never A's", () => {
    const picked = pickLiveShopRecipeVersions(versions, SHOP_A);
    expect([...picked.keys()]).toEqual(["italian"]);
    expect(picked.get("italian")!.id).toBe("s-ital");
  });
  it("the global scope picks nothing live (recipe_inputs IS the live global)", () => {
    expect(pickLiveShopRecipeVersions(versions, null).size).toBe(0);
  });
});

describe("as of an instant — the version IN FORCE then", () => {
  const versions = [
    v("g1", "italian", null, "2000-01-01T00:00:00Z", "2026-10-15T14:00:00Z"),
    v("g2", "italian", null, "2026-10-15T14:00:00Z", null),
    v("s1", "slaw", SHOP_A, "2026-10-10T00:00:00Z", "2026-10-12T00:00:00Z"), // back to default on 10-12
    v("gs", "slaw", null, "2000-01-01T00:00:00Z", null),
  ];
  it("yesterday reads the old global version; today the new head", () => {
    expect(pickRecipeVersionsAsOf(versions, null, "2026-10-15T03:59:59.999Z").get("italian")!.id).toBe("g1");
    expect(pickRecipeVersionsAsOf(versions, null, "2026-10-16T03:59:59.999Z").get("italian")!.id).toBe("g2");
  });
  it("a retired shop version answers only inside its own dates", () => {
    expect(pickRecipeVersionsAsOf(versions, SHOP_A, "2026-10-11T12:00:00Z").get("slaw")!.id).toBe("s1");
    expect(pickRecipeVersionsAsOf(versions, SHOP_A, "2026-10-13T12:00:00Z").get("slaw")!.id).toBe("gs");
    expect(pickRecipeVersionsAsOf(versions, SHOP_B, "2026-10-11T12:00:00Z").get("slaw")!.id).toBe("gs");
  });
  it("only non-head versions need their lines read; replacements are in line order", () => {
    const picked = pickRecipeVersionsAsOf(versions, SHOP_A, "2026-10-11T12:00:00Z");
    expect(versionIdsNeedingLines(picked).sort()).toEqual(["g1", "s1"]);
    const rep = recipeLineReplacements(picked, [line("b", "s1", "slaw", "mayo", 24, 1), line("a", "s1", "slaw", "lettuce", 48, 0), line("x", "gs", "slaw", "mayo", 16, 1)]);
    expect(rep.get("slaw")!.map((l) => l.id)).toEqual(["a", "b"]);
    expect(rep.has("italian")).toBe(true); // g1 is NOT the live head: its own lines answer
    expect(rep.get("italian")).toEqual([]);  // (none were supplied here)
  });
  it("the LIVE global head is never a replacement — recipe_inputs answers, byte for byte", () => {
    const picked = pickRecipeVersionsAsOf(versions, null, "2026-10-16T03:59:59.999Z");
    expect(versionIdsNeedingLines(picked)).toEqual([]);
    expect(recipeLineReplacements(picked, []).size).toBe(0);
  });
});

describe("line ops — the edit a person makes, applied to the set they saw", () => {
  const lines: LiveRecipeLine[] = [{ lineId: "l1", fields: f("turkey", 4) }, { lineId: "l2", fields: f("mayo", 1) }];
  it("update replaces exactly one line and keeps its id", () => {
    const r = applyRecipeLineOp(lines, { kind: "update", lineId: "l1", line: f("turkey", 5), expected: f("turkey", 4) });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (r.ok) expect(r.lines).toEqual([{ lineId: "l1", fields: f("turkey", 5) }, lines[1]]);
  });
  it("a stale expected line is 409 line_changed; a missing line 404; nothing-changed is a no-op", () => {
    expect(applyRecipeLineOp(lines, { kind: "update", lineId: "l1", line: f("turkey", 5), expected: f("turkey", 3) })).toEqual({ ok: false, status: 409, code: "line_changed" });
    expect(applyRecipeLineOp(lines, { kind: "remove", lineId: "zz", expected: f("turkey", 4) })).toEqual({ ok: false, status: 404, code: "edge_not_found" });
    expect(applyRecipeLineOp(lines, { kind: "update", lineId: "l1", line: f("turkey", 4, " oz "), expected: f("turkey", 4) })).toMatchObject({ ok: true, changed: false });
  });
  it("add appends a new line (no id); removing the last line is refused", () => {
    const r = applyRecipeLineOp(lines, { kind: "add", line: f("pickle", 1) });
    if (!r.ok) throw new Error("expected ok");
    expect(r.lines[2]).toEqual({ lineId: null, fields: f("pickle", 1) });
    expect(applyRecipeLineOp([lines[0]!], { kind: "remove", lineId: "l1", expected: f("turkey", 4) })).toEqual({ ok: false, status: 400, code: "empty_recipe" });
  });
  it("the RPC payload names the kept line and every column", () => {
    expect(rpcRecipeLines([{ lineId: "l1", fields: f("turkey", 5) }])).toEqual([{
      keep_id: "l1", component_sku_id: "turkey", component_item_id: null, component_product_id: null,
      quantity: 5, unit: "oz", each_container_label: null, portioned: false,
    }]);
  });
});

describe("parseRecipeLineOp — the route's one parser", () => {
  const SKU = "7d0c1f2e-0000-4000-8000-000000000001";
  const LINE = "7d0c1f2e-0000-4000-8000-000000000009";
  it("accepts the three kinds with uuid ids", () => {
    expect(parseRecipeLineOp({ kind: "add", line: { componentSkuId: SKU, quantity: 2, unit: "oz" } })).toMatchObject({ ok: true, op: { kind: "add" } });
    expect(parseRecipeLineOp({ kind: "remove", lineId: LINE, expected: { componentSkuId: SKU, quantity: 2, unit: "oz" } })).toMatchObject({ ok: true, op: { kind: "remove", lineId: LINE } });
  });
  it("refuses a non-uuid id anywhere, an unknown kind, and a bad line", () => {
    expect(parseRecipeLineOp({ kind: "add", line: { componentSkuId: "x", quantity: 2 } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineOp({ kind: "remove", lineId: "nope", expected: { componentSkuId: SKU, quantity: 2 } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineOp({ kind: "rename" })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineOp({ kind: "add", line: { componentSkuId: SKU, quantity: 0 } })).toEqual({ ok: false, code: "invalid_quantity" });
  });
});

describe("diffRecipeLineSets — what changed, in plain terms (by ingredient)", () => {
  it("changed, added and removed lines", () => {
    const d = diffRecipeLineSets([f("turkey", 4), f("mayo", 1)], [f("turkey", 5), f("pickle", 1)]);
    expect(d.map((c) => [c.kind, c.key])).toEqual([["changed", "sku:turkey"], ["added", "sku:pickle"], ["removed", "sku:mayo"]]);
  });
  it("identical sets differ by nothing", () => {
    expect(diffRecipeLineSets([f("turkey", 4)], [f("turkey", 4, "oz ")])).toEqual([]);
  });
});

describe("the gate (spec §2) — GM own shop; MoO any shop and global; a ROLE rule, never level-only", () => {
  it("floors", () => { expect([RECIPE_VERSION_READ_MIN, RECIPE_SHOP_WRITE_MIN, RECIPE_GLOBAL_WRITE_MIN]).toEqual([6, 7, 8]); });
  it("a shop version needs level 7 AND the shop", () => {
    expect(recipeVersionWriteGate({ role: "agm", level: 6, scope: SHOP_A, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(recipeVersionWriteGate({ role: "gm", level: 7, scope: SHOP_B, scopeAllowed: false })).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(recipeVersionWriteGate({ role: "gm", level: 7, scope: SHOP_A, scopeAllowed: true })).toEqual({ ok: true });
  });
  it("a GM never edits the global recipe; MoO does", () => {
    expect(recipeVersionWriteGate({ role: "gm", level: 7, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "global_requires_moo" });
    expect(recipeVersionWriteGate({ role: "agm", level: 6, scope: null, scopeAllowed: false })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(recipeVersionWriteGate({ role: "moo", level: 8, scope: null, scopeAllowed: false })).toEqual({ ok: true });
    expect(recipeVersionWriteGate({ role: "moo", level: 8, scope: SHOP_B, scopeAllowed: true })).toEqual({ ok: true });
  });
  it("the social media manager (level 6) is refused every write, in a shop and globally, even with the shop", () => {
    expect(recipeVersionWriteGate({ role: "social_media_mgr", level: 6, scope: SHOP_A, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(recipeVersionWriteGate({ role: "social_media_mgr", level: 6, scope: null, scopeAllowed: true })).toEqual({ ok: false, status: 403, code: "forbidden" });
  });
  it("the version read: level 6 operational managers and up; the social media manager is refused (AGENTS.md 'LEVEL 6 IS NOT ONE THING')", () => {
    expect(recipeVersionReadAllowed("agm", 6)).toBe(true);
    expect(recipeVersionReadAllowed("prep_mgr", 6)).toBe(true);
    expect(recipeVersionReadAllowed("gm", 7)).toBe(true);
    expect(recipeVersionReadAllowed("owner", 9)).toBe(true);
    expect(recipeVersionReadAllowed("social_media_mgr", 6)).toBe(false);
    expect(recipeVersionReadAllowed("key_holder", 4)).toBe(false);
  });
});

describe("the cycle mirror (0262 recipe_scope_item_edges + recipe_lines_would_cycle)", () => {
  // slaw-r makes SLAW from DRESSING; dress-r makes DRESSING (from no items).
  const outputs = [{ recipe_id: "slaw-r", output_item_id: "SLAW" }, { recipe_id: "dress-r", output_item_id: "DRESSING" }];
  const global = [{ recipe_id: "slaw-r", component_item_id: "DRESSING" }];
  it("global: dressing consuming slaw closes a loop", () => {
    const edges = scopedItemEdges(global, new Map(), []);
    expect(recipeLinesWouldCycle({ recipeId: "dress-r", lineItemIds: ["SLAW"], startItemIds: ["SLAW"] }, outputs, edges)).toBe(true);
  });
  it("shop A's own slaw no longer uses dressing — the same dressing edit is safe THERE", () => {
    const edges = scopedItemEdges(global, new Map([["slaw-r", "sv"]]), [{ version_id: "sv", recipe_id: "slaw-r", component_item_id: null }]);
    expect(recipeLinesWouldCycle({ recipeId: "dress-r", lineItemIds: ["SLAW"], startItemIds: ["SLAW"] }, outputs, edges)).toBe(false);
  });
  it("the recipe's OWN old lines are replaced by the new set, never walked", () => {
    const edges = scopedItemEdges([...global, { recipe_id: "dress-r", component_item_id: "SLAW" }], new Map(), []);
    expect(recipeLinesWouldCycle({ recipeId: "dress-r", lineItemIds: [], startItemIds: [] }, outputs, edges)).toBe(false);
  });
});

describe("named refusals — every SQL code the writers raise is in the list, and parses", () => {
  const sql = readFileSync("supabase/migrations/0262_recipe_shop_versions.sql", "utf8");
  it("every 'recipe_version:<code>' 0262 raises is a listed code", () => {
    const raised = [...new Set([...sql.matchAll(/'recipe_version:([a-z_]+)/g)].map((m) => m[1]!))];
    expect(raised.length).toBeGreaterThan(10);
    for (const c of raised) expect(RECIPE_VERSION_ERROR_CODES as readonly string[], c).toContain(c);
  });
  it("parses a code, and a named line's position", () => {
    expect(parseRecipeVersionRefusal("ERROR: recipe_version:product_line_invalid:2")).toEqual({ code: "product_line_invalid", line: 2 });
    expect(parseRecipeVersionRefusal("recipe_version:restore_source_out_of_scope")).toEqual({ code: "restore_source_out_of_scope", line: null });
    expect(parseRecipeVersionRefusal("recipe_version:made_up")).toBeNull();
    expect(parseRecipeVersionRefusal("would_create_cycle")).toBeNull();
  });
});
