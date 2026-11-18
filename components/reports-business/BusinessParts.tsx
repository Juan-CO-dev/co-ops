/**
 * Item 9b: small server pieces of the business report page. Every number arrives in the DTO from
 * lib/business-report.ts; every string is translated here (en + es). THE RULE OF THIS PAGE: an unknown is a
 * dash WITH its reason, never 0 (a labor % that is not shown names why: rebuilding, hours not final,
 * salaries not set up, ...).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ReportRangeForm } from "@/components/reports-hub/ReportRangeForm";
import { formatCents, formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import {
  BUSINESS_RANGES, BUSINESS_REPORT_TABS,
  type BusinessRange, type BusinessReportTab, type LaborFigures,
} from "@/lib/business-report-shared";
import type { LaborTone } from "@/lib/scheduling/board-shared";
import { loadedPctFigure, purePctFigure, type Figure } from "@/lib/business-figure-shared";

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
export function Money({ cents, reason, language }: { cents: number | null | undefined; reason?: TranslationKey | null; language: Language }) {
  return cents === null || cents === undefined ? <Dash reason={reason} language={language} /> : <>{formatCents(cents, language)}</>;
}
/** Fix round 1: an amount that holds checks of unknown amount is a FLOOR, never a plain total: "at least $20.00
 * + 1 unknown"; when every check is unknown (no known cents) it is "amount unknown (2 checks)", never $0.00. */
export function amountText(cents: number, missing: number | null | undefined, language: Language): string {
  const n = missing ?? 0;
  if (n <= 0) return formatCents(cents, language);
  if (cents === 0) return serverT(language, "reports.business.amount_unknown", { n });
  return serverT(language, "reports.business.amount_at_least", { amount: formatCents(cents, language), n });
}
export function Amount({ cents, missing, language }: { cents: number; missing: number | null | undefined; language: Language }) {
  return <>{amountText(cents, missing, language)}</>;
}
/** Internal to the figure formatter below; the page renders figures, never these directly. */
export function hoursText(minutes: number | null | undefined, language: Language): string | null {
  return minutes === null || minutes === undefined ? null : serverT(language, "reports.business.hours_value", { h: formatQuantity(minutes / 60, language) });
}
export function pctText(pct: number | null, language: Language): string | null {
  return pct === null ? null : serverT(language, "reports.business.pct_value", { pct: formatQuantity(pct, language) });
}
export function dateRange(from: string, to: string, language: Language): string {
  return from === to ? formatDateLabel(from, language) : serverT(language, "reports.export.header.range", { from: formatDateLabel(from, language), to: formatDateLabel(to, language) });
}

const TONE: Record<LaborTone, string> = {
  none: "text-co-text", good: "text-co-confirm-text", watch: "text-co-warning-text", high: "text-co-cta-text",
};
// ── THE figure formatter (fix round 3, review ITEM9B-r3) ────────────────────────────────────────
// Every labor / sales figure of the page and every collapsed row is rendered by these two from a `Figure`
// (lib/business-figure-shared.ts): the value as its STATE allows ("so far", "at least", covered days only), and
// the reason / qualifications beside it. Nothing on the page formats a labor number any other way.

/** The value of a figure as words, or null when it is unknown. */
export function figureValueText(f: Figure, language: Language): string | null {
  if (f.value === null) return null;
  let s: string;
  if (f.unit === "pct") s = pctText(f.value, language)!;
  else if (f.unit === "minutes") s = f.value === 0 && f.zero ? serverT(language, f.zero) : hoursText(f.value, language)!;
  else s = f.missing !== undefined ? amountText(f.value, f.missing, language) : formatCents(f.value, language);
  if (f.coveredOnly) s = serverT(language, "reports.business.sales_covered_only", { amount: s });
  if (f.soFar) s = serverT(language, "reports.business.hours_so_far", { h: s });
  return s;
}
/** One line of text (a collapsed row's summary): the value or "—", then "(reason; qualifications)". `short`
 * uses the compact qualifier words so a phone row stays one or two lines. */
export function figureText(f: Figure, language: Language, opts: { short?: boolean } = {}): string {
  const v = figureValueText(f, language) ?? "—";
  const parts = [
    ...(f.reason && (f.value === null || f.kind === "incomplete") && !(f.missing && !f.coveredOnly && f.value !== null) ? [serverT(language, f.reason)] : []),
    ...f.notes.map((n) => serverT(language, opts.short ? n.short : n.key, n.values)),
  ];
  return parts.length ? `${v} (${parts.join("; ")})` : v;
}
/** A figure on the page: the value (or a dash) and, as visible captions, why it is not plain. `compact` (the
 * 15-minute lines) shows the reason only when there is no value; "so far" still qualifies a provisional one, and
 * the day line above names the reason once. */
export function FigureView({ f, language, compact = false, className = "" }: { f: Figure; language: Language; compact?: boolean; className?: string }) {
  const v = figureValueText(f, language);
  const showReason = f.reason !== null && (v === null || (!compact && f.kind === "incomplete" && !(f.missing && !f.coveredOnly)));
  return <span className="inline-flex flex-col">
    {v === null ? <span aria-hidden="true" className={className}>—</span> : <span className={className}>{v}</span>}
    {showReason ? <span className={`text-xs font-normal ${v === null ? "text-co-text-muted" : "text-co-warning-text"}`}>{serverT(language, f.reason!)}</span> : null}
    {f.notes.map((n) => <span key={n.key} className={`text-xs font-normal ${n.kind === "gap" ? "text-co-warning-text" : "text-co-text-muted"}`}>{serverT(language, n.key, n.values)}</span>)}
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
export function LaborPct({ figures, view, target, language }: {
  figures: LaborFigures; view: "pure" | "loaded"; target: number | "target_varies"; language: Language;
}) {
  const t = tFor(language);
  const f = view === "pure" ? purePctFigure(figures) : loadedPctFigure(figures);
  const tone = f.value === null ? "none" : view === "pure" ? figures.tone : figures.loadedTone;
  const targetLine = target === "target_varies" ? t("reports.business.target_varies")
    : t(view === "pure" ? "reports.business.target" : "reports.business.target_le", { pct: target });
  return <span className="inline-flex flex-col">
    <span className="font-bold"><FigureView f={f} language={language} className={TONE[tone]} /></span>
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

/** One label / value line inside a drawer; a missing value is a dash with its reason. */
export function Line({ label, value, reason, language }: { label: string; value: ReactNode | null; reason?: TranslationKey | null; language: Language }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
    <span className="text-co-text-muted">{label}</span>
    <span className="min-w-0 break-words text-right font-semibold text-co-text">{value ?? <Dash reason={reason} language={language} />}</span>
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
export function BusinessRangeControls({ range, locationId, tab, language }: { range: BusinessRange; locationId: string; tab: BusinessReportTab; language: Language }) {
  const t = tFor(language);
  return <ReportRangeForm action="/reports/business">
    <input type="hidden" name="location" value={locationId} />
    <input type="hidden" name="tab" value={tab} />
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.range")}
      <select name="range" defaultValue={range.range} className={control}>
        {BUSINESS_RANGES.map((v) => <option key={v} value={v}>{t(RANGE_LABEL[v])}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.from")}<input className={control} type="date" aria-label={t("reports.hub.from")} name="from" defaultValue={range.from} /></label>
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.to")}<input className={control} type="date" aria-label={t("reports.hub.to")} name="to" defaultValue={range.to} /></label>
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
