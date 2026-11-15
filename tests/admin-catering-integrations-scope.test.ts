/**
 * W08/B161 — the Toast crosswalk and ezCater admin state are read with the same shop scope as their writes:
 * a single-shop GM sees only their shop (its Toast restaurant GUID, crosswalk rows, ezCater caterer UUID and
 * events); the owner (all-locations access) sees every shop.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/toast/client", () => ({ toastConfigured: () => false }));

import { loadToastMapState } from "@/lib/admin/toast-map";
import { loadEzcaterAdminState } from "@/lib/admin/ezcater-map";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const gmAtA = { user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;
const owner = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [] } as unknown as AuthContext;

function mapRow(id: string, location: string) {
  return { id, location_id: location, menu_item_id: null, item_id: null, package_id: null, sku_id: null,
    toast_item_guid: `guid-${id}`, toast_item_name: `Toast ${id}`, toast_price_cents: 100, match_status: "confirmed",
    match_score: null, confirmed_at: null, is_modifier: false, disposition: "deplete", portion_qty: null, portion_unit: null, active: true };
}
function tables() {
  return {
    locations: [
      { id: A, name: "Shop A", active: true, toast_restaurant_guid: "ga-restaurant", ezcater_caterer_uuid: "ea-caterer" },
      { id: B, name: "Shop B", active: true, toast_restaurant_guid: "gb-restaurant", ezcater_caterer_uuid: "eb-caterer" },
    ],
    toast_menu_map: [mapRow("ma", A), mapRow("mb", B)],
    menu_items: [], items: [], catering_packages: [], vendor_items: [],
    catering_pipeline: [{ id: "lead-a", location_id: A }, { id: "lead-b", location_id: B }],
    ezcater_events: [
      { id: "ev-a", event_key: "k", entity_id: "e1", processing_result: "ok", signature_valid: true, received_at: "2026-11-01T10:00:00Z", lead_id: "lead-a" },
      { id: "ev-b", event_key: "k", entity_id: "e2", processing_result: "ok", signature_valid: true, received_at: "2026-11-01T11:00:00Z", lead_id: "lead-b" },
      { id: "ev-none", event_key: "k", entity_id: "e3", processing_result: "unmatched", signature_valid: false, received_at: "2026-11-01T12:00:00Z", lead_id: null },
    ],
  };
}

describe("W08/B161 catering integrations admin state is shop-scoped", () => {
  it("a single-shop GM's Toast state lists only their shop and its crosswalk rows", async () => {
    current = createFakeDb(tables());
    const s = await loadToastMapState(gmAtA);
    expect(s.locations.map((l) => l.id)).toEqual([A]);
    expect(s.rows.map((r) => r.locationId)).toEqual([A]);
    expect(JSON.stringify(s)).not.toContain("gb-restaurant");
    expect(JSON.stringify(s)).not.toContain("guid-mb");
  });

  it("the owner's Toast state lists both shops", async () => {
    current = createFakeDb(tables());
    const s = await loadToastMapState(owner);
    expect(s.locations.map((l) => l.id).sort()).toEqual([A, B]);
    expect(s.rows.map((r) => r.id).sort()).toEqual(["ma", "mb"]);
  });

  it("a GM with no shop sees no shop at all", async () => {
    current = createFakeDb(tables());
    const none = { ...gmAtA, locations: [] } as unknown as AuthContext;
    const s = await loadToastMapState(none);
    expect(s.locations).toEqual([]);
    expect(s.rows).toEqual([]);
    const e = await loadEzcaterAdminState(none);
    expect(e.locations).toEqual([]);
    expect(e.events).toEqual([]);
  });

  it("a single-shop GM's ezCater state hides the other shop's caterer UUID and events", async () => {
    current = createFakeDb(tables());
    const s = await loadEzcaterAdminState(gmAtA);
    expect(s.locations.map((l) => l.id)).toEqual([A]);
    expect(s.events.map((e) => e.id)).toEqual(["ev-a"]);
    expect(JSON.stringify(s)).not.toContain("eb-caterer");
  });

  it("the owner's ezCater state shows every shop and every event, unlinked ones included", async () => {
    current = createFakeDb(tables());
    const s = await loadEzcaterAdminState(owner);
    expect(s.locations.map((l) => l.id).sort()).toEqual([A, B]);
    expect(s.events.map((e) => e.id)).toEqual(["ev-none", "ev-b", "ev-a"]);
  });
});
