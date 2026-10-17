/**
 * Catalog Phase 3b — the server half over the fixture: the recipe page view, a shop preview that names
 * the sandwich it moves, a global preview that lists the untouched shop, apply refuses a stale token and
 * SAVES what the preview showed, the token binds the dependency snapshot AND every number shown, promote
 * names its returning source, the menu preview's margin and field-by-field promote with the TRUTHFUL Spanish
 * name (CC note 1 #2: never resurrected), and the Shop changes list's gate and paging. The gates (shop bind,
 * the social media manager refused by role) hold in the lib.
 * The stand-in database has no rpc(), so the two snapshot loaders are replaced by a controllable value, and a
 * recording rpc() answers the writers so a save is asserted by what it SENT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { applyRecipeChange, computeRecipePreview, loadRecipeItemView } from "@/lib/catalog/recipe-item";
import { applyMenuChange, computeMenuPreview, loadMenuItemPageView } from "@/lib/catalog/menu-item-page";
import { loadShopChanges, loadShopNotices } from "@/lib/catalog/shop-changes";
import { RecipeVersionError, writeRecipeVersion } from "@/lib/admin/recipe-versions";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

type Row = Record<string, unknown>;
let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit", () => ({ audit: async (a: Record<string, unknown>) => { audits.push(a); } }));
let snap: Record<string, unknown> = { v: 1 };
vi.mock("@/lib/admin/recipe-versions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/recipe-versions")>()),
  loadRecipeChangeSnapshot: async () => snap,
}));
vi.mock("@/lib/admin/menu-item-shop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/menu-item-shop")>()),
  loadMenuChangeSnapshot: async () => snap,
}));
let tables: Record<string, Row[]>;

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const gm = actor("gm", 7, [LOC]);
const moo = actor("moo", 8, []);
const smm = actor("social_media_mgr", 6, [LOC]);
const turkey = (qty: number) => ({ componentSkuId: "s-turkey", componentItemId: null, componentProductId: null, quantity: qty, unit: "case", eachContainerLabel: null, portioned: false });
const edit = { kind: "lines", target: { kind: "shop", shopId: LOC },
  op: { kind: "update", lineId: "ri-03", line: turkey(0.025), expected: turkey(0.0125) } } as const;

describe("owned recipe reopen and preview boundaries", () => {
  const ownedEdit = { ...edit, target: { kind: "owned", ownerLocationId: LOC } } as const;
  function ownRecipe() {
    tables.recipes!.find(r => r.id === "r-italian")!.location_id = LOC;
    tables.menu_items!.find(r => r.id === "m-italian")!.location_id = LOC;
    tables.recipe_versions = tables.recipe_versions!.filter(r => r.id !== "ov-italian");
  }
  it("projects owned capability and null version head with owner-shop picker visibility", async () => {
    ownRecipe();
    tables.vendor_items!.find(r => r.id === "s-turkey")!.location_id = LOC;
    tables.vendor_items!.find(r => r.id === "s-turkey")!.inventory_only = false;
    tables.vendor_items!.push({ ...tables.vendor_items![0], id: "foreign-input", location_id: OTHER });
    const view = (await loadRecipeItemView(gm, "r-italian", LOC))!;
    expect(view.owner).toEqual({ locationId: LOC, name: "Shop one" });
    expect(view.scope).toBe(LOC);
    expect(view.can).toMatchObject({ editOwned: true, share: false, editGlobal: false, editShop: false, shopsToEdit: [] });
    expect(view.version).toMatchObject({ scopeVersionId: "rv-r-italian-base", ridesDefault: false });
    expect(view.picker.skus.map(s => s.id)).toContain("s-turkey");
    expect(view.picker.skus.map(s => s.id)).not.toContain("foreign-input");
    expect(view.otherShopVersions).toEqual([]);
    expect(view.notices).toEqual([]);
    expect((await loadRecipeItemView(moo, "r-italian", LOC))!.can.share).toBe(true);
  });
  it("does not use null write scope as global read visibility, or foreign scope as authority", async () => {
    ownRecipe();
    expect(await loadRecipeItemView(gm, "r-italian", null)).toBeNull();
    expect(await loadRecipeItemView(gm, "r-italian", OTHER)).toBeNull();
    expect(await loadRecipeItemView(actor("gm", 7, [OTHER]), "r-italian", LOC)).toBeNull();
    await expect(loadRecipeItemView(smm, "r-italian", LOC)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("previews only the owner shop and saves the null head through the owner-bound writer", async () => {
    ownRecipe();
    const calls = recordRpc({ save_owned_recipe_version: () => ({ version_id: "owned-next", retired_version_id: "rv-r-italian-base" }) });
    const preview = await computeRecipePreview(gm, "r-italian", ownedEdit);
    expect(preview.reached.map(r => r.scope)).toEqual([LOC]);
    expect(preview.expectedVersionId).toBe("rv-r-italian-base");
    expect(preview.basedOnVersionId).toBeNull();
    expect(await applyRecipeChange(gm, "r-italian", ownedEdit, preview.token)).toEqual({ versionId: "owned-next" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fn: "save_owned_recipe_version", args: { p_expected_owner: LOC, p_expected_active_id: "rv-r-italian-base" } });
  });
  it("refuses a share between preview and save, including for MoO", async () => {
    ownRecipe();
    const calls = recordRpc({});
    const preview = await computeRecipePreview(moo, "r-italian", ownedEdit);
    tables.recipes!.find(r => r.id === "r-italian")!.location_id = null;
    await expect(applyRecipeChange(moo, "r-italian", ownedEdit, preview.token)).rejects.toMatchObject({ code: "ownership_changed" });
    expect(calls).toEqual([]);
  });
  it("owned target cannot bypass shared-default, owner, or role gates", async () => {
    await expect(computeRecipePreview(gm, "r-italian", ownedEdit)).rejects.toMatchObject({ code: "ownership_changed" });
    ownRecipe();
    await expect(computeRecipePreview(actor("gm", 7, [OTHER]), "r-italian", ownedEdit)).rejects.toMatchObject({ code: "not_found" });
    await expect(computeRecipePreview(smm, "r-italian", ownedEdit)).rejects.toMatchObject({ code: "forbidden" });
    await expect(computeRecipePreview(gm, "r-italian", edit)).rejects.toMatchObject({ code: "shop_owned_edit_here" });
  });
  it("writer never switches an expected owned save onto the shared RPC after Share", async () => {
    const calls = recordRpc({});
    await expect(writeRecipeVersion(moo, { recipeId: "r-italian", scope: null, expectedOwner: LOC,
      expectedVersionId: "rv-r-italian-base", basedOnVersionId: null, lines: [], op: "update", snapshot: {} }))
      .rejects.toMatchObject({ code: "ownership_changed" });
    expect(calls).toEqual([]);
  });
  it("owned preview refuses foreign input with its position and name", async () => {
    ownRecipe();
    tables.vendor_items!.find(r => r.id === "s-turkey")!.location_id = OTHER;
    await expect(computeRecipePreview(gm, "r-italian", ownedEdit)).rejects.toMatchObject({
      code: "line_other_shop", line: { position: 1, name: "Turkey", reason: "line_other_shop" },
    });
  });
});

type RpcCall = { fn: string; args: Record<string, unknown> };
/** A recording rpc() on the fake db: each function answers with `answers[fn]`. */
function recordRpc(answers: Record<string, (args: Record<string, unknown>) => unknown>): RpcCall[] {
  const calls: RpcCall[] = [];
  (current!.client as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const a = answers[fn];
    if (!a) return { data: null, error: { message: `no stand-in for ${fn}` } };
    return { data: a(args), error: null };
  };
  return calls;
}

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    const x = e as { status?: number; code?: string };
    if (typeof x.status === "number" && typeof x.code === "string") return { status: x.status, code: x.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  const t = buildRecipeVersionsFixture();
  // OTHER has its own Italian (so a global change leaves it untouched).
  t.recipe_versions!.push({ id: "ov-italian", recipe_id: "r-italian", location_id: OTHER, based_on_version_id: "rv-r-italian-base", adopted_from_version_id: null,
    promoted_from_version_id: null, adoption_ended_from_version_id: null, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null,
    created_at: "2026-10-10T00:00:00Z", created_by: "u1", retired_by: null });
  for (const l of t.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
    t.recipe_version_lines!.push({ ...l, id: `o-${String(l.id)}`, version_id: "ov-italian", location_id: OTHER });
  }
  t.users = [{ id: "u1", name: "Ana" }];
  t.units ??= [];
  t.toast_menu_map ??= [];
  snap = { v: 1 };
  audits.length = 0;
  tables = t;
  current = createFakeDb(t);
});
afterEach(() => { current = null; });

