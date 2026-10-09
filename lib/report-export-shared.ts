/**
 * Report exports — the PURE core (zero I/O, client-safe). Reports hub v2 piece 3.
 *
 * Spec (Juan-approved, 2026-10-07): "CSV: flat, one header row, ISO dates, cents as decimal
 * dollars with explicit currency column, stable column names (documented), UTF-8 with BOM for
 * Excel." Juan: "100% should be both [CSV and PDF] so that it's convenient."
 *
 * Three things live here:
 *   1. the CSV writer (`toCsv`): UTF-8 BOM, RFC 4180 quoting, CRLF line ends, one header row;
 *   2. the cell formatter (`formatCell`), shared with the PDF writer so both files say the same
 *      thing: money is integer CENTS in and "12.34" out, never a float; dates stay YYYY-MM-DD;
 *      timestamps are ISO 8601 UTC; an absent value is an empty cell, never a 0;
 *   3. the column REGISTRY (`EXPORT_COLUMNS`) and one pure row mapper per hub family. The column
 *      names ARE the documented contract (this registry; the accountant package's is
 *      PACKAGE_COLUMNS in lib/report-package-shared.ts) and a snapshot test pins them: renaming
 *      one breaks an accountant's spreadsheet, so it must fail a test first.
 *
 * THE CONTRACT IN ONE PARAGRAPH. UTF-8 with a BOM, one header row, CRLF, RFC 4180 quoting. Dates
 * YYYY-MM-DD; timestamps ISO 8601 UTC. Money = integer cents written as decimal dollars with a
 * `currency` column (USD). An absent value is an EMPTY cell, never 0; a source that does not exist
 * yet says `not_yet_available` in a `status` column. Text cells starting with = + - @ get a
 * leading ' so a spreadsheet never runs them. File name {family}_{shop-code}_{from}_{to}.{ext}.
 *
 * The loaders and scope gates are NOT here: lib/report-export.ts calls the SAME loaders as each
 * page, so an export can never show more than the screen.
 */
import type { CashReportDetail, ReportListItem } from "@/lib/reports-hub";
import type { TrendSeries } from "@/lib/reports-trends";
import type { TeamOperatingHealth } from "@/lib/team-metrics";
import type { CalendarEvent } from "@/lib/catering/insights-shared";
import type { MenuCostRow } from "@/lib/menu-costing-shared";
import type { BreakdownRow, SalesBucket, SalesCheckRow, SalesExportView, SalesEzcaterRow, SalesTotals } from "@/lib/sales-reports-shared";
import { rowAverageCents, salesHasData } from "@/lib/sales-reports-shared";

// ── Cells ───────────────────────────────────────────────────────────────────────────────────

/** text · date (YYYY-MM-DD) · datetime (ISO UTC) · money (integer cents → "12.34") · int · number · bool · currency ("USD"). */
export type ColumnKind = "text" | "date" | "datetime" | "money" | "int" | "number" | "bool" | "currency";
export interface ExportColumn { key: string; kind: ColumnKind }
export type ExportValue = string | number | boolean | null | undefined;
export type ExportRow = Record<string, ExportValue>;

export const EXPORT_CURRENCY = "USD";
export const CSV_BOM = "﻿";
/** The status value a section or family states when its source does not exist yet (never zeros). */
export const NOT_YET_AVAILABLE = "not_yet_available";

const col = (key: string, kind: ColumnKind = "text"): ExportColumn => ({ key, kind });

