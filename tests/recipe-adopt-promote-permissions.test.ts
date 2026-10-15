/**
 * Catalog Phase 3b — adopt binds the adopting shop; promote is MoO+; the notice answer binds the shop; the menu
 * promote is MoO+ and carries the optional Spanish name. The gates hold INSIDE the lib, before any I/O (house rule:
 * location bind + the social media manager refused live in the lib). Success paths run on the fixture with a
 * recording rpc() stand-in and assert what was SENT and RETURNED — never "not an error of type X".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { adoptRecipeVersion, dismissRecipeNotice, promoteRecipeVersion, RecipeVersionError } from "@/lib/admin/recipe-versions";
import { MenuShopError, promoteMenuItemShopSetting } from "@/lib/admin/menu-item-shop";
import { NIL_SCOPE } from "@/lib/sku-versions-shared";
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
afterEach(() => { current = null; audits.length = 0; });

const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;
const SNAP = { snap: "preview" };

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof RecipeVersionError || e instanceof MenuShopError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

type RpcCall = { fn: string; args: Record<string, unknown> };
/** The fixture plus a recording rpc() that answers each function with `answers[fn]`. */
function install(tables: Record<string, Row[]>, answers: Record<string, (args: Record<string, unknown>) => unknown>): RpcCall[] {
  current = createFakeDb(tables);
  const calls: RpcCall[] = [];
  (current.client as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const a = answers[fn];
    if (!a) return { data: null, error: { message: `no stand-in for ${fn}` } };
    return { data: a(args), error: null };
  };
  return calls;
}

/** OTHER's live version of the slaw (60 oz lettuce + 16 oz mayo) — what LOC adopts / what a MoO promotes. */
function withOtherSlaw(): Record<string, Row[]> {
  const t = buildRecipeVersionsFixture();
  t.recipe_versions!.push({
    id: "sv-other-slaw", recipe_id: "r-slaw", location_id: OTHER, based_on_version_id: "rv-r-slaw-base", adopted_from_version_id: null,
    promoted_from_version_id: null, adoption_ended_from_version_id: null, active: true, valid_from: "2026-10-10T00:00:00.000Z", valid_to: null,
    note: null, created_at: "2026-10-10T00:00:00.000Z", created_by: null, retired_by: null,
  });
  for (const [i, [sku, qty]] of ([["s-lettuce", 60], ["s-mayo", 16]] as const).entries()) {
    t.recipe_version_lines!.push({
      id: `svl-${i}`, version_id: "sv-other-slaw", recipe_id: "r-slaw", location_id: OTHER, component_sku_id: sku, component_item_id: null,
      component_product_id: null, quantity: qty, unit: "oz", each_container_label: null, portioned: false, display_order: i, source_line_id: null,
    });
  }
  return t;
}

