import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createLead, CateringPipelineError, PIPELINE_WRITE_MIN, type CreateLeadInput } from "@/lib/catering/pipeline";

// POST — create a catering lead at stage 'inquiry' (catering_mgr+ >= 6).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/catering/pipeline");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PIPELINE_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const contactName = b.contactName;
  if (typeof contactName !== "string" || contactName.trim().length === 0) {
    return jsonError(400, "invalid_payload", { field: "contactName" });
  }

  // Optional fields: null/absent → null; wrong type → reject.
  const optStr = (v: unknown): string | null | undefined =>
    v === null || v === undefined ? null : typeof v === "string" ? v : undefined;
  const optNum = (v: unknown): number | null | undefined =>
    v === null || v === undefined ? null : typeof v === "number" ? v : undefined;

  const company = optStr(b.company);
  const eventDate = optStr(b.eventDate);
  const headcount = optNum(b.headcount);
  const leadSource = optStr(b.leadSource);
  const locationId = optStr(b.locationId);
  const notes = optStr(b.notes);
  const followUpDate = optStr(b.followUpDate);
  const customerId = optStr(b.customerId);
  const estimatedRevenueCents = optNum(b.estimatedRevenueCents);

  for (const [field, v] of Object.entries({
    company, eventDate, headcount, leadSource, locationId, notes, followUpDate, customerId, estimatedRevenueCents,
  })) {
    if (v === undefined) return jsonError(400, "invalid_payload", { field });
  }

  const input: CreateLeadInput = {
    contactName,
    company: company ?? null,
    eventDate: eventDate ?? null,
    headcount: headcount ?? null,
    leadSource: leadSource ?? null,
    locationId: locationId ?? null,
    notes: notes ?? null,
    followUpDate: followUpDate ?? null,
    customerId: customerId ?? null,
    estimatedRevenueCents: estimatedRevenueCents ?? null,
  };

  try {
    const { id } = await createLead(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof CateringPipelineError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
