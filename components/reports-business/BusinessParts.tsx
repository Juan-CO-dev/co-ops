/**
 * Item 9b: small server pieces of the business report page. Every number arrives in the DTO from
 * lib/business-report.ts as the VIEW of lib/business-view-shared.ts; every string is translated here (en + es).
 * THE RULE OF THIS PAGE: an unknown is a dash WITH its reason, never 0, and no number is written here by hand:
 * every one is a `Figure` rendered by the formatter below.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ReportRangeForm } from "@/components/reports-hub/ReportRangeForm";
import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { BUSINESS_RANGES, BUSINESS_REPORT_TABS, type BusinessRange, type BusinessReportTab, type CompareChange } from "@/lib/business-report-shared";
import type { LaborTone } from "@/lib/scheduling/board-shared";
import { figureDisplay, figureReasonOf, figureText as figureWords, figureValueText as figureValueWords, type Figure } from "@/lib/business-figure-shared";
import { changeWords, figureFormatFor } from "@/lib/business-figure-format";
import type { LaborView } from "@/lib/business-view-shared";

export const bizCard = "min-w-0 max-w-full break-words rounded-xl border border-co-border bg-co-surface p-4";
const pill = "inline-flex min-h-[44px] items-center rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition";
const control = "inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 bg-co-surface px-3 text-sm";

export function tFor(language: Language) {
  return (key: TranslationKey, values?: Record<string, string | number>) => serverT(language, key, values);
}

/** A dash that says why. Fix round 2 (ITEM9B-r2 P3): the reason is VISIBLE text under the dash (a small caption,
 * read on a phone without a tap), never only an attribute; screen readers read the same caption. */
export function Dash({ reason, language }: { reason?: TranslationKey | null; language: Language }) {
  return <span className="inline-flex flex-col">
    <span aria-hidden="true">—</span>
    <span className="text-xs font-normal text-co-text-muted">{serverT(language, reason ?? "reports.sales.amount_unavailable")}</span>
  </span>;
}
export function dateRange(from: string, to: string, language: Language): string {
  return from === to ? formatDateLabel(from, language) : serverT(language, "reports.export.header.range", { from: formatDateLabel(from, language), to: formatDateLabel(to, language) });
}

const TONE: Record<LaborTone, string> = {
  none: "text-co-text", good: "text-co-confirm-text", watch: "text-co-warning-text", high: "text-co-cta-text",
};
// ── THE figure formatter (fix rounds 3 + 4, reviews ITEM9B-r3 / r4) ─────────────────────────────
// Every money, percent, hours and count value of the page is a `Figure` (lib/business-figure-shared.ts, opaque)
// and is rendered by the functions below and by nothing else. This file never holds a number and names no number
// formatter: lib/business-figure-format.ts hands the language's formatters to the figure module, which decides what
// may be said ("so far", "at least", covered days only, a dash) and returns WORDS
// (tests/business-report-figure-census.test.ts).

/** This period against the one before (lib/business-figure-shared.ts `figureChange` decided it): a whole %, or
 * a labor % in points; anything not whole on both sides is "Not comparable". */
export function ChangeText({ change, language }: { change: CompareChange; language: Language }) {
  const words = changeWords(change, language);
  return words === null ? <span className="text-co-text-muted">{serverT(language, "reports.business.compare.not_comparable")}</span>
    : <span className="font-semibold">{words}</span>;
}

/** The value of a figure as words (qualified as its state demands), or null when it is unknown. */
export function figureValueText(f: Figure, language: Language): string | null {
  return figureValueWords(f, figureFormatFor(language));
}
/** The sentence that says why a figure is unknown or not whole, or null when it is plain. */
export function figureReasonText(f: Figure, language: Language): string | null {
  const key = figureReasonOf(f);
  return key === null ? null : serverT(language, key);
}
/** One line of text (a collapsed row's summary): the value or "—", then "(reason; qualifications)". */
export function figureText(f: Figure, language: Language, opts: { short?: boolean } = {}): string {
  return figureWords(f, figureFormatFor(language), opts);
}
/** A figure on the page: the value (or a dash) and, as visible captions, why it is not plain. `compact` (a list
 * row) shows the reason only when there is no value (or always, with `reason="always"`) and puts the short
 * qualifier words on the same line; "so far" / "at least" / "covered days only" are part of the value itself. */
