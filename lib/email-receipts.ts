/**
 * Email-receipt ledger — the vendor-claim side of the two-way match (delivery-intake
 * P2, spec D4/D6; migration 0170). SERVER-ONLY, service-role client; the `receipts`
 * bucket is private + deny-by-default (0170, mirrors the `photos` posture from 0164),
 * so this module is the sole reader/writer. Authorization is APP-LAYER (KH+ gate +
 * location-bind IDOR masking as 404; the OVERRIDE lifecycle requires AGM+).
 *
 * TWO INGRESS PATHS into the ledger:
 *   - MACHINE (ingestInboundReceipt): the Resend inbound webhook route calls this with
 *     no actor. We store the raw .eml + attachments, attribute a location by the
 *     to-address, guess a vendor by the from-address, insert the row (source 'inbound'),
 *     then attemptAutoLink. LEDGER-FIRST LAW: a storage failure THROWS (the route → 500);
 *     we never record a receipt row whose promised bytes never landed.
 *   - MANUAL (uploadManualReceipt): a KH+ staffer uploads a photo/PDF of a paper invoice,
 *     optionally pre-linked to a delivery.
 *
 * PARSING is deferred to P4 (parse_state stays 'unparsed'); MATCH VERDICTS (attestMatch /
 * overrideMatch) are MANAGER ATTESTATION on a visual compare — not a computed diff (P2).
 *
 * PO-MATCHING (V2 §4, section 3b): a SEPARATE linking axis from the delivery two-way match.
 * On ingest (and on parse completion / manual attach) a receipt may resolve to the purchase
 * order it confirms or invoices — linked_po_id, distinct from linked_delivery_id (a receipt
 * can carry both, one, or neither). matchReceiptToPo writes the link (PO-code key, then a
 * vendor+window single-candidate fallback); applyReceiptPoEffects fills the PO's ack (V2-D2)
 * or flips placed→invoiced by doc_kind. All best-effort/fail-open — never poisons the ingest.
 *
 * APPEND-ONLY: no DELETEs anywhere. Notes append (read-append; never clobber — mirrors
 * lib/credits.ts resolveCredit). Every UPDATE checks error AND rowcount (silent-UPDATE
 * law); Supabase `.update()` swallows constraint violations, so we never infer success
 * from `data`.
 *
 * STORAGE HELPER: the receipts bucket's MIME allow-list (PDF/EML/text/html + phone
 * image types) genuinely differs from the photos image-only set, so the storage seam
 * (allow-list + path builder + signed-URL minting) lives inline in this module rather
 * than reusing lib/photos-shared.ts. Object-path convention (task-specified, distinct
 * from photos' month-partition): `<locationId ?? "unattributed">/<uuid>/<filename>`.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, accessibleLocations, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { autoPlaceOnEmailEvidence } from "@/lib/purchase-orders";
import { extractPoCodes } from "@/lib/email-receipts-matching-shared";

// Re-export the pure code extractor so server callers keep their `@/lib/email-receipts`
// import path (the *-shared.ts law). Task 7's SMS leg imports the leaf directly (client-safe).
export { extractPoCodes } from "@/lib/email-receipts-matching-shared";

export const RECEIPT_MIN = 4; // key_holder+ — read + manual-upload + link + attest
export const RECEIPT_OVERRIDE_MIN = 6; // AGM+ — override a match verdict

const RECEIPT_BUCKET = "receipts";
const SIGNED_URL_TTL_SECONDS = 60;

/** ±2 days: an inbound receipt's received-at date vs a candidate delivery's date. */
const AUTO_LINK_DAY_WINDOW = 2;

export class EmailReceiptError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "EmailReceiptError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new EmailReceiptError(403, "forbidden", "Insufficient role level for receipts");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

// ── STORAGE SEAM (receipts bucket) ─────────────────────────────────────────────────
// The bucket's allow-list (0170) — PDF + EML + text/html + the phone image types. Kept
// in sync with the migration's `allowed_mime_types` so the app-layer rejection and the
// Storage-layer rejection agree.
const RECEIPT_ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "message/rfc822",
  "text/plain",
  "text/html",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

/** True iff `ct` is an allowed receipt content type. Case-insensitive on the type token;
 *  tolerant of a trailing `; charset=…` some clients add (mirrors photos-shared). */
function isReceiptContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return (RECEIPT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(base);
}

/** Sanitize a filename for use as the trailing segment of an object key: strip any
 *  path separators, collapse to a safe charset, cap length. Never empty (falls back
 *  to "file"). The uuid segment guarantees uniqueness, so a collapsed name is fine. */
function safeFilename(filename: string | null | undefined): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return cleaned || "file";
}

/** Build the storage object path: `<locationId ?? "unattributed">/<uuid>/<filename>`.
 *  `assetId` is a per-asset uuid so multiple attachments in one receipt never collide. */
function buildReceiptPath(locationId: string | null, assetId: string, filename: string): string {
  const prefix = locationId ?? "unattributed";
  return `${prefix}/${assetId}/${safeFilename(filename)}`;
}

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** An entry in email_receipts.attachment_paths. `omitted` records a skip (content-type
 *  not in the bucket allow-list) so the ledger row is honest about what did NOT store. */
interface AttachmentPathEntry {
  filename: string;
  contentType: string;
  path: string | null;
  omitted?: true;
}

/**
 * Store one asset to the receipts bucket. LEDGER-FIRST: a storage error THROWS (the
 * ingest is poisoned → the webhook route surfaces 500). The row id is minted per-asset
 * so paths never collide. Returns the object path.
 */
async function storeReceiptAsset(
  sb: ServiceClient,
  locationId: string | null,
  filename: string,
  contentType: string,
  bytes: Uint8Array | Buffer,
): Promise<string> {
  const assetId = randomUUID();
  const path = buildReceiptPath(locationId, assetId, filename);
  const { error } = await sb.storage.from(RECEIPT_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`storeReceiptAsset: ${error.message}`);
  return path;
}

/** Mint a short-lived signed URL for a stored object; null-safe (a missing path or a
 *  sign failure returns null so a partly-stored receipt still renders its other assets). */
