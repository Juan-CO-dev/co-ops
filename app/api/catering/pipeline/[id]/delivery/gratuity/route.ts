/**
 * Catering delivery D4 — correct an order's RECORDED gratuity split (10% driver / 90% crew, Juan's decision 4).
 *
 *   { mode: "recompute", ... }  "Recalculate from the current quote": the quote, the delivered job or the shop's share
 *                               changed after the split was recorded (a quote revised to no gratuity records a 0 split);
 *   { mode: "void", ... }       "Remove — this delivery didn't happen".
 * Both name the shop and the head of the chain the person SAW (`expectedShopId`, `expectedHeadId`; null = they saw no
 * split) and carry a reason. **Tier A**, asserted after the parse; this path is a step-up surface (lib/session.ts
 * `isCateringStepUpPath`) so the route's own requireSession keeps the unlock the preceding POST /api/auth/step-up set.
 *
 * Order: same-origin, the session, the switch, the strict parse, the tier, the lib (the write gate before any I/O, then
 * the shop's own switch). `record_delivery_gratuity_split` (0356) refuses by name under the lead lock: `shop_moved`,
 * `delivery_off`, `forbidden`, `split_moved` (the head is no longer the one the person saw), `quote_ambiguous` (two
 * quotes are accepted: nothing to recalculate from), `no_change`, `reason_required`.
 *
 * RECORDED ONLY. This appends one row to the order's chain and its audit row. It pays nothing, pools nothing and
 * exports nothing: the payroll and legal treatment of the driver's share is UNVERIFIED.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { deliveryOffResponse, deliveryRefusal } from "@/lib/delivery/http";
import { recordDeliveryGratuitySplit } from "@/lib/delivery/jobs";
import { parseDeliveryId, parseGratuityCorrection } from "@/lib/delivery/parse-shared";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/pipeline/${id}/delivery/gratuity`);
  if (ctx instanceof Response) return ctx;
  const off = deliveryOffResponse();
  if (off) return off;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const leadId = parseDeliveryId(id), input = parseGratuityCorrection(raw);
  if (!leadId || !input) return jsonError(400, "invalid_request");
  if (input === "reason_required") return jsonError(400, "reason_required");
  const stepUp = assertStepUp(ctx, "A");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  try { return jsonOk({ ok: true, split: await recordDeliveryGratuitySplit(ctx, { leadId, ...input }) }); }
  catch (error) { return deliveryRefusal(error); }
}
