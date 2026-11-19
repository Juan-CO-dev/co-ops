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
import { BUSINESS_RANGES, BUSINESS_REPORT_TABS, type BusinessRangeEmptyReason, type BusinessRangeRequest, type BusinessReportTab } from "@/lib/business-report-shared";
import type { LaborTone } from "@/lib/scheduling/board-shared";
import { figureDisplay, figureKindOf, figureReasonOf, figureText as figureWords, type EmptyClaim, type Figure } from "@/lib/business-figure-shared";
import { changeWords, figureFormatFor, figureLegend, type FigureLegend, type LegendEntry } from "@/lib/business-figure-format";
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

/** This period against the one before (lib/business-figure-shared.ts `figureChange` decides it): a whole %, or
 * a labor % in points; anything not whole on both sides is "Not comparable". Fix round 7: it takes the two FIGURES,
 * so the change carries their qualifications ("+1.5 pts (salary estimated)"). */
export function ChangeText({ cur, prev, language, legend }: { cur: Figure; prev: Figure | null; language: Language; legend?: FigureLegend }) {
  // Fix round 1 (review POLISH-r1 P3): inside a scope the change's qualifications (both periods') are the scope's
  // marks, said once in its legend; only one the legend does not hold is written beside it.
  if (legend) {
    const c = legend.change(cur, prev);
    return c === null ? <span className="text-co-text-muted">{serverT(language, "reports.business.compare.not_comparable")}</span>
      : <span className="font-semibold">{c.said}<Marks marks={c.marks} />{c.loose.length ? <span className="text-xs font-normal text-co-text-muted"> ({c.loose.join("; ")})</span> : null}</span>;
  }
  const words = changeWords(cur, prev, language);
  return words === null ? <span className="text-co-text-muted">{serverT(language, "reports.business.compare.not_comparable")}</span>
    : <span className="font-semibold">{words}</span>;
}

/**
 * Fix round 7 (review ITEM9B-r7 P2): AN EMPTY LIST IS A CLAIM. The view decides (`emptyClaim`) whether "none" may be
 * said: `verified` = every input behind the list is known complete and zero, so `none` is written (with whatever
 * qualifies it); otherwise "Not known yet." and every reason. A list on this page never writes a "none" sentence
 * any other way.
 */
export function EmptyNote({ claim, none, language }: { claim: EmptyClaim; none: TranslationKey; language: Language }) {
  const reasons = claim.reasons.map((k) => <span key={k}> {serverT(language, k)}</span>);
  return claim.kind === "verified" ? <p className="text-sm text-co-text-muted">{serverT(language, none)}{reasons}</p>
    : <p className="text-sm text-co-warning-text">{serverT(language, "reports.business.empty.not_known")}{reasons}</p>;
}

/** The sentence that says why a figure is unknown or not whole, or null when it is plain. */
export function figureReasonText(f: Figure, language: Language): string | null {
  const key = figureReasonOf(f);
  return key === null ? null : serverT(language, key);
}
/** Why a figure is not plain, as one sentence: its reason (with the reason's own numbers) then every qualification;
 * null when it is plain. Fix round 8: the rush line ("3 checks have no time — rushes unknown"). */
