/**
 * Unit spine — lib/geo.ts (pure; FR-a/FR-b delivery-zone math).
 * Pins: haversine sanity on real DC coordinates, radius boundary inclusivity, unit conversions.
 */
import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  isWithinRadius,
  milesToMeters,
  metersToMiles,
  type LatLng,
} from "@/lib/geo";

// Real-world anchors (approx): the two CO neighborhoods.
const CAPITOL_HILL: LatLng = { lat: 38.8866, lng: -76.9962 };
const P_STREET: LatLng = { lat: 38.9097, lng: -77.0295 };

describe("haversineMeters", () => {
  it("is zero for identical points and symmetric", () => {
    expect(haversineMeters(CAPITOL_HILL, CAPITOL_HILL)).toBe(0);
    expect(haversineMeters(CAPITOL_HILL, P_STREET)).toBeCloseTo(
      haversineMeters(P_STREET, CAPITOL_HILL),
      6,
    );
  });

  it("Capitol Hill ↔ P Street is ~3.9 km (sanity window 3–5 km)", () => {
    const d = haversineMeters(CAPITOL_HILL, P_STREET);
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(5000);
  });

  it("one degree of latitude is ~111.2 km", () => {
    const d = haversineMeters({ lat: 38, lng: -77 }, { lat: 39, lng: -77 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_500);
  });

  it("antipodal points don't NaN (asin clamp) and are ~half Earth's circumference", () => {
    const d = haversineMeters({ lat: 90, lng: 0 }, { lat: -90, lng: 0 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20_000_000);
    expect(d).toBeLessThan(20_100_000);
  });
});

describe("isWithinRadius", () => {
  it("inside and outside behave as expected for a 2-mile zone", () => {
    const twoMiles = milesToMeters(2);
    expect(isWithinRadius(CAPITOL_HILL, CAPITOL_HILL, twoMiles)).toBe(true);
    // ~3.9km apart > 2mi (3218m)
    expect(isWithinRadius(P_STREET, CAPITOL_HILL, twoMiles)).toBe(false);
    expect(isWithinRadius(P_STREET, CAPITOL_HILL, milesToMeters(3))).toBe(true);
  });

  it("the boundary is inclusive (<=)", () => {
    const d = haversineMeters(CAPITOL_HILL, P_STREET);
    expect(isWithinRadius(P_STREET, CAPITOL_HILL, d)).toBe(true);
    expect(isWithinRadius(P_STREET, CAPITOL_HILL, d - 1)).toBe(false);
  });
});

describe("mile/meter conversions", () => {
  it("uses the exact statute-mile constant and round-trips", () => {
    expect(milesToMeters(1)).toBe(1609.344);
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(milesToMeters(7.5))).toBeCloseTo(7.5, 10);
  });
});
