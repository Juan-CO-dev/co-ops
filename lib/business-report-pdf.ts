/**
 * The business report's PDF (polish, 2026-11-18): the page, printed for a person.
 *
 * The CSV is the machine file (stable snake_case columns, state codes, `figure_notes`). This is the other one: the
 * page's own labels in the reader's language, every value written by the page's formatter (a dash when it is
 * unknown, "so far", "at least"), NO code columns, and each qualification said ONCE in a "Notes" block under the
 * tables with a short mark on every figure it qualifies: "$1,251.20 (a, b)". Tables are built to fit a portrait
 * page (seven columns at most); a wider one would turn the page landscape.
 *
 * It is a SURFACE like the page: it receives the VIEW (lib/business-view-shared.ts) and never a number. Every
 * figure becomes text through `figureLegend(...).cell(figure)`, which writes the value WITH its marks (and, beside
 * it, anything the legend does not hold), so a value cannot be printed without its state
 * (tests/business-report-figure-census.test.ts scans this file with the page's rules).
 */
import { channelLabel, providerLabel, serverLabel } from "@/components/reports-hub/SalesParts";
import { changeWords, figureLegend } from "@/lib/business-figure-format";
import type { EmptyClaim, Figure } from "@/lib/business-figure-shared";
import type { BusinessReportTab } from "@/lib/business-report-shared";
import type { BusinessReportView, LaborView, SalesView } from "@/lib/business-view-shared";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ExportColumn, ExportRow } from "@/lib/report-export-shared";

/** A cell before the legend is known: a figure, or words that are already final. */
type Cell = Figure | string;
interface Spec { heading: string; columns: string[]; rows: Cell[][]; empty: string }
export interface BusinessPdfTable { heading: string | null; columns: readonly ExportColumn[]; rows: ExportRow[]; emptyText: string; fit: true; plain: true }
export interface BusinessPdf {
  tables: BusinessPdfTable[];
  /** "(a) Some hours come from Toast punches ..." — each qualification of the file, once. */
  legend: string[];
  /** Sentences about the file itself (what it leaves out, what the CSV adds). */
  notes: string[];
  layout: "portrait" | "landscape";
}
/** More columns than this and the page turns landscape. */
export const BUSINESS_PDF_PORTRAIT_COLUMNS = 7;

const EXCLUDED: Record<string, TranslationKey> = {
  gift_card: "reports.business.channels.excluded.gift_card", ezcater_linked: "reports.business.channels.excluded.ezcater_linked",
  void: "reports.business.channels.excluded.void", excess_food: "reports.business.channels.excluded.excess_food",
};

