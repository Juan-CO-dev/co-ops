import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadQuote,
  reviseQuote,
  setQuoteStatus,
  parseQuoteLinesFromBody,
  CateringQuoteError,
  QUOTE_READ_MIN,
  QUOTE_WRITE_MIN,
  type ReviseQuoteInput,
  type QuoteStatus,
} from "@/lib/catering/quotes";

// GET — one quote (any revision) + its line items (view >= 5).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < QUOTE_READ_MIN) return jsonError(403, "forbidden");
  try {
    const detail = await loadQuote(ctx, id);
    if (!detail) return jsonError(404, "not_found");
    return jsonOk({ quote: detail.quote, items: detail.items });
  } catch (e) {
    if (e instanceof CateringQuoteError) return jsonError(e.status, e.code);
    throw e;
  }
}

const SETTABLE_STATUSES = ["accepted", "declined", "expired"] as const;
function isSettableStatus(v: unknown): v is (typeof SETTABLE_STATUSES)[number] {
  return typeof v === "string" && (SETTABLE_STATUSES as readonly string[]).includes(v);
}

// PATCH — one concern per call (write >= 6): { status } transition | { lines, ... } revise.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < QUOTE_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasStatus = "status" in b;
  const hasRevise = "lines" in b;
  const concerns = [hasStatus, hasRevise].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields" });
  if (concerns > 1) return jsonError(400, "mixed_concerns", { message: "Set status or revise lines, not both" });

  const optStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const optInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

  try {
    if (hasStatus) {
      if (!isSettableStatus(b.status)) {
        return jsonError(400, "invalid_payload", { field: "status", message: "Must be accepted, declined, or expired" });
      }
      await setQuoteStatus(ctx, id, b.status as Extract<QuoteStatus, "accepted" | "declined" | "expired">);
      return jsonOk({ ok: true });
    }

    const input: ReviseQuoteInput = {
      eventDate: optStr(b.eventDate),
      headcount: optInt(b.headcount),
      isDelivery: b.isDelivery === true,
      deliveryZoneId: optStr(b.deliveryZoneId),
      lines: parseQuoteLinesFromBody(b.lines),
      notes: optStr(b.notes),
      expiresAt: optStr(b.expiresAt),
    };
    const { id: newId, version } = await reviseQuote(ctx, id, input);
    return jsonOk({ id: newId, version });
  } catch (e) {
    if (e instanceof CateringQuoteError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
