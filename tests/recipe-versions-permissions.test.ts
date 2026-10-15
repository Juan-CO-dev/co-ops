/**
 * Catalog Phase 3a — the recipe-version write gates hold INSIDE the lib, before any I/O (spec §2, §8:
 * the lib bind holds even when the route is bypassed). With no database installed, a call that got past
 * the gates fails with a plain Error ("no fake db installed"); with the fixture installed, one that got
 * all the way to the RPC fails because the stand-in has no rpc() — both prove the gates passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import {
  loadRecipeVersionHistory, RecipeVersionError, restoreRecipeVersion, retireShopRecipeVersion, saveRecipeLines,
} from "@/lib/admin/recipe-versions";
import { addedLinePositions } from "@/lib/recipe-versions-shared";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const sku = (id: string, qty: number, unit: string): RecipeLineFields =>
  ({ componentSkuId: id, componentItemId: null, componentProductId: null, quantity: qty, unit, eachContainerLabel: null, portioned: false });
const ADD = { kind: "add" as const, line: sku("s-cheese", 1, "oz") };
/** A stand-in dependency snapshot: the stand-in database has no rpc(), so the friendly-refusal tests hand one in. */
const SNAP = { test: true };

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof RecipeVersionError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("GM writes only its own shops; MoO any shop and the global default", () => {
  it("a GM of LOC cannot write OTHER's version (404, before any I/O)", async () => {
    expect(await refused(saveRecipeLines(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: OTHER, expectedVersionId: null, basedOnVersionId: null, op: ADD })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("an AGM cannot write any recipe version; a GM never edits the global recipe", async () => {
    expect(await refused(saveRecipeLines(actor("agm", 6, [LOC]), { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: null, op: ADD })))
      .toEqual({ status: 403, code: "forbidden" });
    expect(await refused(saveRecipeLines(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: null, expectedVersionId: null, basedOnVersionId: null, op: ADD })))
      .toEqual({ status: 403, code: "global_requires_moo" });
  });
  it("back to default and restore bind the shop too", async () => {
    expect(await refused(retireShopRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", versionId: "v", locationId: OTHER })))
      .toEqual({ status: 404, code: "not_found" });
    expect(await refused(restoreRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: null, fromVersionId: "v", expectedVersionId: null, basedOnVersionId: null })))
      .toEqual({ status: 403, code: "global_requires_moo" });
  });
  it("an UNASSIGNED MoO passes the gate for OTHER — it reaches the RPC (which the stand-in lacks)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const p = saveRecipeLines(actor("moo", 8, []), { recipeId: "r-slaw", scope: OTHER, expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base", op: ADD });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(RecipeVersionError);
  });
});

