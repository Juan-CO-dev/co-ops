/**
 * Report exports — the LOADERS (server-only). Reports hub v2 piece 3.
 *
 * THE LAW OF THIS FILE: "an export never shows more than the screen would." Every family below
 * calls the SAME loader as its page, with the SAME viewer, after the SAME gates (role floor, shop
 * read grant, operational bind where the page uses one). Nothing here reads a table the page does
 * not read, widens a viewer, or skips a redaction the loader applies (cash notes below level 5,
 * own-submissions below level 4, written-report visibility, team names only). The pure halves —
 * columns, row mapping, the CSV writer — live in lib/report-export-shared.ts.
 *
 * One shop per export. `location=all` is refused (400 one_shop_at_a_time): every page's all-shops
 * view is the per-shop panels stacked, and a per-shop file keeps the filename and the header true.
 */
import "server-only";
import { canReadReportLocation, lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift-shared";
import { parseReportRange } from "@/lib/report-range";
import { REPORTS_HUB_CASH_LEVEL, listReports, loadReportDetail, type CashReportDetail, type ReportTypeKey, type SignalFilters, type Viewer } from "@/lib/reports-hub";
import { buildSearchCorpus, searchReport } from "@/lib/reports-search";
import { OPS_TRENDS_LEVEL, loadTrendSeries, resolveTrendRange, trendLocationAllowed, type TrendGranularity } from "@/lib/reports-trends";
import { TEAM_VIEW_LEVEL, loadTeamOperatingHealth } from "@/lib/team-metrics";
import { listWrittenReports } from "@/lib/written-reports";
import { INSIGHTS_READ_MIN, loadCateringInsightsV2 } from "@/lib/catering/insights";
import { RECEIVE_MIN, ReceivingError, loadRecentDeliveries } from "@/lib/receiving";
import { COUNT_READ_MIN, loadOnHand } from "@/lib/counts";
import { MENU_COSTING_READ_MIN, loadMenuCostingBoard } from "@/lib/admin/menu-costing";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { etCalendarDate } from "@/lib/operational-day";
import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { TENANT_NAME } from "@/lib/tenant";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  EXPORT_COLUMNS,
  cashRows,
  cateringRows,
  costingRows,
  countRows,
  operationsRows,
  receivingRows,
  salesNotYetAvailableRows,
  teamRows,
  trendRows,
  writtenRows,
  type ExportColumn,
  type ExportFamily,
  type ExportRow,
  type ShopRef,
} from "@/lib/report-export-shared";

export class ExportError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = "ExportError";
  }
}

export interface ExportTable {
  family: ExportFamily;
  columns: readonly ExportColumn[];
  rows: ExportRow[];
  /** null for the org-wide families (costing). */
  shop: ShopRef | null;
  from: string;
  to: string;
}

type Params = Record<string, string | undefined>;
const ALL_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm", "maintenance"];
/** The landing page shows Sales ("coming next") from level 6. */
export const SALES_EXPORT_MIN = 6;
/** Bounded like every hub list: written reports page 50 at a time; 40 pages = 2,000 rows max. */
const WRITTEN_MAX_PAGES = 40;
const RECEIVING_EXPORT_LIMIT = 1000;

const ORG_WIDE: readonly ExportFamily[] = ["costing"];
const OPTIONAL_SHOP: readonly ExportFamily[] = ["catering"];

function actorOf(auth: AuthContext): LocationActor {
  return { role: auth.role, locations: auth.locations };
}

async function loadShop(locationId: string): Promise<ShopRef> {
  const { data, error } = await getServiceRoleClient().from("locations").select("id, code, name").eq("id", locationId).maybeSingle<ShopRef>();
  if (error) throw new Error(`export location: ${error.message}`);
  if (!data) throw new ExportError(404, "location_not_found");
  return data;
}

/**
 * The shop gate every per-shop family shares, BEFORE any database work: a real id (never "all"),
 * readable by this viewer (a GM: their own shop; level 8+: any). Family gates follow.
 */
export function assertExportShop(auth: AuthContext, family: ExportFamily, location: string | undefined): string | null {
  if (ORG_WIDE.includes(family)) return null;
  if (!location) {
    if (OPTIONAL_SHOP.includes(family)) return null;
    throw new ExportError(400, "location_required");
  }
  if (location === "all") throw new ExportError(400, "one_shop_at_a_time");
  if (!/^[0-9a-f-]{36}$/i.test(location)) throw new ExportError(400, "invalid_location");
  if (!canReadReportLocation(actorOf(auth), location)) throw new ExportError(403, "location_forbidden");
  return location;
}

