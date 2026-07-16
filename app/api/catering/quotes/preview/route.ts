import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { previewQuote, parseQuoteLinesFromBody, CateringQuoteError, QUOTE_WRITE_MIN } from "@/lib/catering/quotes";

/**
 * POST — compute-only preview of the charge stack for a candidate line set. Persists
 * nothing; the quote builder calls it live so the breakdown is always the server's
 * authoritative math. Static segment "preview" takes precedence over [id] in App Router.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/catering/quotes/preview");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < QUOTE_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const locationId = typeof b.locationId === "string" ? b.locationId : null;
  if (!locationId) return jsonError(400, "invalid_payload", { field: "locationId" });

  try {
    const preview = await previewQuote(ctx, {
      locationId,
      lines: parseQuoteLinesFromBody(b.lines),
      isDelivery: b.isDelivery === true,
      deliveryZoneId: typeof b.deliveryZoneId === "string" ? b.deliveryZoneId : null,
    });
    return jsonOk({ stack: preview.stack, hasPricingRule: preview.hasPricingRule, lineTotals: preview.lineTotals });
  } catch (e) {
    if (e instanceof CateringQuoteError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
