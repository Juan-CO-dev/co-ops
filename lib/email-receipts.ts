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
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

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

  return { receiptId: inserted.id };
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
}

/**
 * KH+ + location-bind: unlinked receipts AT this location OR unattributed (location_id
 * null — inbound receipts whose to-address matched nothing land here for any bound
 * viewer to triage), newest first. Each carries a short-lived signed URL for its first
 * displayable asset (raw eml text or first stored attachment — mirrors lib/photos.ts).
 */
export async function listUnlinkedReceipts(actor: AuthContext, locationId: string): Promise<UnlinkedReceiptView[]> {
  requireLevel(actor, RECEIPT_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new EmailReceiptError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("email_receipts")
    .select("id, source, from_address, subject, received_at, location_id, vendor_guess_id, raw_storage_path, attachment_paths")
    .is("linked_delivery_id", null)
    .or(`location_id.eq.${locationId},location_id.is.null`)
    .order("received_at", { ascending: false })
    .returns<Array<{ id: string; source: "inbound" | "upload"; from_address: string | null; subject: string | null; received_at: string; location_id: string | null; vendor_guess_id: string | null; raw_storage_path: string | null; attachment_paths: AttachmentPathEntry[] | null }>>();
  if (error) throw new Error(`listUnlinkedReceipts: ${error.message}`);

  const list = rows ?? [];
  return Promise.all(
    list.map(async (r) => ({
      id: r.id,
      source: r.source,
      fromAddress: r.from_address,
      subject: r.subject,
      receivedAt: r.received_at,
      locationId: r.location_id,
      vendorGuessId: r.vendor_guess_id,
      previewUrl: await signReceiptPath(sb, firstDisplayablePath(r.raw_storage_path, r.attachment_paths)),
    })),
  );
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
