import { describe, it, expect, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadCateringMenuItems, loadCateringPackagesForQuote } from "@/lib/catering/menu";
import { loadPublicCateringMenu, loadPublicCateringPackages } from "@/lib/portal/menu";
import type { AuthContext } from "@/lib/session";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/rate-rules", () => ({ loadActiveRateRules: vi.fn(async () => []) }));
const own = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const actor = { user: { role: "gm" }, locations: [own] } as AuthContext;
function setup() {
  const rows = [null, own, foreign].map((location_id, i) => ({ id: `item-${i}`, name: `Name ${i}`, location_id, active: true, catering_available: true, menu_price: 10, catering_only: false }));
  const db = createFakeDb({ items: rows, menu_items: rows.map(r => ({...r, id: r.id.replace("item", "menu")})), item_sizes: [],
    catering_packages: [{id: "pkg", active: true, location_id: null, label_en: "Package", price_cents: 5000}],
    catering_package_items: [...rows.map((r,i) => ({id: `line-${i}`, package_id: "pkg", item_id: r.id, menu_item_id: null, active: true, quantity: 1, slot_type: "fixed"})), {id:"choice",package_id:"pkg",active:true,slot_type:"choice",quantity:1}],
    catering_package_slot_options: rows.map(r => ({package_item_id:"choice", item_id:r.id, menu_item_id:null,active:true})) });
  vi.mocked(getServiceRoleClient).mockReturnValue(db.client);
}
describe("catering available choices follow owner scope", () => {
  it.each(["staff", "portal"])("%s a la carte excludes foreign items and menu items", async lane => {
    setup(); const result = lane === "staff" ? await loadCateringMenuItems(actor, own) : await loadPublicCateringMenu(own);
    expect(result.map(r => r.id).sort()).toEqual(["item-0","item-1","menu-0","menu-1"]);
  });
  it.each(["staff", "portal"])("%s fixed package refs never return as hidden fallback lines", async lane => {
    setup(); const result = lane === "staff" ? await loadCateringPackagesForQuote(actor, own) : await loadPublicCateringPackages(own);
    expect(result[0]!.items.map(r => r.itemId)).toEqual(["item-0", "item-1"]);
  });
  it("portal choice options exclude foreign references", async () => {
    setup(); const result = await loadPublicCateringPackages(own);
    expect(result[0]!.slots[0]!.options.map(r => r.refId)).toEqual(["item-0", "item-1"]);
  });
});