/** The family's own role floor (mirrors each page's redirect), checked before any database work. */
export function assertFamilyFloor(auth: AuthContext, family: ExportFamily): void {
  const floor: Record<ExportFamily, number> = {
    operations: 2, written: 2, cash: REPORTS_HUB_CASH_LEVEL, trends_ops: OPS_TRENDS_LEVEL, team: TEAM_VIEW_LEVEL,
    catering: INSIGHTS_READ_MIN, receiving: RECEIVE_MIN, counts: COUNT_READ_MIN, costing: MENU_COSTING_READ_MIN,
    sales: SALES_EXPORT_MIN,
  };
  if (auth.level < floor[family]) throw new ExportError(403, "role_insufficient");
}

function granularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

/** The operations page's exact type + signal filter derivation (app/(authed)/reports/operations/page.tsx). */
export function operationsFilters(params: Params, level: number): { types: ReportTypeKey[] | undefined; signals: SignalFilters | undefined } {
  const allowed = ALL_TYPES.filter((t) => t !== "cash" || level >= REPORTS_HUB_CASH_LEVEL);
  const t = params.type;
  const types = t && t !== "all" && (allowed as string[]).includes(t) ? [t as ReportTypeKey] : undefined;
  const signals: SignalFilters = {
    ...(params.sf_underPar === "true" ? { underPar: true } : {}),
    ...(params.sf_overPar === "true" ? { overPar: true } : {}),
    ...(params.sf_skipped === "true" ? { skipped: true } : {}),
    ...(params.sf_tempFlag === "true" ? { tempFlag: true } : {}),
    ...(params.sf_cashOver === "true" && level >= REPORTS_HUB_CASH_LEVEL ? { cashOver: true } : {}),
    ...(params.sf_cashShort === "true" && level >= REPORTS_HUB_CASH_LEVEL ? { cashShort: true } : {}),
  };
  return { types, signals: Object.keys(signals).length > 0 ? signals : undefined };
}