describe("the recipe page view", () => {
  it("a GM at its shop: riding the default, may edit its shop, not everyone; OTHER's version is listed to adopt", async () => {
    const view = (await loadRecipeItemView(gm, "r-italian", LOC))!;
    expect(view.version).toMatchObject({ ridesDefault: true, scopeVersionId: null, globalVersionId: "rv-r-italian-base" });
    expect(view.can).toMatchObject({ editShop: true, editGlobal: false });
    // No dead ends: the shops this GM may change it for — its own, never OTHER.
    expect(view.can.shopsToEdit.map((s) => s.id)).toEqual([LOC]);
    expect(view.lines.map((l) => l.lineId)).toContain("ri-03");
    expect(view.otherShopVersions.map((o) => [o.shopId, o.createdByName, o.changes.length])).toEqual([[OTHER, "Ana", 0]]);
    expect(view.makes.map((m) => m.id)).toEqual(["m-italian"]);
    expect(view.history.map((h) => h.id)).toEqual(["rv-r-italian-base"]); // global + this shop only, never OTHER's
    expect(view.history.map((h) => h.shopId)).toEqual([null]); // each row says whose it is (Restore is offered only for global or THIS shop's)
  });
  it("the slaw is USED IN the Italian, from the scope-resolved graph", async () => {
    const view = (await loadRecipeItemView(moo, "r-slaw", null))!;
    expect(view.usedIn.map((u) => u.id)).toEqual(["r-italian"]);
    expect(view.can).toMatchObject({ editShop: false, editGlobal: true });
    // The MoO may change it for every active shop.
    expect(view.can.shopsToEdit.map((s) => s.id).sort()).toEqual([LOC, OTHER].sort());
  });
  it("a GM reading ANOTHER shop's recipe sees it read-only, with its own shop as the way forward (no dead ends)", async () => {
    const view = (await loadRecipeItemView(gm, "r-italian", OTHER))!;
    expect(view.can).toMatchObject({ editShop: false, editGlobal: false });
    expect(view.can.shopsToEdit.map((s) => s.id)).toEqual([LOC]);
    const global = (await loadRecipeItemView(gm, "r-italian", null))!;
    expect(global.can).toMatchObject({ editShop: false, editGlobal: false });
    expect(global.can.shopsToEdit.map((s) => s.id)).toEqual([LOC]);
  });
  it("the social media manager is refused by ROLE in the lib (house rule)", async () => {
    expect(await refused(loadRecipeItemView(smm, "r-italian", LOC))).toEqual({ status: 403, code: "forbidden" });
  });
  it("each line of a shop version carries its lineage (source_line_id), so an open edit survives another manager's save (Astra chunks 3-4 P2 #1)", async () => {
    const view = (await loadRecipeItemView(moo, "r-italian", OTHER))!;
    const versionLines = tables.recipe_version_lines!.filter((r) => view.lines.some((l) => l.lineId === r.id));
    expect(versionLines.length).toBe(view.lines.length);
    for (const l of view.lines) {
      const row = versionLines.find((r) => r.id === l.lineId)!;
      expect(l.lineage, l.lineId).toEqual([row.source_line_id]); // the default's input it was copied from
    }
    // the default (recipe_inputs keeps its ids in place) has no lineage to walk
    const global = (await loadRecipeItemView(moo, "r-italian", null))!;
    expect(global.lines.every((l) => l.lineage.length === 0)).toBe(true);
  });
});

