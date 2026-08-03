import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addDeliveryLines, completeDelivery, ReceivingError, RECEIVE_MIN, type DeliveryLineInput } from "@/lib/receiving";

// POST { deliveryId, lines } → addDeliveryLines (append lines to an in-progress delivery).
// POST { deliveryId, complete: true } → completeDelivery (flip to complete).
// POST { deliveryId, lines, complete: true } → append then complete.
// KH+ (≥4), location-bound (checked in lib).
export async function POST(req: NextRequest) {
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

  const VALID_DISCREPANCY = new Set(["short", "over", "damaged", "substitution"]);

  // Narrow lines defensively when present (client is untrusted).
  let lines: DeliveryLineInput[] | undefined;
  if (hasLines) {
    const rawLines = b.lines as unknown[];
    const narrow: DeliveryLineInput[] = [];
    for (const raw of rawLines) {
      if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_payload", { field: "lines" });
      const r = raw as Record<string, unknown>;
      if (typeof r.skuId !== "string") return jsonError(400, "invalid_payload", { field: "lines[].skuId" });
      if (typeof r.qtyReceived !== "number") return jsonError(400, "invalid_payload", { field: "lines[].qtyReceived" });
      const unitPrice = r.unitPrice === null || r.unitPrice === undefined ? null : typeof r.unitPrice === "number" ? r.unitPrice : undefined;
      if (unitPrice === undefined) return jsonError(400, "invalid_payload", { field: "lines[].unitPrice" });
      const observedOzPerEach = r.observedOzPerEach === null || r.observedOzPerEach === undefined ? null : typeof r.observedOzPerEach === "number" ? r.observedOzPerEach : undefined;
      if (observedOzPerEach === undefined) return jsonError(400, "invalid_payload", { field: "lines[].observedOzPerEach" });
      const notes = r.notes === null || r.notes === undefined ? null : typeof r.notes === "string" ? r.notes : undefined;
      if (notes === undefined) return jsonError(400, "invalid_payload", { field: "lines[].notes" });
      const receivedLevelLabel = r.receivedLevelLabel === null || r.receivedLevelLabel === undefined ? null : typeof r.receivedLevelLabel === "string" ? r.receivedLevelLabel : undefined;
      if (receivedLevelLabel === undefined) return jsonError(400, "invalid_payload", { field: "lines[].receivedLevelLabel" });
      const photoUrl = r.photoUrl === null || r.photoUrl === undefined ? null : typeof r.photoUrl === "string" ? r.photoUrl : undefined;
      if (photoUrl === undefined) return jsonError(400, "invalid_payload", { field: "lines[].photoUrl" });
      const expectedQty = r.expectedQty === null || r.expectedQty === undefined ? null : typeof r.expectedQty === "number" ? r.expectedQty : undefined;
      if (expectedQty === undefined) return jsonError(400, "invalid_payload", { field: "lines[].expectedQty" });
      const discrepancyType = r.discrepancyType === null || r.discrepancyType === undefined ? null
        : typeof r.discrepancyType === "string" && VALID_DISCREPANCY.has(r.discrepancyType) ? (r.discrepancyType as DeliveryLineInput["discrepancyType"])
        : undefined;
      if (discrepancyType === undefined) return jsonError(400, "invalid_payload", { field: "lines[].discrepancyType" });
      narrow.push({ skuId: r.skuId, qtyReceived: r.qtyReceived, unitPrice, observedOzPerEach, notes, receivedLevelLabel, photoUrl, expectedQty, discrepancyType });
    }
    lines = narrow;
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
