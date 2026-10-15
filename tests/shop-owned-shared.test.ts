import { describe, expect, it } from "vitest";
import {
  SHOP_OWNED_ERROR_CODES, creationScope, filterOwnedEntities, linesOwnedElsewhere,
  newThingScopeGate, ownedAwareRecipeGate, ownedRecipeScopeRefusal, ownerVisible,
  ownerWriteCheck, shareGate, shopOwnedErrorFromRpc, ShopOwnedError,
  type ShopOwnedActor,
} from "@/lib/catalog/shop-owned-shared";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const gm = (locations: string[] = [A]): ShopOwnedActor => ({ role: "gm", level: 7, locations });
const moo: ShopOwnedActor = { role: "moo", level: 8, locations: [] };
const forbidden = { ok: false, status: 403, code: "forbidden" };
const hidden = { ok: false, status: 404, code: "not_found" };
const global = { ok: false, status: 403, code: "global_requires_moo" };

describe("owner visibility (operational scope, not administrative access)", () => {
  it.each([
    [null, null, true], [null, A, true], [undefined, A, true],
    [A, A, true], [A, B, false], [A, null, false],
  ])("owner %s at %s => %s", (owner, scope, visible) => {
    expect(ownerVisible(owner, scope)).toBe(visible);
  });
  it("preserves order and objects while projecting the complete ownership map", () => {
    const rows = [{ id: "shared" }, { id: "a" }, { id: "b" }];
    const owners = new Map([["a", A], ["b", B]]);
    expect(filterOwnedEntities(rows, owners, A)).toEqual(rows.slice(0, 2));
    expect(filterOwnedEntities(rows, owners, null)).toEqual([rows[0]]);
    expect(rows).toHaveLength(3);
  });
  it("reports each foreign ingredient's one-based position, including at the default", () => {
    const owners = { skus: new Map([["sa", A], ["sb", B]]), items: new Map([["ib", B]]) };
    const lines = [
      { componentSkuId: "shared", componentItemId: null },
      { componentSkuId: "sa", componentItemId: null },
      { componentSkuId: "sb", componentItemId: null },
      { componentSkuId: null, componentItemId: "ib" },
    ];
    expect(linesOwnedElsewhere(lines, owners, A)).toEqual([3, 4]);
    expect(linesOwnedElsewhere(lines, owners, B)).toEqual([2]);
    expect(linesOwnedElsewhere(lines, owners, null)).toEqual([2, 3, 4]);
  });
});

describe("creation scope keeps omitted and explicit global distinct", () => {
  it("infers exactly one distinct membership; never converts explicit null to that membership", () => {
    expect(creationScope(gm())).toEqual({ ok: true, scope: A });
    expect(creationScope(gm([A, A]))).toEqual({ ok: true, scope: A });
    expect(creationScope(gm(), null)).toEqual(global);
    expect(creationScope(gm(), A)).toEqual({ ok: true, scope: A });
    expect(creationScope(gm(), B)).toEqual(hidden);
  });
  it.each([{ locations: [] }, { locations: [A, B] }])("requires a selection with memberships $locations", ({ locations }) => {
    expect(creationScope(gm(locations))).toEqual({ ok: false, status: 400, code: "location_required" });
  });
  it("MoO can explicitly choose global or any shop, but omission is not implicit global", () => {
    expect(creationScope(moo, null)).toEqual({ ok: true, scope: null });
    expect(creationScope(moo, B)).toEqual({ ok: true, scope: B });
    expect(creationScope(moo)).toEqual({ ok: false, status: 400, code: "location_required" });
  });
  it("rejects malformed scope instead of inferring a shop", () => {
    for (const scope of ["", "global", "not-a-uuid"]) {
      expect(creationScope(gm(), scope)).toEqual({ ok: false, status: 400, code: "invalid_payload" });
    }
  });
});