describe("previews", () => {
  it("a shop edit reaches that shop only, names the line change, and forks from the default it saw", async () => {
    const p = await computeRecipePreview(gm, "r-italian", edit);
    expect(p.reached.map((r) => r.scope)).toEqual([LOC]);
    expect(p.changes).toHaveLength(1);
    expect(p.expectedVersionId).toBeNull();
    expect(p.basedOnVersionId).toBe("rv-r-italian-base");
    expect(p.snapshot).toEqual({ v: 1 });
  });
  it("a global edit (MoO) reaches the default and LOC; OTHER (its own version) is untouched", async () => {
    const p = await computeRecipePreview(moo, "r-italian", { ...edit, target: { kind: "global" } });
    expect(p.reached.map((r) => r.scope)).toEqual([null, LOC]);
    expect(p.untouched.map((u) => u.shopId)).toEqual([OTHER]);
  });
  it("a GM may not preview a global save; another shop's preview is not found; the social media manager is refused", async () => {
    expect(await refused(computeRecipePreview(gm, "r-italian", { kind: "promote", sourceVersionId: "ov-italian" }))).toEqual({ status: 403, code: "global_requires_moo" });
    expect(await refused(computeRecipePreview(gm, "r-italian", { ...edit, target: { kind: "shop", shopId: OTHER } }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(computeRecipePreview(smm, "r-italian", edit))).toEqual({ status: 403, code: "forbidden" });
  });
  it("an edit that changes nothing is named (nothing_changed)", async () => {
    expect(await refused(computeRecipePreview(gm, "r-italian", { ...edit, op: { ...edit.op, line: turkey(0.0125) } }))).toEqual({ status: 400, code: "nothing_changed" });
  });
  it("the token binds the dependency snapshot: a moved dependency makes the old token stale (Astra 3b r1#3)", async () => {
    const a = await computeRecipePreview(gm, "r-italian", edit);
    snap = { v: 2 };
    expect((await computeRecipePreview(gm, "r-italian", edit)).token).not.toBe(a.token);
    expect(await refused(applyRecipeChange(gm, "r-italian", edit, a.token))).toEqual({ status: 409, code: "preview_stale" });
  });
  // The Italian is not fully costed in this fixture (its cost is null before and after); the pickle side is.
  const jar = (q: number) => ({ componentSkuId: "s-pickle", componentItemId: null, componentProductId: null, quantity: q, unit: "jar", eachContainerLabel: null, portioned: false });
  const pickle = { kind: "lines", target: { kind: "shop", shopId: LOC }, op: { kind: "update", lineId: "ri-09", line: jar(2), expected: jar(1) } } as const;
  it("names the sandwich whose cost moves, before and after, at the shop", async () => {
    const p = await computeRecipePreview(gm, "r-pickle", pickle);
    expect(p.reached).toEqual([{ scope: LOC, scopeName: "Shop one", items: [],
      menu: [{ menuItemId: "m-pickle-side", name: "Pickle side", nameEs: "Pepinillos", before: 2.4975, after: 4.995, statusBefore: "costed", statusAfter: "costed" }] }]);
  });
  it("the token binds every number shown: a price that moves changes it even under the same snapshot", async () => {
    const a = await computeRecipePreview(gm, "r-pickle", pickle);
    tables.vendor_price_history!.find((r) => r.id === "ph-11")!.unit_price = 12.5; // the pickle now costs more
    const b = await computeRecipePreview(gm, "r-pickle", pickle);
    expect(b.reached[0]!.menu[0]!.after).not.toBe(a.reached[0]!.menu[0]!.after);
    expect(b.token).not.toBe(a.token);
  });
  it("the token binds the COMPLETE change: the same result from a different baseline is another token (lead decision)", async () => {
    const a = await computeRecipePreview(gm, "r-italian", edit);
    const b = await computeRecipePreview(gm, "r-italian", { ...edit, op: { ...edit.op } });
    expect(b.token).toBe(a.token);
    tables.recipe_inputs!.find((r) => r.id === "ri-03")!.quantity = 0.02; // the line moved under the draft
    // the draft's ORIGINAL baseline is kept: the preview refuses by name rather than silently rebasing
    expect(await refused(computeRecipePreview(gm, "r-italian", edit))).toEqual({ status: 409, code: "line_changed" });
  });
  it("restore before the adoption, and back to default, say they drop the link — in the preview (Astra r6)", async () => {
    const vrow = (id: string, active: boolean, extra: Row) => ({ id, recipe_id: "r-italian", location_id: LOC,
      based_on_version_id: null, adopted_from_version_id: null, promoted_from_version_id: null, adoption_ended_from_version_id: null, active,
      valid_from: "2026-10-01T00:00:00Z", valid_to: active ? null : "2026-10-05T00:00:00Z", note: null,
      created_at: "2026-10-01T00:00:00Z", created_by: null, retired_by: null, ...extra });
    tables.recipe_versions!.push(
      vrow("pre", false, {}),
      vrow("adopted", true, { adopted_from_version_id: "ov-italian", based_on_version_id: "ov-italian", valid_from: "2026-10-05T00:00:00Z" }),
    );
    for (const id of ["pre", "adopted"]) {
      for (const l of tables.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
        tables.recipe_version_lines!.push({ ...l, id: `${id}-${String(l.id)}`, version_id: id, location_id: LOC });
      }
    }
    // a pre-adoption version needs a different line set to be a change worth restoring
    tables.recipe_version_lines!.find((l) => l.id === "pre-rvl-ri-03")!.quantity = 0.025;
    const pre = await computeRecipePreview(gm, "r-italian", { kind: "restore", target: { kind: "shop", shopId: LOC }, fromVersionId: "pre" });
    expect(pre.dropsLinkTo).toBe("Shop two");
    const back = await computeRecipePreview(gm, "r-italian", { kind: "back_to_default", shopId: LOC });
    expect(back.dropsLinkTo).toBe("Shop two");
    // a version of the adopted lineage keeps the link: no drop line
    tables.recipe_versions!.push(vrow("adopted-old", false, { adopted_from_version_id: "ov-italian", based_on_version_id: "ov-italian" }));
    for (const l of tables.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
      tables.recipe_version_lines!.push({ ...l, id: `ao-${String(l.id)}`, version_id: "adopted-old", location_id: LOC });
    }
    expect((await computeRecipePreview(gm, "r-italian", { kind: "restore", target: { kind: "shop", shopId: LOC }, fromVersionId: "adopted-old" })).dropsLinkTo).toBeNull();
  });
  it("promote: the source shop RETURNS to the default (named), it is not 'untouched' (lead decision 5)", async () => {
    const p = await computeRecipePreview(moo, "r-italian", { kind: "promote", sourceVersionId: "ov-italian" });
    expect(p.returnedShop).toEqual({ shopId: OTHER, shopName: "Shop two" });
    expect(p.untouched).toEqual([]);
    expect(p.reached.map((r) => r.scope)).toEqual([null, LOC]);
    expect(p.expectedVersionId).toBe("rv-r-italian-base");
  });
  it("an ADDED broken line is refused at preview and named; a CARRIED one is only flagged (lead decision (b))", async () => {
    for (const p of tables.products!) if (p.id === "p-ham") p.active = false; // ri-05 (ham) is now a broken line
    const carried = await computeRecipePreview(gm, "r-italian", edit);
    expect(carried.flagged).toEqual([{ position: 3, name: "Ham", reason: "invalid_component_product" }]);
    let err: unknown;
    try {
      await computeRecipePreview(gm, "r-italian", { kind: "lines", target: { kind: "shop", shopId: LOC },
        op: { kind: "add", line: { componentSkuId: null, componentItemId: null, componentProductId: "p-ham", quantity: 2, unit: "oz", eachContainerLabel: null, portioned: false } } });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RecipeVersionError);
    expect(err).toMatchObject({ status: 400, code: "invalid_component_product", line: { position: 7, name: "Ham", reason: "invalid_component_product" } });
  });
});

describe("apply saves EXACTLY what the preview showed", () => {
  it("a shop edit: the preview's snapshot, versions and lines go to the one writer; the new version comes back", async () => {
    const p = await computeRecipePreview(gm, "r-italian", edit);
    const calls = recordRpc({ save_recipe_version: () => ({ version_id: "lv-new", retired_version_id: null, changed_shops: [LOC] }) });
    expect(await applyRecipeChange(gm, "r-italian", edit, p.token)).toEqual({ versionId: "lv-new" });
    expect(calls.map((c) => c.fn)).toEqual(["save_recipe_version"]);
    expect(calls[0]!.args).toMatchObject({ p_recipe: "r-italian", p_location: LOC, p_expected: null, p_based_on: "rv-r-italian-base", p_snapshot: { v: 1 } });
    const sent = calls[0]!.args.p_lines as Array<Record<string, unknown>>;
    expect(sent.find((l) => l.component_sku_id === "s-turkey")).toMatchObject({ quantity: 0.025 });
    expect(audits).toEqual([expect.objectContaining({ action: "recipe_version.save", resourceId: "lv-new" })]);
  });
  it("a promote: copied in SQL from the source, against the global head the preview saw", async () => {
    const p = await computeRecipePreview(moo, "r-italian", { kind: "promote", sourceVersionId: "ov-italian" });
    const calls = recordRpc({ save_recipe_version: () => ({ version_id: "gv-new", retired_version_id: "rv-r-italian-base", changed_shops: [LOC], returned_shop: OTHER }) });
    expect(await applyRecipeChange(moo, "r-italian", { kind: "promote", sourceVersionId: "ov-italian" }, p.token)).toEqual({ versionId: "gv-new" });
    expect(calls[0]!.args).toMatchObject({ p_location: null, p_lines: null, p_expected: "rv-r-italian-base", p_promoted_from: "ov-italian", p_snapshot: { v: 1 } });
  });
  it("adopt: LOC takes OTHER's version", async () => {
    const change = { kind: "adopt", shopId: LOC, sourceVersionId: "ov-italian" } as const;
    const p = await computeRecipePreview(gm, "r-italian", change);
    const calls = recordRpc({ save_recipe_version: () => ({ version_id: "lv-adopt", retired_version_id: null, changed_shops: [LOC] }) });
    expect(await applyRecipeChange(gm, "r-italian", change, p.token)).toEqual({ versionId: "lv-adopt" });
    expect(calls[0]!.args).toMatchObject({ p_location: LOC, p_adopted_from: "ov-italian", p_expected: null, p_snapshot: { v: 1 } });
  });
});

describe("the menu item page", () => {
  it("the view: this shop's resolved name and price, the recipe, and its food cost here", async () => {
    const v = (await loadMenuItemPageView(gm, "m-italian", LOC))!;
    expect(v.here).toMatchObject({ settingId: null, price: null, soldHere: true, name: "Italian", nameEs: "Italiano", typedPrice: 12.5 });
    expect(v.recipe).toEqual({ id: "r-italian", name: "Italian" });
    expect(v.can).toEqual({ editShop: true, promote: false, shopsToEdit: [{ id: LOC, name: expect.any(String) }] });
    expect(await refused(loadMenuItemPageView(smm, "m-italian", LOC))).toEqual({ status: 403, code: "forbidden" });
  });
  it("no dead ends: a GM reading another shop or the global menu is read-only with its own shop as the way forward; the MoO may promote and edit every shop", async () => {
    const other = (await loadMenuItemPageView(gm, "m-italian", OTHER))!;
    expect(other.can.editShop).toBe(false);
    expect(other.can.promote).toBe(false);
    expect(other.can.shopsToEdit.map((s) => s.id)).toEqual([LOC]);
    const global = (await loadMenuItemPageView(gm, "m-italian", null))!;
    expect(global.can).toMatchObject({ editShop: false, promote: false });
    expect(global.can.shopsToEdit.map((s) => s.id)).toEqual([LOC]);
    const mooView = (await loadMenuItemPageView(moo, "m-italian", LOC))!;
    expect(mooView.can.editShop).toBe(true);
    expect(mooView.can.promote).toBe(true);
    expect(mooView.can.shopsToEdit.map((s) => s.id).sort()).toEqual([LOC, OTHER].sort());
  });
  it("the menu preview: a shop price and its margin over this shop's food cost", async () => {
    const p = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null } });
    expect(p.before.price).toBe(12.5);
    expect(p.after.price).toBe(13.5);
    expect(p.expectedSettingId).toBeNull();
    if (p.cost !== null) expect(p.marginAfter! - p.marginBefore!).toBeCloseTo(1, 10);
    expect(await refused(computeMenuPreview(gm, "m-italian", { kind: "save", shopId: OTHER, patch: { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null } })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("the menu token binds the COMPLETE patch: a Spanish-only change moves it, and an old token cannot save a new patch (Astra 3b r4#2)", async () => {
    const patch = { price: 13.5, soldHere: true, nameOverride: "Italian Grande", nameOverrideEs: "Italiano Grande" };
    const a = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch });
    const b = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, nameOverrideEs: "Italiano Grandote" } });
    expect(b.after.nameEs).toBe("Italiano Grandote");
    expect(b.token).not.toBe(a.token);
    const own = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, price: 12.5 } });
    const inherit = await computeMenuPreview(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, price: null } });
    expect(own.after.price).toBe(inherit.after.price);
    expect(own.token).not.toBe(inherit.token);
    expect(inherit.after.inherits.price).toBe(true);
    expect(await refused(applyMenuChange(gm, "m-italian", { kind: "save", shopId: LOC, patch: { ...patch, nameOverrideEs: "Otro" } }, a.token)))
      .toEqual({ status: 409, code: "preview_stale" });
  });
  it("a save with the matching token writes exactly the patch shown", async () => {
    const change = { kind: "save", shopId: LOC, patch: { price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null } } as const;
    const p = await computeMenuPreview(gm, "m-italian", change);
    const calls = recordRpc({ save_menu_item_shop_setting: () => ({ setting_id: "ms-new", retired_setting_id: null }) });
    expect(await applyMenuChange(gm, "m-italian", change, p.token)).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "save_menu_item_shop_setting", args: expect.objectContaining({ p_location: LOC, p_price: 13.5, p_expected: null, p_snapshot: { v: 1 } }) }]);
  });
  const shopRow = (id: string, loc: string, price: number | null, name: string | null, nameEs: string | null = null) => ({
    id, menu_item_id: "m-italian", location_id: loc, based_on_setting_id: null, price, sold_here: true, name_override: name,
    name_override_es: nameEs, active: true, valid_from: "2026-10-10T00:00:00Z", valid_to: null, note: null, created_by: null,
  });
  it("menu promote: field by field — a shop with its own price but the default name still changes; the source returns (Astra 3b r1#4)", async () => {
    tables.menu_item_shop_settings!.push(shopRow("ms-loc", LOC, 13.5, "Italian Grande"), shopRow("ms-other", OTHER, 14, null));
    const p = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["price", "name"] });
    expect(p.changedShops.map((c) => c.shopId)).toEqual([OTHER]);
    expect(p.returnedShop).toMatchObject({ shopId: LOC });
    const priceOnly = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["price"] });
    expect(priceOnly.changedShops).toEqual([]);
    expect(priceOnly.after).toMatchObject({ name: "Italian", nameEs: "Italiano", price: 13.5 });
    expect(await refused(computeMenuPreview(gm, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["price"] }))).toEqual({ status: 403, code: "global_requires_moo" });
    expect(await refused(computeMenuPreview(smm, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["price"] }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("the Spanish name is shown TRUTHFULLY (CC note 1 #2): the shop's pair, never the old default's; empty → the English fallback", async () => {
    tables.menu_item_shop_settings!.push(shopRow("ms-loc", LOC, null, "Italian Grande", "Italiano Grande"), shopRow("ms-en", OTHER, null, "Big Italian"));
    const named = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-loc", fields: ["name"] });
    expect(named.before.nameEs).toBe("Italiano");
    expect(named.after).toMatchObject({ name: "Italian Grande", nameEs: "Italiano Grande" });
    expect(named.spanishFallsBackToEnglish).toBe(false);
    // an English-only rename: the old "Italiano" is NOT resurrected; Spanish users will see the English name
    const english = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-en", fields: ["name"] });
    expect(english.after).toMatchObject({ name: "Big Italian", nameEs: null });
    expect(english.spanishFallsBackToEnglish).toBe(true);
    // the optional Spanish name field fills it in the same step — and is part of the token
    const typed = await computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-en", fields: ["name"], nameEs: "Italiano grande" });
    expect(typed.after.nameEs).toBe("Italiano grande");
    expect(typed.spanishFallsBackToEnglish).toBe(false);
    expect(typed.token).not.toBe(english.token);
    // a Spanish name with a price-only promote is refused by name (the lib's rule)
    expect(await refused(computeMenuPreview(moo, "m-italian", { kind: "promote", settingId: "ms-en", fields: ["price"], nameEs: "x" }))).toEqual({ status: 400, code: "invalid_payload" });
  });
  it("apply carries the typed Spanish name through the two-step promote (saved on the shop's row, then promoted)", async () => {
    tables.menu_item_shop_settings!.push(shopRow("ms-en", OTHER, null, "Big Italian"));
    const change = { kind: "promote", settingId: "ms-en", fields: ["name"], nameEs: "Italiano grande" } as const;
    // 0263's snapshot shape: after the name save it differs from the preview's ONLY by OTHER's own new row.
    const before = { item: { id: "m-italian" }, settings: [{ id: "ms-en", location_id: OTHER }], active_shops: [LOC, OTHER], costs: [] };
    const after = { ...before, settings: [{ id: "ms-en-2", location_id: OTHER }] };
    snap = before;
    let saved = false;
    const p = await computeMenuPreview(moo, "m-italian", change);
    const calls = recordRpc({
      menu_item_change_snapshot: () => (saved ? after : before),
      save_menu_item_shop_setting: () => { saved = true; return { setting_id: "ms-en-2", retired_setting_id: "ms-en" }; },
      promote_menu_item_shop_setting: () => ({ changed_shops: [LOC], before: {}, returned_shop: OTHER, retired_setting_id: "ms-en-2", remaining_setting_id: null }),
    });
    expect(await applyMenuChange(moo, "m-italian", change, p.token)).toEqual({ ok: true });
    expect(calls.find((c) => c.fn === "save_menu_item_shop_setting")!.args).toMatchObject({ p_location: OTHER, p_name: "Big Italian", p_name_es: "Italiano grande" });
    expect(calls.find((c) => c.fn === "promote_menu_item_shop_setting")!.args).toMatchObject({
      p_setting: "ms-en-2", p_fields: ["name"], p_expected_price: 12.5, p_expected_name: "Italian", p_expected_name_es: "Italiano",
    });
  });
});

