"use client";

/**
 * ShopContextSync — remembers the shop an explicit URL pick selected (B2, triage #30).
 *
 * Mounted once per authenticated shell (the (authed) and admin layouts, and /ordering, which has
 * no layout). After a navigation COMMITS, it reads `?location=` / `?loc=` and, when that is a shop
 * the actor holds operationally, writes it to the `co_shop` cookie — so the next page that opens
 * without a shop in its URL opens on the same shop. Renders nothing.
 *
 * It runs in an effect on purpose: a Link prefetch fetches a page without committing it, so a
 * prefetched shop chip never moves the remembered shop (the reason this is not in proxy.ts — see
 * lib/shop-context-shared.ts). The cookie is a preference; every page re-validates it.
 */
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { SHOP_COOKIE, readCookie, shopCookieAssignment, shopParamFromUrl, shouldRememberShop } from "@/lib/shop-context-shared";

/** Remember `shopId` on this device (tile login). Blocked cookies are not an error. */
export function rememberShopOnDevice(shopId: string): void {
  try {
    document.cookie = shopCookieAssignment(shopId, window.location.protocol === "https:");
  } catch {
    // Cookies blocked: pages fall back to their first allowed shop.
  }
}

export function ShopContextSync({ allowed }: { allowed: string[] | "all" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const candidate = shopParamFromUrl(pathname, searchParams);

  useEffect(() => {
    try {
      const current = readCookie(document.cookie, SHOP_COOKIE);
      if (!shouldRememberShop({ candidate, allowed, current })) return;
      document.cookie = shopCookieAssignment(candidate!, window.location.protocol === "https:");
    } catch {
      // Cookies blocked: every page still falls back to its first allowed shop.
    }
  }, [candidate, allowed]);

  return null;
}
