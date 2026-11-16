import { assertStepUp } from "@/lib/admin/step-up";
import { assertSameOrigin } from "@/lib/portal/csrf";
/**
 * /api/operations/receiving/email-receipts — thin adapter over lib/email-receipts.ts.
 *
 * GET  ?locationId=<uuid>[&offset=<n>]
 *        → RECEIPT_MIN gate → listUnlinkedReceipts → { receipts, total, hasMore, flagged }
 *          (W20/B195: one page of 100, newest first; `offset` asks for the next older page)
 * GET  ?candidatesForReceipt=<uuid>
 *        → RECEIPT_MIN gate → loadPoCandidatesForReceipt → { candidates } (Attach-to-order picker)
 *
 * POST  multipart/form-data (locationId, deliveryId?, file ≤ 15 MB)
 *        → RECEIPT_MIN gate → uploadManualReceipt → { receiptId }
 *
 * PATCH { deliveryId?, action, receiptId?, poId?, verdict?, note? }
 *        action "link"      → RECEIPT_MIN     → linkReceipt(actor, receiptId, deliveryId)
 *        action "attest"    → RECEIPT_MIN     → attestMatch(actor, deliveryId, verdict, note, receiptId)
 *        action "override"  → RECEIPT_OVERRIDE_MIN → overrideMatch(actor, deliveryId, note, receiptId)
 *        (`receiptId` = the receipt on screen; a different one linked by then is 409 receipt_changed)
 *        action "unlink"    → RECEIPT_OVERRIDE_MIN → unlinkReceipt(actor, deliveryId, note, receiptId?) (W20-2)
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
  moveConflictedReceipt,
  uploadManualReceipt,
  listUnlinkedReceipts,
  linkReceipt,
  attestMatch,
  overrideMatch,
  unlinkReceipt,
  attachReceiptToPo,
  loadPoCandidatesForReceipt,
  EmailReceiptError,
  RECEIPT_MIN,
  RECEIPT_OVERRIDE_MIN,
  type MatchVerdict,
} from "@/lib/email-receipts";
import { parseReceiptForActor } from "@/lib/receipt-parse";

// W20/B115: "Parse now" (PATCH action=parse_now) runs the model call inside the request. A long
// invoice's call is bounded at 150 s (PARSE_CALL_TIMEOUT_MS), plus downloads and matching.
export const maxDuration = 180;

// 15 MB hard cap for manual receipt uploads (staff photos/PDFs of paper invoices).
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // W20/B195: the queue is paged. `offset` is a whole number, zero or more (anything else is a
  // 400, never a silent first page).
  const rawOffset = req.nextUrl.searchParams.get("offset");
  if (rawOffset !== null && !/^\d{1,9}$/.test(rawOffset)) {
    return jsonError(400, "invalid_payload", { message: "offset must be a whole number, zero or more", field: "offset" });
  }

  try {
    const page = await listUnlinkedReceipts(ctx, locationId, { offset: rawOffset === null ? 0 : Number(rawOffset) });
    return jsonOk({ receipts: page.receipts, total: page.total, hasMore: page.hasMore, flagged: page.flagged });
  } catch (e) {
    if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// ── POST multipart/form-data ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
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
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const ctx = await requireSession(req, "/api/operations/receiving/email-receipts");
  if (ctx instanceof Response) return ctx;

  const b = parsed as Record<string, unknown>;
  const action = b.action;
  const deliveryId = b.deliveryId;

  if (action !== "move" && action !== "link" && action !== "attest" && action !== "override" && action !== "unlink" && action !== "attach_po" && action !== "parse_now") {
    return jsonError(400, "invalid_payload", { message: "action must be move, link, attest, override, unlink, attach_po, or parse_now", field: "action" });
  }

  if (action === "move") {
    if (typeof b.receiptId !== "string" || !b.receiptId) return jsonError(400, "invalid_payload");
    const stepUp = assertStepUp(ctx, "A");
    if (!stepUp.ok) return jsonError(403, stepUp.code);
    try {
      await moveConflictedReceipt(ctx, b.receiptId);
      return jsonOk({ ok: true });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code);
      throw e;
    }
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

  // The receipt the person was looking at (attest / override / unlink). Optional, but a value that
  // is sent must be a receipt id: the lib refuses `receipt_changed` when another one is linked by
  // the time the write runs (review W20-r1), so a verdict never lands on a receipt nobody compared.
  const seenReceipt = b.receiptId;
  const seenReceiptId = typeof seenReceipt === "string" && UUID_RE.test(seenReceipt) ? seenReceipt : null;
  const badSeenReceipt = seenReceipt !== undefined && seenReceipt !== null && seenReceiptId === null;

  if (action === "attest") {
    if (ROLES[ctx.user.role].level < RECEIPT_MIN) return jsonError(403, "forbidden");
    const verdict = b.verdict;
    if (verdict !== "matched" && verdict !== "discrepant") {
      return jsonError(400, "invalid_payload", { message: "verdict must be matched or discrepant", field: "verdict" });
    }
    if (badSeenReceipt) return jsonError(400, "invalid_payload", { message: "receiptId must be a receipt id", field: "receiptId" });
    const note = typeof b.note === "string" ? b.note : undefined;
    try {
      await attestMatch(ctx, deliveryId, verdict as MatchVerdict, note, seenReceiptId);
      return jsonOk({ ok: true });
    } catch (e) {
      if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  // W20-2: a manager unlinks the receipt from this delivery (reason required). `receiptId` is the
  // receipt the person was looking at; the lib refuses if a different one is linked by then.
  if (action === "unlink") {
    if (ROLES[ctx.user.role].level < RECEIPT_OVERRIDE_MIN) return jsonError(403, "forbidden");
    const reason = b.note;
    if (typeof reason !== "string" || !reason.trim()) {
      return jsonError(400, "unlink_note_required", { message: "A reason is required for action=unlink", field: "note" });
    }
    if (badSeenReceipt) return jsonError(400, "invalid_payload", { message: "receiptId must be a receipt id", field: "receiptId" });
    try {
      await unlinkReceipt(ctx, deliveryId, reason, seenReceiptId);
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
  if (badSeenReceipt) return jsonError(400, "invalid_payload", { message: "receiptId must be a receipt id", field: "receiptId" });
  try {
    await overrideMatch(ctx, deliveryId, note, seenReceiptId);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof EmailReceiptError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