describe("the Shop changes list", () => {
  it("is MoO+ (the social media manager refused by role); it lists OTHER's Italian with what changed against the default (nothing yet)", async () => {
    expect(await refused(loadShopChanges(gm))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(loadShopChanges(smm))).toEqual({ status: 403, code: "forbidden" });
    const list = await loadShopChanges(moo);
    expect(list.recipes.map((r) => [r.shopId, r.recipeId, r.sameAsDefault, r.shopName, r.createdByName])).toEqual([[OTHER, "r-italian", true, "Shop two", "Ana"]]);
    expect(list.menu).toEqual([]);
  });
  it("pages past the 1000-row cap: an 1,100-line shop version equal to its 1,100-line default reads as unchanged (Astra 3b r1#9)", async () => {
    // the default's two original lines first, in both reads (the diff pairs same-ingredient lines in order)
    for (const [i, id] of ["ri-01", "ri-02"].entries()) tables.recipe_inputs!.find((r) => r.id === id)!.display_order = i;
    for (let i = 0; i < 1098; i++) {
      tables.recipe_inputs!.push({ id: `ri-bulk-${String(i).padStart(4, "0")}`, recipe_id: "r-slaw", component_sku_id: "s-lettuce",
        component_item_id: null, component_product_id: null, quantity: 1, unit: "oz", each_container_label: null, portioned: false, display_order: 100 + i });
    }
    tables.recipe_versions!.push({ id: "lv-slaw", recipe_id: "r-slaw", location_id: LOC, based_on_version_id: "rv-r-slaw-base", adopted_from_version_id: null,
      promoted_from_version_id: null, active: true, valid_from: "2026-10-11T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-11T00:00:00Z", created_by: null, retired_by: null });
    const slaw = tables.recipe_inputs!.filter((r) => r.recipe_id === "r-slaw");
    expect(slaw).toHaveLength(1100);
    slaw.forEach((r, i) => tables.recipe_version_lines!.push({
      id: `lv-${String(i).padStart(4, "0")}`, version_id: "lv-slaw", recipe_id: "r-slaw", location_id: LOC,
      component_sku_id: r.component_sku_id ?? null, component_item_id: r.component_item_id ?? null, component_product_id: r.component_product_id ?? null,
      quantity: r.quantity, unit: r.unit ?? null, each_container_label: null, portioned: false, display_order: Number(r.display_order ?? i), source_line_id: r.id,
    }));
    const row = (await loadShopChanges(moo)).recipes.find((r) => r.versionId === "lv-slaw")!;
    expect(row.changes).toEqual([]);
    expect(row.sameAsDefault).toBe(true);
  });
});

