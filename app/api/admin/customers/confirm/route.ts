import type { NextRequest } from "next/server";
import { assertStepUp } from "@/lib/admin/step-up";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  CUSTOMER_STATS_MIN, CustomerError, confirmMerge, customerProfilesEnabled, eraseCustomer, importConsentCsv, runRetention,
} from "@/lib/customers/customers";
import { requireSession } from "@/lib/session";

/**
 * 0234 customer profiles — the Tier B lane (irreversible acts): confirm a merge (GM+ bound),
 * delete-on-request (9+), the retention sweep (9+), the Toast marketing CSV import (9+).
 * Role floors and the shop bind are enforced again inside lib/customers before any I/O.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/customers/confirm");
  if (ctx instanceof Response) return ctx;
  if (!customerProfilesEnabled()) return jsonError(404, "not_enabled");
  if (ctx.level < CUSTOMER_STATS_MIN) return jsonError(403, "role_insufficient");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  const only = (...keys: string[]) => Object.keys(b).every((k) => ["operation", ...keys].includes(k));
  const actor = { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations };
  const meta = { ipAddress: extractIp(req), userAgent: req.headers.get("user-agent") };
  try {
    if (b.operation === "merge" && typeof b.suggestionId === "string" && typeof b.keep === "string" && only("suggestionId", "keep")) {
      return jsonOk(await confirmMerge(actor, { suggestionId: b.suggestionId, keep: b.keep }, meta));
    }
    if (b.operation === "erase" && typeof b.customerId === "string" && only("customerId")) {
      return jsonOk(await eraseCustomer(actor, b.customerId, meta));
    }
    if (b.operation === "retention" && only()) {
      return jsonOk(await runRetention(actor, meta));
    }
    if (b.operation === "import" && only("files", "exportDate", "allowLargeOptOut") && Array.isArray(b.files) && typeof b.exportDate === "string"
      && (b.allowLargeOptOut === undefined || typeof b.allowLargeOptOut === "boolean")
      && b.files.every((f) => f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string" && typeof (f as { text?: unknown }).text === "string")) {
      const files = (b.files as { name: string; text: string }[]).map((f) => ({ name: f.name.slice(0, 200), text: f.text }));
      return jsonOk({ summary: await importConsentCsv(actor, { files, exportDate: b.exportDate, allowLargeOptOut: b.allowLargeOptOut === true }, meta) });
    }
    return jsonError(400, "invalid_payload");
  } catch (error) {
    if (error instanceof CustomerError) return jsonError(error.status, error.code);
    console.error("[/api/admin/customers/confirm]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }
}
