import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addDeliveryLines, completeDelivery, ReceivingError, RECEIVE_MIN, type DeliveryLineInput } from "@/lib/receiving";
import { parseDeliveryLineInputs } from "@/lib/receiving-shared";

// POST { deliveryId, lines } → addDeliveryLines (append lines to an in-progress delivery).
// POST { deliveryId, complete: true } → completeDelivery (flip to complete).
// POST { deliveryId, lines, complete: true } → append then complete.
// KH+ (≥4), location-bound (checked in lib).
export async function POST(req: NextRequest) {
  // Same-origin FIRST (LRA-237): same belt as the scan/* and order-guide routes.
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/continue");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIVE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  if (typeof b.deliveryId !== "string" || !b.deliveryId) {
    return jsonError(400, "invalid_payload", { field: "deliveryId" });
  }

  const hasLines = Array.isArray(b.lines);
  const wantComplete = b.complete === true;

  if (!hasLines && !wantComplete) {
    return jsonError(400, "invalid_payload", { message: "Provide lines to append, complete: true to close, or both" });
  }

  // Narrow lines defensively when present (client is untrusted). W20/B197: the ONE shape check,
  // shared with the create route (lib/receiving-shared.ts parseDeliveryLineInputs).
  let lines: DeliveryLineInput[] | undefined;
  if (hasLines) {
    const narrowed = parseDeliveryLineInputs(b.lines);
    if (!narrowed.ok) return jsonError(400, "invalid_payload", { field: narrowed.field });
    lines = narrowed.lines;
  }

  // After narrowing: if lines was provided but empty and complete is false, nothing would happen.
  if (lines !== undefined && lines.length === 0 && !wantComplete) {
    return jsonError(400, "no_lines", { message: "lines array must not be empty unless complete: true is also set" });
  }

  try {
    let added: number | undefined;
    if (lines !== undefined && lines.length > 0) {
      const res = await addDeliveryLines(ctx, b.deliveryId, lines);
      added = res.added;
    }
    if (wantComplete) {
      await completeDelivery(ctx, b.deliveryId);
    }
    return jsonOk({ deliveryId: b.deliveryId, ...(added !== undefined ? { added } : {}), ...(wantComplete ? { complete: true } : {}) });
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
