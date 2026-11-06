import { summarizeMenuCostRows, type MenuCostRow } from "@/lib/menu-costing-shared";
import type { loadSandwiches } from "@/lib/admin/sandwiches";
export function sandwichesView(rows: MenuCostRow[], scope = "shop-a"): Awaited<ReturnType<typeof loadSandwiches>> {
  return { rows: rows.map(row => ({ ...row, soldHere: true, toastStatus: row.priceFlag ? "price_differs" : "linked", marginPct: row.menuPrice && row.marginDollars != null ? row.marginDollars / row.menuPrice * 100 : null })),
    scope, totals: summarizeMenuCostRows(rows), globalPrices: Object.fromEntries(rows.map(row => [row.id, row.typedPrice ?? null])),
    toastLinkedIds: [], toastLinksKnown: true, notSoldHere: [], skuNames: {}, itemNames: {}, productNames: {},
    toastFetchedAt: null, toastUnavailable: false, toastNotices: [] };
}