describe("the GM's notices", () => {
  it("bind the shop and refuse the social media manager in the lib; a GM reads its own shop's", async () => {
    expect(await refused(loadShopNotices(gm, OTHER))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(loadShopNotices(smm, LOC))).toEqual({ status: 403, code: "forbidden" });
    expect(await loadShopNotices(gm, LOC)).toEqual([]);
  });
  it("an adopted copy whose source moved on raises source_changed for the adopter", async () => {
    tables.recipe_versions!.push({ id: "lv-adopted", recipe_id: "r-italian", location_id: LOC, based_on_version_id: "ov-italian",
      adopted_from_version_id: "ov-italian", promoted_from_version_id: null, adoption_ended_from_version_id: null, active: true,
      valid_from: "2026-10-11T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-11T00:00:00Z", created_by: null, retired_by: null });
    // OTHER edits its recipe: ov-italian closes, ov-italian-2 opens
    Object.assign(tables.recipe_versions!.find((v) => v.id === "ov-italian")!, { active: false, valid_to: "2026-10-12T00:00:00Z" });
    tables.recipe_versions!.push({ id: "ov-italian-2", recipe_id: "r-italian", location_id: OTHER, based_on_version_id: "ov-italian",
      adopted_from_version_id: null, promoted_from_version_id: null, adoption_ended_from_version_id: null, active: true,
      valid_from: "2026-10-12T00:00:00Z", valid_to: null, note: null, created_at: "2026-10-12T00:00:00Z", created_by: null, retired_by: null });
    const notices = await loadShopNotices(gm, LOC);
    expect(notices).toEqual([expect.objectContaining({ kind: "source_changed", recipeId: "r-italian", sourceShopId: OTHER, seenVersionId: "ov-italian-2", sourceLiveVersionId: "ov-italian-2" })]);
    // the recipe page shows the same notice for this recipe
    expect((await loadRecipeItemView(gm, "r-italian", LOC))!.notices.map((n) => n.kind)).toEqual(["source_changed"]);
  });
});