export function figureWhyText(f: Figure, language: Language): string | null {
  const d = figureDisplay(f, figureFormatFor(language), { reason: "always" });
  const parts = [d.reason, ...d.notes.map((n) => n.text)].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
/** One line of text (a collapsed row's summary, a badge, a caption): the value or "—", then "(reason;
 * qualifications)"; `wrap` sets the value in its sentence first. Fix round 9 (ITEM9B-r9 P2): there is NO value-only
 * text on this page — every badge, chip, caption and attribute that says a figure says it through here or
 * `FigureView`, with its state. */
export function figureText(f: Figure, language: Language, opts: { short?: boolean; wrap?: (value: string) => string } = {}): string {
  return figureWords(f, figureFormatFor(language), opts);
}
// ── Say it once (polish, 2026-11-18) ────────────────────────────────────────────────────────────
// A card grid, a drawer or a list is a SCOPE with one legend (lib/business-figure-format.ts `figureLegend`): each
// qualification is written ONCE there under a short mark, and a figure shows the marks of what qualifies it. Every
// affected figure still carries its qualification: the mark for the eye, the full sentence for a screen reader
// (visually hidden text beside the figure) and on hover (`title`). A sentence the legend does not hold is written
// beside the figure as before, so passing a legend can never drop one.

/** The legend of a scope. `reasons` also moves the reasons (why a figure is a dash or not whole) into it. */
export function legendFor(language: Language, figures: ReadonlyArray<Figure | null | undefined>, o: { reasons?: boolean } = {}): FigureLegend {
  return figureLegend(language, figures, o);
}
function Marks({ marks }: { marks: readonly LegendEntry[] }) {
  if (marks.length === 0) return null;
  const said = marks.map((m) => m.text).join(" ");
  const letters = marks.map((m) => m.mark).join(",");
  return <>
    <sup aria-hidden="true" title={said} data-marks={letters} className="ml-0.5 text-[10px] font-bold text-co-text-muted">{letters}</sup>
    <span className="sr-only" data-figure-note=""> ({said})</span>
  </>;
}
/** The notes of a scope: each qualification once, under its mark. Nothing when the scope has none. */
export function LegendNotes({ entries, language, className = "" }: { entries: readonly LegendEntry[]; language: Language; className?: string }) {
  if (entries.length === 0) return null;
  return <ul data-legend="" aria-label={serverT(language, "reports.business.legend.title")} className={`flex flex-col gap-0.5 rounded-lg bg-co-surface-inset p-2 text-xs text-co-text-muted ${className}`}>
    {entries.map((e) => <li key={e.mark} className="flex gap-1.5"><span aria-hidden="true" data-mark={e.mark} className="min-w-[1rem] font-bold text-co-text">{e.mark}</span><span className="min-w-0 break-words">{e.text}</span></li>)}
  </ul>;
}

/** A figure on the page: the value (or a dash) and why it is not plain. With a `legend` (the scope's), what the
 * legend holds is a mark; anything else is a visible caption. `compact` (a list row without a legend) shows the
 * reason only when there is no value (or always, with `reason="always"`) and puts the short qualifier words on the
 * same line; "so far" / "at least" / "covered days only" are part of the value itself. */
export function FigureView({ f, language, compact = false, reason, className = "", legend }: { f: Figure; language: Language; compact?: boolean; reason?: "always"; className?: string; legend?: FigureLegend }) {
  if (legend) {
    const r = legend.read(f);
    return <span className="inline-flex flex-col">
      <span className={className}>{r.said === null ? <span aria-hidden="true">—</span> : r.said}<Marks marks={r.marks} /></span>
      {r.reason !== null ? <span className={`text-xs font-normal ${r.said === null ? "text-co-text-muted" : "text-co-warning-text"}`}>{r.reason}</span> : null}
      {r.loose.map((n) => <span key={n.id} className={`text-xs font-normal ${n.gap ? "text-co-warning-text" : "text-co-text-muted"}`}>{n.text}</span>)}
    </span>;
  }
  const d = figureDisplay(f, figureFormatFor(language), { compact, reason });
  const inline = compact && d.words !== null && d.notes.length > 0 ? ` (${d.notes.map((n) => n.text).join("; ")})` : "";
  return <span className="inline-flex flex-col">
    {d.words === null ? <span aria-hidden="true" className={className}>—</span> : <span className={className}>{d.words}{inline}</span>}
    {d.reason !== null ? <span className={`text-xs font-normal ${d.words === null ? "text-co-text-muted" : "text-co-warning-text"}`}>{d.reason}</span> : null}
    {inline ? null : d.notes.map((n) => <span key={n.id} className={`text-xs font-normal ${n.gap ? "text-co-warning-text" : "text-co-text-muted"}`}>{n.text}</span>)}
  </span>;
}
/** One label / figure line inside a drawer: the label left (an optional small line under it), the figure right. */
export function FigureLine({ label, sub, f, language, legend, tone }: { label: string; sub?: string; f: Figure; language: Language; legend?: FigureLegend; tone?: string }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 text-sm">
    <span className="min-w-0 break-words text-co-text-muted">{label}{sub ? <span className="block text-xs text-co-text-dim">{sub}</span> : null}</span>
    <span className="max-w-[12rem] break-words text-right font-semibold text-co-text"><FigureView f={f} language={language} legend={legend} className={tone} /></span>
  </div>;
}
/** A figure WITH its label, inline (a closed row's summary, a 15-minute line): never a bare value or dash. A figure
 * whose words name themselves ("3 checks") takes the label only when it is a dash (`selfLabeled`). */
export function Labeled({ label, f, language, legend, selfLabeled = false }: { label: string; f: Figure; language: Language; legend?: FigureLegend; selfLabeled?: boolean }) {
  const dash = figureKindOf(f) === "unknown";
  return <span className="inline-flex items-baseline gap-1">
    {selfLabeled && !dash ? null : <span className="text-co-text-dim">{label}</span>}
    <FigureView f={f} language={language} legend={legend} compact className="font-semibold text-co-text" />
  </span>;
}

/** The target line of a labor % ("Target 18%"). */
export function targetLine(view: "pure" | "loaded", target: number | "target_varies", language: Language): string {
  const t = tFor(language);
  return target === "target_varies" ? t("reports.business.target_varies") : t(view === "pure" ? "reports.business.target" : "reports.business.target_le", { pct: target });
}
/** The tone class of a labor % (the view's tone is "none" whenever the % is a dash). */
export function shareTone(labor: LaborView, view: "pure" | "loaded"): string { return TONE[view === "pure" ? labor.pureTone : labor.loadedTone]; }
/** A labor % (pure hourly or fully loaded) with its target, through the one formatter (a KPI card's body). */
export function LaborShare({ labor, view, target, language, legend }: {
  labor: LaborView; view: "pure" | "loaded"; target: number | "target_varies"; language: Language; legend?: FigureLegend;
}) {
  return <span className="inline-flex flex-col">
    <span className="font-bold"><FigureView f={view === "pure" ? labor.purePct : labor.loadedPct} language={language} className={shareTone(labor, view)} legend={legend} /></span>
    <span className="text-xs text-co-text-muted">{targetLine(view, target, language)}</span>
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
/** Fix round 6 (ITEM9B-r6 P2): the boxes show `request.form` (parseBusinessRangeRequest) and nothing else: what was
 * ASKED, blank where nothing (or nothing valid) was asked — never a default or normalized date, so Apply re-asks
 * exactly the same request. */
export function BusinessRangeControls({ request, locationId, tab, language }: { request: BusinessRangeRequest; locationId: string; tab: BusinessReportTab; language: Language }) {
  const t = tFor(language);
  return <ReportRangeForm action="/reports/business">
    <input type="hidden" name="location" value={locationId} />
    <input type="hidden" name="tab" value={tab} />
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.range")}
      <select name="range" defaultValue={request.query.range} className={control}>
        {BUSINESS_RANGES.map((v) => <option key={v} value={v}>{t(RANGE_LABEL[v])}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.from")}<input className={control} type="date" aria-label={t("reports.hub.from")} name="from" defaultValue={request.form.from} /></label>
    <label className="grid gap-1 text-xs font-bold">{t("reports.hub.to")}<input className={control} type="date" aria-label={t("reports.hub.to")} name="to" defaultValue={request.form.to} /></label>
    <button className={control} type="submit">{t("reports.hub.apply")}</button>
    <p className="w-full text-xs text-co-text-muted">{t("reports.business.cap")}</p>
    {request.kind === "range" && request.range.shortened ? <p className="w-full text-xs text-co-text-muted">{t("reports.business.range_shortened")}</p> : null}
  </ReportRangeForm>;
}

/** The sentence an empty request shows instead of numbers (one per reason, en + es). */
export const BUSINESS_EMPTY_KEY: Record<BusinessRangeEmptyReason, TranslationKey> = {
  dates_missing: "reports.business.empty.dates_missing",
  from_after_to: "reports.business.empty.from_after_to",
  no_finished_days: "reports.business.no_finished_days",
};

/** Why the CSV / PDF links are not offered for an empty request (one per reason, en + es). */
export const BUSINESS_EXPORT_OFF_KEY: Record<BusinessRangeEmptyReason, TranslationKey> = {
  dates_missing: "reports.business.export.off.dates_missing",
  from_after_to: "reports.business.export.off.from_after_to",
  no_finished_days: "reports.business.export.off.no_finished_days",
};

/** Why a section has no numbers (switch off, a refused scope, 0341 missing, a read that failed). */
export function BusinessUnavailable({ code, language }: { code: string; language: Language }) {
  const known = ["business_report_unavailable", "role_insufficient", "location_forbidden", "business_reads_not_installed", "business_reads_timeout", "business_reads_incomplete"];
  const key = (known.includes(code) ? `reports.business.error.${code}` : "reports.business.error.business_reads_timeout") as TranslationKey;
  return <p className={`${bizCard} text-sm text-co-text-muted`} role="status">{serverT(language, key)}</p>;
}
