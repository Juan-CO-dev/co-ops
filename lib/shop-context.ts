/**
 * Shop context — server half. Reads the remembered shop (`co_shop`) for the current request and
 * runs the pure resolver from `lib/shop-context-shared.ts` (read that header for the rule).
 *
 * Server Components only (`next/headers`). The cookie is re-validated against the page's own
 * allowed list on every read, so a stale or forged value can never select a shop the page would
 * not already show this actor.
 */
import "server-only";
import { cookies } from "next/headers";

import { REPORT_ALL_LOCATIONS_LEVEL } from "./locations";
import { SHOP_COOKIE, isShopId, pickShop, pickShopId, reportShopCandidates } from "./shop-context-shared";
import { getServiceRoleClient } from "./supabase-server";

export { SHOP_COOKIE, isShopId, pickShop, pickShopId } from "./shop-context-shared";

/** The remembered shop id for this request, or null when absent / not a shop id. */
export async function rememberedShopId(): Promise<string | null> {
  const value = (await cookies()).get(SHOP_COOKIE)?.value ?? null;
  return isShopId(value) ? value : null;
}

/** Explicit → remembered → first, over location rows the page already allows. */
export async function resolveShop<T extends { id: string }>(allowed: readonly T[], explicit?: string | null): Promise<T | null> {
  return pickShop({ allowed, explicit, remembered: await rememberedShopId() });
}

/** Explicit → remembered → first, over shop ids the page already allows. */
export async function resolveShopId(allowed: readonly string[], explicit?: string | null): Promise<string | null> {
  return pickShopId({ allowed, explicit, remembered: await rememberedShopId() });
}

/**
 * The default shop of a REPORT page with no `?location=` (the hub and the three Sales pages),
 * resolved against the page's AUTHORIZED list — the read gate's own grant — not memberships only
 * (review P2). Level 8+ reads every shop, so a remembered active shop outside the memberships is
 * honoured; below that the list is the memberships, exactly as the gate. The active-shop read runs
 * only when the remembered shop is not already a membership, so the common case costs no query.
 */
export async function resolveReportShopId(viewer: { level: number; locations: readonly string[] }): Promise<string | null> {
  const remembered = await rememberedShopId();
  const needsAllShops = viewer.level >= REPORT_ALL_LOCATIONS_LEVEL
    && (viewer.locations.length === 0 || (remembered !== null && !viewer.locations.includes(remembered)));
  let activeShopIds: string[] = [];
  if (needsAllShops) {
    const { data, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name");
    if (error) throw new Error(`report default shop: ${error.message}`);
    activeShopIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }
  const allowed = reportShopCandidates({ level: viewer.level, memberships: viewer.locations, activeShopIds, reportAllLevel: REPORT_ALL_LOCATIONS_LEVEL });
  return pickShopId({ allowed, remembered });
}