export function FigureView({ f, language, compact = false, reason, className = "" }: { f: Figure; language: Language; compact?: boolean; reason?: "always"; className?: string }) {
  const d = figureDisplay(f, figureFormatFor(language), { compact, reason });
  const inline = compact && d.words !== null && d.notes.length > 0 ? ` (${d.notes.map((n) => n.text).join("; ")})` : "";
  return <span className="inline-flex flex-col">
    {d.words === null ? <span aria-hidden="true" className={className}>—</span> : <span className={className}>{d.words}{inline}</span>}
    {d.reason !== null ? <span className={`text-xs font-normal ${d.words === null ? "text-co-text-muted" : "text-co-warning-text"}`}>{d.reason}</span> : null}
    {inline ? null : d.notes.map((n) => <span key={n.id} className={`text-xs font-normal ${n.gap ? "text-co-warning-text" : "text-co-text-muted"}`}>{n.text}</span>)}
  </span>;
}
/** One label / figure line inside a drawer. */
export function FigureLine({ label, f, language }: { label: string; f: Figure; language: Language }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
    <span className="text-co-text-muted">{label}</span>
    <span className="min-w-0 break-words text-right font-semibold text-co-text"><FigureView f={f} language={language} /></span>
  </div>;
}

/** A labor % (pure hourly or fully loaded) with its target, through the one formatter. */
export function LaborShare({ labor, view, target, language }: {
  labor: LaborView; view: "pure" | "loaded"; target: number | "target_varies"; language: Language;
}) {
  const t = tFor(language);
  const targetLine = target === "target_varies" ? t("reports.business.target_varies")
    : t(view === "pure" ? "reports.business.target" : "reports.business.target_le", { pct: target });
  return <span className="inline-flex flex-col">
    <span className="font-bold"><FigureView f={view === "pure" ? labor.purePct : labor.loadedPct} language={language} className={TONE[view === "pure" ? labor.pureTone : labor.loadedTone]} /></span>
    <span className="text-xs text-co-text-muted">{targetLine}</span>
  </span>;
}

export function Card({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return <div className="min-w-0 break-words rounded-lg border border-co-border bg-co-surface-inset p-3">
    <div className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{label}</div>
    <div className="text-lg text-co-text">{children}</div>
    {sub ? <div className="text-xs text-co-text-muted">{sub}</div> : null}
  </div>;
}

export function BusinessTabs({ tab, hrefFor, language }: { tab: BusinessReportTab; hrefFor: (tab: BusinessReportTab) => string; language: Language }) {
  return <nav className="mb-4 flex flex-wrap gap-2" aria-label={serverT(language, "reports.business.tabs_aria")}>
    {BUSINESS_REPORT_TABS.map((v) => <Link key={v} href={hrefFor(v)} aria-current={v === tab ? "page" : undefined}
      className={`${pill} ${v === tab ? "border-co-text bg-co-gold text-co-text" : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text"}`}>
      {serverT(language, `reports.business.tab.${v}` as TranslationKey)}
    </Link>)}
  </nav>;
}

const RANGE_LABEL: Record<(typeof BUSINESS_RANGES)[number], TranslationKey> = {
  yesterday: "reports.hub.yesterday", last7: "reports.sales.range.last7", last30: "reports.sales.range.last30",
  last90: "reports.sales.range.last90", custom: "reports.hub.custom",
};
/** Finished days only (today stays on Pulse); no "compare" box: Compare is its own tab. */
/** `query` = businessRangeQuery(range, params): the form shows what was ASKED (an empty range keeps its dates). */
export function BusinessRangeControls({ range, query, locationId, tab, language }: { range: BusinessRange; query: { from?: string; to?: string }; locationId: string; tab: BusinessReportTab; language: Language }) {
  const t = tFor(language);
  return <ReportRangeForm action="/reports/business">
    <input type="hidden" name="location" value={locationId} />
    <input type="hidden" name="tab" value={tab} />
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.range")}
      <select name="range" defaultValue={range.range} className={control}>
        {BUSINESS_RANGES.map((v) => <option key={v} value={v}>{t(RANGE_LABEL[v])}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.from")}<input className={control} type="date" aria-label={t("reports.hub.from")} name="from" defaultValue={query.from ?? range.from} /></label>
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.to")}<input className={control} type="date" aria-label={t("reports.hub.to")} name="to" defaultValue={query.to ?? range.to} /></label>
    <button className={control} type="submit">{t("reports.hub.apply")}</button>
    <p className="w-full text-xs text-co-text-muted">{t("reports.business.cap")}</p>
    {range.shortened ? <p className="w-full text-xs text-co-text-muted">{t("reports.business.range_shortened")}</p> : null}
  </ReportRangeForm>;
}

/** Why a section has no numbers (switch off, a refused scope, 0341 missing, a read that failed). */
export function BusinessUnavailable({ code, language }: { code: string; language: Language }) {
  const known = ["business_report_unavailable", "role_insufficient", "location_forbidden", "business_reads_not_installed", "business_reads_timeout", "business_reads_incomplete"];
  const key = (known.includes(code) ? `reports.business.error.${code}` : "reports.business.error.business_reads_timeout") as TranslationKey;
  return <p className={`${bizCard} text-sm text-co-text-muted`} role="status">{serverT(language, key)}</p>;
}