describe("role-aware gates before and after the owner read", () => {
  it.each([
    { role: "agm", level: 6 }, { role: "prep_mgr", level: 6 },
    { role: "catering_mgr", level: 6 }, { role: "social_media_mgr", level: 6 },
    { role: "social_media_mgr", level: 8 }, { role: "employee", level: 3 },
  ] as const)("refuses $role/$level through every entry gate", (role) => {
    const actor = { ...role, locations: [A] };
    expect(creationScope(actor, A)).toEqual(forbidden);
    expect(newThingScopeGate(actor, A)).toEqual(forbidden);
    expect(ownerWriteCheck(actor, A)).toEqual(forbidden);
    expect(shareGate(actor)).toEqual(forbidden);
    expect(ownedAwareRecipeGate({ ...actor, scope: null, scopeAllowed: true })).toEqual(forbidden);
  });
  it("allows GM's default request only conditionally on the subsequent owner check", () => {
    expect(ownedAwareRecipeGate({ ...gm(), scope: null, scopeAllowed: false })).toEqual({ ok: true, ownerCheck: true });
    expect(ownerWriteCheck(gm(), null)).toEqual(global);
    expect(ownerWriteCheck(gm(), A)).toEqual({ ok: true });
    expect(ownerWriteCheck(gm(), B)).toEqual(hidden);
    expect(ownerWriteCheck(moo, B)).toEqual({ ok: true });
  });
  it("preserves authorized shop versions and MoO default writes", () => {
    expect(ownedAwareRecipeGate({ ...gm(), scope: A, scopeAllowed: true })).toEqual({ ok: true, ownerCheck: false });
    expect(ownedAwareRecipeGate({ ...gm(), scope: B, scopeAllowed: false })).toEqual(hidden);
    expect(ownedAwareRecipeGate({ ...moo, scope: null, scopeAllowed: false })).toEqual({ ok: true, ownerCheck: false });
    expect(newThingScopeGate(moo, null)).toEqual({ ok: true });
    expect(newThingScopeGate(gm(), null)).toEqual(global);
    expect(shareGate(gm())).toEqual(global);
    expect(shareGate(moo)).toEqual({ ok: true });
  });
  it("owned recipes have direct edits, never shop versions", () => {
    expect(ownedRecipeScopeRefusal(null, A)).toBeNull();
    expect(ownedRecipeScopeRefusal(A, null)).toBeNull();
    expect(ownedRecipeScopeRefusal(A, A)).toEqual({ ok: false, status: 409, code: "shop_owned_edit_here" });
    expect(ownedRecipeScopeRefusal(A, B)).toEqual(hidden);
  });
});

describe("closed ownership refusal vocabulary", () => {
  function error(message: string): unknown {
    try { shopOwnedErrorFromRpc(message); } catch (e) { return e; }
    throw new Error("mapper did not throw");
  }
  it("maps every listed code without generic fallbacks or duplicates", () => {
    expect(new Set(SHOP_OWNED_ERROR_CODES).size).toBe(SHOP_OWNED_ERROR_CODES.length);
    for (const code of SHOP_OWNED_ERROR_CODES) {
      expect(error(`shop_owned:${code}`)).toBeInstanceOf(ShopOwnedError);
      expect(error(`shop_owned:${code}`)).toMatchObject({ code, status: expect.any(Number) });
    }
  });
  it.each([
    ["ownership_changed", 409], ["items_changed", 409], ["skus_changed", 409],
    ["share_the_recipe", 409], ["output_other_shop", 400], ["not_found", 404],
    ["global_requires_moo", 403], ["invalid_price", 400],
  ])("%s maps to %i", (code, status) => {
    expect(error(`shop_owned:${code}`)).toMatchObject({ code, status });
  });
  it("preserves the positional SQL refusal and reason", () => {
    expect(error("shop_owned:line_other_shop:3")).toMatchObject({
      code: "line_other_shop", status: 400, line: { position: 3, reason: "line_other_shop" },
    });
  });
  it.each(["boom", "swap:not_found", "shop_owned:new_unknown_code", "shop_owned:not_found_extra",
    "shop_owned:line_other_shop:0", "shop_owned:line_other_shop:NaN"])("leaves unknown/malformed errors unclassified: %s", (message) => {
    expect(error(message)).toBeInstanceOf(Error);
    expect(error(message)).not.toBeInstanceOf(ShopOwnedError);
  });
});
