import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadTodaysOrders,
  loadPoHistory,
  loadPoDetail,
  updateDraftLines,
  confirmPO,
  markPlaced,
  markReconciled,
  PurchaseOrderError,
  PO_MIN,
  PO_RECONCILE_MIN,
  type DraftLineEdit,
  type MarkPlacedInput,
} from "@/lib/purchase-orders";
import { generateDraftForVendor, OrderingError } from "@/lib/ordering";
import { orderEmailPreview, sendOrderEmail } from "@/lib/po-email";

// The purchase-order lifecycle surface (sibling of ../route.ts — same house idiom: KH+ front
// gate, typed error → jsonError). All authorization + location-bind (IDOR) is enforced inside
// the libs; this handler validates the wire shape + maps PurchaseOrderError / OrderingError.
//
//   GET  ?locationId=<uuid>              → loadTodaysOrders (today's POs, per vendor)
//   GET  ?locationId=<uuid>&history=1    → loadPoHistory
//   GET  ?poId=<uuid>                    → loadPoDetail (bound via the PO's OWN location_id)
//   POST { action: "confirm",  poId }                       → confirmPO
//   POST { action: "place",    poId, channel, target?, note? } → markPlaced
//   POST { action: "reconcile", poId }                      → markReconciled (AGM+; lib re-checks)
//   POST { action: "generate_draft", locationId, vendorId } → generateDraftForVendor
//   POST { action: "send_email", poId }                     → sendOrderEmail (V2 auto tier; two-tap)
//   PATCH { poId, lines }                → updateDraftLines (draft-only, enforced in lib)
//
// The GET ?poId= detail payload also carries `emailPreview` (server-rendered to/from/
// subject + bodies) when the PO is confirmed AND its location's auto-email leg is awake —
// the panel's Send-to-vendor preview card reads it (no separate endpoint; the server is
// the sole email author). Preview derivation failures NEVER break the detail load.

const PLACEMENT_CHANNELS = new Set(["email", "sms", "phone", "portal", "in_person"]);

/** Map a typed lib error to the house JSON error shape. Both PO + ordering errors share
 *  the (status, code, message) surface, so one mapper covers both. Returns null when the
 *  error is not a typed lib error (the caller re-throws → 500). */