describe("adopt", () => {
  it("a GM adopts only INTO its own shop (404 before any I/O); the social media manager is refused by role", async () => {
    expect(await refused(adoptRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", locationId: OTHER, sourceVersionId: "sv-x", expectedVersionId: null })))
      .toEqual({ status: 404, code: "not_found" });
    expect(await refused(adoptRecipeVersion(actor("social_media_mgr", 6, [LOC]), { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "sv-x", expectedVersionId: null })))
      .toEqual({ status: 403, code: "forbidden" });
    expect(await refused(adoptRecipeVersion(actor("agm", 6, [LOC]), { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "sv-x", expectedVersionId: null })))
      .toEqual({ status: 403, code: "forbidden" });
  });
  it("the source must be ANOTHER shop's LIVE version of THIS recipe (invalid_source, named)", async () => {
    install(withOtherSlaw(), {});
    const gm = actor("gm", 7, [LOC]);
    // the default's own version is not another shop's
    expect(await refused(adoptRecipeVersion(gm, { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "rv-r-slaw-base", expectedVersionId: null, snapshot: SNAP })))
      .toEqual({ status: 400, code: "invalid_source" });
    // another recipe's version
    expect(await refused(adoptRecipeVersion(gm, { recipeId: "r-italian", locationId: LOC, sourceVersionId: "sv-other-slaw", expectedVersionId: null, snapshot: SNAP })))
      .toEqual({ status: 400, code: "invalid_source" });
    // no such version
    expect(await refused(adoptRecipeVersion(gm, { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "nope", expectedVersionId: null, snapshot: SNAP })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("its own shop: the lines are copied IN SQL from the source, the preview's snapshot rides along, and the result is returned", async () => {
    const calls = install(withOtherSlaw(), {
      save_recipe_version: () => ({ version_id: "sv-loc-new", retired_version_id: null, changed_shops: [LOC] }),
    });
    const r = await adoptRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "sv-other-slaw", expectedVersionId: null, snapshot: SNAP });
    expect(r).toEqual({ versionId: "sv-loc-new", retiredVersionId: null, changedShops: [LOC], returnedShop: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fn: "save_recipe_version",
      args: { p_recipe: "r-slaw", p_location: LOC, p_lines: null, p_expected: null, p_adopted_from: "sv-other-slaw", p_promoted_from: null, p_restored_from: null, p_actor: "u1", p_snapshot: SNAP },
    });
    expect(audits).toEqual([expect.objectContaining({ action: "recipe_version.adopt", resourceId: "sv-loc-new" })]);
  });
  it("a direct call (no preview) takes the scoped snapshot over the SOURCE's lines first", async () => {
    const calls = install(withOtherSlaw(), {
      recipe_change_snapshot: () => ({ snap: "now" }),
      save_recipe_version: () => ({ version_id: "sv-loc-new", retired_version_id: null, changed_shops: [LOC] }),
    });
    await adoptRecipeVersion(actor("gm", 7, [LOC]), { recipeId: "r-slaw", locationId: LOC, sourceVersionId: "sv-other-slaw", expectedVersionId: null });
    expect(calls.map((c) => c.fn)).toEqual(["recipe_change_snapshot", "save_recipe_version"]);
    expect(calls[0]!.args).toMatchObject({ p_recipe: "r-slaw", p_location: LOC });
    expect((calls[0]!.args.p_lines as Array<Record<string, unknown>>).map((l) => [l.component_sku_id, l.quantity])).toEqual([["s-lettuce", 60], ["s-mayo", 16]]);
    expect(calls[1]!.args.p_snapshot).toEqual({ snap: "now" });
  });
});

describe("promote", () => {
  it("is the Director of Operations' act — a GM is refused before any I/O, by name", async () => {
    expect(await refused(promoteRecipeVersion(actor("gm", 7, [LOC, OTHER]), { recipeId: "r-slaw", sourceVersionId: "v", expectedGlobalVersionId: "g" })))
      .toEqual({ status: 403, code: "global_requires_moo" });
    expect(await refused(promoteMenuItemShopSetting(actor("gm", 7, [LOC]), { menuItemId: "m-italian", settingId: "s", fields: ["price"], expected: { price: 12.5, name: "Italian", nameEs: "Italiano" } })))
      .toEqual({ status: 403, code: "global_requires_moo" });
    expect(await refused(promoteMenuItemShopSetting(actor("social_media_mgr", 6, [LOC]), { menuItemId: "m-italian", settingId: "s", fields: ["price"], expected: { price: 12.5, name: "Italian", nameEs: "Italiano" } })))
      .toEqual({ status: 403, code: "forbidden" });
  });
  it("a MoO promotes a shop's LIVE version: copied in SQL, the source returns to the default (returnedShop)", async () => {
    const calls = install(withOtherSlaw(), {
      save_recipe_version: () => ({ version_id: "gv-new", retired_version_id: "rv-r-slaw-base", changed_shops: [LOC], returned_shop: OTHER, returned_version_id: "sv-other-slaw" }),
    });
    const r = await promoteRecipeVersion(actor("moo", 8, []), { recipeId: "r-slaw", sourceVersionId: "sv-other-slaw", expectedGlobalVersionId: "rv-r-slaw-base", snapshot: SNAP });
    expect(r).toEqual({ versionId: "gv-new", retiredVersionId: "rv-r-slaw-base", changedShops: [LOC], returnedShop: OTHER });
    expect(calls[0]).toMatchObject({ fn: "save_recipe_version", args: { p_location: null, p_lines: null, p_expected: "rv-r-slaw-base", p_promoted_from: "sv-other-slaw", p_adopted_from: null, p_snapshot: SNAP } });
    expect(audits).toEqual([expect.objectContaining({ action: "recipe_version.promote", metadata: expect.objectContaining({ returned_shop: OTHER }) })]);
  });
  it("the global default's own version is not a shop's to promote", async () => {
    install(withOtherSlaw(), {});
    expect(await refused(promoteRecipeVersion(actor("moo", 8, []), { recipeId: "r-slaw", sourceVersionId: "rv-r-slaw-base", expectedGlobalVersionId: "rv-r-slaw-base", snapshot: SNAP })))
      .toEqual({ status: 400, code: "invalid_source" });
  });
});

describe("the notice answer", () => {
  it("binds the shop; the social media manager is refused; an unknown kind is refused by name", async () => {
    expect(await refused(dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: OTHER, recipeId: "r-slaw", kind: "new_default", seenVersionId: "g" })))
      .toEqual({ status: 404, code: "not_found" });
    expect(await refused(dismissRecipeNotice(actor("social_media_mgr", 6, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "new_default", seenVersionId: "g" })))
      .toEqual({ status: 403, code: "forbidden" });
    expect(await refused(dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "bogus" as "new_default", seenVersionId: "g" })))
      .toEqual({ status: 400, code: "invalid_payload" });
  });
  it("the seen version must be a version of THIS recipe", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    expect(await refused(dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "new_default", seenVersionId: "rv-r-italian-base" })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("its own shop writes ONE idempotent row (twice answered, once stored) and an audit row", async () => {
    const t = buildRecipeVersionsFixture();
    current = createFakeDb(t);
    await dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "new_default", seenVersionId: "rv-r-slaw-base" });
    await dismissRecipeNotice(actor("gm", 7, [LOC]), { locationId: LOC, recipeId: "r-slaw", kind: "new_default", seenVersionId: "rv-r-slaw-base" });
    expect(t.recipe_notice_dismissals).toHaveLength(1);
    expect(t.recipe_notice_dismissals![0]).toMatchObject({ location_id: LOC, recipe_id: "r-slaw", kind: "new_default", seen_version_id: "rv-r-slaw-base", created_by: "u1" });
    expect(audits[0]).toMatchObject({ action: "recipe_version.notice_dismiss", resourceTable: "recipe_notice_dismissals", resourceId: "rv-r-slaw-base" });
  });
});

