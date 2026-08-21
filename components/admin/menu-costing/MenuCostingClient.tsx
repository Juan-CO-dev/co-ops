"use client";

/**
 * MenuCostingClient — the menu costing board (the "payoff screen").
 *
 * One row per active menu_item: name · menu price · rolled-up cost · food-cost %
 * · $ margin, with an inline `(N unpriced)` badge naming exactly how incomplete
 * the number is. Read-only: nothing here mutates.
 *
 * HONESTY RULES this component enforces at the render layer (the whole point of
 * the screen — see lib/menu-costing-shared.ts for the math side):
 *  - Cost / FC% / margin render "—" whenever the rollup is incomplete. A partial
 *    cost is never shown in the cost column; it appears only in the drawer,
 *    explicitly labelled "known so far", because a partial cost flatters the
 *    margin in the one direction an owner must never be misled.
 *  - A missing price NEVER reads as $0 and never hides the row. The row stays,
 *    the badge counts the unpriced lines, and the drawer names the SKUs to go
 *    price. On a system with no price ledger yet EVERY row reads unpriced — the
 *    correct day-one output, with the counts falling as prices land.
 *  - "No recipe" and "cost unresolved" are different badges. The first is work
 *    not started; the second is a data bug in the recipe graph.
 *  - "Recipe weights don't add up" is a THIRD kind of failure and gets its own
 *    badge and group: the cost could be computed, and would be wrong, because a
 *    prep this item is built from claims to produce more weight than it is made
 *    of. It is the only failure mode that used to render as a confident number,
 *    which is why it sorts ABOVE unresolved and why the drawer names the exact
 *    prep to go fix rather than leaving the operator to hunt for it.
 *
 * DISCLOSURE DOCTRINE (D1-D10): identity + every alert badge ride the always-
 * visible summary line (D1/D2); the per-row detail is a lazy drawer (D3/D10);
 * groups are CollapsibleSections carrying i18n'd counts (D5); the first
 * non-empty group opens so the board is never a wall of closed headers; state
 * is per-session useState with Set-based multi-expand (D7/D9); toggles are
 * full-row 44px+ buttons with the aria contract baked into the primitives (D8).
 *
 * Admin/tablet is the honest primary here — four money columns want width. The
 * metric cluster degrades to a 2x2 grid on a phone rather than a squeezed row.
 */

