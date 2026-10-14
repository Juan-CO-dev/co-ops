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

import { SHOP_COOKIE, isShopId, pickShop, pickShopId } from "./shop-context-shared";

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
