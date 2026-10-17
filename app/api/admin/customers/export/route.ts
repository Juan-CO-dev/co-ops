import { assertSameOrigin } from "@/lib/portal/csrf";
import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { extractIp, jsonError, parseJsonBody } from "@/lib/api-helpers";
import { CustomerError, customerProfilesEnabled, exportCustomers, type CustomerExportKind } from "@/lib/customers/customers";
import { requireSession } from "@/lib/session";
import { listParamsInput, parseListParams } from "@/lib/customers/list-params-shared";

/**
 * 0234: the two marketing files. Level 9+, Tier B, audited (a refusal is audited too). Both are built
 * ONLY from opted-in subjects, with no override. The Meta file is hashed (SHA-256) and is refused while
 * META_AUDIENCE_EXPORT is off (Pete's OK pending). Nothing is uploaded anywhere: this is a download.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/customers/export");
  if (ctx instanceof Response) return ctx;
  if (!customerProfilesEnabled()) return jsonError(404, "not_enabled");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "kind" && !(b.kind === "marketing_segment" && k === "params"))
    || !["marketing_email", "meta_audience", "marketing_segment"].includes(b.kind as string)) return jsonError(400, "invalid_payload");
  const input = b.kind === "marketing_segment" ? listParamsInput(b.params) : null;
  if (b.kind === "marketing_segment" && !input) return jsonError(400, "invalid_payload");
  const params = input ? parseListParams(input, ctx.level) : undefined;
  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations };
  try {
    const file = await exportCustomers(actor, b.kind as CustomerExportKind, { ipAddress: extractIp(req), userAgent: req.headers.get("user-agent") }, {}, params);
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
    console.error("[/api/admin/customers/export] internal_error");
    return jsonError(500, "internal_error");
  }
}