import { useMemo, useState, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { EmptyState } from "@/components/EmptyState";
import { SummaryRow } from "@/components/ui/SummaryRow";
import {
  FOOD_COST_RED_THRESHOLD_PCT,
  type MenuCostRow,
  type MenuCostStatus,
  type MenuCostTotals,
} from "@/lib/menu-costing-shared";

/** Group render order — mirrors the sort ranking in menu-costing-shared. */
const GROUPS: ReadonlyArray<{ status: MenuCostStatus; titleKey: TranslationKey }> = [
  { status: "costed", titleKey: "admin.menu_costing.group.costed" },
  { status: "partial", titleKey: "admin.menu_costing.group.partial" },
  { status: "unpriced", titleKey: "admin.menu_costing.group.unpriced" },
  { status: "inconsistent", titleKey: "admin.menu_costing.group.inconsistent" },
  { status: "unweighed", titleKey: "admin.menu_costing.group.unweighed" },
  { status: "unresolved", titleKey: "admin.menu_costing.group.unresolved" },
  { status: "no_recipe", titleKey: "admin.menu_costing.group.no_recipe" },
];

export function MenuCostingClient({
  rows,
  totals,
  skuNames,
  itemNames,
  productNames,
}: {
  rows: MenuCostRow[];
  totals: MenuCostTotals;
  skuNames: Record<string, string>;
  itemNames: Record<string, { en: string; es: string | null }>;
  productNames: Record<string, { en: string; es: string | null }>;
}) {
  const { t, language } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const money = useMemo(() => {
    const fmt = new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", {
      style: "currency",
      currency: "USD",
    });
    return (v: number | null) => (v != null ? fmt.format(v) : "—");
  }, [language]);

  const pct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "—");

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const grouped = useMemo(() => {
    const m = new Map<MenuCostStatus, MenuCostRow[]>();
    for (const r of rows) {
      const list = m.get(r.rollup.status) ?? [];
      list.push(r);
      m.set(r.rollup.status, list);
    }
    return m;
  }, [rows]);

  if (rows.length === 0) {
    return <EmptyState message={t("admin.menu_costing.empty")} />;
  }

  const firstNonEmpty = GROUPS.find((g) => (grouped.get(g.status)?.length ?? 0) > 0)?.status;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* Board state — never collapses (D2): the counts that say how much of this
          board is real yet. */}
      <div className="co-card flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
        <Metric label={t("admin.menu_costing.totals.items")} value={String(totals.rowCount)} />
        <Metric label={t("admin.menu_costing.totals.costed")} value={String(totals.costedCount)} />
        <Metric
          label={t("admin.menu_costing.totals.over_threshold")}
          value={String(totals.overThresholdCount)}
          danger={totals.overThresholdCount > 0}
        />
        <Metric
          label={t("admin.menu_costing.totals.blocking_skus")}
          value={String(totals.blockingSkuCount)}
        />
        {/* Always rendered, zero included — same contract as "Over target". A
            zero here is the good news this card exists to deliver, and a metric
            that appears only on bad days teaches nobody where to look. */}
        <Metric
          label={t("admin.menu_costing.totals.inconsistent_items")}
          value={String(totals.inconsistentItemCount)}
          danger={totals.inconsistentItemCount > 0}
        />
        {/* Same always-rendered contract, different errand: these preps need a
            scale, not a recipe edit. */}
        <Metric
          label={t("admin.menu_costing.totals.unweighed_items")}
          value={String(totals.unweighedItemCount)}
          danger={totals.unweighedItemCount > 0}
        />
        <p className="w-full text-[11px] font-medium text-co-text-muted">
          {t("admin.menu_costing.threshold_note", { pct: FOOD_COST_RED_THRESHOLD_PCT })}
        </p>
      </div>

      {GROUPS.map((g) => {
        const list = grouped.get(g.status) ?? [];
        if (list.length === 0) return null;
        return (
          <CollapsibleSection
            key={g.status}
            idBase={`menu-costing-${g.status}`}
            title={t(g.titleKey)}
            count={t("admin.menu_costing.group_count", { n: list.length })}
            defaultOpen={g.status === firstNonEmpty}
          >
            <ul className="flex flex-col gap-2">
              {list.map((row) => (
                <li key={row.id}>
                  <SummaryRow
                    drawerId={`menu-costing-row-${row.id}`}
                    expanded={expanded.has(row.id)}
                    onToggle={() => toggle(row.id)}
                    toggleLabel={
                      expanded.has(row.id)
                        ? t("admin.menu_costing.toggle.hide")
                        : t("admin.menu_costing.toggle.show")
                    }
                    summary={
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-co-text">
                          {language === "es" && row.nameEs ? row.nameEs : row.name}
                        </span>
                        <span className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-5">
                          <Metric
                            label={t("admin.menu_costing.col.price")}
                            value={money(row.menuPrice)}
                          />
                          <Metric
                            label={t("admin.menu_costing.col.cost")}
                            value={money(row.rollup.cost)}
                          />
                          <Metric
                            label={t("admin.menu_costing.col.food_cost")}
                            value={pct(row.foodCostPct)}
                            danger={row.overThreshold}
                          />
                          <Metric
                            label={t("admin.menu_costing.col.margin")}
                            value={money(row.marginDollars)}
                          />
                        </span>
                      </span>
                    }
                    badges={<RowBadges row={row} t={t} />}
                  >
                    <RowDrawer
                      row={row}
                      skuNames={skuNames}
                      itemNames={itemNames}
                      productNames={productNames}
                      language={language}
                      money={money}
                      t={t}
                    />
                  </SummaryRow>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

/** Field-or-sub label (10-11px / 700 / tracking-[0.12em] / dim) + its value. */
function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {label}
      </span>
      <span
        className={`text-sm font-bold ${danger ? "text-co-cta-text" : "text-co-text"}`}
      >
        {value}
      </span>
    </span>
  );
}

/** Never-collapse alerts (D2) — they ride the summary line in both states. */
function RowBadges({
  row,
  t,
}: {
  row: MenuCostRow;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const badges: ReactNode[] = [];
  if (row.overThreshold) {
    badges.push(
      <AlertPill key="fc" tone="danger">
        {t("admin.menu_costing.badge.over_threshold", { pct: FOOD_COST_RED_THRESHOLD_PCT })}
      </AlertPill>,
    );
  }
  if (row.rollup.unpricedLineCount > 0) {
    badges.push(
      <AlertPill key="unpriced" tone="warn">
        {t("admin.menu_costing.badge.unpriced", { n: row.rollup.unpricedLineCount })}
      </AlertPill>,
    );
  }
  if (row.rollup.status === "inconsistent") {
    badges.push(
      <AlertPill key="inconsistent" tone="danger">
        {t("admin.menu_costing.badge.inconsistent")}
      </AlertPill>,
    );
  }
  if (row.rollup.status === "unweighed") {
    badges.push(
      <AlertPill key="unweighed" tone="warn">
        {t("admin.menu_costing.badge.unweighed")}
      </AlertPill>,
    );
  }
  if (row.rollup.status === "unresolved") {
    badges.push(
      <AlertPill key="unresolved" tone="danger">
        {t("admin.menu_costing.badge.unresolved")}
      </AlertPill>,
    );
  }
  if (row.rollup.status === "no_recipe") {
    badges.push(
      <AlertPill key="no-recipe" tone="info">
        {t("admin.menu_costing.badge.no_recipe")}
      </AlertPill>,
    );
  }
  return <>{badges}</>;
}

function RowDrawer({
  row,
  skuNames,
  itemNames,
  productNames,
  language,
  money,
  t,
}: {
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
              {(language === "es" ? name?.es ?? name?.en : name?.en) ?? t(unknownKey)}
            </li>
          );
        })}
      </ul>
    </div>
  );

  /** The two prep-blocked drawers — same list, different errand. */
  const prepList = (ids: string[], labelKey: TranslationKey) =>
    nameList(ids, labelKey, itemNames, "admin.menu_costing.drawer.unknown_item");

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
                {skuNames[id] ?? t("admin.menu_costing.drawer.unknown_sku")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