describe("owned page visibility", () => {
  it.each([null, OTHER])("recipe and menu pages hide another shop's entity at %s", async scope => {
    tables.recipes!.find(r => r.id === "r-italian")!.location_id = LOC;
    tables.menu_items!.find(r => r.id === "m-italian")!.location_id = LOC;
    expect(await loadRecipeItemView(moo, "r-italian", scope)).toBeNull();
    expect(await loadMenuItemPageView(moo, "m-italian", scope)).toBeNull();
  });
  it("their owner's page remains visible", async () => {
    tables.recipes!.find(r => r.id === "r-italian")!.location_id = LOC;
    tables.menu_items!.find(r => r.id === "m-italian")!.location_id = LOC;
    expect(await loadRecipeItemView(gm, "r-italian", LOC)).not.toBeNull();
    expect(await loadMenuItemPageView(gm, "m-italian", LOC)).not.toBeNull();
  });
});


it("direct previews refuse foreign owned recipe and menu targets", async () => {
  tables.recipes!.find(r => r.id === "r-italian")!.location_id = LOC;
  tables.menu_items!.find(r => r.id === "m-italian")!.location_id = LOC;
  expect(await refused(computeRecipePreview(moo, "r-italian", { ...edit, target: { kind: "shop", shopId: OTHER } }))).toEqual({ status: 404, code: "not_found" });
  expect(await refused(computeMenuPreview(moo, "m-italian", { kind: "back_to_default", shopId: OTHER }))).toEqual({ status: 404, code: "not_found" });
});
