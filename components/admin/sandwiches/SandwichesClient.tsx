"use client";

import Link from "next/link";
import { useState } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { MenuPriceEditor } from "@/components/admin/menu-costing/MenuPriceEditor";
import { MenuCostDrawer } from "@/components/admin/menu-costing/MenuCostingClient";
import { filterSandwiches, sandwichProblems, SANDWICH_PROBLEMS, type SandwichFilter } from "@/lib/admin/sandwiches-shared";
import type { loadSandwiches } from "@/lib/admin/sandwiches";
import { menuItemPageHref } from "@/lib/catalog/recipe-item-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";

const control = "inline-flex min-h-[44px] min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm";
export function SandwichesClient({ view, scope, canEditShop }: {
  view: Awaited<ReturnType<typeof loadSandwiches>>; scope: string; canEditShop: boolean;
}) {
  const { t, language } = useTranslation();
  const [filter, setFilter] = useState<SandwichFilter>("sold");
  const [search, setSearch] = useState("");
  const rows = filterSandwiches(view.rows, filter, search);
  const problems = sandwichProblems(view.rows);
  const name = (row: { name: string; nameEs: string | null }) => language === "es" && row.nameEs ? row.nameEs : row.name;
  const money = (n: number | null) => n === null ? t("admin.sandwiches.unknown") : new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(n);
  const percent = (n: number | null) => n === null ? t("admin.sandwiches.unknown") : new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(n / 100);
  return <div className="min-w-0 space-y-4 break-words [overflow-wrap:anywhere] [&_button_span]:min-w-0">
    <p role="status">{t("admin.sandwiches.problems", { n: problems.count })}</p>
    <CollapsibleSection idBase="sandwich-problems" title={t("admin.sandwiches.causes")} count={t("admin.menu_costing.group_count", { n: problems.count })}>
      <ul className="space-y-3">{SANDWICH_PROBLEMS.map(cause => <li key={cause}>
        <p className="font-bold">{t(`admin.sandwiches.problem.${cause}`, { n: problems.causes[cause].length })}</p>
        <ul>{problems.causes[cause].map(row => <li key={row.id}><Link className={`${control} my-1 max-w-full`} href={menuItemPageHref(row.id, { shopId: scope })}>{name(row)}</Link></li>)}</ul>
      </li>)}</ul>
    </CollapsibleSection>
    {view.toastUnavailable && <p>{t("admin.menu_costing.price.unavailable")}</p>}
    {view.toastFetchedAt && <p className="text-xs text-co-text-muted">{t("admin.menu_costing.price.as_of", { date: formatDateLabel(etCalendarDate(view.toastFetchedAt), language) })}</p>}
    {view.toastNotices.map((notice, index) => <p key={index} className="text-sm text-co-text-muted">{t(notice.reason === "menu_not_set" ? "admin.menu_costing.price.menu_not_set" : notice.reason === "menu_missing" ? "admin.menu_costing.price.menu_missing" : "admin.menu_costing.price.shop_unavailable", { name: notice.locationName })}</p>)}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0">{t("admin.sandwiches.filter")}<select aria-label={t("admin.sandwiches.filter")} className={`${control} mt-1 w-full`} value={filter} onChange={event => setFilter(event.target.value as SandwichFilter)}>
        {(["sold", "off", "all"] as const).map(value => <option key={value} value={value}>{t(`admin.sandwiches.filter.${value}`)}</option>)}
      </select></label>
      <label className="min-w-0">{t("admin.sandwiches.search")}<input type="search" className={`${control} mt-1 w-full`} value={search} onChange={event => setSearch(event.target.value)} /></label>
    </div>
    <p role="status">{t("admin.menu_costing.group_count", { n: rows.length })}</p>
    {!rows.length && <p>{t("admin.sandwiches.empty")}</p>}
    <ul className="space-y-3">{rows.map(row => <li key={row.id} className="co-card min-w-0 space-y-3 p-3">
      <h2 className="font-bold">{name(row)}</h2>
      <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
        <Value label={t("admin.sandwiches.price")} value={row.includedInSubPrice ? t("admin.menu_costing.price.included") : money(row.menuPrice)} />
        <Value label={t("admin.sandwiches.sold_here")} value={t(row.soldHere ? "admin.sandwiches.on" : "admin.sandwiches.off")} />
        <Value label={t("admin.sandwiches.toast")} value={t(`admin.sandwiches.toast.${row.toastStatus}`)} />
        <Value label={t("admin.menu_costing.col.cost")} value={money(row.rollup.cost)} />
        <Value label={t("admin.menu_costing.col.margin")} value={money(row.marginDollars)} />
        <Value label={t("admin.sandwiches.margin_pct")} value={percent(row.marginPct)} />
      </dl>
      <CollapsibleSection idBase={`sandwich-${row.id}`} title={t("admin.sandwiches.details", { name: name(row) })}>
        <MenuCostDrawer row={row} scope={scope} canOpenSkuItem skuNames={view.skuNames} itemNames={view.itemNames} productNames={view.productNames} language={language} money={money} t={t} />
        <Link className={`${control} mt-3 max-w-full font-bold`} href={menuItemPageHref(row.id, { shopId: scope })}>
          {t(canEditShop ? "admin.sandwiches.edit_shop" : "catalog.menu.open_page")}
        </Link>
        {row.canEditPrice && <CollapsibleSection idBase={`sandwich-global-${row.id}`} title={t("admin.sandwiches.global_price")}>
          <p className="mb-3 text-sm">{t("admin.sandwiches.global_help")}</p>
          <MenuPriceEditor key={`${row.id}:${view.globalPrices[row.id]}`} row={{ ...row, typedPrice: view.globalPrices[row.id] ?? null }} />
        </CollapsibleSection>}
      </CollapsibleSection>
    </li>)}</ul>
  </div>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-co-text-muted">{label}</dt><dd className="font-bold">{value}</dd></div>;
}
