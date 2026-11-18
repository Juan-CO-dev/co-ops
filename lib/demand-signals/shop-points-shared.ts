/**
 * Demand signals: WHERE IS EACH SHOP. PURE (no I/O). The NWS collector asks the forecast for a shop's point, and
 * a shop's point is its ACTIVE catering fulfilment node (0138: the one place a shop's coordinates are stored).
 *
 * One rule, decided here and nowhere else:
 *   - only ACTIVE nodes of ACTIVE shops count (an inactive node is not a point; a node of an inactive shop is
 *     ignored);
 *   - exactly ONE designated point per shop. The table has no primary / default flag, so several active nodes for
 *     one shop is refused BY NAME (`multiple_points`), never resolved by picking one (0138's UNIQUE (location_id)
 *     makes this unreachable today; the rule does not lean on it);
 *   - a shop with no active node is LISTED (`no_coordinates`), never silently skipped; so is a node whose
 *     coordinates are not finite numbers (`bad_coordinates`).
 * Output is in shop id order.
 */

export interface ShopPoint { locationId: string; lat: number; lon: number }
export type ShopPointGap = "no_coordinates" | "multiple_points" | "bad_coordinates";
export interface UnplacedShop { locationId: string; reason: ShopPointGap }
export interface ShopPoints { points: ShopPoint[]; unplaced: UnplacedShop[] }
export interface ShopNodeRow { location_id: string; lat: number | null; lng: number | null; active: boolean | null }

export function pickShopPoints(activeShopIds: readonly string[], nodes: readonly ShopNodeRow[]): ShopPoints {
  const byShop = new Map<string, ShopNodeRow[]>();
  for (const id of activeShopIds) byShop.set(id, []);
  for (const n of nodes) if (n.active === true) byShop.get(n.location_id)?.push(n);
  const points: ShopPoint[] = [];
  const unplaced: UnplacedShop[] = [];
  for (const id of [...byShop.keys()].sort()) {
    const live = byShop.get(id)!;
    if (live.length === 0) { unplaced.push({ locationId: id, reason: "no_coordinates" }); continue; }
    if (live.length > 1) { unplaced.push({ locationId: id, reason: "multiple_points" }); continue; }
    const lat = Number(live[0]!.lat), lon = Number(live[0]!.lng);
    if (live[0]!.lat === null || live[0]!.lng === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      unplaced.push({ locationId: id, reason: "bad_coordinates" }); continue;
    }
    points.push({ locationId: id, lat, lon });
  }
  return { points, unplaced };
}