async function signReceiptPath(sb: ServiceClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await sb.storage.from(RECEIPT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ── (1) MACHINE PATH — inbound webhook ingest ───────────────────────────────────────

export interface InboundReceiptInput {
  toAddress: string | null;
  fromAddress: string | null;
  subject: string | null;
  rawEml: { bytes: Uint8Array | Buffer; contentType: string } | null;
  attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array | Buffer }>;
  /** IDEMPOTENCY KEY (the svix-id). When present, a receipt already stored under this
   *  external_id short-circuits before any storage/DB write (Resend retries on our 500s;
   *  a replay must NOT duplicate the row). Backed by 0171 email_receipts_external_uq. */
  externalId?: string | null;
}

/**
 * MACHINE path (no actor): called by the Resend inbound-email webhook route. Stores the
 * raw .eml + each attachment to the receipts bucket, attributes a location by matching
 * the to-address against locations.receipt_email_address (case-insensitive, active
 * locations), guesses a vendor by matching the from-address against vendor emails
 * (null when ambiguous across vendors), inserts the ledger row (source 'inbound'), then
 * attempts an auto-link. Every storage/DB call is error-checked; a storage failure
 * poisons the ingest with a thrown error (ledger-first law — the route converts to 500).
 */
export async function ingestInboundReceipt(input: InboundReceiptInput): Promise<{ receiptId: string }> {
  const sb = getServiceRoleClient();

  // IDEMPOTENT REPLAY: when an externalId (svix-id) is present, a prior receipt under
  // that key means Resend re-delivered (it retries on our 500s). Return the existing id
  // BEFORE storing anything — no duplicate bytes, no duplicate row.
  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    const { data: existing, error: exErr } = await sb
      .from("email_receipts")
      .select("id")
      .eq("external_id", externalId)
      .maybeSingle<{ id: string }>();
    if (exErr) throw new Error(`ingestInboundReceipt idempotency lookup: ${exErr.message}`);
    if (existing) return { receiptId: existing.id };
  }

  // Location attribution by the to-address (case-insensitive, active locations).
  const locationId = await attributeLocationByToAddress(sb, input.toAddress);
  // Vendor guess by the from-address (null when ambiguous or unmatched).
  const vendorGuessId = await guessVendorByFromAddress(sb, input.fromAddress);

  // Store raw + attachments. LEDGER-FIRST: any storage error throws before we insert
  // the row, so we never promise bytes we didn't land. Disallowed attachment types are
  // recorded as `omitted` (they don't fail the whole ingest).
  let rawStoragePath: string | null = null;
  if (input.rawEml && isReceiptContentType(input.rawEml.contentType)) {
    rawStoragePath = await storeReceiptAsset(sb, locationId, "message.eml", input.rawEml.contentType, input.rawEml.bytes);
  }

  const attachmentPaths: AttachmentPathEntry[] = [];
  for (const att of input.attachments ?? []) {
    if (!isReceiptContentType(att.contentType)) {
      // Skip disallowed types — record the skip, don't fail the ingest.
      attachmentPaths.push({ filename: att.filename, contentType: att.contentType, path: null, omitted: true });
      continue;
    }
    const path = await storeReceiptAsset(sb, locationId, att.filename, att.contentType, att.bytes);
    attachmentPaths.push({ filename: att.filename, contentType: att.contentType, path });
  }

  const { data: inserted, error: insErr } = await sb
    .from("email_receipts")
    .insert({
      location_id: locationId,
      source: "inbound",
      from_address: input.fromAddress?.trim() || null,
      subject: input.subject?.trim() || null,
      raw_storage_path: rawStoragePath,
      attachment_paths: attachmentPaths,
      vendor_guess_id: vendorGuessId,
      external_id: externalId,
      created_by: null, // machine — no actor
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) {
    // IDEMPOTENCY RACE: a concurrent retry inserted the same external_id first and won
    // the 0171 email_receipts_external_uq index (23505). Re-select by external_id and
    // return the winner's id — our stored bytes are orphaned but harmless (append-only).
    if (externalId && insErr.code === PG_UNIQUE_VIOLATION) {
      const { data: raced, error: raceErr } = await sb
        .from("email_receipts")
        .select("id")
        .eq("external_id", externalId)
        .maybeSingle<{ id: string }>();
      if (raceErr) throw new Error(`ingestInboundReceipt idempotency re-select: ${raceErr.message}`);
      if (raced) return { receiptId: raced.id };
    }
    throw new Error(`ingestInboundReceipt insert: ${insErr.message}`);
  }
  if (!inserted) throw new Error("ingestInboundReceipt insert returned no row");

  // Best-effort auto-link (never throws to the caller on zero/many candidates).
  await attemptAutoLink(inserted.id);

  // Best-effort PO matching (V2 §4) — SEPARATE axis from the delivery auto-link above.
  // FAIL-OPEN (ledger-first): matching NEVER poisons the ingest — a failure here logs and
  // returns, the row is already durable. The body text is only in memory now (email_receipts
  // has no body column) — decode it from the raw eml bytes when they are text-ish (text/plain
  // or text/html; a PDF/image raw is not usable as match text → null). doc_kind is null here
  // (pre-parse) so applyReceiptPoEffects is a no-op until parse classifies the document; we
  // still call it so an already-classified re-run is covered by one code path.
  try {
    const bodyText = decodeReceiptBodyText(input.rawEml);
    const match = await matchReceiptToPo(sb, {
      id: inserted.id,
      subject: input.subject?.trim() || null,
      body: bodyText,
      vendorGuessId,
      locationId,
      receivedAt: new Date().toISOString(),
    });
    await applyReceiptPoEffects(sb, inserted.id, match?.matchedBy);
  } catch (poErr) {
    console.error(`[email-receipts] PO matching failed for receipt=${inserted.id} (ingest unaffected):`, poErr instanceof Error ? poErr.message : poErr);
  }

  return { receiptId: inserted.id };
}

/** Decode a rawEml asset to match text when it is a text-ish content type (text/plain or
 *  text/html — the body forms the Resend webhook stores). A PDF/image raw is not usable as
 *  match text → null. utf-8 decode; a decode failure → null (best-effort, never throws). */
function decodeReceiptBodyText(rawEml: { bytes: Uint8Array | Buffer; contentType: string } | null): string | null {
  if (!rawEml) return null;
  const base = rawEml.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base !== "text/plain" && base !== "text/html") return null;
  try {
    return new TextDecoder("utf-8").decode(rawEml.bytes);
  } catch {
    return null;
  }
}

/** Match a to-address against locations.receipt_email_address (case-insensitive, active
 *  locations). Null when the address is empty or no active location claims it. Ambiguity
 *  (two active locations sharing an address — shouldn't happen) resolves to null. */
async function attributeLocationByToAddress(sb: ServiceClient, toAddress: string | null): Promise<string | null> {
  const to = toAddress?.trim().toLowerCase();
  if (!to) return null;
  const { data, error } = await sb
    .from("locations")
    .select("id, receipt_email_address")
    .eq("active", true)
    .not("receipt_email_address", "is", null)
    .returns<Array<{ id: string; receipt_email_address: string | null }>>();
  if (error) throw new Error(`attributeLocationByToAddress: ${error.message}`);
  const matches = (data ?? []).filter((l) => (l.receipt_email_address ?? "").trim().toLowerCase() === to);
  return matches.length === 1 ? matches[0]!.id : null;
}

/**
 * Guess a vendor from a from-address by matching it (lowercased) against BOTH
 * vendor_contacts.email AND vendor_ordering_details.value where method='email'. Returns
 * a single vendor id only when every match points at ONE vendor; null when the address
 * is empty, unmatched, OR ambiguous across vendors (we never guess wrong — a bad guess
 * would mis-link a delivery).
 */
async function guessVendorByFromAddress(sb: ServiceClient, fromAddress: string | null): Promise<string | null> {
  const from = fromAddress?.trim().toLowerCase();
  if (!from) return null;

  const vendorIds = new Set<string>();

  const { data: contacts, error: cErr } = await sb
    .from("vendor_contacts")
    .select("vendor_id, email")
    .eq("active", true)
    .ilike("email", from)
    .returns<Array<{ vendor_id: string; email: string | null }>>();
  if (cErr) throw new Error(`guessVendorByFromAddress contacts: ${cErr.message}`);
  for (const c of contacts ?? []) {
    if ((c.email ?? "").trim().toLowerCase() === from) vendorIds.add(c.vendor_id);
  }

  const { data: ordering, error: oErr } = await sb
    .from("vendor_ordering_details")
    .select("vendor_id, value")
    .eq("active", true)
    .eq("method", "email")
    .ilike("value", from)
    .returns<Array<{ vendor_id: string; value: string | null }>>();
  if (oErr) throw new Error(`guessVendorByFromAddress ordering: ${oErr.message}`);
  for (const o of ordering ?? []) {
    if ((o.value ?? "").trim().toLowerCase() === from) vendorIds.add(o.vendor_id);
  }

  return vendorIds.size === 1 ? [...vendorIds][0]! : null; // null when ambiguous/unmatched
}

// ── (2) MANUAL PATH — staff upload ──────────────────────────────────────────────────

export interface ManualReceiptInput {
  locationId: string;
  deliveryId?: string;
  file: { filename: string; contentType: string; bytes: Buffer };
}

