/** Audit W22/B203 — a delivery routing result is only good for the inputs it was computed for. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentRoute, routeKey, type KeyedRoute } from "@/app/order/start/route-key";

const geo = { lat: 38.9, lng: -77.03 };
const base = { date: "2030-01-10", guests: "20", geo };
const routed: KeyedRoute = { result: { status: "routed", locationId: "A", locationName: "A", distanceMeters: 100 }, key: routeKey(base) };

describe("B203: route key", () => {
  it("same inputs keep the result", () => {
    expect(currentRoute(routed, { ...base })).toEqual(routed.result);
  });
  it("a changed date invalidates a routed result", () => {
    expect(currentRoute(routed, { ...base, date: "2030-01-11" })).toBeNull();
  });
  it("a changed guest count invalidates it", () => {
    expect(currentRoute(routed, { ...base, guests: "200" })).toBeNull();
  });
  it("a moved pin invalidates it", () => {
    expect(currentRoute(routed, { ...base, geo: { lat: 38.91, lng: -77.03 } })).toBeNull();
  });
  it("no result is no result", () => {
    expect(currentRoute(null, base)).toBeNull();
  });
});

describe("B203: the start form uses only the current result", () => {
  // Source pin (client component; the unit spine has no DOM).
  const src = readFileSync(path.join(process.cwd(), "app/order/start/start-client.tsx"), "utf8");
  it("submits the routed shop only from the result for the current inputs", () => {
    expect(src).toContain("const liveRoute = currentRoute(route, { date: f.date, guests: f.guests, geo });");
    expect(src).toContain('fulfillmentRouted: liveRoute?.status === "routed"');
    expect(src).not.toMatch(/route\?\.status === "routed"/);
  });
  it("re-routes with explicit values when the date or guests change", () => {
    expect(src).toContain("void runRoute(geo.lat, geo.lng, f.date, f.guests)");
    expect(src).toContain("[deliveryNodesExist, f.fulfillment, f.date, f.guests, geo, route]");
  });
});
