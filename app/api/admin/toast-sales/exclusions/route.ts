// POST add an ingest exclusion (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addExclusion, AdminToastSalesError, TOAST_SALES_WRITE_MIN } from "@/lib/catering/toast-sales";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/toast-sales/exclusions");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_SALES_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  // An exclusion is authored FOR ONE SHOP (Juan's ruling, 2026-08-31 — see addExclusion).
  // A null/absent locationId used to mean "every location"; it is now a 400, and the lib
  // refuses it a second time behind this.
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  const locationId = b.locationId;
  if (typeof b.kind !== "string" || typeof b.value !== "string") return jsonError(400, "invalid_payload", { field: "kind/value" });
  try {
    const { id } = await addExclusion(ctx, { locationId, kind: b.kind, value: b.value, note: typeof b.note === "string" ? b.note : null });
    return jsonOk({ id });
  } catch (e) {
    if (e instanceof AdminToastSalesError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