/**
 * KH+ manual upload of a receipt image/PDF, location-bound. Content-type must be in the
 * bucket allow-list (400 otherwise). Stores to the bucket, inserts the ledger row
 * (source 'upload', created_by actor, location set). When deliveryId is provided: the
 * delivery must exist, be location-matched, and not already carry a receipt (409
 * already_linked); then BOTH sides are set (email_receipts.linked_delivery_id +
 * vendor_deliveries.email_receipt_id, each error-checked; the delivery update is
 * rowcount-checked).
 */
export async function uploadManualReceipt(
  actor: AuthContext,
  input: ManualReceiptInput,
): Promise<{ receiptId: string }> {
  requireLevel(actor, RECEIPT_MIN);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) {
    throw new EmailReceiptError(404, "not_found", "Location not found");
  }
  if (!isReceiptContentType(input.file.contentType)) {
    throw new EmailReceiptError(400, "unsupported_type", "Unsupported receipt file type");
  }
  if (!input.file.bytes || input.file.bytes.byteLength === 0) {
    throw new EmailReceiptError(400, "empty_file", "Receipt file is empty");
  }
  const sb = getServiceRoleClient();

  // Validate the delivery BEFORE storing/inserting, so a bad delivery ref never leaves
  // an orphaned object or an unlinked row that "should have" linked.
  let delivery: { id: string; location_id: string; email_receipt_id: string | null } | null = null;
  if (input.deliveryId) {
    const { data: d, error: dErr } = await sb
      .from("vendor_deliveries")
      .select("id, location_id, email_receipt_id")
      .eq("id", input.deliveryId)
      .maybeSingle<{ id: string; location_id: string; email_receipt_id: string | null }>();
    if (dErr) throw new Error(`uploadManualReceipt delivery: ${dErr.message}`);
    // Missing OR out-of-location → same 404 (no IDOR oracle).
    if (!d || d.location_id !== input.locationId) {
      throw new EmailReceiptError(404, "not_found", "Delivery not found");
    }
    if (d.email_receipt_id) throw new EmailReceiptError(409, "already_linked", "This delivery already has a receipt");
    delivery = d;
  }

  const storagePath = await storeReceiptAsset(sb, input.locationId, input.file.filename, input.file.contentType, input.file.bytes);
  const attachmentPaths: AttachmentPathEntry[] = [
    { filename: safeFilename(input.file.filename), contentType: input.file.contentType, path: storagePath },
  ];

  const { data: inserted, error: insErr } = await sb
    .from("email_receipts")
    .insert({
      location_id: input.locationId,
      source: "upload",
      attachment_paths: attachmentPaths,
      linked_delivery_id: delivery?.id ?? null,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) throw new Error(`uploadManualReceipt insert: ${insErr.message}`);
  if (!inserted) throw new Error("uploadManualReceipt insert returned no row");

  if (delivery) {
    // LINK ORDER (race-safe): the RECEIPT side was already claimed by the INSERT above
    // (linked_delivery_id set at birth) — so the receipt-first ordering holds. Now the
    // DELIVERY side, count-checked + 23505-guarded (the 0171 vendor_deliveries_email_
    // receipt_uq index is the DB arbiter). If the delivery side loses (count 0 OR 23505),
    // COMPENSATE by releasing the receipt claim, then 409.
    const { error: uErr, count } = await sb
      .from("vendor_deliveries")
      .update({ email_receipt_id: inserted.id }, { count: "exact" })
      .eq("id", delivery.id)
      .is("email_receipt_id", null); // guard against a race stealing the slot
    if (uErr || count === 0) {
      await compensateReceiptClaim(sb, inserted.id, delivery.id);
      if (uErr && uErr.code !== PG_UNIQUE_VIOLATION) throw new Error(`uploadManualReceipt delivery link: ${uErr.message}`);
      throw new EmailReceiptError(409, "already_linked", "This delivery already has a receipt");
    }

    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "delivery.receipt_linked", resourceTable: "vendor_deliveries", resourceId: delivery.id,
      metadata: { receipt_id: inserted.id, location_id: input.locationId, source: "upload" },
      ipAddress: null, userAgent: null,
    });
  }

  return { receiptId: inserted.id };
}

// ── LINK-RACE COMPENSATION ──────────────────────────────────────────────────────────
/**
 * Release a receipt→delivery claim that was made on the RECEIPT side but could not be
 * completed on the DELIVERY side (the delivery lost the race or tripped the 0171 unique
 * index). BEST-EFFORT: a failure here is logged, never thrown — the receipt reverts to
 * unlinked for manual triage, which is the safe state (worst case the row keeps a stale
 * linked_delivery_id, discoverable and re-linkable). Guarded on the exact (id,
 * linked_delivery_id) we set, so we never clobber a claim some other writer made.
 */
async function compensateReceiptClaim(sb: ServiceClient, receiptId: string, deliveryId: string): Promise<void> {
  const { error } = await sb
    .from("email_receipts")
    .update({ linked_delivery_id: null })
    .eq("id", receiptId)
    .eq("linked_delivery_id", deliveryId);
  if (error) {
    console.error(`[email-receipts] compensateReceiptClaim failed for receipt=${receiptId} delivery=${deliveryId}:`, error.message);
  }
}

/** Postgres unique-violation code (per pg docs) — the 0171 partial-unique index arbiter. */
const PG_UNIQUE_VIOLATION = "23505";

// ── (3) AUTO-LINK — internal, best-effort ───────────────────────────────────────────

/**
 * Auto-link an inbound receipt to a delivery when there is exactly ONE candidate.
 * INTERNAL — only meaningful when the receipt carries BOTH a vendor_guess_id AND a
 * location_id. Candidates = deliveries at that vendor+location with email_receipt_id
 * null and delivery_date within ±2 days of received_at::date. Links only on a unique
 * candidate (both sides set, error-checked). NEVER throws to the caller on zero/many —
 * it just returns (the receipt stays unlinked for manual triage).
 */
export async function attemptAutoLink(receiptId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: r, error } = await sb
    .from("email_receipts")
    .select("id, location_id, vendor_guess_id, linked_delivery_id, received_at")
    .eq("id", receiptId)
    .maybeSingle<{ id: string; location_id: string | null; vendor_guess_id: string | null; linked_delivery_id: string | null; received_at: string }>();
  if (error) return; // best-effort — never poison the ingest on an auto-link read failure
  if (!r || r.linked_delivery_id || !r.vendor_guess_id || !r.location_id) return;

  // ±2-day window around the receipt's received-at date (bare-date comparison).
  const receivedMs = Date.parse(r.received_at);
  if (!Number.isFinite(receivedMs)) return;
  const lo = new Date(receivedMs - AUTO_LINK_DAY_WINDOW * 86_400_000).toISOString().slice(0, 10);
  const hi = new Date(receivedMs + AUTO_LINK_DAY_WINDOW * 86_400_000).toISOString().slice(0, 10);

  const { data: candidates, error: cErr } = await sb
    .from("vendor_deliveries")
    .select("id")
    .eq("vendor_id", r.vendor_guess_id)
    .eq("location_id", r.location_id)
    .is("email_receipt_id", null)
    .gte("delivery_date", lo)
    .lte("delivery_date", hi)
    .returns<Array<{ id: string }>>();
  if (cErr) return;
  const list = candidates ?? [];
  if (list.length !== 1) return; // zero or many → leave unlinked for manual triage
  const deliveryId = list[0]!.id;

  // LINK ORDER: claim the RECEIPT side FIRST (count-checked — a loser aborts having
  // touched nothing), THEN the delivery side (count-checked + 23505-guarded by the
  // 0171 vendor_deliveries_email_receipt_uq index). If the delivery side loses the
  // race, COMPENSATE by unsetting the receipt side (best-effort) and return silently —
  // this is the internal best-effort path (never throws to the caller).
  const { error: ruErr, count: rCount } = await sb
    .from("email_receipts")
    .update({ linked_delivery_id: deliveryId }, { count: "exact" })
    .eq("id", r.id)
    .is("linked_delivery_id", null);
  if (ruErr || rCount === 0) return; // lost the receipt side (or read error) — abort untouched.

  const { error: duErr, count } = await sb
    .from("vendor_deliveries")
    .update({ email_receipt_id: r.id }, { count: "exact" })
    .eq("id", deliveryId)
    .is("email_receipt_id", null);
  if (duErr || count === 0) {
    // Delivery side lost (count 0) or tripped the unique index (23505): compensate by
    // releasing the receipt claim we made, then bail silently for manual triage.
    await compensateReceiptClaim(sb, r.id, deliveryId);
    return;
  }

  // audit() is fail-open by contract (lib/audit.ts wraps the insert in try/catch and
  // never throws) — safe to await here without poisoning this best-effort auto-link.
  await audit({
    actorId: null, actorRole: null,
    action: "delivery.receipt_linked", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { receipt_id: r.id, location_id: r.location_id, source: "auto", vendor_guess_id: r.vendor_guess_id },
    ipAddress: null, userAgent: null,
  });
}

