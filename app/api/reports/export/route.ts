// GET /api/reports/export?family=&format=csv|pdf&location=&range|from|to&type=&sf_*&q=&g=
// Reports hub v2 piece 3: the CSV / PDF of one report family for one shop, for the page's current
// filters. lib/report-export.ts runs the page's own loader behind the page's own gates, so a file
// never shows more than the screen. Audited report.export (registered before this caller).
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { extractIp, jsonError } from "@/lib/api-helpers";
import { serverT } from "@/lib/i18n/server";
import { EXPORT_TITLE_KEY, ExportError, loadExportTable, pdfHeaderLines } from "@/lib/report-export";
import { exportFilename, isExportFamily, isExportFormat, toCsv } from "@/lib/report-export-shared";
import { renderReportPdf } from "@/lib/report-pdf";
import { requireSession } from "@/lib/session";

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
  const filename = exportFilename(family, table.shop?.code ?? "all", table.from, table.to, format);
  let body: string | Buffer;
  try {
    body = format === "csv"
      ? toCsv(table.columns, table.rows)
      : await renderReportPdf(
        { title: serverT(language, EXPORT_TITLE_KEY[family]), lines: pdfHeaderLines(language, { shop: shopLabel, from: table.from, to: table.to, at: new Date(), by: ctx.user.name }) },
        [{ heading: null, columns: table.columns, rows: table.rows, emptyText: serverT(language, "reports.export.empty") }],
        { pageLabel: (n, total) => serverT(language, "reports.export.page", { n, total }) },
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
