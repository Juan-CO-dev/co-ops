// GET /api/reports/export?family=&format=csv|pdf&location=&range|from|to&type=&sf_*&q=&g=
// Reports hub v2 piece 3: the CSV / PDF of one report family for one shop, for the page's current
// filters. lib/report-export.ts runs the page's own loader behind the page's own gates, so a file
// never shows more than the screen. Audited report.export (registered before this caller).
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { extractIp, jsonError } from "@/lib/api-helpers";
import { serverT } from "@/lib/i18n/server";
import { EXPORT_TITLE_KEY, ExportError, loadExportTable } from "@/lib/report-export";
import { exportFilename, isExportFamily, isExportFormat, toCsv } from "@/lib/report-export-shared";
import { pdfHeaderLines, renderReportPdf } from "@/lib/report-pdf";
import { requireSession } from "@/lib/session";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/reports/export");
  if (ctx instanceof Response) return ctx;
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { family, format } = params;
  if (!isExportFamily(family)) return jsonError(400, "invalid_family");
  if (!isExportFormat(format)) return jsonError(400, "invalid_format");

  let table;
  try {
    table = await loadExportTable(ctx, family, params);
  } catch (error) {
    if (error instanceof ExportError) return jsonError(error.status, error.code);
    console.error("[/api/reports/export]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }

  const language = ctx.user.language;
  const shopLabel = table.shop ? table.shop.name : serverT(language, "reports.export.header.all_shops");
  // Catalog Phase 2a: the costing export names WHOSE prices it used, on its first line (CSV) / header (PDF).
  const pricingLine = table.pricingScope
    ? table.pricingScope.kind === "shop"
      ? serverT(language, "reports.export.pricing_scope_shop", { shop: table.pricingScope.name })
      : serverT(language, "reports.export.pricing_scope_global")
    : null;
  // Item 9b fix round 1: a file that leaves days out says so. Polish (2026-11-18): AFTER the table, so line 1 of the
  // CSV is the header row (Excel / Sheets) — a "Notes" line, then the sentences. The costing pricing scope still
  // LEADS its file (it names whose prices every row is in); the two never meet in one family.
  const noticeLines = (table.notices ?? []).map((n) => serverT(language, n.key, n.values));
  const topLines = pricingLine ? [pricingLine] : [];
  const csvNotes = noticeLines.length ? [serverT(language, "reports.export.notes"), ...noticeLines] : [];
  const pageLabels = { pageLabel: (n: number, total: number) => serverT(language, "reports.export.page", { n, total }), partLabel: (i: number, n: number) => serverT(language, "reports.export.part", { i, n }) };
  const pdfHeader = (extra: string[]) => ({ title: serverT(language, EXPORT_TITLE_KEY[family]),
    lines: [...pdfHeaderLines(language, { shop: shopLabel, from: table.from, to: table.to, at: new Date(), by: ctx.user.name }), ...extra] });
  const filename = exportFilename(table.fileFamily ?? family, table.shop?.code ?? "all", table.from, table.to, format);
  let body: string | Buffer;
  try {
    body = format === "csv"
      ? toCsv(table.columns, table.rows, topLines, csvNotes)
      // The business report's PDF is its own readable layout: translated labels, no code columns, each
      // qualification once in "Notes" with a mark on the figures it qualifies (lib/business-report-pdf.ts).
      : table.pdf ? await renderReportPdf(pdfHeader([]), table.pdf.tables, { ...pageLabels, layout: table.pdf.layout, fontSize: 8,
        trailer: [{ heading: serverT(language, "reports.business.pdf.notes"), lines: [...noticeLines, ...table.pdf.legend, ...table.pdf.notes] }] })
      : await renderReportPdf(pdfHeader([...topLines, ...noticeLines]),
        [{ heading: null, columns: table.columns.map((c) => c.key === "check_amount_pre_tax"
          ? { ...c, label: serverT(language, "reports.export.column.check_amount_pre_tax") } : c),
        rows: table.rows, emptyText: serverT(language, "reports.export.empty") }],
        pageLabels,
      );
  } catch (error) {
    console.error("[/api/reports/export] render", error instanceof Error ? error.message : String(error));
    return jsonError(500, "render_failed");
  }

  await audit({
    actorId: ctx.user.id, actorRole: ctx.role, action: "report.export", resourceTable: "reports", resourceId: null,
    metadata: { family, format, rows: table.rows.length, location_id: table.shop?.id ?? null, from: table.from, to: table.to, filename },
    ipAddress: extractIp(req), userAgent: req.headers.get("user-agent"),
  });

  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status: 200,
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
