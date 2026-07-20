/** Pure geo helpers — no DB, no external calls. Great-circle (haversine) distance + radius check. */
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_MILE = 1609.344;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` is within `radiusMeters` of `center` (the in/out-of-zone test). */
export function isWithinRadius(point: LatLng, center: LatLng, radiusMeters: number): boolean {
  return haversineMeters(point, center) <= radiusMeters;
}

export function milesToMeters(mi: number): number {
  return mi * METERS_PER_MILE;
}
export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}