// ── (3b) PO MATCHING — receipt → purchase_order link + effects ───────────────────────
//
// The confirmation/invoice→PO edge (V2 §4). SEPARATE AXIS from the delivery auto-link
// above: a receipt can carry BOTH a linked_delivery_id (the two-way match) AND a
// linked_po_id (the order it acknowledges/invoices). Neither implies the other. Called
// on ingest AND on parse completion (Task 5); pure extraction (extractPoCodes) is also
// reused by the SMS leg (Task 7).

/** PO statuses a receipt link may legitimately attach to on the PO-CODE path. A draft
 *  PO is NOT a valid target (nothing was even confirmed). `confirmed` IS code-linkable
 *  (2026-08-10, Juan-ratified auto-place): a vendor reply carrying OUR display code is
 *  placement evidence — applyReceiptPoEffects auto-advances confirmed→placed on it.
 *  The vendor+window fallback keeps its own narrower placed|invoiced filter inline —
 *  a window guess must never place an order nobody sent. Kept as a Set for O(1). */
const PO_LINKABLE_STATUSES = new Set(["confirmed", "placed", "invoiced", "received", "reconciled"]);
/** ±3 days: the vendor+window fallback tolerance around a receipt's received-at date vs a
 *  candidate PO's placed_at (V2 §4 step 4 — the single-candidate rule). */
const PO_MATCH_DAY_WINDOW = 3;

/** The text a matcher inspects for a receipt — subject + whatever body text the caller
 *  holds (email_receipts has NO body column; at ingest the body is the webhook's in-memory
 *  text, post-parse it is the parse output). */
export interface MatchReceiptInput {
  id: string;
  subject: string | null;
  body?: string | null;
  vendorGuessId: string | null;
  locationId: string | null;
  receivedAt: string;
}

/**
 * Resolve the ONE purchase order an inbound receipt links to, if any, and WRITE the link
 * (V2 §4). Precedence (deterministic, batch-only):
 *   (1) PO DISPLAY CODE in subject+body → the strongest key. extractPoCodes → one batched
 *       `.in("display_code", …)` lookup → a candidate is VALID iff its status is linkable
 *       AND (vendor agrees when vendorGuessId known) AND (location agrees when locationId
 *       known). Exactly one DISTINCT valid PO → match `po_code`. Two-or-more distinct →
 *       null (ambiguous → triage; we never guess).
 *   (2) VENDOR + WINDOW fallback → only when a vendor is known: placed|invoiced POs for
 *       that vendor (+ location when known) whose placed_at is within ±3 days of receivedAt.
 *       EXACTLY ONE → match `vendor_window`; else null (the shipped single-candidate P2 law).
 * The link WRITE is a guarded UPDATE (`linked_po_id IS NULL`, count exact) so a concurrent
 * writer (a re-run on parse, a manual attach) never double-links or double-audits: count 0
 * → someone already linked → return null. Audits `receipt.po_linked` once per NEW link.
 * NEVER throws to the caller on a query error — matching is best-effort (ledger-first); a
 * read failure returns null and the receipt stays in triage.
 */
export async function matchReceiptToPo(
  sb: ServiceClient,
  receipt: MatchReceiptInput,
): Promise<{ poId: string; matchedBy: "po_code" | "vendor_window" } | null> {
  const matched = await resolvePoMatch(sb, receipt);
  if (!matched) return null;

  // GUARDED LINK WRITE (silent-UPDATE law): claim linked_po_id only while it is still null.
  // count 0 = a rival writer linked first → do NOT audit again (no double-audit), return null.
  const { error: uErr, count } = await sb
    .from("email_receipts")
    .update({ linked_po_id: matched.poId }, { count: "exact" })
    .eq("id", receipt.id)
    .is("linked_po_id", null);
  if (uErr) {
    console.error(`[email-receipts] matchReceiptToPo link write failed for receipt=${receipt.id}:`, uErr.message);
    return null;
  }
  if (count === 0) return null; // already linked (raced or re-run) — no new link, no audit.

  // doc_kind may be null at ingest (pre-parse) — recorded as-is for forensics.
  const { data: rowForKind } = await sb
    .from("email_receipts")
    .select("doc_kind")
    .eq("id", receipt.id)
    .maybeSingle<{ doc_kind: string | null }>();
  await audit({
    actorId: null, actorRole: null,
    action: "receipt.po_linked", resourceTable: "email_receipts", resourceId: receipt.id,
    metadata: { receipt_id: receipt.id, po_id: matched.poId, matched_by: matched.matchedBy, doc_kind: rowForKind?.doc_kind ?? null },
    ipAddress: null, userAgent: null,
  });
  return matched;
}

/**
 * The pure(ish) resolution half of matchReceiptToPo — computes the target PO WITHOUT
 * writing (so the write + audit live in one place above). Batch queries only; every call
 * error-checked but a failure returns null (best-effort). Split out so the precedence is
 * readable and testable in isolation from the link write.
 */
async function resolvePoMatch(
  sb: ServiceClient,
  receipt: MatchReceiptInput,
): Promise<{ poId: string; matchedBy: "po_code" | "vendor_window" } | null> {
  // ── (1) PO display code in subject + body ──────────────────────────────────────────
  const codes = extractPoCodes(`${receipt.subject ?? ""} ${receipt.body ?? ""}`);
  if (codes.length > 0) {
    const { data: pos, error } = await sb
      .from("purchase_orders")
      .select("id, status, vendor_id, location_id")
      .in("display_code", codes)
      .returns<Array<{ id: string; status: string; vendor_id: string; location_id: string }>>();
    if (error) {
      console.error(`[email-receipts] resolvePoMatch code lookup failed for receipt=${receipt.id}:`, error.message);
      return null;
    }
    const valid = (pos ?? []).filter(
      (p) =>
        PO_LINKABLE_STATUSES.has(p.status) &&
        (receipt.vendorGuessId == null || p.vendor_id === receipt.vendorGuessId) &&
        (receipt.locationId == null || p.location_id === receipt.locationId),
    );
    const distinct = new Set(valid.map((p) => p.id));
    if (distinct.size === 1) return { poId: [...distinct][0]!, matchedBy: "po_code" };
    if (distinct.size > 1) return null; // ambiguous → triage; the code key never guesses.
    // zero valid candidates from the codes → fall through to the vendor+window fallback.
  }

  // ── (2) Vendor + window fallback (single-candidate rule) ───────────────────────────
  if (!receipt.vendorGuessId) return null; // no vendor → no fallback (never fan out wide).
  const receivedMs = Date.parse(receipt.receivedAt);
  if (!Number.isFinite(receivedMs)) return null;
  const lo = new Date(receivedMs - PO_MATCH_DAY_WINDOW * 86_400_000).toISOString();
  const hi = new Date(receivedMs + PO_MATCH_DAY_WINDOW * 86_400_000).toISOString();

  let q = sb
    .from("purchase_orders")
    .select("id")
    .eq("vendor_id", receipt.vendorGuessId)
    .in("status", ["placed", "invoiced"])
    .gte("placed_at", lo)
    .lte("placed_at", hi);
  if (receipt.locationId != null) q = q.eq("location_id", receipt.locationId);
  const { data: windowPos, error: wErr } = await q.returns<Array<{ id: string }>>();
  if (wErr) {
    console.error(`[email-receipts] resolvePoMatch window lookup failed for receipt=${receipt.id}:`, wErr.message);
    return null;
  }
  const list = windowPos ?? [];
  if (list.length !== 1) return null; // zero or many → triage (single-candidate law).
  return { poId: list[0]!.id, matchedBy: "vendor_window" };
}