/** Loads one family for one shop through the page's own loader. Throws ExportError on a refusal. */
export async function loadExportTable(auth: AuthContext, family: ExportFamily, params: Params, now: Date = new Date()): Promise<ExportTable> {
  assertFamilyFloor(auth, family);
  const locationId = assertExportShop(auth, family, params.location);
  const today = operationalNow(now).date;
  const sb = getServiceRoleClient();
  const viewer: Viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const shop = locationId ? await loadShop(locationId) : null;
  const shops = new Map(shop ? [[shop.id, shop]] : []);
  const range = parseReportRange(params, today);
  const base = { family, columns: EXPORT_COLUMNS[family], shop, from: range.from, to: range.to };

  try {
    switch (family) {
      case "operations": {
        const { types, signals } = operationsFilters(params, auth.level);
        let items = await listReports(sb, { viewer, locationId: locationId!, dateFrom: range.from, dateTo: range.to, types, signalFilters: signals });
        const query = (params.q ?? "").trim();
        if (query) {
          const corpus = await buildSearchCorpus(sb, { viewer, locationId: locationId!, items });
          items = items.filter((it) => searchReport(it, serverT(auth.user.language, `reports.type.${it.type}` as TranslationKey), corpus.get(`${it.type}:${it.id}`), query).matched);
        }
        return { ...base, rows: operationsRows(items, shops) };
      }
      case "cash": {
        const items = await listReports(sb, { viewer, locationId: locationId!, dateFrom: range.from, dateTo: range.to, types: ["cash"] });
        const details: Array<CashReportDetail & { id: string }> = [];
        for (const item of items) {
          const d = await loadReportDetail(sb, { viewer, type: "cash", id: item.id, locationId: locationId! });
          if (d && d.kind === "cash") details.push({ ...d, id: item.id });
        }
        return { ...base, rows: cashRows(details, shops) };
      }
      case "written": {
        const items = [];
        let cursor: string | undefined;
        for (let page = 0; page < WRITTEN_MAX_PAGES; page++) {
          const res = await listWrittenReports(sb, {
            viewer: { userId: auth.user.id, level: auth.level, locations: [locationId!] },
            from: range.from, to: range.to, locationId: locationId!, cursor, now,
          });
          items.push(...res.reports);
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
        }
        return { ...base, rows: writtenRows(items, shops) };
      }
      case "trends_ops": {
        const g = granularity(params.g);
        const trendRange = resolveTrendRange(params, today, g);
        const series = await loadTrendSeries(sb, { viewer, locationId: locationId!, granularity: g, compare: false, today, range: { ...trendRange, compare: false } });
        return { ...base, from: trendRange.from, to: trendRange.to, rows: trendRows(series, shop!) };
      }
      case "team": {
        const g = granularity(params.g);
        const trendRange = resolveTrendRange(params, today, g);
        if (!trendLocationAllowed(viewer, locationId!)) throw new ExportError(403, "location_forbidden");
        const team = await loadTeamOperatingHealth(sb, { viewer, locationId: locationId!, granularity: g, compare: false, today, range: { ...trendRange, compare: false } });
        if (!team) throw new ExportError(403, "role_insufficient");
        return { ...base, from: trendRange.from, to: trendRange.to, rows: teamRows(team, shop!, trendRange) };
      }
      case "catering": {
        // The insights loader scopes to the viewer's own shops; the export only narrows further.
        if (locationId && !lockLocationContext(actorOf(auth), locationId)) throw new ExportError(403, "location_forbidden");
        const data = await loadCateringInsightsV2(auth, today);
        // The insights page has no range control: its calendar is the loader's own window
        // (±90 days around today, future bookings included). A range in the URL narrows it.
        const ranged = !!(params.range || params.from || params.to);
        const events = data.calendar.filter((e) => (!locationId || e.locationId === locationId) && (!ranged || (e.eventDate >= range.from && e.eventDate <= range.to)))
          .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.id.localeCompare(b.id));
        const span = ranged ? { from: range.from, to: range.to } : { from: events[0]?.eventDate ?? today, to: events[events.length - 1]?.eventDate ?? today };
        const ids = [...new Set(events.map((e) => e.locationId))];
        const named = new Map(shops);
        if (!locationId && ids.length > 0) {
          const { data: rows, error } = await sb.from("locations").select("id, code, name").in("id", ids);
          if (error) throw new Error(`export locations: ${error.message}`);
          for (const r of (rows ?? []) as ShopRef[]) named.set(r.id, r);
        }
        return { ...base, ...span, rows: cateringRows(events, named) };
      }
      case "receiving": {
        if (!lockLocationContext(actorOf(auth), locationId!)) throw new ExportError(403, "location_forbidden");
        if (!(await canDoOperationalTask(auth, locationId!, "receiving"))) throw new ExportError(403, "task_forbidden");
        const list = await loadRecentDeliveries(auth, locationId!, RECEIVING_EXPORT_LIMIT);
        return { ...base, rows: receivingRows(list.filter((d) => d.deliveryDate >= range.from && d.deliveryDate <= range.to), shop!) };
      }
      case "counts": {
        if (!lockLocationContext(actorOf(auth), locationId!)) throw new ExportError(403, "location_forbidden");
        const view = await loadOnHand(auth, locationId!, now.getTime());
        return { ...base, from: today, to: today, rows: countRows(view.rows, shop!) };
      }
      case "costing": {
        const board = await loadMenuCostingBoard(auth);
        return { ...base, from: today, to: today, rows: costingRows(board.rows) };
      }
      case "sales":
        return { ...base, rows: salesNotYetAvailableRows([shop!], null) };
    }
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (error instanceof ReceivingError) throw new ExportError(error.status, error.code);
    if (error instanceof Error && (error.message === "report_scope_forbidden" || error.message === "Forbidden report trends scope")) {
      throw new ExportError(403, "location_forbidden");
    }
    const status = (error as { status?: unknown })?.status;
    const code = (error as { code?: unknown })?.code;
    if (typeof status === "number" && status >= 400 && status < 500 && typeof code === "string") throw new ExportError(status, code);
    throw error;
  }
}

// ── Headers shared by the on-screen export and the package ──────────────────────────────────

export const EXPORT_TITLE_KEY: Record<ExportFamily, TranslationKey> = {
  operations: "reports.export.title.operations",
  cash: "reports.export.title.cash",
  written: "reports.export.title.written",
  trends_ops: "reports.export.title.trends_ops",
  team: "reports.export.title.team",
  catering: "reports.export.title.catering",
  receiving: "reports.export.title.receiving",
  counts: "reports.export.title.counts",
  costing: "reports.export.title.costing",
  sales: "reports.export.title.sales",
};

/** The PDF header lines: tenant · shop · range · generated at (ET) · generated by. */
export function pdfHeaderLines(language: Language, args: { shop: string; from: string; to: string; at: Date; by: string }): string[] {
  const t = (key: TranslationKey, values?: Record<string, string | number>) => serverT(language, key, values);
  return [
    TENANT_NAME,
    t("reports.export.header.shop", { shop: args.shop }),
    t("reports.export.header.range", { from: args.from, to: args.to }),
    t("reports.export.header.generated_at", { date: etCalendarDate(args.at.toISOString()), time: formatTime(args.at.toISOString(), language) }),
    t("reports.export.header.generated_by", { name: args.by }),
  ];
}