function mapLibError(e: unknown) {
  if (e instanceof PurchaseOrderError || e instanceof OrderingError) {
    return jsonError(e.status, e.code, { message: e.message });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/ordering/po");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PO_MIN) return jsonError(403, "forbidden");

  const params = req.nextUrl.searchParams;
  const poId = params.get("poId");
  const locationId = params.get("locationId");
  const history = params.get("history");

  try {
    // poId branch: one PO's detail (its own location_id binds the read). Exclusive with
    // locationId — reject the ambiguous combination before any locationId handling.
    if (typeof poId === "string" && poId) {
      if (typeof locationId === "string" && locationId) {
        return jsonError(400, "invalid_payload", { message: "Provide poId OR locationId, not both" });
      }
      const detail = await loadPoDetail(ctx, poId);
      // Attach the server-rendered email preview when the auto leg is awake for a
      // confirmed PO (V2 §3) — the panel's Send-to-vendor card reads it. Best-effort:
      // a preview failure must never break the detail load (manual flow stays intact).
      let emailPreview = null;
      if (detail.status === "confirmed" && detail.transmit.emailOrderingAvailable) {
        try {
          emailPreview = await orderEmailPreview(ctx, poId);
        } catch {
          emailPreview = null;
        }
      }
      return jsonOk({ detail, emailPreview });
    }
    if (typeof locationId !== "string" || !locationId) {
      return jsonError(400, "invalid_payload", { field: "locationId" });
    }
    if (history === "1") {
      const orders = await loadPoHistory(ctx, locationId);
      return jsonOk({ orders });
    }
    const orders = await loadTodaysOrders(ctx, locationId);
    return jsonOk({ orders });
  } catch (e) {
    const mapped = mapLibError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/ordering/po");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PO_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : null;
  if (!action) return jsonError(400, "invalid_payload", { field: "action" });

  try {
    switch (action) {
      case "confirm": {
        if (typeof b.poId !== "string" || !b.poId) return jsonError(400, "invalid_payload", { field: "poId" });
        await confirmPO(ctx, b.poId);
        return jsonOk({ poId: b.poId, status: "confirmed" });
      }
      case "place": {
        if (typeof b.poId !== "string" || !b.poId) return jsonError(400, "invalid_payload", { field: "poId" });
        if (typeof b.channel !== "string" || !PLACEMENT_CHANNELS.has(b.channel)) {
          return jsonError(400, "invalid_channel", { field: "channel" });
        }
        const target = b.target === null || b.target === undefined ? null : typeof b.target === "string" ? b.target : undefined;
        if (target === undefined) return jsonError(400, "invalid_payload", { field: "target" });
        const note = b.note === null || b.note === undefined ? null : typeof b.note === "string" ? b.note : undefined;
        if (note === undefined) return jsonError(400, "invalid_payload", { field: "note" });
        await markPlaced(ctx, b.poId, { channel: b.channel, target, note } as MarkPlacedInput);
        return jsonOk({ poId: b.poId, status: "placed" });
      }
      case "reconcile": {
        // AGM+ front-door check (the lib re-checks PO_RECONCILE_MIN authoritatively).
        if (ROLES[ctx.user.role].level < PO_RECONCILE_MIN) return jsonError(403, "forbidden");
        if (typeof b.poId !== "string" || !b.poId) return jsonError(400, "invalid_payload", { field: "poId" });
        await markReconciled(ctx, b.poId);
        return jsonOk({ poId: b.poId, status: "reconciled" });
      }
      case "generate_draft": {
        if (typeof b.locationId !== "string" || !b.locationId) return jsonError(400, "invalid_payload", { field: "locationId" });
        if (typeof b.vendorId !== "string" || !b.vendorId) return jsonError(400, "invalid_payload", { field: "vendorId" });
        const created = await generateDraftForVendor(ctx, b.locationId, b.vendorId);
        return jsonOk({ poId: created.poId, displayCode: created.displayCode }, 201);
      }
      case "send_email": {
        // V2 auto tier (two-tap). The server is the sole email author — the tap carries
        // only poId; sendOrderEmail re-derives + gates (409 po_not_confirmed/email_dormant/
        // no_email_target, 502 send_failed) and, on success, places the PO. mapLibError maps
        // every PurchaseOrderError status (incl. the 502) to the house error shape.
        if (typeof b.poId !== "string" || !b.poId) return jsonError(400, "invalid_payload", { field: "poId" });
        const sent = await sendOrderEmail(ctx, b.poId);
        return jsonOk({ poId: b.poId, status: "placed", providerMessageId: sent.providerMessageId });
      }
      default:
        return jsonError(400, "invalid_payload", { field: "action" });
    }
  } catch (e) {
    const mapped = mapLibError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/ordering/po");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PO_MIN) return jsonError(403, "forbidden");

  const b = parsed as { poId?: unknown; lines?: unknown };
  if (typeof b.poId !== "string" || !b.poId) return jsonError(400, "invalid_payload", { field: "poId" });
  if (!Array.isArray(b.lines)) return jsonError(400, "no_lines");
  // The lib re-validates each line (SKU string, qty finite ≥ 0, no dupes, draft-only);
  // this cast just narrows the wire shape. Extra fields are ignored by the lib.
  const lines = b.lines as DraftLineEdit[];

  try {
    await updateDraftLines(ctx, b.poId, lines);
    return jsonOk({ poId: b.poId });
  } catch (e) {
    const mapped = mapLibError(e);
    if (mapped) return mapped;
    throw e;
  }
}
