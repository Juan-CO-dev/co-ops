import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  createQuote,
  parseQuoteLinesFromBody,
  CateringQuoteError,
  QUOTE_WRITE_MIN,
  type CreateQuoteInput,
} from "@/lib/catering/quotes";
import { resolveOrCreateContact, CateringCompanyError } from "@/lib/catering/companies";

// POST — create a draft catering quote (catering_mgr+ >= 6).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/catering/quotes");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < QUOTE_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const locationId = typeof b.locationId === "string" ? b.locationId : null;
  if (!locationId) return jsonError(400, "invalid_payload", { field: "locationId" });

  const optStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const optInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

  try {
    // Email-as-identifier: when the builder supplies a client email (and no existing
    // customer), resolve-or-create the contact (auto-attributing to a company by domain).
    let customerId = optStr(b.customerId);
    const contactEmail = optStr(b.contactEmail);
    if (!customerId && contactEmail) {
      const contact = await resolveOrCreateContact(ctx, {
        email: contactEmail,
        name: optStr(b.contactName),
        company: optStr(b.contactCompany),
        primaryLocationId: locationId,
      });
      customerId = contact.id;
    }

    const input: CreateQuoteInput = {
      locationId,
      pipelineId: optStr(b.pipelineId),
      customerId,
      eventDate: optStr(b.eventDate),
      headcount: optInt(b.headcount),
      isDelivery: b.isDelivery === true,
      deliveryZoneId: optStr(b.deliveryZoneId),
      lines: parseQuoteLinesFromBody(b.lines),
      notes: optStr(b.notes),
      expiresAt: optStr(b.expiresAt),
    };
    const { id, version } = await createQuote(ctx, input);
    return jsonOk({ id, version }, 201);
  } catch (e) {
    if (e instanceof CateringQuoteError) return jsonError(e.status, e.code, { message: e.message });
    if (e instanceof CateringCompanyError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
