import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadOpenCreditsSummary,
  loadCreditsForDelivery,
  resolveCredit,
  CreditError,
  CREDIT_READ_MIN,
  CREDIT_RESOLVE_MIN,
  type CreditOutcome,
} from "@/lib/credits";

const VALID_OUTCOMES = new Set<string>(["resolved_credit", "resolved_refund", "written_off"]);

// GET ?locationId=<uuid> → loadOpenCreditsSummary — per-vendor open-credit rollup. KH+ (≥4).
// GET ?deliveryId=<uuid> → loadCreditsForDelivery — credits for one delivery. KH+ (≥4).
// Exactly one of locationId or deliveryId must be provided; both present is rejected.
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/receiving/credits");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CREDIT_READ_MIN) return jsonError(403, "forbidden");

  const locationId = req.nextUrl.searchParams.get("locationId");
  const deliveryId = req.nextUrl.searchParams.get("deliveryId");

  if (locationId && deliveryId) return jsonError(400, "invalid_payload", { message: "Provide locationId or deliveryId, not both" });
  if (!locationId && !deliveryId) return jsonError(400, "invalid_payload", { message: "locationId or deliveryId is required" });

  try {
    if (locationId) {
      const summary = await loadOpenCreditsSummary(ctx, locationId);
      return jsonOk({ summary });
    }
    // deliveryId branch (guaranteed non-null here)
    const credits = await loadCreditsForDelivery(ctx, deliveryId!);
    return jsonOk({ credits });
  } catch (e) {
    if (e instanceof CreditError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// PATCH { creditId, outcome, notes? } → resolveCredit. AGM+ (≥6), location-bound in lib.
export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/credits");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CREDIT_RESOLVE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  if (typeof b.creditId !== "string" || !b.creditId) return jsonError(400, "invalid_payload", { field: "creditId" });
  if (typeof b.outcome !== "string" || !VALID_OUTCOMES.has(b.outcome)) {
    return jsonError(400, "invalid_outcome", { message: "outcome must be resolved_credit, resolved_refund, or written_off", field: "outcome" });
  }
  const notes = b.notes === null || b.notes === undefined ? null : typeof b.notes === "string" ? b.notes : undefined;
  if (notes === undefined) return jsonError(400, "invalid_payload", { field: "notes" });

  try {
    await resolveCredit(ctx, b.creditId, b.outcome as CreditOutcome, notes);
    return jsonOk({ creditId: b.creditId, outcome: b.outcome });
  } catch (e) {
    if (e instanceof CreditError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
