import assert from "node:assert/strict";
import { haversineMeters, isWithinRadius, milesToMeters, metersToMiles } from "@/lib/geo";

// 1 degree of longitude at the equator ≈ 111,195 m (π/180 × 6,371,000).
const oneDeg = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
assert.ok(Math.abs(oneDeg - 111_195) < 50, `1° lng at equator ≈ 111195 m (got ${oneDeg})`);
// Symmetric for latitude.
const oneDegLat = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
assert.ok(Math.abs(oneDegLat - 111_195) < 50, `1° lat ≈ 111195 m (got ${oneDegLat})`);
// Same point → 0.
assert.equal(haversineMeters({ lat: 38.9, lng: -77.0 }, { lat: 38.9, lng: -77.0 }), 0, "same point = 0 m");

// A point ~1 mile north of a DC center (1 mi ≈ 1/69.0 deg lat).
const center = { lat: 38.9072, lng: -77.0369 };
const oneMileNorth = { lat: center.lat + 1 / 69.0, lng: center.lng };
const d = haversineMeters(oneMileNorth, center);
assert.ok(Math.abs(d - milesToMeters(1)) < 50, `~1 mi north ≈ ${milesToMeters(1)} m (got ${d})`);
assert.equal(isWithinRadius(oneMileNorth, center, milesToMeters(2)), true, "1 mi is within a 2 mi radius");
assert.equal(isWithinRadius(oneMileNorth, center, milesToMeters(0.5)), false, "1 mi is NOT within a 0.5 mi radius");

// Round-trip conversion.
assert.ok(Math.abs(metersToMiles(milesToMeters(3)) - 3) < 1e-9, "miles round-trip");

console.log("geo-test: PASS");
