/**
 * /api/operations/receiving/email-receipts — thin adapter over lib/email-receipts.ts.
 *
 * GET  ?locationId=<uuid>
 *        → RECEIPT_MIN gate → listUnlinkedReceipts → { receipts }
 *
 * POST  multipart/form-data (locationId, deliveryId?, file ≤ 15 MB)
 *        → RECEIPT_MIN gate → uploadManualReceipt → { receiptId }
 *
 * PATCH { deliveryId, action, receiptId?, verdict?, note? }
 *        action "link"     → RECEIPT_MIN     → linkReceipt(actor, receiptId, deliveryId)
 *        action "attest"   → RECEIPT_MIN     → attestMatch(actor, deliveryId, verdict)
 *        action "override" → RECEIPT_OVERRIDE_MIN → overrideMatch(actor, deliveryId, note)
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
  EmailReceiptError,
  RECEIPT_MIN,
  RECEIPT_OVERRIDE_MIN,
  type MatchVerdict,
} from "@/lib/email-receipts";

// 15 MB hard cap for manual receipt uploads (staff photos/PDFs of paper invoices).
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

// ── GET ?locationId=<uuid> ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/receiving/email-receipts");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");

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

  if (typeof deliveryId !== "string" || !deliveryId) {
    return jsonError(400, "invalid_payload", { field: "deliveryId" });
  }
  if (action !== "link" && action !== "attest" && action !== "override") {
    return jsonError(400, "invalid_payload", { message: "action must be link, attest, or override", field: "action" });
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
