/**
 * W08B (owner ruling 2026-11-15, follow-up to W08/B161) — the MoO, owner and CGS roles may CHANGE both shops'
 * Toast crosswalk, Toast restaurant GUID, ezCater caterer id and catering-menu flags, by role, whatever their
 * shop list says. GM stays on the shops it is assigned to; AGM and the catering manager are below the GM floor
 * of these writes (the catering manager is NOT in the trusted set). Step-up tiers are route-level and unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb>;
let db: ReturnType<typeof tables>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/toast/client", () => ({ toastConfigured: () => false }));
vi.mock("@/lib/toast/menus", () => ({
  fetchToastMenuItems: vi.fn(async () => [{ itemGuid: "toast-new", name: "Shared Sub", priceCents: 1200 }]),
  fetchToastModifierOptions: vi.fn(async () => []),
}));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: vi.fn(async () => ({})) }));
vi.mock("@/lib/menu-item-shop", () => ({ loadLiveMenuItemShopSettings: vi.fn(async () => new Map()) }));

import {
  confirmMapping, confirmSandwichToastLink, driftReport, loadSandwichToastChoices, manualMap, rejectMapping,
  runAutoMatch, setLocationToastGuid, unmapConfirmed,
} from "@/lib/admin/toast-map";
import { setLocationEzcaterUuid } from "@/lib/admin/ezcater-map";
import { setCateringFlags } from "@/lib/admin/catering/menu";
import { canWriteIntegrationsShop, INTEGRATIONS_ALL_SHOPS_ROLES } from "@/lib/admin/integrations-scope";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const NEW_GUID = "11111111-2222-4333-8444-555555555555";
function actor(role: string, level: number, locations: string[]): AuthContext {
  return { user: { id: `u-${role}`, role }, role, level, locations } as unknown as AuthContext;
}
const trusted: Array<[string, AuthContext]> = [
  ["MoO assigned to shop A", actor("moo", 8, [A])],
  ["MoO with no shop", actor("moo", 8, [])],
  ["owner assigned to shop A", actor("owner", 9, [A])],
  ["CGS with no shop", actor("cgs", 10, [])],
];
const gmAtA = actor("gm", 7, [A]);
const gmAtB = actor("gm", 7, [B]);
const agmAtB = actor("agm", 6, [B]);
const cateringMgrAtB = actor("catering_mgr", 6, [B]);

function mapRow(id: string, location: string, status: string) {
  return { id, location_id: location, menu_item_id: null, item_id: null, package_id: null, sku_id: null,
    toast_item_guid: `guid-${id}`, toast_item_name: `Toast ${id}`, toast_price_cents: 100, match_status: status,
    match_score: null, confirmed_at: null, is_modifier: false, disposition: "deplete", portion_qty: null, portion_unit: null, active: true };
}
function tables() {
  return {
    locations: [
      { id: A, name: "Shop A", active: true, toast_restaurant_guid: "ga-restaurant", ezcater_caterer_uuid: "ea-caterer" },
      { id: B, name: "Shop B", active: true, toast_restaurant_guid: "gb-restaurant", ezcater_caterer_uuid: "eb-caterer" },
    ],
    toast_menu_map: [
      mapRow("cand-a", A, "candidate"), mapRow("cand-b", B, "candidate"),
      mapRow("conf-a", A, "confirmed"), mapRow("conf-b", B, "confirmed"),
    ],
    menu_items: [{ id: "sub-shared", name: "Shared Sub", menu_price: 12, location_id: null, active: true }],
    items: [
      { id: "item-b", name: "Shop B Cookie", menu_price: 3, location_id: B, active: true, catering_available: false, catering_only: false },
    ],
    catering_packages: [], vendor_items: [],
  };
}
const loc = (id: string) => db.locations.find((l) => l.id === id)!;
const map = (id: string) => db.toast_menu_map.find((r) => r.id === id)!;

type Write = { name: string; run: (a: AuthContext, shop: string) => Promise<unknown>; landed: (shop: string) => void };
const writes: Write[] = [
  { name: "set the Toast restaurant GUID", run: (a, s) => setLocationToastGuid(a, s, NEW_GUID),
    landed: (s) => expect(loc(s).toast_restaurant_guid).toBe(NEW_GUID) },
  { name: "set the ezCater caterer id", run: (a, s) => setLocationEzcaterUuid(a, s, "new-caterer"),
    landed: (s) => expect(loc(s).ezcater_caterer_uuid).toBe("new-caterer") },
  { name: "confirm a Toast candidate", run: (a, s) => confirmMapping(a, s === A ? "cand-a" : "cand-b"),
    landed: (s) => expect(map(s === A ? "cand-a" : "cand-b").match_status).toBe("confirmed") },
  { name: "reject a Toast candidate", run: (a, s) => rejectMapping(a, s === A ? "cand-a" : "cand-b"),
    landed: (s) => expect(map(s === A ? "cand-a" : "cand-b").match_status).toBe("rejected") },
  { name: "unmap a confirmed Toast mapping", run: (a, s) => unmapConfirmed(a, s === A ? "conf-a" : "conf-b"),
    landed: (s) => expect(map(s === A ? "conf-a" : "conf-b").active).toBe(false) },
  { name: "manually map a Toast item",
    run: (a, s) => manualMap(a, { locationId: s, toastItemGuid: "toast-manual", toastItemName: "Assortment", entityKind: "assortment_full", entityId: null, isModifier: true }),
    landed: (s) => expect(db.toast_menu_map.some((r) => r.location_id === s && r.toast_item_guid === "toast-manual" && r.active !== false)).toBe(true) },
  { name: "run Toast auto-match", run: (a, s) => runAutoMatch(a, s),
    landed: (s) => expect(db.toast_menu_map.some((r) => r.location_id === s && r.toast_item_guid === "toast-new")).toBe(true) },
  { name: "run the Toast drift check", run: (a, s) => driftReport(a, s),
    landed: () => undefined },
  { name: "link a catalog sandwich to a Toast item",
    run: (a, s) => confirmSandwichToastLink(a, { locationId: s, menuItemId: "sub-shared", toastItemGuid: "toast-new", confirmed: true }),
    landed: (s) => expect(db.toast_menu_map.some((r) => r.location_id === s && r.menu_item_id === "sub-shared" && r.toast_item_guid === "toast-new")).toBe(true) },
  { name: "load a shop's Toast items for the catalog sandwich link", run: (a, s) => loadSandwichToastChoices(a, s),
    landed: () => undefined },
];

describe("W08B: MoO, owner and CGS may change both shops' Toast and ezCater settings", () => {
  beforeEach(() => { current = createFakeDb(db = tables()); });

  it("the trusted set is exactly MoO, owner and CGS (the catering manager is not in it)", () => {
    expect([...INTEGRATIONS_ALL_SHOPS_ROLES].sort()).toEqual(["cgs", "moo", "owner"]);
    const asActor = (role: string, locations: string[]) => ({ user: { role }, locations } as unknown as AuthContext);
    expect(canWriteIntegrationsShop(asActor("moo", []), B)).toBe(true);
    expect(canWriteIntegrationsShop(asActor("owner", [A]), B)).toBe(true);
    expect(canWriteIntegrationsShop(asActor("cgs", []), B)).toBe(true);
    expect(canWriteIntegrationsShop(asActor("gm", [A]), B)).toBe(false);
    expect(canWriteIntegrationsShop(asActor("gm", [B]), B)).toBe(true);
    expect(canWriteIntegrationsShop(asActor("agm", [A]), B)).toBe(false);
    expect(canWriteIntegrationsShop(asActor("catering_mgr", [A]), B)).toBe(false);
    expect(canWriteIntegrationsShop(asActor("catering_mgr", [B]), B)).toBe(true);
  });

  for (const w of writes) {
    describe(w.name, () => {
      for (const [label, a] of trusted) {
        it(`${label} may do it at shop B`, async () => {
          await expect(w.run(a, B)).resolves.not.toThrow();
          w.landed(B);
        });
      }

      it("a GM at shop A is refused at shop B and nothing changes", async () => {
        const before = JSON.stringify(db);
        await expect(w.run(gmAtA, B)).rejects.toMatchObject({ status: 403, code: "forbidden" });
        expect(JSON.stringify(db)).toBe(before);
      });

      it("a GM at shop A may still do it at shop A, and a GM at shop B at shop B", async () => {
        await expect(w.run(gmAtA, A)).resolves.not.toThrow();
        w.landed(A);
        current = createFakeDb(db = tables());
        await expect(w.run(gmAtB, B)).resolves.not.toThrow();
        w.landed(B);
      });

      it("an AGM and a catering manager assigned to shop B stay below the GM floor", async () => {
        const before = JSON.stringify(db);
        await expect(w.run(agmAtB, B)).rejects.toMatchObject({ status: 403, code: "forbidden" });
        await expect(w.run(cateringMgrAtB, B)).rejects.toMatchObject({ status: 403, code: "forbidden" });
        expect(JSON.stringify(db)).toBe(before);
      });
    });
  }

  it("a trusted role still gets 404 for a shop that does not exist or is inactive", async () => {
    db.locations[1]!.active = false;
    for (const [, a] of trusted) {
      await expect(setLocationToastGuid(a, B, NEW_GUID)).rejects.toMatchObject({ status: 404, code: "location_not_found" });
      await expect(setLocationEzcaterUuid(a, B, "x")).rejects.toMatchObject({ status: 404, code: "location_not_found" });
    }
  });

  describe("catering-menu flags on shop B's own item", () => {
    for (const [label, a] of trusted) {
      it(`${label} may change them`, async () => {
        await expect(setCateringFlags(a, "item", "item-b", { cateringAvailable: true })).resolves.toMatchObject({ cateringAvailable: true });
        expect(db.items[0]!.catering_available).toBe(true);
      });
    }
    it("a GM at shop A gets 404; a GM at shop B may change them", async () => {
      await expect(setCateringFlags(gmAtA, "item", "item-b", { cateringAvailable: true })).rejects.toMatchObject({ status: 404 });
      expect(db.items[0]!.catering_available).toBe(false);
      await expect(setCateringFlags(gmAtB, "item", "item-b", { cateringAvailable: true })).resolves.toMatchObject({ cateringAvailable: true });
    });
    it("an AGM and a catering manager at shop B are refused", async () => {
      await expect(setCateringFlags(agmAtB, "item", "item-b", { cateringAvailable: true })).rejects.toMatchObject({ status: 403 });
      await expect(setCateringFlags(cateringMgrAtB, "item", "item-b", { cateringAvailable: true })).rejects.toMatchObject({ status: 403 });
      expect(db.items[0]!.catering_available).toBe(false);
    });
  });
});
