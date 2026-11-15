// Audit W01/B031 r1: a package whose fixed ingredient was deactivated, or a pick that is no longer
// active, must not be orderable from the portal — the package loader is what resolveLines (save) and
// the re-price (preview / submit) check a cart against, so it decides what "available" means.
import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadPublicCateringPackages } from "@/lib/portal/menu";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/catering/rate-rules", () => ({ loadActiveRateRules: vi.fn(async () => []) }));

const LOC = "11111111-1111-4111-8111-111111111111";

function setup(over: { fixedItemActive?: boolean; fixedSubActive?: boolean; optionItemActive?: boolean; optionSubActive?: boolean } = {}) {
  const db = createFakeDb({
    items: [
      { id: "item-fixed", name: "Chips", location_id: null, active: over.fixedItemActive ?? true, menu_price: 2 },
      { id: "item-opt", name: "Cookie", location_id: null, active: over.optionItemActive ?? true, menu_price: 3 },
    ],
    menu_items: [
      { id: "menu-fixed", name: "Italian", location_id: null, active: over.fixedSubActive ?? true, menu_price: 12 },
      { id: "menu-opt", name: "Turkey", location_id: null, active: over.optionSubActive ?? true, menu_price: 11 },
    ],
    catering_packages: [
      { id: "pkg", active: true, location_id: null, label_en: "Box lunch", label_es: null, pricing_mode: "flat", price_cents: 5000, min_headcount: null, lead_time_hours: null, serves: 10, display_order: 0 },
      { id: "pkg-other", active: true, location_id: null, label_en: "Plain", label_es: null, pricing_mode: "flat", price_cents: 900, min_headcount: null, lead_time_hours: null, serves: 1, display_order: 1 },
    ],
    catering_package_items: [
      { id: "line-item", package_id: "pkg", slot_type: "fixed", item_id: "item-fixed", menu_item_id: null, description: null, quantity: 1, active: true, display_order: 0 },
      { id: "line-sub", package_id: "pkg", slot_type: "fixed", item_id: null, menu_item_id: "menu-fixed", description: null, quantity: 1, active: true, display_order: 1 },
      { id: "choice", package_id: "pkg", slot_type: "choice", item_id: null, menu_item_id: null, description: "Pick two", quantity: 2, active: true, display_order: 2 },
      { id: "line-other", package_id: "pkg-other", slot_type: "fixed", item_id: "item-opt", menu_item_id: null, description: null, quantity: 1, active: true, display_order: 0 },
    ],
    catering_package_slot_options: [
      { package_item_id: "choice", item_id: "item-opt", menu_item_id: null, active: true, display_order: 0 },
      { package_item_id: "choice", item_id: null, menu_item_id: "menu-opt", active: true, display_order: 1 },
    ],
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(db.client as never);
}

describe("portal packages follow the availability of what they are made of", () => {
  it("everything active: the package, its fixed lines and both choices are offered", async () => {
    setup();
    const pkgs = await loadPublicCateringPackages(LOC);
    const pkg = pkgs.find((p) => p.id === "pkg")!;
    expect(pkg.items.map((i) => i.label)).toEqual(["Chips", "Italian"]);
    expect(pkg.slots[0]!.options.map((o) => o.refId)).toEqual(["item-opt", "menu-opt"]);
  });
  it("a deactivated fixed ingredient (an item or a sub) makes the package unavailable; other packages stay", async () => {
    setup({ fixedItemActive: false });
    expect((await loadPublicCateringPackages(LOC)).map((p) => p.id)).toEqual(["pkg-other"]);
    setup({ fixedSubActive: false });
    expect((await loadPublicCateringPackages(LOC)).map((p) => p.id)).toEqual(["pkg-other"]);
  });
  it("a deactivated choice is no longer an eligible option (item or sub); the package stays", async () => {
    setup({ optionItemActive: false });
    // item-opt is pkg-other's fixed line too: deactivating it retires that package as well.
    let pkgs = await loadPublicCateringPackages(LOC);
    expect(pkgs.map((p) => p.id)).toEqual(["pkg"]);
    expect(pkgs[0]!.slots[0]!.options.map((o) => o.refId)).toEqual(["menu-opt"]);
    setup({ optionSubActive: false });
    pkgs = await loadPublicCateringPackages(LOC);
    expect(pkgs.find((p) => p.id === "pkg")!.slots[0]!.options.map((o) => o.refId)).toEqual(["item-opt"]);
  });
});
