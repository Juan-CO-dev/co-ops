/**
 * /admin/menu-costing — the menu costing board.
 *
 * READ-ONLY payoff surface: every active menu_item priced against its rolled-up
 * food cost, with food-cost %, $ margin, and an inline count of the ingredient
 * lines we cannot price yet. No mutations, no step-up.
 *
 * DORMANT-SAFE BY DESIGN: with an empty price ledger every row renders as
 * "not yet priced" with its blocking-SKU count — the correct day-one output,
 * not an error state. The counts fall as vendor_price_history fills.
 *
 * Gate: level >= MENU_COSTING_READ_MIN (6, = COST_READ_MIN — the same AGM+ floor
 * as every other cost read). The admin shell (auth boundary, level >= 6,
 * providers, width ladder) lives in app/admin/layout.tsx; this page re-gates
 * defensively per the C.39 pattern.
 *
 * Thin render over a pure compose: all math is lib/menu-costing-shared.ts
 * (pure, vitest-pinned); this file only fetches and hands off.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadMenuCostingBoard, MENU_COSTING_READ_MIN } from "@/lib/admin/menu-costing";
import { MenuCostingClient } from "@/components/admin/menu-costing/MenuCostingClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminMenuCostingPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < MENU_COSTING_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const { rows, totals, skuNames } = await loadMenuCostingBoard(auth);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.menu_costing.title")}
        subtitle={serverT(lang, "admin.menu_costing.subtitle")}
      />
      <MenuCostingClient rows={rows} totals={totals} skuNames={skuNames} />
    </div>
  );
}