/** Integer cents → "12.34" / "-0.05". Integer math only: a float never decides a cent. */
export function centsToDollars(cents: number): string {
  const c = Math.round(cents);
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Dollars (numeric columns such as invoice_total, unit_price, menu_price) → integer cents. */
export function dollarsToCents(dollars: number | null | undefined): number | null {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Spreadsheet formula injection (CSV injection): a free-text cell that starts with = + - @ or a
 * control character is evaluated by Excel. Text cells get a leading apostrophe in that case; the
 * typed columns (money, numbers, dates) never do, so a negative amount stays a number.
 */
function defuse(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** One cell as text. Absent → "" (an empty cell, never a fabricated zero). */
export function formatCell(kind: ColumnKind, value: ExportValue): string {
  if (kind === "currency") return value === null || value === undefined || value === "" ? EXPORT_CURRENCY : String(value);
  if (value === null || value === undefined || value === "") return "";
  switch (kind) {
    case "money":
      return typeof value === "number" && Number.isFinite(value) ? centsToDollars(value) : String(value);
    case "int":
      return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : String(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10_000) / 10_000) : String(value);
    case "bool":
      return value === true ? "true" : value === false ? "false" : String(value);
    case "date": {
      const s = String(value);
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    }
    case "datetime": {
      const t = Date.parse(String(value));
      return Number.isNaN(t) ? String(value) : new Date(t).toISOString();
    }
    default:
      return defuse(String(value));
  }
}

/** RFC 4180: quote a field holding a comma, quote, CR or LF (or edge spaces); double the quotes. */
export function csvField(text: string): string {
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The whole file: BOM + one header row + one line per row, CRLF, trailing CRLF. */
export function toCsv(columns: readonly ExportColumn[], rows: readonly ExportRow[]): string {
  const lines = [columns.map((c) => csvField(c.key)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvField(formatCell(c.kind, row[c.key]))).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

// ── Families ────────────────────────────────────────────────────────────────────────────────

export const EXPORT_FAMILIES = [
  "operations", "cash", "written", "trends_ops", "team", "catering", "receiving", "counts", "costing", "sales",
] as const;
export type ExportFamily = (typeof EXPORT_FAMILIES)[number];
export const EXPORT_FORMATS = ["csv", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFamily(v: unknown): v is ExportFamily {
  return typeof v === "string" && (EXPORT_FAMILIES as readonly string[]).includes(v);
}
export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === "string" && (EXPORT_FORMATS as readonly string[]).includes(v);
}

/** Every per-shop row starts with these (spec: "per shop per day"). */
const SHOP = [col("location_code"), col("location_name")];

/**
 * SALES (piece 4, Phase 2b). One column set per Sales view, because each view is its own table
 * (lib/sales-reports-shared.ts SALES_EXPORT_VIEWS). Juan 2026-10-08: discounts BY NAME (one row
 * per name, no comp/discount partition); E-Gift Cards and ezCater-linked Toast rings are named
 * EXCLUSIONS, never sales; ezCater orders are their own source; server = the order's server, by
 * Toast first name. No customer, card or comment field exists in any of them.
 */
const PERIOD = [col("period_start", "date"), col("period_end", "date")];
export const SALES_EXPORT_COLUMNS: Record<SalesExportView, readonly ExportColumn[]> = {
  summary: [
    col("row_type"), ...PERIOD, ...SHOP, col("coverage_status"), col("covered_days", "int"), col("expected_days", "int"),
    col("toast_check_totals", "money"), col("checks", "int"), col("average_check", "money"), col("discounts", "money"),
    col("discount_count", "int"), col("sales_tax", "money"), col("tips", "money"), col("refunds_captured_so_far", "money"),
    col("refunds_captured_count", "int"), col("ezcater_sales", "money"), col("ezcater_orders", "int"), col("sales_before_refunds", "money"),
    col("amount_missing", "int"), col("unknown_tax", "int"), col("unknown_tips", "int"), col("unknown_discounts", "int"), col("gift_cards_excluded", "money"), col("gift_card_checks_excluded", "int"),
    col("ezcater_linked_toast_excluded", "money"), col("ezcater_linked_checks_excluded", "int"), col("void_checks", "int"),
    col("currency", "currency"), col("sales_basis"), col("refunds_basis"),
    col("toast_gross", "money"), col("toast_discounts_comps", "money"), col("toast_item_voids", "money"),
    col("toast_service_charges", "money"), col("toast_sales_refunds", "money"), col("toast_item_sales_net", "money"),
    col("accounting_missing", "int"), col("sales_refund_missing", "int"), col("toast_net_basis"),
  ],
  items: [...PERIOD, ...SHOP, col("item_guid"), col("item"), col("units", "number"), col("checks", "int")],
  modifiers: [...PERIOD, ...SHOP, col("item_guid"), col("modifier"), col("units", "number"), col("checks", "int")],
  channels: [
    ...PERIOD, ...SHOP, col("channel"), col("provider"), col("source"), col("counted", "bool"), col("class"),
    col("checks_or_orders", "int"), col("sales", "money"), col("amount_missing", "int"), col("currency", "currency"),
  ],
  heatmap: [...PERIOD, ...SHOP, col("weekday", "int"), col("hour_et", "int"), col("checks", "int"), col("sales", "money"), col("currency", "currency")],
  discounts: [
    ...PERIOD, ...SHOP, col("discount_name"), col("applications", "int"), col("checks", "int"), col("amount", "money"),
    col("amount_missing", "int"), col("currency", "currency"),
  ],
  servers: [
    ...PERIOD, ...SHOP, col("server_first_name"), col("server_ref"), col("checks", "int"), col("sales", "money"),
    col("amount_missing", "int"), col("average_check", "money"), col("currency", "currency"),
  ],
  checks: [
    col("business_date", "date"), ...SHOP, col("check_guid"), col("opened_at", "datetime"), col("channel"), col("provider"),
    col("dining_option"), col("server_first_name"), col("units", "number"), col("discounts", "money"),
    col("check_total", "money"), col("sales_tax", "money"), col("currency", "currency"),
  ],
  catering: [
    col("event_date", "date"), ...SHOP, col("ezcater_order_number"), col("headcount", "int"), col("subtotal", "money"),
    col("toast_status"), col("currency", "currency"),
  ],
};

/**
 * THE CONTRACT. Stable snake_case names; money in dollars with an explicit currency column.
 * Pinned by tests/report-export-shared.test.ts; listed in the PR body for the accountant.
 */
export const EXPORT_COLUMNS: Record<ExportFamily, readonly ExportColumn[]> = {
  operations: [
    col("business_date", "date"), ...SHOP, col("report_type"), col("report_id"), col("status"), col("submitted_by"),
    col("under_par", "int"), col("over_par", "int"), col("skipped", "int"), col("temp_flags", "int"),
    col("cash_over_short", "money"), col("currency", "currency"),
  ],
  cash: [
    col("business_date", "date"), ...SHOP, col("report_id"), col("projected", "money"), col("drawer_total", "money"),
    col("float", "money"), col("deposit", "money"), col("over_short", "money"), col("cash_tips", "money"),
    col("count_method"), col("on_shift"), col("signed_by"), col("signed_at", "datetime"), col("over_short_note"),
    col("payment_type"), col("currency", "currency"),
  ],
  written: [
    col("submitted_at", "datetime"), ...SHOP, col("report_id"), col("category"), col("title"), col("body"),
    col("submitted_by"), col("submitted_by_role"), col("edit_count", "int"), col("last_edited_at", "datetime"),
  ],
  trends_ops: [
    col("bucket_start", "date"), ...SHOP, col("granularity"), col("has_data", "bool"), col("under_par", "int"),
    col("over_par", "int"), col("temp_flags", "int"), col("completion_pct", "number"), col("cash_over_short", "money"),
    col("currency", "currency"),
  ],
  team: [
    col("period_from", "date"), col("period_to", "date"), ...SHOP, col("name"), col("role"), col("score", "int"),
    col("previous_score", "int"), col("health"), col("tasks", "int"), col("finalizations", "int"),
    col("people_mgmt", "int"), col("oversight", "int"), col("notes", "int"),
  ],
  catering: [
    col("event_date", "date"), ...SHOP, col("lead_id"), col("event_name"), col("time_window"), col("headcount", "int"),
    col("lead_source"), col("stage"), col("money_status"), col("value", "money"), col("currency", "currency"),
  ],
  receiving: [
    col("delivery_date", "date"), ...SHOP, col("delivery_id"), col("vendor_or_store"), col("invoice_number"),
    col("line_count", "int"), col("received_by"), col("match_state"), col("delivery_status"),
    col("has_receipt_photo", "bool"), col("po_code"),
  ],
  counts: [
    ...SHOP, col("sku_id"), col("sku"), col("dimension"), col("anchor_at", "datetime"), col("anchor_age_days", "int"),
    col("anchor_qty", "number"), col("on_hand_qty", "number"), col("unit"), col("anchor_stale", "bool"),
  ],
  costing: [
    col("menu_item_id"), col("menu_item"), col("section"), col("menu_price", "money"), col("food_cost", "money"),
    col("food_cost_pct", "number"), col("margin", "money"), col("cost_status"), col("currency", "currency"),
  ],
  /** The default Sales file is the summary; `view=` picks another SALES_EXPORT_COLUMNS table. */
  sales: SALES_EXPORT_COLUMNS.summary,
};

export interface ShopRef { id: string; code: string | null; name: string }
const shopCells = (shop: ShopRef | undefined): ExportRow => ({ location_code: shop?.code ?? "", location_name: shop?.name ?? "" });

// ── Row mappers (pure: loader output in, rows out) ───────────────────────────────────────────

export function operationsRows(items: readonly ReportListItem[], shops: ReadonlyMap<string, ShopRef>): ExportRow[] {
  return items.map((i) => ({
    business_date: i.date, ...shopCells(shops.get(i.locationId)), report_type: i.type, report_id: i.id, status: i.status,
    submitted_by: i.submitterName, under_par: i.signalSummary?.underPar, over_par: i.signalSummary?.overPar,
    skipped: i.signalSummary?.skipped, temp_flags: i.signalSummary?.tempFlags,
    cash_over_short: i.signalSummary?.cashOverShortCents ?? null,
  }));
}

export function cashRows(details: ReadonlyArray<CashReportDetail & { id: string }>, shops: ReadonlyMap<string, ShopRef>): ExportRow[] {
  return details.map((d) => ({
    business_date: d.date, ...shopCells(shops.get(d.locationId)), report_id: d.id, projected: d.projectedCents,
    drawer_total: d.drawerTotalCents, float: d.floatCents, deposit: d.depositCents, over_short: d.overShortCents,
    cash_tips: d.cashTipsCents, count_method: d.countMethod, on_shift: d.onShift.map((p) => p.name).join("; "),
    signed_by: d.signedByName, signed_at: d.signedAt, over_short_note: d.overShortNote, payment_type: "cash",
  }));
}

export interface WrittenExportItem {
  id: string; locationId: string | null; submittedAt: string; category: string | null; title: string | null; body: string;
  submittedByName: string | null; submittedByRole: string; editCount: number; lastEditedAt: string | null;
}
export function writtenRows(items: readonly WrittenExportItem[], shops: ReadonlyMap<string, ShopRef>): ExportRow[] {
  return items.map((w) => ({
    submitted_at: w.submittedAt, ...shopCells(w.locationId ? shops.get(w.locationId) : undefined), report_id: w.id,
    category: w.category, title: w.title, body: w.body, submitted_by: w.submittedByName, submitted_by_role: w.submittedByRole,
    edit_count: w.editCount, last_edited_at: w.lastEditedAt,
  }));
}

/** Gaps stay gaps: a bucket with no report exports has_data=false and EMPTY metrics, never zeros. */
export function trendRows(series: TrendSeries, shop: ShopRef): ExportRow[] {
  return series.current.map((b) => ({
    bucket_start: b.key, ...shopCells(shop), granularity: series.granularity, has_data: b.hasData,
    under_par: b.hasData ? b.underPar : null, over_par: b.hasData ? b.overPar : null, temp_flags: b.hasData ? b.tempFlags : null,
    completion_pct: b.completionPct, cash_over_short: series.cashVisible ? b.cashOverShortCents : null,
  }));
}

/** Names only (plan: "team, level 6+, names only"): no email, phone or ids. */
export function teamRows(team: TeamOperatingHealth | null, shop: ShopRef, period: { from: string; to: string }): ExportRow[] {
  return (team?.members ?? []).map((m) => ({
    period_from: period.from, period_to: period.to, ...shopCells(shop), name: m.name, role: m.role, score: m.score,
    previous_score: m.previousScore, health: m.health, tasks: m.counts.tasks, finalizations: m.counts.finalizations,
    people_mgmt: m.counts.peopleMgmt, oversight: m.counts.oversight, notes: m.counts.notes,
  }));
}

/** 0195 money split: completed = earned; confirmed/out = to earn. */
export function moneyStatus(stage: string): "earned" | "to_earn" | "none" {
  return stage === "completed" ? "earned" : stage === "confirmed" || stage === "out" ? "to_earn" : "none";
}

export function cateringRows(events: readonly CalendarEvent[], shops: ReadonlyMap<string, ShopRef>): ExportRow[] {
  return events.map((e) => ({
    event_date: e.eventDate, ...shopCells(shops.get(e.locationId)), lead_id: e.id, event_name: e.name,
    time_window: e.timeWindow, headcount: e.headcount, lead_source: e.source, stage: e.stage,
    money_status: moneyStatus(e.stage), value: e.valueCents,
  }));
}

export interface DeliveryExportItem {
  id: string; vendorName: string; deliveryDate: string; invoiceNumber: string | null; lineCount: number;
  receivedByName: string | null; matchState: string; deliveryStatus: string; receiptUrl: string | null; purchaseOrderCode?: string | null;
}
/** The receipt photo is a private storage path: the export says whether one exists, never the path. */
export function receivingRows(items: readonly DeliveryExportItem[], shop: ShopRef): ExportRow[] {
  return items.map((d) => ({
    delivery_date: d.deliveryDate, ...shopCells(shop), delivery_id: d.id, vendor_or_store: d.vendorName,
    invoice_number: d.invoiceNumber, line_count: d.lineCount, received_by: d.receivedByName, match_state: d.matchState,
    delivery_status: d.deliveryStatus, has_receipt_photo: !!d.receiptUrl, po_code: d.purchaseOrderCode ?? null,
  }));
}

export type CountExportItem =
  | { dimension: "weight"; skuId: string; skuName: string; anchorAt: string | null; anchorAgeDays: number | null; anchorOz: number | null; onHandOz: number | null; anchorStale: boolean }
  | { dimension: "count"; skuId: string; skuName: string; unitLabel: string; anchorAt: string | null; anchorAgeDays: number | null; anchorUnits: number | null; onHandUnits: number | null; anchorStale: boolean };
export function countRows(rows: readonly CountExportItem[], shop: ShopRef): ExportRow[] {
  return rows.map((r) => ({
    ...shopCells(shop), sku_id: r.skuId, sku: r.skuName, dimension: r.dimension, anchor_at: r.anchorAt,
    anchor_age_days: r.anchorAgeDays,
    anchor_qty: r.dimension === "weight" ? r.anchorOz : r.anchorUnits,
    on_hand_qty: r.dimension === "weight" ? r.onHandOz : r.onHandUnits,
    unit: r.dimension === "weight" ? "oz" : r.unitLabel,
    anchor_stale: r.anchorStale,
  }));
}

/** A cost is exported only when the rollup is COMPLETE (costed); a partial cost is never "the cost". */
export function costingRows(rows: readonly MenuCostRow[]): ExportRow[] {
  return rows.map((r) => ({
    menu_item_id: r.id, menu_item: r.name, section: r.section, menu_price: dollarsToCents(r.menuPrice),
    food_cost: dollarsToCents(r.rollup.cost), food_cost_pct: r.foodCostPct, margin: dollarsToCents(r.marginDollars),
    cost_status: r.rollup.status,
  }));
}

/**
 * A shop/period whose Sales source is not there yet (0232 not applied, or no capture in the
 * window): ONE row with every metric empty, never a zero (CC answers Q7: "no fake numbers").
 */
export function salesNotYetAvailableRows(shops: readonly ShopRef[], period: { from: string; to: string } | null): ExportRow[] {
  return shops.map((s) => ({ row_type: "total", period_start: period?.from, period_end: period?.to, ...shopCells(s), coverage_status: NOT_YET_AVAILABLE }));
}

// ── Sales rows (pure projections of the SAME DTOs the Sales pages render) ──────────────────────

type Period = { from: string; to: string };
const periodCells = (p: Period): ExportRow => ({ period_start: p.from, period_end: p.to });

/** Astra r2 (CC): an export must carry the same caveats the Sales screen shows. */
export const SALES_BASIS_NOTE = "Toast check totals before refunds plus ezCater subtotals as reported; NOT reconciled net sales. These legacy columns retain non-sales check amounts; exact captured Toast item-sales net is separate.";
export const REFUNDS_BASIS_NOTE = "Refunds captured so far are payment refunds by refund date; never subtracted from the legacy totals. Reconciled item-sales refunds alone reduce Toast item-sales net. Late refunds may not yet be captured.";
export const TOAST_NET_BASIS_NOTE = "Captured Toast item-sales net = gross minus discounts/comps minus item voids minus reconciled sales refunds by refund date. All non-gratuity service charges are removed; gratuities, tax, deferred and house-account sales are outside sales. Comps are not inferred from discount names. Missing accounting or unreconciled refunds leave exact amounts empty. ezCater remains a reported subtotal; capture coverage still applies.";

function salesTotalsCells(t: SalesTotals): ExportRow {
  // A missing coverage day leaves the money as what was captured, labelled by coverage_status +
  // covered_days; a window with NO capture at all exports empty metrics, never zeros.
  const none = !salesHasData(t);
  const v = (x: number | null) => (none ? null : x);
  return {
    coverage_status: t.coverage, covered_days: t.coveredDays, expected_days: t.expectedDays,
    toast_check_totals: v(t.toastChecksCents), checks: v(t.checks), average_check: v(t.avgCheckCents), discounts: v(t.discountCents),
    discount_count: v(t.discountCount), sales_tax: v(t.taxCents), tips: v(t.tipCents), refunds_captured_so_far: v(t.refundCents),
    refunds_captured_count: v(t.refundCount), ezcater_sales: v(t.ezcaterCents), ezcater_orders: v(t.ezcaterOrders), sales_before_refunds: v(t.totalCents),
    amount_missing: t.amountMissing, unknown_tax: t.taxMissing, unknown_tips: t.tipMissing, unknown_discounts: t.discountMissing, gift_cards_excluded: v(t.giftCardCents), gift_card_checks_excluded: v(t.giftCardChecks),
    ezcater_linked_toast_excluded: v(t.ezcaterLinkedCents), ezcater_linked_checks_excluded: v(t.ezcaterLinkedChecks), void_checks: v(t.voidChecks),
    sales_basis: SALES_BASIS_NOTE, refunds_basis: REFUNDS_BASIS_NOTE,
    toast_gross: v(t.grossCents), toast_discounts_comps: v(t.discountsCompsCents), toast_item_voids: v(t.voidsCents),
    toast_service_charges: v(t.serviceChargesCents), toast_sales_refunds: v(t.salesRefundsCents), toast_item_sales_net: v(t.toastNetCents),
    accounting_missing: t.accountingMissing, sales_refund_missing: t.salesRefundMissing, toast_net_basis: TOAST_NET_BASIS_NOTE,
  };
}

/** One row per bucket (day/week/month) and a closing `total` row: the screen's cards, exactly. */
export function salesSummaryRows(buckets: readonly SalesBucket[], totals: SalesTotals, period: Period, shop: ShopRef): ExportRow[] {
  return [
    ...buckets.map((b) => ({ row_type: "bucket", ...periodCells(b), ...shopCells(shop), ...salesTotalsCells(b) })),
    { row_type: "total", ...periodCells(period), ...shopCells(shop), ...salesTotalsCells(totals) },
  ];
}

export function salesBreakdownRows(view: Exclude<SalesExportView, "summary" | "checks" | "catering">, rows: readonly BreakdownRow[], period: Period, shop: ShopRef): ExportRow[] {
  const base = { ...periodCells(period), ...shopCells(shop) };
  return rows.map((r) => {
    switch (view) {
      case "items": return { ...base, item_guid: r.key, item: r.label, units: r.units, checks: r.checks };
      case "modifiers": return { ...base, item_guid: r.key, modifier: r.label, units: r.units, checks: r.checks };
      case "channels": return {
        ...base, channel: r.channel, provider: r.provider, source: r.saleClass === "ezcater_source" ? "ezcater" : "toast",
        counted: r.saleClass === "sale" || r.saleClass === "ezcater_source", class: r.saleClass,
        checks_or_orders: r.checks, sales: r.cents, amount_missing: r.amountMissing,
      };
      case "heatmap": return { ...base, weekday: r.dow, hour_et: r.hour !== undefined && r.hour >= 0 ? r.hour : null, checks: r.checks, sales: r.cents };
      case "discounts": return { ...base, discount_name: r.label ?? "", applications: r.count, checks: r.checks, amount: r.cents, amount_missing: r.amountMissing };
      case "servers": return {
        ...base, server_first_name: r.label, server_ref: r.key ? r.key.slice(-4) : null, checks: r.checks, sales: r.cents,
        amount_missing: r.amountMissing, average_check: rowAverageCents(r),
      };
    }
  });
}

export function salesCheckRows(rows: readonly SalesCheckRow[], shop: ShopRef): ExportRow[] {
  return rows.map((r) => ({
    business_date: r.businessDate, ...shopCells(shop), check_guid: r.checkGuid, opened_at: r.openedAt, channel: r.channel,
    provider: r.provider, dining_option: r.diningOption, server_first_name: r.serverName, units: r.units,
    discounts: r.discountCents, check_total: r.amountCents, sales_tax: r.taxCents,
  }));
}

export function salesCateringRows(rows: readonly SalesEzcaterRow[], shop: ShopRef): ExportRow[] {
  return rows.map((r) => ({
    event_date: r.eventDate, ...shopCells(shop), ezcater_order_number: r.orderNumber, headcount: r.headcount,
    subtotal: r.subtotalCents, toast_status: r.status,
  }));
}

/** `{family}_{shop-code}_{from}_{to}.{ext}`, filesystem-safe. */
export function exportFilename(family: string, shopCode: string, from: string, to: string, format: ExportFormat): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "all";
  return `${safe(family)}_${safe(shopCode)}_${safe(from)}_${safe(to)}.${format}`;
}