describe("menu promote", () => {
  function withShopSetting(over: Row = {}): Record<string, Row[]> {
    const t = buildRecipeVersionsFixture();
    t.menu_item_shop_settings!.push({
      id: "ms-other", menu_item_id: "m-italian", location_id: OTHER, based_on_setting_id: null, price: 13.5, sold_here: true,
      name_override: "Big Italian", name_override_es: null, valid_from: "2026-10-10T00:00:00.000Z", valid_to: null, active: true, note: null,
      created_by: null, ...over,
    });
    return t;
  }
  const expected = { price: 12.5, name: "Italian", nameEs: "Italiano" };
  const promoted = () => ({ changed_shops: [LOC], before: { menu_price: 12.5 }, returned_shop: OTHER, retired_setting_id: "ms-other", remaining_setting_id: null });

  it("price and name: the compare-and-set values and the snapshot go to SQL; the shops that change and the returned shop come back", async () => {
    const calls = install(withShopSetting(), { promote_menu_item_shop_setting: promoted });
    const r = await promoteMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", settingId: "ms-other", fields: ["price", "name"], expected, snapshot: SNAP });
    expect(r).toEqual({ changedShops: [LOC], returnedShop: OTHER, promotedSettingId: "ms-other" });
    expect(calls).toEqual([{ fn: "promote_menu_item_shop_setting", args: {
      p_setting: "ms-other", p_fields: ["price", "name"], p_expected_price: 12.5, p_expected_name: "Italian", p_expected_name_es: "Italiano", p_actor: "u1", p_snapshot: SNAP,
    } }]);
    expect(audits).toEqual([expect.objectContaining({ action: "menu_item.shop_setting_promote", resourceId: "m-italian" })]);
  });
  it("a setting of another menu item is not found", async () => {
    install(withShopSetting(), {});
    expect(await refused(promoteMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-pickle-side", settingId: "ms-other", fields: ["price"], expected, snapshot: SNAP })))
      .toEqual({ status: 404, code: "not_found" });
  });
  it("THE OPTIONAL SPANISH NAME (CC note 1 #2): set on the shop's row first, then that row is promoted — the pair is copied exactly", async () => {
    const calls = install(withShopSetting(), {
      menu_item_change_snapshot: (a) => ({ snap: a.p_location === NIL_SCOPE ? "preview" : "shop" }),
      save_menu_item_shop_setting: () => ({ setting_id: "ms-other-2", retired_setting_id: "ms-other" }),
      promote_menu_item_shop_setting: promoted,
    });
    const r = await promoteMenuItemShopSetting(actor("moo", 8, []), {
      menuItemId: "m-italian", settingId: "ms-other", fields: ["name"], expected, nameEs: "  Italiano grande ", snapshot: SNAP,
    });
    expect(r).toEqual({ changedShops: [LOC], returnedShop: OTHER, promotedSettingId: "ms-other-2" });
    expect(calls.map((c) => c.fn)).toEqual([
      "menu_item_change_snapshot", // the preview's snapshot re-checked BEFORE anything is written
      "menu_item_change_snapshot", // the shop save's own snapshot (its scope)
      "save_menu_item_shop_setting",
      "menu_item_change_snapshot", // the promote's, re-taken after the save
      "promote_menu_item_shop_setting",
    ]);
    expect(calls[2]!.args).toMatchObject({
      p_menu_item: "m-italian", p_location: OTHER, p_price: 13.5, p_sold_here: true, p_name: "Big Italian", p_name_es: "Italiano grande", p_expected: "ms-other",
    });
    expect(calls[4]!.args).toMatchObject({ p_setting: "ms-other-2", p_fields: ["name"], p_snapshot: { snap: "preview" } });
  });
  it("the Spanish name step refuses a moved preview BEFORE writing anything", async () => {
    const calls = install(withShopSetting(), { menu_item_change_snapshot: () => ({ snap: "moved" }) });
    expect(await refused(promoteMenuItemShopSetting(actor("moo", 8, []), {
      menuItemId: "m-italian", settingId: "ms-other", fields: ["name"], expected, nameEs: "Italiano grande", snapshot: SNAP,
    }))).toEqual({ status: 409, code: "dependencies_changed" });
    expect(calls.map((c) => c.fn)).toEqual(["menu_item_change_snapshot"]);
  });
  it("a blank or unchanged Spanish name is no extra step; a Spanish name with a price-only promote is refused by name; too long is invalid_name", async () => {
    let calls = install(withShopSetting({ name_override_es: "Italiano grande" }), { promote_menu_item_shop_setting: promoted });
    await promoteMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", settingId: "ms-other", fields: ["name"], expected, nameEs: "Italiano grande", snapshot: SNAP });
    expect(calls.map((c) => c.fn)).toEqual(["promote_menu_item_shop_setting"]);
    calls = install(withShopSetting(), { promote_menu_item_shop_setting: promoted });
    await promoteMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", settingId: "ms-other", fields: ["name"], expected, nameEs: "   ", snapshot: SNAP });
    expect(calls.map((c) => c.fn)).toEqual(["promote_menu_item_shop_setting"]);
    install(withShopSetting(), {});
    expect(await refused(promoteMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", settingId: "ms-other", fields: ["price"], expected, nameEs: "Italiano", snapshot: SNAP })))
      .toEqual({ status: 400, code: "invalid_payload" });
    expect(await refused(promoteMenuItemShopSetting(actor("moo", 8, []), { menuItemId: "m-italian", settingId: "ms-other", fields: ["name"], expected, nameEs: "x".repeat(121), snapshot: SNAP })))
      .toEqual({ status: 400, code: "invalid_name" });
  });
});
