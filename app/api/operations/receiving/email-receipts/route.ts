/**
 * /api/operations/receiving/email-receipts — thin adapter over lib/email-receipts.ts.
 *
 * GET  ?locationId=<uuid>
 *        → RECEIPT_MIN gate → listUnlinkedReceipts → { receipts }
 * GET  ?candidatesForReceipt=<uuid>
 *        → RECEIPT_MIN gate → loadPoCandidatesForReceipt → { candidates } (Attach-to-order picker)
 *
 * POST  multipart/form-data (locationId, deliveryId?, file ≤ 15 MB)
 *        → RECEIPT_MIN gate → uploadManualReceipt → { receiptId }
 *
 * PATCH { deliveryId?, action, receiptId?, poId?, verdict?, note? }
 *        action "link"      → RECEIPT_MIN     → linkReceipt(actor, receiptId, deliveryId)
 *        action "attest"    → RECEIPT_MIN     → attestMatch(actor, deliveryId, verdict)
 *        action "override"  → RECEIPT_OVERRIDE_MIN → overrideMatch(actor, deliveryId, note)
 *        action "attach_po" → RECEIPT_MIN     → attachReceiptToPo(actor, receiptId, poId)
 *        action "parse_now" → RECEIPT_MIN     → parseReceiptForActor(actor, receiptId) (V2 §4)
 *
 * Zero business logic in this file: parse, validate, gate, delegate, map errors.
 * ingestInboundReceipt is NOT used here — it is webhook-only (resend-inbound route).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  uploadManualReceipt,
  listUnlinkedReceipts,
  linkReceipt,
  attestMatch,
  overrideMatch,
  attachReceiptToPo,
  loadPoCandidatesForReceipt,
  EmailReceiptError,
  RECEIPT_MIN,
  RECEIPT_OVERRIDE_MIN,
  type MatchVerdict,
} from "@/lib/email-receipts";
import { parseReceiptForActor } from "@/lib/receipt-parse";

// 15 MB hard cap for manual receipt uploads (staff photos/PDFs of paper invoices).
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

// ── GET ?locationId=<uuid>  |  ?candidatesForReceipt=<uuid> ──────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/receiving/email-receipts");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");

  // Attach-to-order picker: candidate POs for one receipt (vendor/location-scoped, server-loaded).
  const candidatesForReceipt = req.nextUrl.searchParams.get("candidatesForReceipt");
  if (candidatesForReceipt) {
    try {
      const candidates = await loadPoCandidatesForReceipt(ctx, candidatesForReceipt);
      return jsonOk({ candidates });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  const locationId = req.nextUrl.searchParams.get("locationId");
  if (!locationId) return jsonError(400, "invalid_payload", { message: "locationId is required" });

  try {
    const receipts = await listUnlinkedReceipts(ctx, locationId);
    return jsonOk({ receipts });
  } catch (e) {
    if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// ── POST multipart/form-data ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/receiving/email-receipts");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", { message: "Body must be multipart/form-data" });
  }

  const locationId = form.get("locationId");
  const deliveryIdField = form.get("deliveryId");
  const file = form.get("file");

  if (typeof locationId !== "string" || !locationId) {
    return jsonError(400, "missing_location", { message: "A `locationId` field is required" });
  }
  if (!(file instanceof File)) {
    return jsonError(400, "missing_file", { message: "A `file` field is required" });
  }
  const deliveryId = typeof deliveryIdField === "string" && deliveryIdField ? deliveryIdField : undefined;

  // Size cap before reading the bytes.
  if (file.size > MAX_RECEIPT_BYTES) {
    return jsonError(413, "file_too_large", { message: "Receipt file must be ≤ 15 MB" });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const { receiptId } = await uploadManualReceipt(ctx, {
      locationId,
      deliveryId,
      file: { filename: file.name || "receipt", contentType: file.type || "application/octet-stream", bytes },
    });
    return jsonOk({ receiptId });
  } catch (e) {
    if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// ── PATCH JSON { deliveryId, action, receiptId?, verdict?, note? } ─────────────────────
export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const ctx = await requireSession(req, "/api/operations/receiving/email-receipts");
  if (ctx instanceof Response) return ctx;

  const b = parsed as Record<string, unknown>;
  const action = b.action;
  const deliveryId = b.deliveryId;

  if (action !== "link" && action !== "attest" && action !== "override" && action !== "attach_po" && action !== "parse_now") {
    return jsonError(400, "invalid_payload", { message: "action must be link, attest, override, attach_po, or parse_now", field: "action" });
  }

  // parse_now is receipt-axis only (no deliveryId). KH+ gate; location-bind IDOR-masks inside
  // the lib. Returns the resulting parseState + docKind for the row to reflect (V2 §4).
  if (action === "parse_now") {
    if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");
    const receiptId = b.receiptId;
    if (typeof receiptId !== "string" || !receiptId) {
      return jsonError(400, "invalid_payload", { message: "receiptId is required for action=parse_now", field: "receiptId" });
    }
    try {
      const { parseState, docKind } = await parseReceiptForActor(ctx, receiptId);
      return jsonOk({ parseState, docKind });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  // attach_po is PO-axis only — no deliveryId. Validated + gated before the delivery-axis
  // actions below (which all require a deliveryId).
  if (action === "attach_po") {
    if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");
    const receiptId = b.receiptId;
    const poId = b.poId;
    if (typeof receiptId !== "string" || !receiptId) {
      return jsonError(400, "invalid_payload", { message: "receiptId is required for action=attach_po", field: "receiptId" });
    }
    if (typeof poId !== "string" || !poId) {
      return jsonError(400, "invalid_payload", { message: "poId is required for action=attach_po", field: "poId" });
    }
    try {
      await attachReceiptToPo(ctx, receiptId, poId);
      return jsonOk({ ok: true });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  if (typeof deliveryId !== "string" || !deliveryId) {
    return jsonError(400, "invalid_payload", { field: "deliveryId" });
  }

  // Per-action validation and level gate (lib re-checks; route gate is the front door).
  if (action === "link") {
    if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");
    const receiptId = b.receiptId;
    if (typeof receiptId !== "string" || !receiptId) {
      return jsonError(400, "invalid_payload", { message: "receiptId is required for action=link", field: "receiptId" });
    }
    try {
      await linkReceipt(ctx, receiptId, deliveryId);
      return jsonOk({ ok: true });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  if (action === "attest") {
    if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");
    const verdict = b.verdict;
    if (verdict !== "matched" && verdict !== "discrepant") {
      return jsonError(400, "invalid_payload", { message: "verdict must be matched or discrepant", field: "verdict" });
    }
    const note = typeof b.note === "string" ? b.note : undefined;
    try {
      await attestMatch(ctx, deliveryId, verdict as MatchVerdict, note);
      return jsonOk({ ok: true });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  // action === "override"
  if (ROLES[ctx.user.role].level < RECEIPT_OVERRIDE_MIN) return jsonError(403, "forbidden");
  const note = b.note;
  if (typeof note !== "string" || !note.trim()) {
    return jsonError(400, "invalid_payload", { message: "A non-empty note is required for action=override", field: "note" });
  }
  try {
    await overrideMatch(ctx, deliveryId, note);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