/**
 * Apply the PO-side EFFECTS of a receipt→PO link (V2-D2 / §4). IDEMPOTENT + guarded:
 * safe to call on ingest, on parse completion, and on a manual attach — it converges on
 * the same PO state without double-writing. Loads the receipt's (linked_po_id, doc_kind,
 * from_address, received_at); a receipt with no link OR no doc_kind is a NO-OP (nothing to
 * apply yet — the ack/invoice effect needs to know WHICH document kind linked).
 *
 * `matchedBy` is a PARAMETER, not a stored column: the caller passes it when it knows how
 * the link formed ("po_code" | "vendor_window" | "manual"); a re-run over a pre-existing
 * link that doesn't know → null/omitted → ack.matchedBy lands null. It never drives control
 * flow, only the recorded evidence.
 *
 * EFFECTS by doc_kind:
 *   'confirmation' → fill purchase_orders.ack (V2-D2). FIRST confirmation wins the top-level
 *      ack via a guarded `.is("ack", null)` UPDATE (count exact). If that write lost the race
 *      (count 0) OR ack was already non-null, AND this receiptId is not already recorded
 *      (top-level receiptId or an ack.additional[] entry), read-modify-write append to
 *      ack.additional[]. NEAR-SINGLE-WRITER: the parse cron (single-threaded) is the routine
 *      writer of this path; manual attach (a human tap) is the only co-writer. The RMW
 *      append is not CAS-guarded, so a cron×manual race could drop ONE ack.additional
 *      entry — advisory forensic evidence only; the durable link itself is written by the
 *      guarded linked_po_id UPDATE and can never be lost here.
 *   'invoice' → guarded placed→invoiced status flip (`.eq("status","placed")`, count exact).
 *      count 0 is TOLERATED: a PO already received/reconciled just keeps the link (invoices
 *      often arrive after the truck) — the link is enough, no status regression, no throw.
 *   AUTO-PLACE precedes both (V2.1): a PO-CODE-matched confirmation/invoice for a PO still
 *      in `confirmed` first advances it confirmed→placed (autoPlaceOnEmailEvidence — machine
 *      transmission + audit), so the effects above act on the placed order in the same pass.
 *      vendor_window and manual matches never auto-place.
 * NO audit here (the link write above already audited receipt.po_linked). Best-effort reads
 * error-checked; nothing here throws to the ingest (ledger-first).
 */
export async function applyReceiptPoEffects(
  sb: ServiceClient,
  receiptId: string,
  matchedBy?: "po_code" | "vendor_window" | "manual" | null,
): Promise<void> {
  const { data: r, error } = await sb
    .from("email_receipts")
    .select("id, linked_po_id, doc_kind, from_address, received_at")
    .eq("id", receiptId)
    .maybeSingle<{ id: string; linked_po_id: string | null; doc_kind: string | null; from_address: string | null; received_at: string }>();
  if (error) {
    console.error(`[email-receipts] applyReceiptPoEffects load failed for receipt=${receiptId}:`, error.message);
    return;
  }
  if (!r || !r.linked_po_id || !r.doc_kind) return; // no link / no classification → nothing to apply.

  // AUTO-PLACE (V2.1, Juan-ratified 2026-08-10): a code-matched vendor doc for a PO
  // still in `confirmed` advances it to `placed` FIRST, so the ack/invoiced effects
  // below apply to the placed order in the same pass (one invoice email can carry
  // confirmed→placed→invoiced). PO-CODE MATCHES ONLY — a vendor+window guess or a
  // manual attach never auto-places (the human places, or the code proves it).
  if (matchedBy === "po_code" && (r.doc_kind === "confirmation" || r.doc_kind === "invoice")) {
    await autoPlaceOnEmailEvidence(sb, r.linked_po_id, r.id);
  }

  if (r.doc_kind === "confirmation") {
    const ackEntry = {
      receiptId: r.id,
      matchedBy: matchedBy ?? null,
      at: r.received_at,
      from: r.from_address,
      source: "email",
    };
    // FIRST confirmation wins the top-level ack (guarded — only while ack IS NULL).
    const { error: fillErr, count } = await sb
      .from("purchase_orders")
      .update({ ack: ackEntry }, { count: "exact" })
      .eq("id", r.linked_po_id)
      .is("ack", null);
    if (fillErr) {
      console.error(`[email-receipts] applyReceiptPoEffects ack fill failed for po=${r.linked_po_id}:`, fillErr.message);
      return;
    }
    if (count === 0) {
      // ack was already set (a prior confirmation, or a raced concurrent fill). Append this
      // receipt to ack.additional[] unless it is ALREADY recorded (idempotent re-run).
      // NEAR-SINGLE-WRITER (parse cron + manual attach) → RMW not CAS-guarded; a race can
      // drop one advisory ack.additional entry, never the durable link (documented above).
      const { data: poRow, error: readErr } = await sb
        .from("purchase_orders")
        .select("ack")
        .eq("id", r.linked_po_id)
        .maybeSingle<{ ack: { receiptId?: string; additional?: Array<{ receiptId?: string }> } | null }>();
      if (readErr) {
        console.error(`[email-receipts] applyReceiptPoEffects ack read failed for po=${r.linked_po_id}:`, readErr.message);
        return;
      }
      const ack = poRow?.ack ?? null;
      const already =
        ack != null &&
        (ack.receiptId === r.id || (ack.additional ?? []).some((a) => a.receiptId === r.id));
      if (ack == null || already) return; // nothing to append (raced-away or duplicate).
      const additional = [...(ack.additional ?? []), ackEntry];
      const { error: appendErr } = await sb
        .from("purchase_orders")
        .update({ ack: { ...ack, additional } })
        .eq("id", r.linked_po_id);
      if (appendErr) {
        console.error(`[email-receipts] applyReceiptPoEffects ack append failed for po=${r.linked_po_id}:`, appendErr.message);
      }
    }
    return;
  }

  if (r.doc_kind === "invoice") {
    // Guarded placed→invoiced flip. count 0 TOLERATED: an already received/reconciled PO
    // (or one already invoiced) keeps the link with no status regression — invoices routinely
    // arrive after the truck. The link (written by matchReceiptToPo) is the durable edge.
    const { error: flipErr } = await sb
      .from("purchase_orders")
      .update({ status: "invoiced" }, { count: "exact" })
      .eq("id", r.linked_po_id)
      .eq("status", "placed");
    if (flipErr) {
      console.error(`[email-receipts] applyReceiptPoEffects invoiced flip failed for po=${r.linked_po_id}:`, flipErr.message);
    }
  }
  // 'statement' / 'other' → no PO effect (the link alone is the record).
}

// ── (4) READS — unlinked queue + per-delivery receipt (with signed URLs) ────────────

