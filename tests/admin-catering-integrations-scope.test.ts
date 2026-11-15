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
// Owner ruling 2026-11-15: the MoO, owner and CGS roles see both shops by role, whatever their shop list says.
const mooAtA = { user: { id: "u-moo", role: "moo" }, role: "moo", level: 8, locations: [A] } as unknown as AuthContext;
const mooNoShop = { ...mooAtA, locations: [] } as unknown as AuthContext;
const cgs = { user: { id: "u-cgs", role: "cgs" }, role: "cgs", level: 10, locations: [] } as unknown as AuthContext;
const ownerAtA = { ...owner, locations: [A] } as unknown as AuthContext;
const agmAtB = { user: { id: "u-agm", role: "agm" }, role: "agm", level: 6, locations: [B] } as unknown as AuthContext;

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

  it("other-shop traffic past any global cutoff never hides this shop's events (r1)", async () => {
    const t = tables();
    // 250 newer events at shop B, then 25 older ones at shop A: a global window of the newest N
    // events, filtered by shop afterwards, would leave the A manager with nothing.
    const busy = Array.from({ length: 250 }, (_, i) => ({ id: `ev-b${i}`, event_key: "k", entity_id: `b${i}`, processing_result: "ok",
      signature_valid: true, received_at: new Date(Date.UTC(2026, 10, 10, 0, i)).toISOString(), lead_id: "lead-b" }));
    const older = Array.from({ length: 25 }, (_, i) => ({ id: `ev-a${i}`, event_key: "k", entity_id: `a${i}`, processing_result: "ok",
      signature_valid: true, received_at: new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString(), lead_id: "lead-a" }));
    t.ezcater_events = [...busy, ...older, ...t.ezcater_events];
    current = createFakeDb(t);
    const s = await loadEzcaterAdminState(gmAtA);
    expect(s.events).toHaveLength(20);
    expect(s.events.map((e) => e.id)).toEqual(Array.from({ length: 20 }, (_, i) => `ev-a${24 - i}`));
    expect(s.events.every((e) => e.leadId === "lead-a")).toBe(true);
  });

  it("the owner's ezCater state shows every shop and every event, unlinked ones included", async () => {
    current = createFakeDb(tables());
    const s = await loadEzcaterAdminState(owner);
    expect(s.locations.map((l) => l.id).sort()).toEqual([A, B]);
    expect(s.events.map((e) => e.id)).toEqual(["ev-none", "ev-b", "ev-a"]);
  });

  describe("owner ruling 2026-11-15: MoO, owner and CGS see both shops by role", () => {
    for (const [label, actor] of [["MoO assigned to one shop", mooAtA], ["MoO with no shop", mooNoShop], ["owner assigned to one shop", ownerAtA], ["CGS", cgs]] as const) {
      it(`${label}: Toast state lists both shops, both restaurant GUIDs and both shops' crosswalk rows`, async () => {
        current = createFakeDb(tables());
        const s = await loadToastMapState(actor);
        expect(s.locations.map((l) => l.id).sort()).toEqual([A, B]);
        expect(s.locations.map((l) => l.toastRestaurantGuid).sort()).toEqual(["ga-restaurant", "gb-restaurant"]);
        expect(s.rows.map((r) => r.id).sort()).toEqual(["ma", "mb"]);
      });

      it(`${label}: ezCater state lists both shops' caterer ids and both shops' events`, async () => {
        current = createFakeDb(tables());
        const s = await loadEzcaterAdminState(actor);
        expect(s.locations.map((l) => l.ezcaterCatererUuid).sort()).toEqual(["ea-caterer", "eb-caterer"]);
        expect(s.events.map((e) => e.id)).toEqual(expect.arrayContaining(["ev-a", "ev-b"]));
      });
    }

    it("MoO does not see ezCater events with no lead (they stay with all-locations access: owner and CGS)", async () => {
      current = createFakeDb(tables());
      const s = await loadEzcaterAdminState(mooAtA);
      expect(s.events.map((e) => e.id)).toEqual(["ev-b", "ev-a"]);
    });

    it("owner and CGS still see ezCater events with no lead", async () => {
      for (const actor of [ownerAtA, cgs]) {
        current = createFakeDb(tables());
        const s = await loadEzcaterAdminState(actor);
        expect(s.events.map((e) => e.id)).toEqual(["ev-none", "ev-b", "ev-a"]);
      }
    });

    it("MoO's both-shop ezCater window is the newest 20 linked events, not pushed out by unlinked ones", async () => {
      const t = tables();
      const unlinked = Array.from({ length: 30 }, (_, i) => ({ id: `ev-n${i}`, event_key: "k", entity_id: `n${i}`, processing_result: "unmatched",
        signature_valid: false, received_at: new Date(Date.UTC(2026, 10, 12, 0, i)).toISOString(), lead_id: null }));
      t.ezcater_events = [...unlinked, ...t.ezcater_events];
      current = createFakeDb(t);
      const s = await loadEzcaterAdminState(mooAtA);
      expect(s.events.map((e) => e.id)).toEqual(["ev-b", "ev-a"]);
    });

    it("GMs and AGMs stay scoped to their own shop", async () => {
      current = createFakeDb(tables());
      const gT = await loadToastMapState(gmAtA);
      expect(gT.locations.map((l) => l.id)).toEqual([A]);
      const gE = await loadEzcaterAdminState(gmAtA);
      expect(gE.events.map((e) => e.id)).toEqual(["ev-a"]);
      const gmAtB = { user: { id: "u-gm-b", role: "gm" }, role: "gm", level: 7, locations: [B] } as unknown as AuthContext;
      expect((await loadToastMapState(gmAtB)).locations.map((l) => l.id)).toEqual([B]);
      // The Toast crosswalk is GM+ (TOAST_MAP_MIN 7); an AGM reads only the ezCater tab (EZCATER_READ_MIN 6).
      const aE = await loadEzcaterAdminState(agmAtB);
      expect(aE.locations.map((l) => l.id)).toEqual([B]);
      expect(aE.events.map((e) => e.id)).toEqual(["ev-b"]);
      expect(JSON.stringify(aE)).not.toContain("ea-caterer");
    });
  });
});
