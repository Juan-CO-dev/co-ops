import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { loadLastDeliveryTemplate, loadOpenPoTemplate, ReceivingError, RECEIVE_MIN } from "@/lib/receiving";
import { loadOpenCreditRowsForVendor } from "@/lib/credits";

// GET ?locationId=<uuid>&vendorId=<uuid> — prefill template for the door form.
//
// Pre-fill hierarchy (spec §3 "received"):
//   1. Latest `placed` PO for this vendor+location (source "po") — the door
//      ceremony is receiving against a known order; lines are the PO's line qtys.
//   2. Last delivery template (source "last_delivery") — the vendor's most recent
//      drop; lines are what was received then.
//   3. null (source null) — no prior data; the form falls back to offered rows.
//
// Response: { template: ...|null, source: "po"|"last_delivery"|null, poId?, displayCode?, openCredits: [] }
// Old callers that only read `template` continue to work (source/poId/displayCode/
// openCredits are additive; the form must not crash when they are absent — tested: the
// form reads them only when present).
//
// V2-D4: openCredits = the vendor's OPEN credits at this location (KH+ evidence-backed
// closure prefill). Present on EVERY branch (even when there's no template) so the
// "Makes up a short?" section shows regardless of prefill source.
//
// KH+ (≥4), location-bound (checked in each loader).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/receiving/template");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIVE_MIN) return jsonError(403, "forbidden");

  const locationId = req.nextUrl.searchParams.get("locationId");
  const vendorId = req.nextUrl.searchParams.get("vendorId");
  if (typeof locationId !== "string" || !locationId) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof vendorId !== "string" || !vendorId) return jsonError(400, "invalid_payload", { field: "vendorId" });

  try {
    // Open credits ride EVERY branch — computed once alongside the template. Two
    // independent reads, so run them concurrently with the template lookup below.
    const openCreditsP = loadOpenCreditRowsForVendor(ctx, locationId, vendorId);

    // 1. Try the open placed PO first.
    const poTemplate = await loadOpenPoTemplate(ctx, locationId, vendorId);
    if (poTemplate) {
      return jsonOk({
        template: { lines: poTemplate.lines },
        source: "po" as const,
        poId: poTemplate.poId,
        displayCode: poTemplate.displayCode,
        openCredits: await openCreditsP,
      });
    }

    // 2. Fall back to last delivery.
    const lastTemplate = await loadLastDeliveryTemplate(ctx, locationId, vendorId);
    if (lastTemplate) {
      return jsonOk({ template: lastTemplate, source: "last_delivery" as const, openCredits: await openCreditsP });
    }

    // 3. No prior data.
    return jsonOk({ template: null, source: null, openCredits: await openCreditsP });
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