export interface ReceiptAsset {
  filename: string;
  contentType: string;
  signedUrl: string | null; // null when the asset was omitted or signing failed
}
export interface UnlinkedReceiptView {
  id: string;
  source: "inbound" | "upload";
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string;
  locationId: string | null;
  vendorGuessId: string | null;
  /** A short-lived signed URL for the first displayable asset (raw eml or first
   *  attachment) — the queue thumbnail/preview. Null when nothing is displayable. */
  previewUrl: string | null;
  /** V2 §4/§5: the PO this receipt is linked to, if any (the confirmation/invoice→PO
   *  edge — an INDEPENDENT axis from the delivery link that keeps the row in this queue).
   *  All null when no PO is linked ("no order matched" state in the UI). */
  linkedPoId: string | null;
  poDisplayCode: string | null;
  poStatus: string | null;
  /** V2 §4: parse state ('unparsed' | 'parsed' | 'failed') + the classification when parsed.
   *  Drives the KH+ "Parse now" affordance (shown while unparsed/failed) + the doc_kind chip
   *  (shown when parsed). Batched into the existing select — no extra query. */
  parseState: "unparsed" | "parsed" | "failed";
  docKind: string | null;
}

/**
 * KH+ + location-bind: unlinked receipts AT this location OR unattributed (location_id
 * null — inbound receipts whose to-address matched nothing land here for any bound
 * viewer to triage), newest first. Each carries a short-lived signed URL for its first
 * displayable asset (raw eml text or first stored attachment — mirrors lib/photos.ts).
 *
 * QUEUE PREDICATE (V2, unchanged on purpose): `linked_delivery_id IS NULL`. The DELIVERY
 * link and the PO link are INDEPENDENT axes — a receipt that matched a PO but not a
 * delivery still belongs in this triage queue (the manager may still attach it to a door
 * count). We surface the PO link as row metadata (batch-joined) but never gate the queue
 * on it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listUnlinkedReceipts(actor: AuthContext, locationId: string): Promise<UnlinkedReceiptView[]> {
  requireLevel(actor, RECEIPT_MIN);
  // UUID guard BEFORE the .or() interpolation below — lockLocationContext returns true
  // unconditionally for all-locations actors, so without this a crafted locationId could
  // reach the PostgREST filter string (menu.ts:19 idiom; closes the injection class).
  if (!UUID_RE.test(locationId)) {
    throw new EmailReceiptError(404, "not_found", "Location not found");
  }
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new EmailReceiptError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("email_receipts")
    .select("id, source, from_address, subject, received_at, location_id, vendor_guess_id, raw_storage_path, attachment_paths, linked_po_id, parse_state, doc_kind")
    .is("linked_delivery_id", null)
    .or(`location_id.eq.${locationId},location_id.is.null`)
    .order("received_at", { ascending: false })
    .returns<Array<{ id: string; source: "inbound" | "upload"; from_address: string | null; subject: string | null; received_at: string; location_id: string | null; vendor_guess_id: string | null; raw_storage_path: string | null; attachment_paths: AttachmentPathEntry[] | null; linked_po_id: string | null; parse_state: "unparsed" | "parsed" | "failed"; doc_kind: string | null }>>();
  if (error) throw new Error(`listUnlinkedReceipts: ${error.message}`);

  const list = rows ?? [];
  // Batch-join the linked POs' display_code + status (one query over the distinct po ids;
  // never per-row). A missing PO row (deactivated/superseded) degrades to null metadata.
  const poIds = [...new Set(list.map((r) => r.linked_po_id).filter((v): v is string => v != null))];
  const poById = new Map<string, { display_code: string; status: string }>();
  if (poIds.length > 0) {
    const { data: poRows, error: poErr } = await sb
      .from("purchase_orders")
      .select("id, display_code, status")
      .in("id", poIds)
      .returns<Array<{ id: string; display_code: string; status: string }>>();
    if (poErr) throw new Error(`listUnlinkedReceipts pos: ${poErr.message}`);
    for (const p of poRows ?? []) poById.set(p.id, { display_code: p.display_code, status: p.status });
  }

  return Promise.all(
    list.map(async (r) => {
      const po = r.linked_po_id ? poById.get(r.linked_po_id) ?? null : null;
      return {
        id: r.id,
        source: r.source,
        fromAddress: r.from_address,
        subject: r.subject,
        receivedAt: r.received_at,
        locationId: r.location_id,
        vendorGuessId: r.vendor_guess_id,
        previewUrl: await signReceiptPath(sb, firstDisplayablePath(r.raw_storage_path, r.attachment_paths)),
        linkedPoId: r.linked_po_id,
        poDisplayCode: po?.display_code ?? null,
        poStatus: po?.status ?? null,
        parseState: r.parse_state,
        docKind: r.doc_kind,
      };
    }),
  );
}

// ── (5b) MANUAL PO ATTACH — KH+ (triage surface) ────────────────────────────────────

/** A candidate PO the manager may attach a receipt to (the Attach-to-order picker). */
export interface PoAttachCandidate {
  poId: string;
  displayCode: string;
  status: string;
  vendorId: string;
  vendorName: string;
  createdAt: string;
}

/**
 * KH+ + bind: the candidate POs a receipt may be attached to (V2 §5). Scoped to the
 * receipt's vendor guess (when known) and location (when known — an unattributed receipt
 * widens to any bound location), status ∈ {placed, invoiced, received} (a draft isn't
 * placed yet; a reconciled PO is closed), recent-first, capped. IDOR: the receipt itself
 * is location-masked (unattributed is reachable by any bound actor; an attributed receipt
 * out of reach → 404). Batches the vendor-name lookup. Server-loaded — the picker only
 * displays; attachReceiptToPo re-validates on submit.
 */
