/**
 * /admin/menu-costing — the menu costing board.
 *
 * Menu costing payoff surface: every active menu_item priced against its rolled-up
 * food cost, with food-cost %, $ margin, and an inline count of the ingredient
 * lines we cannot price yet. Level 8+ can edit selling prices with Tier B step-up.
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canReadReportLocation } from "@/lib/locations";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadMenuCostingBoard, MENU_COSTING_READ_MIN } from "@/lib/admin/menu-costing";
import { MenuCostingClient } from "@/components/admin/menu-costing/MenuCostingClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportLinks } from "@/components/reports-export/ExportLinks";

export default async function AdminMenuCostingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < MENU_COSTING_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  // THE ONE SHOP RESOLVER over the shops this viewer may read (level 8+: every shop):
  // ?location=<shop> | global → the remembered shop → the first allowed.
  const { data: locs, error: locErr } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string }>>();
  if (locErr) throw new Error(`menu costing page locations: ${locErr.message}`);
  const shops = (locs ?? []).filter((l) => canReadReportLocation({ role: auth.user.role, locations: auth.locations }, l.id));
  const explicit = shopParamFor("/admin/menu-costing", searchParamValues(sp));
  const scope = explicit === "global" ? null : await resolveShopId(shops.map((s) => s.id), explicit ?? null);
  const scopeLabel = scope === null
    ? serverT(lang, "admin.menu_costing.scope_all")
    : serverT(lang, "admin.menu_costing.scope_shop", { shop: shops.find((s) => s.id === scope)?.name ?? "" });

  const { rows, totals, skuNames, itemNames, productNames, toastFetchedAt, toastUnavailable, toastNotices, notSoldHere } = await loadMenuCostingBoard(auth, { scope });
  // The shop-switcher grammar the dashboard established: selected = ink edge on a gold fill;
  // co-surface-2 is hover/pressed only (AGENTS.md token roles).
  const pill = (on: boolean) =>
    `inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold transition ${on ? "border-co-text bg-co-gold text-co-text" : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}`;

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.menu_costing.title")}
        subtitle={serverT(lang, "admin.menu_costing.subtitle")}
      />
      <nav aria-label={serverT(lang, "admin.menu_costing.shop_switcher")} className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {shops.map((s) => (
          <Link key={s.id} href={`/admin/menu-costing?location=${s.id}`} aria-current={scope === s.id ? "page" : undefined} className={pill(scope === s.id)}>
            {s.name}
          </Link>
        ))}
        <Link href="/admin/menu-costing?location=global" aria-current={scope === null ? "page" : undefined} className={pill(scope === null)}>
          {serverT(lang, "admin.menu_costing.scope_all_short")}
        </Link>
      </nav>
      <p className="mb-4 text-sm text-co-text-muted">{scopeLabel}</p>
      {notSoldHere.length > 0 ? (
        <p className="mb-4 text-sm text-co-text-muted">
          {serverT(lang, "admin.menu_costing.not_sold_here", {
            n: notSoldHere.length,
            names: notSoldHere.map((m) => (lang === "es" && m.nameEs ? m.nameEs : m.name)).join(", "),
          })}
        </p>
      ) : null}
      <ExportLinks className="mb-4" family="costing" language={lang} query={{ location: scope ?? "global" }}
        caption={serverT(lang, "admin.menu_costing.export_scope", { scope: scope === null ? serverT(lang, "admin.menu_costing.scope_all_short") : shops.find((s) => s.id === scope)?.name ?? "" })} />
      <MenuCostingClient
        scope={scope}
        toastNotices={toastNotices}
        toastFetchedAt={toastFetchedAt}
        toastUnavailable={toastUnavailable}
        rows={rows}
        totals={totals}
        skuNames={skuNames}
        itemNames={itemNames}
        productNames={productNames}
      />
    </div>
  );
}
