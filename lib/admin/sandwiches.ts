import "server-only";
import type { AuthContext } from "@/lib/session";
import { isShopId } from "@/lib/shop-context-shared";
import { loadMenuCostingBoard, MenuCostingError } from "./menu-costing";
import { canViewSandwiches, type SandwichRow } from "./sandwiches-shared";

/** Same price/cost/Toast composition as reports and the former board; off-here rows opt in. */
export async function loadSandwiches(actor: AuthContext, scope: string) {
  if (!canViewSandwiches(actor.user.role)) throw new MenuCostingError(403, "forbidden");
  if (!isShopId(scope)) throw new MenuCostingError(404, "not_found");
  const board = await loadMenuCostingBoard(actor, { scope, includeNotSoldHere: true });
  const off = new Set(board.notSoldHere.map(row => row.id));
  const linked = new Set(board.toastLinkedIds);
  const rows: SandwichRow[] = board.rows.map(row => ({
    ...row,
    soldHere: !off.has(row.id),
    toastStatus: row.priceFlag ? "price_differs" : linked.has(row.id) ? "linked" : board.toastLinksKnown ? "not_linked" : "unavailable",
    marginPct: row.marginDollars !== null && row.menuPrice !== null && row.menuPrice > 0 ? row.marginDollars / row.menuPrice * 100 : null,
  }));
  return { ...board, rows };
}