export async function loadPoCandidatesForReceipt(
  actor: AuthContext,
  receiptId: string,
  limit = 20,
): Promise<PoAttachCandidate[]> {
  requireLevel(actor, RECEIPT_MIN);
  const sb = getServiceRoleClient();

  const { data: r, error: rErr } = await sb
    .from("email_receipts")
    .select("id, location_id, vendor_guess_id")
    .eq("id", receiptId)
    .maybeSingle<{ id: string; location_id: string | null; vendor_guess_id: string | null }>();
  if (rErr) throw new Error(`loadPoCandidatesForReceipt receipt: ${rErr.message}`);
  if (!r) throw new EmailReceiptError(404, "not_found", "Receipt not found");
  // An attributed receipt must be in the actor's reach; an unattributed one is reachable.
  if (r.location_id != null && !lockLocationContext(actorLoc(actor), r.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Receipt not found");
  }

  let q = sb
    .from("purchase_orders")
    .select("id, display_code, status, vendor_id, created_at")
    .in("status", ["placed", "invoiced", "received"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (r.vendor_guess_id != null) q = q.eq("vendor_id", r.vendor_guess_id);
  if (r.location_id != null) {
    q = q.eq("location_id", r.location_id);
  } else {
    // Unattributed receipt: restrict to the actor's REACHABLE locations (never leak POs
    // from a location the actor can't reach). `accessibleLocations` returns the sentinel
    // "all" for level-9+ (empty locations but full reach) → no location filter; otherwise
    // the concrete assignment list → `.in()`. A non-all actor with ZERO assignments gets a
    // filter on the empty set (no candidates), NOT an unfiltered leak.
    const reach = accessibleLocations(actorLoc(actor));
    if (reach !== "all") q = q.in("location_id", reach);
  }
  const { data: pos, error: pErr } = await q.returns<
    Array<{ id: string; display_code: string; status: string; vendor_id: string; created_at: string }>
  >();
  if (pErr) throw new Error(`loadPoCandidatesForReceipt pos: ${pErr.message}`);
  const list = pos ?? [];
  if (list.length === 0) return [];

  const vendorIds = [...new Set(list.map((p) => p.vendor_id))];
  const { data: vendorRows, error: vErr } = await sb
    .from("vendors").select("id, name").in("id", vendorIds)
    .returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadPoCandidatesForReceipt vendors: ${vErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  return list.map((p) => ({
    poId: p.id,
    displayCode: p.display_code,
    status: p.status,
    vendorId: p.vendor_id,
    vendorName: vName.get(p.vendor_id) ?? "(vendor)",
    createdAt: p.created_at,
  }));
}

/**
 * KH+ manual attach of a receipt to a PO from the triage queue (V2 §5). Validates the PO
 * exists, is location-bound (404-masked), status ∈ {placed, invoiced, received}, and — when
 * the receipt carries them — agrees on vendor + location (409 `mismatch`). The link is a
 * GUARDED write (`linked_po_id IS NULL`, count exact) so a concurrent auto-match/attach
 * never double-links (409 `already_linked` on the loser). On a fresh link: applyReceiptPoEffects
 * (matchedBy "manual") + audit receipt.po_linked {matched_by: "manual"}. Does NOT touch the
 * delivery link — the two axes are independent.
 */
export async function attachReceiptToPo(actor: AuthContext, receiptId: string, poId: string): Promise<void> {
  requireLevel(actor, RECEIPT_MIN);
  const sb = getServiceRoleClient();

  const { data: r, error: rErr } = await sb
    .from("email_receipts")
    .select("id, location_id, vendor_guess_id, linked_po_id")
    .eq("id", receiptId)
    .maybeSingle<{ id: string; location_id: string | null; vendor_guess_id: string | null; linked_po_id: string | null }>();
  if (rErr) throw new Error(`attachReceiptToPo receipt: ${rErr.message}`);
  if (!r) throw new EmailReceiptError(404, "not_found", "Receipt not found");
  if (r.location_id != null && !lockLocationContext(actorLoc(actor), r.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Receipt not found");
  }
  if (r.linked_po_id) throw new EmailReceiptError(409, "already_linked", "This receipt is already linked to an order");

  const { data: po, error: pErr } = await sb
    .from("purchase_orders")
    .select("id, location_id, vendor_id, status")
    .eq("id", poId)
    .maybeSingle<{ id: string; location_id: string; vendor_id: string; status: string }>();
  if (pErr) throw new Error(`attachReceiptToPo po: ${pErr.message}`);
  // Missing OR out-of-reach → same masked 404 (no IDOR oracle).
  if (!po || !lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Order not found");
  }
  if (!["placed", "invoiced", "received"].includes(po.status)) {
    throw new EmailReceiptError(409, "not_attachable", "That order can't take a receipt in its current state");
  }
  // Agreement checks (only when the receipt actually carries the dimension).
  if (r.vendor_guess_id != null && r.vendor_guess_id !== po.vendor_id) {
    throw new EmailReceiptError(409, "mismatch", "That receipt is from a different vendor");
  }
  if (r.location_id != null && r.location_id !== po.location_id) {
    throw new EmailReceiptError(409, "mismatch", "That receipt is from a different location");
  }

  // GUARDED link write (silent-UPDATE law): claim linked_po_id only while still null.
  const { error: uErr, count } = await sb
    .from("email_receipts")
    .update({ linked_po_id: poId }, { count: "exact" })
    .eq("id", receiptId)
    .is("linked_po_id", null);
  if (uErr) throw new Error(`attachReceiptToPo link: ${uErr.message}`);
  if (count === 0) throw new EmailReceiptError(409, "already_linked", "This receipt is already linked to an order");

  await applyReceiptPoEffects(sb, receiptId, "manual");

  const { data: kindRow } = await sb
    .from("email_receipts").select("doc_kind").eq("id", receiptId)
    .maybeSingle<{ doc_kind: string | null }>();
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "receipt.po_linked", resourceTable: "email_receipts", resourceId: receiptId,
    metadata: { receipt_id: receiptId, po_id: poId, matched_by: "manual", doc_kind: kindRow?.doc_kind ?? null, location_id: po.location_id },
    ipAddress: null, userAgent: null,
  });
}

/** First displayable object path: the raw .eml if present, else the first attachment
 *  that actually stored (omitted entries carry a null path). Null when nothing stored. */
function firstDisplayablePath(rawPath: string | null, attachments: AttachmentPathEntry[] | null): string | null {
  if (rawPath) return rawPath;
  for (const a of attachments ?? []) if (a.path) return a.path;
  return null;
}

export interface DeliveryReceiptView {
  id: string;
  source: "inbound" | "upload";
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string;
  vendorGuessId: string | null;
  /** Signed URL for the raw .eml, when inbound (null otherwise / on sign failure). */
  rawUrl: string | null;
  /** Signed URLs for every stored attachment (omitted attachments carry null). */
  attachments: ReceiptAsset[];
}

/**
 * KH+ + bind (via the delivery's location): the receipt linked to a delivery, if any,
 * with signed URLs for the raw .eml + every attachment — the compare-panel payload.
 * Returns null when the delivery has no linked receipt. 404 (masked) when the delivery
 * doesn't exist or the actor isn't bound to its location.
 */
export async function loadReceiptForDelivery(actor: AuthContext, deliveryId: string): Promise<DeliveryReceiptView | null> {
  requireLevel(actor, RECEIPT_MIN);
  const sb = getServiceRoleClient();
  const { data: d, error: dErr } = await sb
    .from("vendor_deliveries")
    .select("id, location_id, email_receipt_id")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; location_id: string; email_receipt_id: string | null }>();
  if (dErr) throw new Error(`loadReceiptForDelivery delivery: ${dErr.message}`);
  if (!d) throw new EmailReceiptError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), d.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Delivery not found");
  }
  if (!d.email_receipt_id) return null;

  const { data: r, error } = await sb
    .from("email_receipts")
    .select("id, source, from_address, subject, received_at, vendor_guess_id, raw_storage_path, attachment_paths")
    .eq("id", d.email_receipt_id)
    .maybeSingle<{ id: string; source: "inbound" | "upload"; from_address: string | null; subject: string | null; received_at: string; vendor_guess_id: string | null; raw_storage_path: string | null; attachment_paths: AttachmentPathEntry[] | null }>();
  if (error) throw new Error(`loadReceiptForDelivery receipt: ${error.message}`);
  if (!r) return null;

  const attachments: ReceiptAsset[] = await Promise.all(
    (r.attachment_paths ?? []).map(async (a) => ({
      filename: a.filename,
      contentType: a.contentType,
      signedUrl: await signReceiptPath(sb, a.path),
    })),
  );
  return {
    id: r.id,
    source: r.source,
    fromAddress: r.from_address,
    subject: r.subject,
    receivedAt: r.received_at,
    vendorGuessId: r.vendor_guess_id,
    rawUrl: await signReceiptPath(sb, r.raw_storage_path),
    attachments,
  };
}

// ── (5) MANUAL LINK — KH+ ───────────────────────────────────────────────────────────

/**
 * KH+ manual link of a receipt to a delivery from the triage queue. BOTH must be
 * unlinked (409 otherwise). Location compatibility required — an unattributed receipt
 * (location_id null) INHERITS the delivery's location on link (we set location_id too);
 * an attributed receipt must match the delivery's location. Both sides set (each
 * error-checked; the delivery update rowcount-checked). Audited delivery.receipt_linked.
 */
