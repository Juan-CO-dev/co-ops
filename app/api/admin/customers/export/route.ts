import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { extractIp, jsonError, parseJsonBody } from "@/lib/api-helpers";
import { CustomerError, customerProfilesEnabled, exportCustomers, type CustomerExportKind } from "@/lib/customers/customers";
import { requireSession } from "@/lib/session";

/**
 * 0234: the two marketing files. Level 9+, Tier B, audited (a refusal is audited too). Both are built
 * ONLY from opted-in subjects, with no override. The Meta file is hashed (SHA-256) and is refused while
 * META_AUDIENCE_EXPORT is off (Pete's OK pending). Nothing is uploaded anywhere: this is a download.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/customers/export");
  if (ctx instanceof Response) return ctx;
  if (!customerProfilesEnabled()) return jsonError(404, "not_enabled");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "kind") || (b.kind !== "marketing_email" && b.kind !== "meta_audience")) return jsonError(400, "invalid_payload");
  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations };
  try {
    const file = await exportCustomers(actor, b.kind as CustomerExportKind, { ipAddress: extractIp(req), userAgent: req.headers.get("user-agent") });
    return new Response(file.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file.filename}"`,
        "cache-control": "private, no-store",
        "x-row-count": String(file.count),
      },
    });
  } catch (error) {
    if (error instanceof CustomerError) return jsonError(error.status, error.code);
    console.error("[/api/admin/customers/export]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }
}
