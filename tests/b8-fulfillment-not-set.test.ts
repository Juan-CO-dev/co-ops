import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { seedState } from "@/components/admin/catering/fulfillment/FulfillmentClient";
import type { FulfillmentNodeView } from "@/lib/admin/catering/fulfillment";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #8 (sim walk 2026-10-14): the fulfillment map drew a pin and a 5-mile circle while both
// shops said "not set" — a default centre rendered as if it were the shop's zone.

const node = (over: Partial<FulfillmentNodeView>): FulfillmentNodeView => ({
  locationId: "shop", locationName: "Shop", configured: false, lat: null, lng: null,
  radiusMiles: null, offersDelivery: true, offersPickup: true, active: true, ...over,
});

describe("B8 #8 an unset shop draws no zone", () => {
  it("a not-set shop starts unplaced", () => {
    expect(seedState(node({})).placed).toBe(false);
  });
  it("a configured shop starts placed at its own centre", () => {
    expect(seedState(node({ configured: true, lat: 1, lng: 2, radiusMiles: 3 }))).toMatchObject({ placed: true, lat: 1, lng: 2, radiusMiles: 3 });
  });
  it("the map draws the pin and circle only when placed; save needs a pin", () => {
    const map = readFileSync("components/admin/catering/fulfillment/ZoneMap.tsx", "utf8");
    expect(map).toContain("{showZone ? <Marker");
    expect(map).toContain("{showZone ? <Circle center={center} radius={radiusMeters} /> : null}");
    const client = readFileSync("components/admin/catering/fulfillment/FulfillmentClient.tsx", "utf8");
    expect(client).toContain("showZone={zone.placed}");
    expect(client).toContain("disabled={busy || !selectedId || !zone.placed}");
    expect(client).toContain('t("admin.catering.fulfillment.not_set_notice", { shop: selectedNode.locationName })');
  });
  it("en + es keys", () => {
    for (const d of [en, es]) {
      expect(d["admin.catering.fulfillment.not_set_notice"]).toContain("{shop}");
      expect(d["admin.catering.fulfillment.place_pin"]).toBeTruthy();
    }
  });
});