export async function linkReceipt(actor: AuthContext, receiptId: string, deliveryId: string): Promise<void> {
  requireLevel(actor, RECEIPT_MIN);
  const sb = getServiceRoleClient();

  const { data: d, error: dErr } = await sb
    .from("vendor_deliveries")
    .select("id, location_id, email_receipt_id")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; location_id: string; email_receipt_id: string | null }>();
  if (dErr) throw new Error(`linkReceipt delivery: ${dErr.message}`);
  if (!d) throw new EmailReceiptError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), d.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Delivery not found");
  }
  if (d.email_receipt_id) throw new EmailReceiptError(409, "already_linked", "This delivery already has a receipt");

  const { data: r, error: rErr } = await sb
    .from("email_receipts")
    .select("id, location_id, linked_delivery_id")
    .eq("id", receiptId)
    .maybeSingle<{ id: string; location_id: string | null; linked_delivery_id: string | null }>();
  if (rErr) throw new Error(`linkReceipt receipt: ${rErr.message}`);
  // Missing OR (attributed but out of the actor's reach) → masked 404. An unattributed
  // receipt is reachable by any location-bound actor.
  if (!r) throw new EmailReceiptError(404, "not_found", "Receipt not found");
  if (r.location_id != null && !lockLocationContext(actorLoc(actor), r.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Receipt not found");
  }
  if (r.linked_delivery_id) throw new EmailReceiptError(409, "already_linked", "This receipt is already linked");
  // An attributed receipt must match the delivery's location.
  if (r.location_id != null && r.location_id !== d.location_id) {
    throw new EmailReceiptError(409, "location_mismatch", "Receipt and delivery are at different locations");
  }

  // LINK ORDER (race-safe): claim the RECEIPT side FIRST, count-checked — a loser aborts
  // having touched nothing. An unattributed receipt inherits the delivery's location on
  // this same claim. THEN the delivery side, count-checked + 23505-guarded (the 0171
  // vendor_deliveries_email_receipt_uq index is the DB arbiter). If the delivery side
  // loses (count 0 OR 23505), COMPENSATE by releasing the receipt claim, then 409.
  const receiptUpdate: { linked_delivery_id: string; location_id?: string } = { linked_delivery_id: deliveryId };
  if (r.location_id == null) receiptUpdate.location_id = d.location_id;
  const { error: ruErr, count: rCount } = await sb
    .from("email_receipts")
    .update(receiptUpdate, { count: "exact" })
    .eq("id", r.id)
    .is("linked_delivery_id", null);
  if (ruErr) throw new Error(`linkReceipt receipt update: ${ruErr.message}`);
  if (rCount === 0) throw new EmailReceiptError(409, "already_linked", "This receipt is already linked");

  const { error: duErr, count } = await sb
    .from("vendor_deliveries")
    .update({ email_receipt_id: r.id }, { count: "exact" })
    .eq("id", d.id)
    .is("email_receipt_id", null);
  if (duErr || count === 0) {
    await compensateReceiptClaim(sb, r.id, deliveryId);
    if (duErr && duErr.code !== PG_UNIQUE_VIOLATION) throw new Error(`linkReceipt delivery update: ${duErr.message}`);
    throw new EmailReceiptError(409, "already_linked", "This delivery already has a receipt");
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.receipt_linked", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { receipt_id: r.id, location_id: d.location_id, source: "manual", inherited_location: r.location_id == null },
    ipAddress: null, userAgent: null,
  });
}

// ── (6) MATCH ATTESTATION — KH+ attest / AGM+ override ──────────────────────────────

export type MatchVerdict = "matched" | "discrepant";
type MatchState = "counted_only" | "matched" | "discrepant" | "override";

/** Load a delivery for an attestation action, bind, and require a linked receipt.
 *  Returns the delivery header (id, location_id, match_state, note, email_receipt_id). */
async function requireAttestableDelivery(
  sb: ServiceClient,
  actor: AuthContext,
  deliveryId: string,
): Promise<{ id: string; location_id: string; match_state: MatchState; note: string | null; email_receipt_id: string | null }> {
  const { data: d, error } = await sb
    .from("vendor_deliveries")
    .select("id, location_id, match_state, note, email_receipt_id")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; location_id: string; match_state: MatchState; note: string | null; email_receipt_id: string | null }>();
  if (error) throw new Error(`requireAttestableDelivery: ${error.message}`);
  if (!d) throw new EmailReceiptError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), d.location_id)) {
    throw new EmailReceiptError(404, "not_found", "Delivery not found");
  }
  return d;
}

/** Compose a note append (read-append; never clobber — mirrors resolveCredit). */
function appendNote(existing: string | null, addition: string): string {
  return existing ? existing + "\n" + addition : addition;
}

/**
 * KH+ + bind: attest a two-way-match verdict on a delivery from the visual compare.
 * REQUIRES a linked receipt (409 no_receipt). The delivery must be match_state
 * 'counted_only' OR be re-attestable from 'matched'/'discrepant' (re-attestation is
 * allowed — a verdict is an ASSESSMENT, not append-only state; only 'override' is
 * terminal-locked). Updates match_state (rowcount-checked). When 'discrepant', a note
 * (if supplied) is APPENDED into vendor_deliveries.note (never clobbered). Audited
 * delivery.match_attested with { verdict }.
 */
export async function attestMatch(
  actor: AuthContext,
  deliveryId: string,
  verdict: MatchVerdict,
  note?: string,
): Promise<void> {
  requireLevel(actor, RECEIPT_MIN);
  if (verdict !== "matched" && verdict !== "discrepant") {
    throw new EmailReceiptError(400, "invalid_verdict", "Verdict must be matched or discrepant");
  }
  const sb = getServiceRoleClient();
  const d = await requireAttestableDelivery(sb, actor, deliveryId);
  if (!d.email_receipt_id) throw new EmailReceiptError(409, "no_receipt", "This delivery has no linked receipt to compare");
  // Re-attestable from counted_only/matched/discrepant; an override is terminal.
  if (d.match_state === "override") {
    throw new EmailReceiptError(409, "already_overridden", "This delivery's match is overridden");
  }

  const trimmedNote = note?.trim() || null;
  const update: { match_state: MatchVerdict; note?: string } = { match_state: verdict };
  // A discrepancy note is appended (never clobber); no note change when none supplied
  // or when the verdict is 'matched'.
  if (verdict === "discrepant" && trimmedNote != null) update.note = appendNote(d.note, trimmedNote);

  const { error: uErr, count } = await sb
    .from("vendor_deliveries")
    .update(update, { count: "exact" })
    .eq("id", deliveryId);
  if (uErr) throw new Error(`attestMatch update: ${uErr.message}`);
  if (count === 0) throw new EmailReceiptError(404, "not_found", "Delivery not found");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.match_attested", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { verdict, prior_state: d.match_state, location_id: d.location_id, receipt_id: d.email_receipt_id, noted: verdict === "discrepant" && trimmedNote != null },
    ipAddress: null, userAgent: null,
  });
}

/**
 * AGM+ (6): override a delivery's match verdict — the escalation path when a manager
 * accepts a discrepancy or forces a resolution outside the KH attestation. Note is
 * REQUIRED (non-empty, 400 otherwise) and APPENDED into vendor_deliveries.note (never
 * clobbered). match_state → 'override'; rowcount-checked. Audited delivery.match_overridden.
 */
export async function overrideMatch(actor: AuthContext, deliveryId: string, note: string): Promise<void> {
  requireLevel(actor, RECEIPT_OVERRIDE_MIN);
  const trimmedNote = note?.trim() || null;
  if (!trimmedNote) throw new EmailReceiptError(400, "note_required", "An override requires a note");
  const sb = getServiceRoleClient();
  const d = await requireAttestableDelivery(sb, actor, deliveryId);

  const { error: uErr, count } = await sb
    .from("vendor_deliveries")
    .update({ match_state: "override", note: appendNote(d.note, trimmedNote) }, { count: "exact" })
    .eq("id", deliveryId);
  if (uErr) throw new Error(`overrideMatch update: ${uErr.message}`);
  if (count === 0) throw new EmailReceiptError(404, "not_found", "Delivery not found");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.match_overridden", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { prior_state: d.match_state, location_id: d.location_id },
    ipAddress: null, userAgent: null,
  });
}
