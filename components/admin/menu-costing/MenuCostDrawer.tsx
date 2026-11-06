import type { TranslationKey } from "@/lib/i18n/types";
import type { MenuCostRow } from "@/lib/menu-costing-shared";
import { prepItemHref, productHref, skuCatalogHref } from "@/lib/admin/product-item-links-shared";
import { skuItemHref } from "@/lib/catalog/sku-item-shared";
const drawerLinkCls = "inline-flex min-h-[44px] items-center underline decoration-2 underline-offset-2 hover:text-co-gold-text";

export function MenuCostDrawer({
  canOpenSkuItem,
  scope,
  row,
  skuNames,
  itemNames,
  productNames,
  language,
  money,
  t,
}: {
  canOpenSkuItem?: boolean;
  scope?: string | null;
  row: MenuCostRow;
  skuNames: Record<string, string>;
  itemNames: Record<string, { en: string; es: string | null }>;
  productNames: Record<string, { en: string; es: string | null }>;
  language: string;
  money: (v: number | null) => string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const {
    status, pricedCost, pricedLineCount, unpricedSkuIds,
    inconsistentItemIds, unweighedItemIds, retiredProductIds,
  } = row.rollup;

  /** Shared renderer for a named-address list — same shape, different registry. */
  const nameList = (
    ids: string[],
    labelKey: TranslationKey,
    names: Record<string, { en: string; es: string | null }>,
    unknownKey: TranslationKey,
    hrefFor: (id: string) => string,
  ) => (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {t(labelKey, { n: ids.length })}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {ids.map((id) => {
          const name = names[id];
          return (
            <li key={id} className="text-xs font-medium text-co-text">
              <a href={hrefFor(id)} className={drawerLinkCls}>
                {(language === "es" ? name?.es ?? name?.en : name?.en) ?? t(unknownKey)}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );

  /** The two prep-blocked drawers — same list, different errand. */
  const prepList = (ids: string[], labelKey: TranslationKey) =>
    nameList(ids, labelKey, itemNames, "admin.menu_costing.drawer.unknown_item", id => prepItemHref(id, scope ?? undefined));

  if (status === "no_recipe") {
    return <p className="text-xs text-co-text-muted">{t("admin.menu_costing.drawer.no_recipe_help")}</p>;
  }
  if (status === "unresolved") {
    // SAME status, two different errands (Juan's ruling A+, 2026-08-21). A row
    // blocked by a discontinued product is not "a SKU is missing pack info" — it is
    // a recipe edit, and pointing the manager at the SKU catalog would waste the
    // trip. Naming the product is what makes the shared status honest.
    if (retiredProductIds.length > 0) {
      return (
        <>
          <p className="text-xs text-co-text-muted">{t("admin.menu_costing.drawer.retired_product_help")}</p>
          {nameList(
            retiredProductIds,
            "admin.menu_costing.drawer.retired_products",
            productNames,
            "admin.menu_costing.drawer.unknown_product",
            productHref,
          )}
        </>
      );
    }
    return <p className="text-xs text-co-text-muted">{t("admin.menu_costing.drawer.unresolved_help")}</p>;
  }
  if (status === "inconsistent") {
    return (
      <>
        <p className="text-xs text-co-text-muted">{t("admin.menu_costing.drawer.inconsistent_help")}</p>
        {prepList(inconsistentItemIds, "admin.menu_costing.drawer.inconsistent_preps")}
      </>
    );
  }
  if (status === "unweighed") {
    return (
      <>
        <p className="text-xs text-co-text-muted">{t("admin.menu_costing.drawer.unweighed_help")}</p>
        {prepList(unweighedItemIds, "admin.menu_costing.drawer.unweighed_preps")}
      </>
    );
  }

  return (
    <>
      <p className="text-xs text-co-text-muted">
        {status === "costed"
          ? t("admin.menu_costing.drawer.costed_lines", { n: pricedLineCount })
          : pricedLineCount === 0
            ? // The day-one state for every row — "$0.00 across 0 priced lines"
              // is arithmetically true and reads like noise, so say it plainly.
              t("admin.menu_costing.drawer.none_priced")
            : t("admin.menu_costing.drawer.known_so_far", {
                amount: money(pricedCost),
                n: pricedLineCount,
              })}
      </p>
      {unpricedSkuIds.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("admin.menu_costing.drawer.blocking", { n: unpricedSkuIds.length })}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {unpricedSkuIds.map((id) => (
              <li key={id} className="text-xs font-medium text-co-text">
                <a href={canOpenSkuItem ? skuItemHref(id, { shopId: scope, job: "price" }) : skuCatalogHref(id)} className={drawerLinkCls}>
                  {skuNames[id] ?? t("admin.menu_costing.drawer.unknown_sku")}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
