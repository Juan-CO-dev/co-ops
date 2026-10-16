/**
 * The per-shop PM v2 switch CARD — pure, client-safe (CC's chunk G ruling 2). What one shop's row shows and what a
 * toggle posts. The rules themselves stay where they are: `canManagePmV2Switch` (who sees the card),
 * `savePeopleShopSettings` + `pmV2Readiness` (who may write, and when ON is refused `pm_v2_not_ready`).
 */
export interface PmV2SwitchShop {
  locationId: string;
  name: string;
  pmV2: boolean;
  prepPositionId: string | null;
  /** pmV2Readiness: both BOH positions AND at least one active shared criterion. */
  ready: boolean;
  boh: boolean;
  criteria: number;
}

export type PmV2Missing = "boh" | "criteria";

/** On / off, whether the toggle may be used (turning OFF is never gated), and what readiness still lacks. */
export function pmV2SwitchState(shop: PmV2SwitchShop): { on: boolean; canToggle: boolean; missing: PmV2Missing[] } {
  const missing: PmV2Missing[] = [];
  if (!shop.boh) missing.push("boh");
  if (shop.criteria <= 0) missing.push("criteria");
  return { on: shop.pmV2, canToggle: shop.pmV2 || shop.ready, missing };
}

/** POST /api/people/settings, action "shop": exactly the route's fields; the prep position travels unchanged. */
export function pmV2SwitchBody(shop: PmV2SwitchShop, pmV2: boolean): { action: "shop"; locationId: string; pmV2: boolean; prepPositionId: string | null } {
  return { action: "shop", locationId: shop.locationId, pmV2, prepPositionId: shop.prepPositionId };
}
