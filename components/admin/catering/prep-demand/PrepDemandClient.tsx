"use client";

/**
 * PrepDemandClient — W4a/W4b Catering Prep Demand manager view.
 *
 * READ-ONLY: no mutations, no step-up. Two-tab toggle:
 *   "Prep" tab — existing W4a per-day prep demand (unchanged)
 *   "Raw / SKU" tab — W4b raw SKU consumption from confirmed catering,
 *     with advisory on-hand shortfall / order-more signal.
 *
 * Both tabs share the location selector + date-window caption above them.
 * Tab state is local useState (no useSearchParams).
 * DORMANT-safe: both tabs render empty states with 0 data.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { AlertPill } from "@/components/ui/AlertPill";
import { SalesTab } from "./SalesTab";
import type { TranslationKey } from "@/lib/i18n/types";
import type { Language } from "@/lib/i18n/types";
import { formatDateLabel } from "@/lib/i18n/format";
import type { PrepDemandDay, PrepDemandLine } from "@/lib/catering/prep-demand";
import type { PackageLocationOption } from "@/lib/admin/catering/packages";
import type { CateringSkuDemand, SkuDemandRow } from "@/lib/catering/sku-demand";
import type { SurplusDay, SurplusLine } from "@/lib/catering/surplus";

// Portion label map: quarter → ¼, half → ½, whole → (no prefix).
const PORTION_LABELS: Record<string, string> = {
  quarter: "¼",
  half: "½",
  whole: "",
};

function portionPrefix(portion: string | null): string {
  if (!portion) return "";
  const label = PORTION_LABELS[portion];
  if (label === undefined) return "";
  return label ? `${label} ` : "";
}

/** Round to at most 1 decimal place. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  days: PrepDemandDay[];
  locations: PackageLocationOption[];
  locationId: string | null;
  from: string;
  to: string;
  lang: Language;
  skuDemand: CateringSkuDemand;
  surplus: SurplusDay[];
  canPull: boolean;
}

// ─── PrepDemandClient ─────────────────────────────────────────────────────────

export function PrepDemandClient({ days, locations, locationId, from, to, lang, skuDemand, surplus, canPull }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"prep" | "sku" | "surplus" | "sales">("prep");

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  const fromLabel = formatDateLabel(from, lang);
  const toLabel = formatDateLabel(to, lang);

  return (
    <div className="mt-5">
      {/* ─── Location selector ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.catering.prep_demand.location" as TranslationKey)}
          </span>
          <select
            className={fieldCls}
            value={locationId ?? ""}
            aria-label={t("admin.catering.prep_demand.location" as TranslationKey)}
            onChange={(e) => {
              const id = e.target.value;
              if (id) router.push(`/admin/catering/prep-demand?location=${id}`);
            }}
          >
            {locations.length === 0 ? (
              <option value="">{t("admin.catering.prep_demand.empty" as TranslationKey)}</option>
            ) : (
              locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))
            )}
          </select>
        </label>
        {/* Date window caption */}
        <p className="text-xs text-co-text-muted">
          {t("admin.catering.prep_demand.date_window" as TranslationKey, {
            from: fromLabel,
            to: toLabel,
          })}
        </p>
      </div>

      {/* ─── Tab toggle ────────────────────────────────────────────────── */}
      <div
        className="mt-5 flex gap-2"
        role="tablist"
        aria-label={t("admin.catering.prep_demand.sku.tab_aria" as TranslationKey)}
      >
        <button
          role="tab"
          aria-selected={activeTab === "prep"}
          onClick={() => setActiveTab("prep")}
          className={[
            "min-h-[44px] rounded-lg border-2 px-4 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            activeTab === "prep"
              ? "border-co-text bg-co-text text-co-bg"
              : "border-co-border bg-co-surface text-co-text hover:border-co-text",
          ].join(" ")}
        >
          {t("admin.catering.prep_demand.sku.tab_prep" as TranslationKey)}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "sku"}
          onClick={() => setActiveTab("sku")}
          className={[
            "min-h-[44px] rounded-lg border-2 px-4 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            activeTab === "sku"
              ? "border-co-text bg-co-text text-co-bg"
              : "border-co-border bg-co-surface text-co-text hover:border-co-text",
          ].join(" ")}
        >
          {t("admin.catering.prep_demand.sku.tab_sku" as TranslationKey)}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "surplus"}
          onClick={() => setActiveTab("surplus")}
          className={[
            "min-h-[44px] rounded-lg border-2 px-4 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            activeTab === "surplus"
              ? "border-co-text bg-co-text text-co-bg"
              : "border-co-border bg-co-surface text-co-text hover:border-co-text",
          ].join(" ")}
        >
          {t("admin.catering.prep_demand.tab_surplus" as TranslationKey)}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "sales"}
          onClick={() => setActiveTab("sales")}
          className={[
            "min-h-[44px] rounded-lg border-2 px-4 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            activeTab === "sales"
              ? "border-co-text bg-co-text text-co-bg"
              : "border-co-border bg-co-surface text-co-text hover:border-co-text",
          ].join(" ")}
        >
          {t("admin.toastsales.tab" as TranslationKey)}
        </button>
      </div>

      {/* ─── Prep tab content ──────────────────────────────────────────── */}
      {activeTab === "prep" && (
        <div className="mt-5">
          {days.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
              {t("admin.catering.prep_demand.empty" as TranslationKey)}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {days.map((day) => (
                <DaySection
                  key={day.needDate}
                  day={day}
                  t={t}
                  lang={lang}
                  defaultOpen={days.length < 4}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Raw / SKU tab content ─────────────────────────────────────── */}
      {activeTab === "sku" && (
        <SkuTab skuDemand={skuDemand} t={t} lang={lang} />
      )}

      {/* ─── Surplus tab content ───────────────────────────────────────── */}
      {activeTab === "surplus" && (
        <SurplusTab surplus={surplus} t={t} lang={lang} />
      )}
      {activeTab === "sales" && (
        <SalesTab locationId={locationId} canPull={canPull} />
      )}

    </div>
  );
}

// ─── SkuTab ───────────────────────────────────────────────────────────────────

function SkuTab({
  skuDemand,
  t,
  lang,
}: {
  skuDemand: CateringSkuDemand;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: Language;
}) {
  return (
    <div className="mt-5">
      {skuDemand.rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.catering.prep_demand.sku.empty" as TranslationKey)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {skuDemand.rows.map((row) => (
            <SkuRow key={row.skuId} row={row} t={t} lang={lang} />
          ))}
        </div>
      )}

      {/* ─── Captions ────────────────────────────────────────────────── */}
      {(skuDemand.unresolvedChoiceLines > 0 || skuDemand.noRecipeLines > 0) && (
        <div className="mt-4 flex flex-col gap-1">
          {skuDemand.unresolvedChoiceLines > 0 && (
            <p className="text-xs text-co-text-muted">
              {t("admin.catering.prep_demand.sku.unresolved_choice" as TranslationKey, {
                n: skuDemand.unresolvedChoiceLines,
              })}
            </p>
          )}
          {skuDemand.noRecipeLines > 0 && (
            <p className="text-xs text-co-text-muted">
              {t("admin.catering.prep_demand.sku.no_recipe" as TranslationKey, {
                n: skuDemand.noRecipeLines,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SkuRow ───────────────────────────────────────────────────────────────────

function SkuRow({
  row,
  t,
  lang,
}: {
  row: SkuDemandRow;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: Language;
}) {
  const totalLabel =
    row.totalPacks != null
      ? t("admin.catering.prep_demand.sku.total_packs" as TranslationKey, {
          packs: r1(row.totalPacks),
          oz: r1(row.totalOz),
        })
      : t("admin.catering.prep_demand.sku.total_oz_only" as TranslationKey, {
          oz: r1(row.totalOz),
        });

  // Per-date sub-line: "Fri 100 oz · Sat 40 oz"
  const perDateLine = row.byDate
    .map((cell) => `${formatDateLabel(cell.needDate, lang)} ${r1(cell.oz)} oz`)
    .join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      {/* SKU name + window total */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.skuName}</span>
        <span className="text-xs text-co-text-muted">{totalLabel}</span>

        {/* Short / order-more chip */}
        {row.short && (
          <AlertPill tone="warn" className="flex-wrap">
            <span>
              {t("admin.catering.prep_demand.sku.on_hand_approx" as TranslationKey, {
                packs: r1(row.onHandPacks),
              })}
            </span>
            {row.suggestOrderPacks != null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("admin.catering.prep_demand.sku.order_more" as TranslationKey, {
                    packs: r1(row.suggestOrderPacks),
                  })}
                </span>
              </>
            )}
          </AlertPill>
        )}
      </div>

      {/* Per-date breakdown */}
      {perDateLine && (
        <p className="mt-0.5 text-xs text-co-text-muted">{perDateLine}</p>
      )}
    </div>
  );
}

// ─── SurplusTab ───────────────────────────────────────────────────────────────

function SurplusTab({
  surplus,
  t,
  lang,
}: {
  surplus: SurplusDay[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: Language;
}) {
  if (surplus.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.catering.prep_demand.surplus_empty" as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      {surplus.map((day) => {
        const dateLabel = formatDateLabel(day.needDate, lang);
        const perishableLines = day.lines.filter((l) => l.kind === "prep");
        const rawSkuLines = day.lines.filter((l) => l.kind === "raw_sku");

        return (
          <section key={day.needDate}>
            <h2 className="mb-2 text-sm font-extrabold uppercase tracking-[0.08em] text-co-text">
              {dateLabel}
            </h2>
            <div className="flex flex-col gap-3">
              {perishableLines.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                    {t("catering.surplus.section_perishable" as TranslationKey)}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {perishableLines.map((line) => (
                      <li key={`${line.pipelineId}-${line.refId}`}>
                        <SurplusPrepLine line={line} t={t} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rawSkuLines.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                    {t("catering.surplus.section_raw" as TranslationKey)}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {rawSkuLines.map((line) => (
                      <li key={`${line.pipelineId}-${line.refId}`}>
                        <SurplusRawSkuLine line={line} t={t} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── SurplusPrepLine ──────────────────────────────────────────────────────────

function SurplusPrepLine({
  line,
  t,
}: {
  line: SurplusLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const prefix = portionPrefix(line.portion);
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      <span className="font-medium text-co-cta">
        {line.qty}
        {" × "}
        {prefix}
        {line.name}
      </span>
      <span className="text-xs text-co-text-muted">
        {t("catering.surplus.days_out" as TranslationKey, { n: line.daysOut })}
      </span>
      <AlertPill tone="warn">
        {t("catering.surplus.hint.perishable" as TranslationKey)}
      </AlertPill>
    </div>
  );
}

// ─── SurplusRawSkuLine ────────────────────────────────────────────────────────

function SurplusRawSkuLine({
  line,
  t,
}: {
  line: SurplusLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      <span className="font-medium">{line.name}</span>
      {line.oz != null && (
        <span className="text-xs text-co-text-muted">{line.oz} oz</span>
      )}
      {line.qty > 0 && (
        <span className="text-xs text-co-text-muted">
          ~{Math.round(line.qty * 10) / 10} packs
        </span>
      )}
      <span className="text-xs text-co-text-muted">
        {t("catering.surplus.days_out" as TranslationKey, { n: line.daysOut })}
      </span>
      <span className="inline-flex items-center rounded-full bg-co-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted ring-1 ring-co-border">
        {t("catering.surplus.hint.adjust_ordering" as TranslationKey)}
      </span>
    </div>
  );
}

// ─── DaySection ───────────────────────────────────────────────────────────────

function DaySection({
  day,
  t,
  lang,
  defaultOpen,
}: {
  day: PrepDemandDay;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: Language;
  defaultOpen: boolean;
}) {
  const dateLabel = formatDateLabel(day.needDate, lang);
  const hasOverPar = day.lines.some((line) => line.overPar);

  return (
    <CollapsibleSection
      idBase={`prep-demand-day-${day.needDate}`}
      title={dateLabel}
      count={t("admin.catering.prep_demand.day_count" as TranslationKey, {
        n: day.lines.length,
      })}
      defaultOpen={defaultOpen}
      badge={
        hasOverPar ? (
          <AlertPill tone="warn">
            {t("admin.catering.prep_demand.over_par_badge" as TranslationKey)}
          </AlertPill>
        ) : null
      }
    >
      <ul className="flex flex-col gap-2">
        {day.lines.map((line) => (
          <li key={line.key}>
            <DemandLine line={line} t={t} />
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}

// ─── DemandLine ───────────────────────────────────────────────────────────────

function DemandLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  if (line.refKind === "choice") {
    return <ChoiceLine line={line} t={t} />;
  }
  if (line.refKind === "menu_item") {
    return <MenuItemLine line={line} t={t} />;
  }
  return <ItemLine line={line} t={t} />;
}

// ─── ChoiceLine ───────────────────────────────────────────────────────────────

function ChoiceLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      <span className="font-medium">{line.name}</span>
      <span className="inline-flex items-center rounded-full bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text">
        {t("admin.catering.prep_demand.needs_pick" as TranslationKey)}
      </span>
    </div>
  );
}

// ─── MenuItemLine ─────────────────────────────────────────────────────────────

function MenuItemLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const prefix = portionPrefix(line.portion);
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      <span className="font-medium">
        {line.qty}
        {" × "}
        {prefix}
        {line.name}
      </span>
      <span className="text-xs text-co-text-muted">
        {t("admin.catering.prep_demand.sub_note" as TranslationKey)}
      </span>
    </div>
  );
}

// ─── ItemLine ─────────────────────────────────────────────────────────────────

function ItemLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const suggestedPar =
    line.overPar
      ? (line.parValue ?? 0) + Math.ceil(line.wholeEquivDemand)
      : null;

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {line.qty}
          {" × "}
          {line.name}
        </span>
        {line.overPar ? (
          <AlertPill tone="warn">
            {t("admin.catering.prep_demand.over_par" as TranslationKey, {
              par: line.parValue != null ? String(line.parValue) : t("admin.catering.prep_demand.no_par" as TranslationKey),
              needed: String(Math.ceil(line.wholeEquivDemand)),
            })}
          </AlertPill>
        ) : null}
      </div>

      {/* Par-bump affordance — only when overPar */}
      {line.overPar && suggestedPar !== null ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-co-text-muted">
          <span>
            {t("admin.catering.prep_demand.suggested_par" as TranslationKey, {
              value: String(suggestedPar),
            })}
          </span>
          <a
            href={`/admin/pars`}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.catering.prep_demand.raise_par" as TranslationKey)}
          </a>
        </div>
      ) : null}
    </div>
  );
}