/** The business report's tables for one tab, as a person reads them. `previous` is Compare's earlier period. */
export function businessPdf(tab: BusinessReportTab, view: BusinessReportView, previous: BusinessReportView | null, language: Language): BusinessPdf {
  const t = (key: TranslationKey, values?: Record<string, string | number>) => serverT(language, key, values);
  const day = (date: string) => formatDateLabel(date, language);
  const span = (from: string, to: string) => (from === to ? day(from) : t("reports.export.header.range", { from: day(from), to: day(to) }));
  /** An empty list is a claim: "none" only when it is verified, else "Not known yet." and why. */
  const claim = (c: EmptyClaim | null, none: TranslationKey) => (c === null ? "" : [t(c.kind === "verified" ? none : "reports.business.empty.not_known"), ...c.reasons.map((k) => t(k))].join(" "));
  const specs: Spec[] = [];
  const notes: string[] = [];

  /** Day rows, then payroll weeks, then the range: the same three grains as the Overview. */
  const periods = <T>(pick: (x: { sales: SalesView; labor: LaborView }) => T): Array<[string, T]> => [
    ...view.days.map((d): [string, T] => [day(d.date), pick(d)]),
    ...view.weeks.map((w): [string, T] => [t("reports.business.week_of", { range: span(w.from, w.to) }), pick(w)]),
    [t("reports.business.pdf.total"), pick(view.total)],
  ];
  const DAY = t("reports.business.pdf.col.day");

  if (tab === "overview") {
    specs.push({
      heading: t("reports.business.pdf.sales"), empty: t("reports.export.empty"),
      columns: [DAY, t("reports.business.detail.sales"), t("reports.business.detail.checks"), t("reports.business.detail.toast_net"), t("reports.business.detail.ezcater"),
        t("reports.business.card.refunds"), t("reports.business.card.net")],
      rows: periods((x) => [x.sales.total, x.sales.checks, x.sales.toastNet, x.sales.ezcater, x.sales.refunds, x.labor.net]).map(([label, cells]) => [label, ...cells]),
    }, {
      heading: t("reports.business.pdf.hourly"), empty: t("reports.export.empty"),
      columns: [DAY, t("reports.business.detail.hours"), t("reports.business.detail.ot_hours"), t("reports.business.detail.pure_hourly_cost"), t("reports.business.detail.ot_premium"),
        t("reports.business.pdf.hourly_pct")],
      rows: periods((x) => [x.labor.hours, x.labor.otHours, x.labor.pureCost, x.labor.otPremium, x.labor.purePct]).map(([label, cells]) => [label, ...cells]),
    }, {
      heading: t("reports.business.pdf.loaded"), empty: t("reports.export.empty"),
      columns: [DAY, t("reports.business.detail.salaried"), t("reports.business.detail.burden"), t("reports.business.detail.fully_loaded"), t("reports.business.pdf.loaded_pct")],
      rows: periods((x) => [x.labor.salaried, x.labor.burden, x.labor.loadedCost, x.labor.loadedPct]).map(([label, cells]) => [label, ...cells]),
    });
    notes.push(t("reports.business.labor.denominator"), t("reports.business.loaded.basis"));
  } else if (tab === "hours") {
    if (view.quarters === null) notes.push(t("reports.business.hours.too_wide"));
    else {
      const money = view.access.quarterCost;
      specs.push({
        heading: t("reports.business.pdf.by_hour"), empty: t("reports.export.empty"),
        columns: [DAY, t("reports.business.pdf.col.hour"), t("reports.business.slot.checks"), t("reports.business.slot.sales"), t("reports.business.slot.labor"),
          ...(money ? [t("reports.business.slot.cost")] : [])],
        rows: view.days.flatMap((d): Cell[][] => [
          // A day with no line says so (a verified "nothing happened", or not known and why): never silence.
          ...(d.activity !== null ? [[day(d.date), claim(d.activity, d.unassigned ? "reports.business.hours.no_timed_activity" : "reports.business.hours.no_activity")]] : []),
          ...d.hourly.map((h): Cell[] => [day(d.date), formatTime(h.hourStartAt, language), h.checks, h.sales, h.hours, ...(money && h.cost ? [h.cost] : [])]),
          ...(d.unassigned ? [[day(d.date), t("reports.business.quarter.unassigned"), d.unassigned.checks, d.unassigned.sales] as Cell[]] : []),
        ]),
      });
      notes.push(t("reports.business.pdf.hours_note"), t("reports.business.quarter.basis"));
    }
  } else if (tab === "channels") {
    const columns = [t("reports.business.pdf.col.channel"), t("reports.business.pdf.col.provider"), t("reports.business.detail.checks"), t("reports.business.pdf.sales")];
    const ez = view.channels.ezcater;
    specs.push({
      heading: t("reports.business.channels.title"), columns, empty: claim(view.empty.channels, "reports.business.channels.none_verified"),
      rows: view.channels.included.map((c): Cell[] => [channelLabel(language, c.key), c.provider ? providerLabel(language, c.provider) : "", c.checks, c.sales]),
    }, {
      heading: t("reports.business.channels.ezcater"), columns, empty: t("reports.export.empty"),
      rows: [[t("reports.business.channels.ezcater_label"), "", ez.orders, ez.sales]],
    }, {
      heading: t("reports.business.channels.excluded"), columns, empty: claim(view.empty.excluded, "reports.business.channels.excluded_none"),
      rows: view.channels.excluded.map((c): Cell[] => [t(EXCLUDED[c.key] ?? "reports.business.channels.excluded.other"), "", c.checks, c.sales]),
    });
  } else if (tab === "people") {
    const cost = view.access.personCost;
    specs.push({
      heading: t("reports.business.people.title"), empty: claim(view.empty.people, "reports.business.people.none"),
      columns: [t("reports.business.pdf.col.name"), t("reports.business.pdf.col.pay"), t("reports.business.sum.hours"), t("reports.business.people.ot_label"),
        ...(cost ? [t("reports.business.people.cost")] : [])],
      rows: view.people.map((p): Cell[] => [
        p.label ?? t("reports.business.people.unnamed"), t(p.payClass === "hourly" ? "reports.business.people.pay.hourly" : "reports.business.people.pay.salaried"), p.hours,
        p.overtime ?? t("reports.business.people.withheld", { n: p.weeksWithheld }), ...(cost && p.cost ? [p.cost] : []),
      ]),
    }, {
      heading: t("reports.business.people.servers"), empty: claim(view.empty.servers, "reports.business.people.servers_none"),
      columns: [t("reports.business.pdf.col.server"), t("reports.business.detail.checks"), t("reports.business.pdf.sales")],
      rows: view.servers.map((s): Cell[] => [serverLabel(language, s.key, s.label), s.checks, s.sales]),
    });
    if (!cost) notes.push(t("reports.business.people.cost_note"));
    notes.push(t("reports.business.people.server_note"));
  } else {
    const cur = view.total, prev = previous?.total ?? null;
    const none = t("reports.business.compare.no_previous");
    const rows: Array<[TranslationKey, (x: BusinessReportView["total"]) => Figure]> = [
      ["reports.business.card.sales", (x) => x.sales.total], ["reports.business.card.net", (x) => x.labor.net], ["reports.business.card.hours", (x) => x.labor.hours],
      ["reports.business.card.pure_hourly", (x) => x.labor.purePct], ["reports.business.card.fully_loaded", (x) => x.labor.loadedPct],
    ];
    specs.push({
      heading: t("reports.business.tab.compare"), empty: t("reports.export.empty"),
      columns: [t("reports.business.pdf.col.measure"), `${t("reports.business.compare.this")} (${span(view.range.from, view.range.to)})`,
        previous ? `${t("reports.business.compare.previous")} (${span(previous.range.from, previous.range.to)})` : t("reports.business.compare.previous"), t("reports.business.compare.change")],
      rows: [
        ...rows.map(([key, fig]): Cell[] => [t(key), fig(cur), prev ? fig(prev) : none,
          changeWords(fig(cur), prev ? fig(prev) : null, language) ?? t("reports.business.compare.not_comparable")]),
        [t("reports.business.last_year.label"), t(view.range.lastYearReason === "no_data_yet" ? "reports.business.last_year.no_data_yet" : "reports.business.last_year.not_shown"), "", ""],
      ],
    });
    notes.push(t("reports.business.compare.rule"));
  }

  // ONE legend for the whole file, reasons included: a dash is "— (a)" and (a) says why, once.
  const legend = figureLegend(language, specs.flatMap((s) => s.rows.flat().filter((c): c is Figure => typeof c !== "string")), { reasons: true });
  const tables = specs.map((s): BusinessPdfTable => ({
    heading: s.heading, emptyText: s.empty || t("reports.export.empty"), fit: true, plain: true,
    columns: s.columns.map((label, i): ExportColumn => ({ key: `c${i}`, kind: "text", label, ...(i === 0 ? { identity: true } : {}) })),
    rows: s.rows.map((cells) => Object.fromEntries(s.columns.map((_, i) => { const c = cells[i]; return [`c${i}`, c === undefined ? null : typeof c === "string" ? c : legend.cell(c)]; }))),
  }));
  return {
    tables, notes,
    legend: legend.entries.map((e) => t("reports.business.pdf.note_line", { mark: e.mark, text: e.text })),
    layout: specs.some((s) => s.columns.length > BUSINESS_PDF_PORTRAIT_COLUMNS) ? "landscape" : "portrait",
  };
}