describe("the friendly refusals come after the bind, from the set the person saw", () => {
  it("a stale version, a forked default that moved, a stale line, the last line", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const gm = actor("gm", 7, [LOC]);
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-slaw", scope: LOC, expectedVersionId: "sv-x", basedOnVersionId: null, op: ADD, snapshot: SNAP })))
      .toEqual({ status: 409, code: "version_changed" });
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: "not-the-head", op: ADD, snapshot: SNAP })))
      .toEqual({ status: 409, code: "version_changed" });
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base",
      op: { kind: "update", lineId: "ri-01", line: sku("s-lettuce", 50, "oz"), expected: sku("s-lettuce", 47, "oz") }, snapshot: SNAP })))
      .toEqual({ status: 409, code: "line_changed" });
    expect(await refused(saveRecipeLines(gm, { recipeId: "r-pickle", scope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-pickle-base",
      op: { kind: "remove", lineId: "ri-09", expected: sku("s-pickle", 1, "jar") }, snapshot: SNAP })))
      .toEqual({ status: 400, code: "empty_recipe" });
  });
  it("restore refuses another shop's version as a source", async () => {
    const t = buildRecipeVersionsFixture();
    t.recipe_versions!.push({ id: "ov", recipe_id: "r-slaw", location_id: OTHER, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-10T00:00:00Z", created_by: null, retired_by: null });
    current = createFakeDb(t);
    expect(await refused(restoreRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: LOC, fromVersionId: "ov", expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base", snapshot: SNAP })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("a restore whose source holds a product line in a pack word is refused like an edit (Astra 3a r1#5)", async () => {
    const t = buildRecipeVersionsFixture();
    t.recipe_versions!.push({ id: "old-ham", recipe_id: "r-italian", location_id: null, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: false, valid_from: "2000-01-01T00:00:00Z", valid_to: "2000-01-01T00:00:00Z", note: null,
      created_at: "2000-01-01T00:00:00Z", created_by: null, retired_by: null });
    t.recipe_version_lines!.push({ id: "old-ham-1", version_id: "old-ham", recipe_id: "r-italian", location_id: null, component_sku_id: null,
      component_item_id: null, component_product_id: "p-ham", quantity: 1, unit: "case", each_container_label: null, portioned: false,
      display_order: 0, source_line_id: null });
    current = createFakeDb(t);
    expect(await refused(restoreRecipeVersion(actor("moo", 8, []), { recipeId: "r-italian", scope: null, fromVersionId: "old-ham",
      expectedVersionId: "rv-r-italian-base", basedOnVersionId: null, snapshot: SNAP })))
      .toEqual({ status: 400, code: "product_line_needs_measure_unit" });
  });
  it("two broken lines: fixing ONE still saves — the other is carried, not re-judged (lead decision (b))", async () => {
    const t = buildRecipeVersionsFixture();
    for (const p of t.products!) if (p.id === "p-ham" || p.id === "p-bread") p.active = false; // ri-05 and ri-06 now broken
    current = createFakeDb(t);
    const p = saveRecipeLines(actor("moo", 8, []), { recipeId: "r-italian", scope: null, expectedVersionId: "rv-r-italian-base", basedOnVersionId: null,
      op: { kind: "update", lineId: "ri-05", line: sku("s-cheese", 3, "oz"), expected: { componentSkuId: null, componentItemId: null,
        componentProductId: "p-ham", quantity: 3, unit: "oz", eachContainerLabel: null, portioned: false } }, snapshot: SNAP });
    // past validation (ri-06 is carried) → the writer's RPC, which the stand-in lacks
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(RecipeVersionError);
  });
  it("ADDING a broken line is refused and the refusal names it: position, name, reason", async () => {
    const t = buildRecipeVersionsFixture();
    for (const p of t.products!) if (p.id === "p-ham") p.active = false;
    current = createFakeDb(t);
    const err = await saveRecipeLines(actor("moo", 8, []), { recipeId: "r-italian", scope: null, expectedVersionId: "rv-r-italian-base", basedOnVersionId: null,
      op: { kind: "add", line: { componentSkuId: null, componentItemId: null, componentProductId: "p-ham", quantity: 2, unit: "oz", eachContainerLabel: null, portioned: false } },
      snapshot: SNAP }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RecipeVersionError);
    const e = err as RecipeVersionError;
    expect(e.code).toBe("invalid_component_product");
    expect(e.line).toMatchObject({ position: 7, reason: "invalid_component_product" }); // r-italian has six lines
    expect(e.line!.name.length).toBeGreaterThan(0);
  });
  it("a COPIED broken line is an addition even when an identical one is already here (Astra 3a r3#3)", async () => {
    const t = buildRecipeVersionsFixture();
    for (const p of t.products!) if (p.id === "p-ham") p.active = false; // ri-05 (ham 3 oz) is broken AND already in the default
    t.recipe_versions!.push({ id: "old-it", recipe_id: "r-italian", location_id: null, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: false, valid_from: "2000-01-01T00:00:00Z", valid_to: "2000-01-01T00:00:00Z", note: null,
      created_at: "2000-01-01T00:00:00Z", created_by: null, retired_by: null });
    for (const l of t.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
      t.recipe_version_lines!.push({ ...l, id: `old-${String(l.id)}`, version_id: "old-it" }); // an identical copy, ham included
    }
    current = createFakeDb(t);
    const err = await restoreRecipeVersion(actor("moo", 8, []), { recipeId: "r-italian", scope: null, fromVersionId: "old-it",
      expectedVersionId: "rv-r-italian-base", basedOnVersionId: null, snapshot: SNAP }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RecipeVersionError);
    // without the copy rule this restore would have passed: every line is identical to the live default's
    expect((err as RecipeVersionError).line?.position).toBeGreaterThan(0);
    expect(["invalid_component_product", "product_line_needs_measure_unit"]).toContain((err as RecipeVersionError).line?.reason);
  });
  it("addedLinePositions: only what the save adds or changes is judged", () => {
    const a = sku("s-a", 1, "oz"), b = sku("s-b", 2, "oz");
    expect(addedLinePositions([a, b], [a, b])).toEqual([]);
    expect(addedLinePositions([a, b], [b, { ...a, quantity: 5 }])).toEqual([2]);
    expect(addedLinePositions([a], [a, a])).toEqual([2]); // a duplicate of a carried line is an addition
  });
  it("history pages past the 1000-row cap: 60 versions × 20 lines all come back (Astra 3a r1#6)", async () => {
    const t = buildRecipeVersionsFixture();
    for (let v = 0; v < 60; v++) {
      const id = `hist-${String(v).padStart(2, "0")}`;
      t.recipe_versions!.push({ id, recipe_id: "r-slaw", location_id: LOC, based_on_version_id: null, adopted_from_version_id: null,
        promoted_from_version_id: null, active: false, valid_from: `2026-0${1 + (v % 9)}-01T00:00:00Z`, valid_to: "2026-10-01T00:00:00Z",
        note: null, created_at: "2026-01-01T00:00:00Z", created_by: null, retired_by: null });
      for (let l = 0; l < 20; l++) {
        t.recipe_version_lines!.push({ id: `${id}-l${String(l).padStart(2, "0")}`, version_id: id, recipe_id: "r-slaw", location_id: LOC,
          component_sku_id: "s-lettuce", component_item_id: null, component_product_id: null, quantity: l + 1, unit: "oz",
          each_container_label: null, portioned: false, display_order: l, source_line_id: null });
      }
    }
    current = createFakeDb(t);
    const rows = await loadRecipeVersionHistory(actor("gm", 7, [LOC]), "r-slaw", LOC);
    const hist = rows.filter((r) => r.id.startsWith("hist-"));
    expect(hist).toHaveLength(60);
    expect(hist.every((r) => r.lines.length === 20)).toBe(true);
  });
  it("an unchanged edit writes nothing (no RPC, no error)", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const r = await saveRecipeLines(actor("gm", 7, [LOC]), { recipeId: "r-slaw", scope: LOC, expectedVersionId: null, basedOnVersionId: "rv-r-slaw-base",
      op: { kind: "update", lineId: "ri-01", line: sku("s-lettuce", 48, "oz"), expected: sku("s-lettuce", 48, "oz") }, snapshot: SNAP });
    expect(r).toEqual({ versionId: null, retiredVersionId: null, changed: false });
  });
});

describe("the role rule (AGENTS.md 'LEVEL 6 IS NOT ONE THING') — where it is the ONLY refusal", () => {
  it("the version history read: an AGM (6) reads it; the social media manager (also 6) is refused by ROLE, before any I/O", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    expect(Array.isArray(await loadRecipeVersionHistory(actor("agm", 6, [LOC]), "r-slaw", LOC))).toBe(true);
    current = null; // nothing reachable: a refusal here is the gate, not a read
    expect(await refused(loadRecipeVersionHistory(actor("social_media_mgr", 6, [LOC]), "r-slaw", LOC))).toEqual({ status: 403, code: "forbidden" });
  });
});

describe("every named refusal the writers can return has its own en + es message", () => {
  it("each RPC code and each line-validator code is a listed recipe-version error code", async () => {
    const { RECIPE_VERSION_ERROR_CODES } = await import("@/lib/recipe-versions-shared");
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/admin/recipe-versions.ts", "utf8");
    const rpc = /const RPC_STATUS: Record<string, number> = \{([\s\S]*?)\};/.exec(src)![1]!;
    const codes = [...rpc.matchAll(/([a-z_]+):/g)].map((m) => m[1]!);
    const validator = ["invalid_component", "invalid_quantity", "invalid_payload", "invalid_component_product", "product_line_needs_measure_unit"];
    for (const c of [...codes, ...validator]) expect(RECIPE_VERSION_ERROR_CODES as readonly string[], c).toContain(c);
  });
});
