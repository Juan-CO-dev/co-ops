/**
 * SMS-message ledger — the inbound-text side of the vendor channel legs (Vendor Ordering
 * V2 §5c / V2-D5; migration 0175 sms_messages). SERVER-ONLY, service-role client. DORMANT
 * until the Twilio-number errand lands: the webhook route (app/api/webhooks/twilio-inbound)
 * 503s until TWILIO_AUTH_TOKEN exists; this module is unfed until then but ships now so the
 * leg wakes with zero rebuild.
 *
 * ── LEDGER-FIRST (mirrors lib/email-receipts.ts ingestInboundReceipt) ──────────────────
 * ingestInboundSms INSERTs the sms_messages row FIRST (direction 'inbound'), and only then
 * does best-effort enrichment (vendor guess, PO match, ack fill). A DB write failure THROWS
 * (the route → 500 → Twilio retries); enrichment failures NEVER poison the ledger (the row is
 * already durable — a failed match just leaves the text in triage-equivalent limbo, re-derivable).
 *
 * IDEMPOTENCY: Twilio retries on any non-2xx. provider_sid (the Twilio MessageSid) is the
 * idempotency key — a 23505 on the 0175 sms_messages_provider_sid_uq index means a concurrent
 * retry won; we re-select and return the winner's id (mirrors the email external_id idiom).
 *
 * ── MEDIA (MMS) ────────────────────────────────────────────────────────────────────────
 * Media URLs are STORED (media jsonb = {urls: [...]}), NOT fetched, in V1 of this leg. Twilio
 * media URLs require authenticated fetch (basic-auth with the account SID/token) and the
 * outbound adapter — the only place we hold live Twilio creds in a request path — is a seam
 * only (lib/po-sms.ts). So we record the URLs for forensics/later-fetch and move on; no
 * unauthenticated fetch, no bucket write, until the outbound leg wakes.
 *
 * ── APPEND-ONLY + UNTRUSTED CONTENT ────────────────────────────────────────────────────
 * No DELETEs. The body is untrusted vendor content: it is TEXT ONLY at every render surface
 * (the PO trail renders it as a text node — never markup/href). Here it is used solely as
 * match text (extractPoCodes) and stored verbatim.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { extractPoCodes } from "@/lib/email-receipts-matching-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Postgres unique-violation code — the 0175 sms_messages_provider_sid_uq index arbiter. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * PO statuses an inbound SMS may link to. DELIBERATELY NARROWER than the email module's
 * PO_LINKABLE_STATUSES (which also allows received/reconciled): a terse vendor text with a
 * PO code is treated as a CONFIRMATION of an order that is still in flight (spec §5c.3 names
 * placed|invoiced). A received/reconciled PO is closed — a stray text about it is not a
 * confirmation to record. Kept as a Set for O(1) membership.
 */
const SMS_PO_LINKABLE_STATUSES = new Set(["placed", "invoiced"]);

export interface IngestInboundSmsInput {
  /** Twilio MessageSid — the idempotency key (null-tolerant, but Twilio always sends it). */
  providerSid: string | null;
  fromNumber: string;
  toNumber: string;
  body: string | null;
  /** MMS media URLs (stored, not fetched in V1 — see module header). */
  mediaUrls: string[];
  /** ISO timestamp of when the message occurred (Twilio has no timestamp field on the inbound
   *  webhook — the route passes receive-time now()). */
  occurredAt: string;
}

/**
 * Ingest one inbound SMS into the ledger, then best-effort attribute a vendor + link a PO.
 * LEDGER-FIRST: the row is inserted first; enrichment is fail-open. Returns the row id + the
 * linked PO id (null when nothing matched). Called by the Twilio inbound webhook route.
 */
export async function ingestInboundSms(
  input: IngestInboundSmsInput,
): Promise<{ smsId: string; linkedPoId: string | null }> {
  const sb = getServiceRoleClient();

  const providerSid = input.providerSid?.trim() || null;

  // IDEMPOTENT REPLAY: a prior row under this provider_sid means Twilio re-delivered (it
  // retries on our non-2xx). Return the existing id BEFORE inserting — no duplicate row.
  if (providerSid) {
    const { data: existing, error: exErr } = await sb
      .from("sms_messages")
      .select("id, linked_po_id")
      .eq("provider_sid", providerSid)
      .maybeSingle<{ id: string; linked_po_id: string | null }>();
    if (exErr) throw new Error(`ingestInboundSms idempotency lookup: ${exErr.message}`);
    if (existing) return { smsId: existing.id, linkedPoId: existing.linked_po_id };
  }

  // Vendor guess by the from-number (E.164 last-10 match vs vendor_contacts.phone). Best-effort:
  // a lookup failure leaves the guess null (never blocks the ledger insert).
  const vendorGuessId = await guessVendorByFromNumber(sb, input.fromNumber);

  // LOCATION: null in V1 of this leg. Unlike inbound EMAIL (which attributes a location by the
  // to-alias), the Twilio number is SHARED across stores — the to_number carries no per-store
  // attribution. So location_id stays null until a real multi-number scheme exists (deferred).
  const locationId: string | null = null;

  const media = input.mediaUrls.length > 0 ? { urls: input.mediaUrls } : null;

  const { data: inserted, error: insErr } = await sb
    .from("sms_messages")
    .insert({
      direction: "inbound",
      provider_sid: providerSid,
      from_number: input.fromNumber,
      to_number: input.toNumber,
      body: input.body?.trim() || null,
      media,
      location_id: locationId,
      vendor_guess_id: vendorGuessId,
      occurred_at: input.occurredAt,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) {
    // IDEMPOTENCY RACE: a concurrent retry won the provider_sid_uq index (23505). Re-select by
    // provider_sid and return the winner's id (mirrors ingestInboundReceipt's race handling).
    if (providerSid && insErr.code === PG_UNIQUE_VIOLATION) {
      const { data: raced, error: raceErr } = await sb
        .from("sms_messages")
        .select("id, linked_po_id")
        .eq("provider_sid", providerSid)
        .maybeSingle<{ id: string; linked_po_id: string | null }>();
      if (raceErr) throw new Error(`ingestInboundSms idempotency re-select: ${raceErr.message}`);
      if (raced) return { smsId: raced.id, linkedPoId: raced.linked_po_id };
    }
    throw new Error(`ingestInboundSms insert: ${insErr.message}`);
  }
  if (!inserted) throw new Error("ingestInboundSms insert returned no row");

  // Best-effort PO match + ack effect. FAIL-OPEN (ledger-first): a failure here logs and
  // returns — the row is already durable. CODE-MATCH ONLY (no vendor-window fallback): texts
  // are terse, and a single-candidate vendor-window guess on an SMS is too weak a signal to
  // auto-confirm an order (a driver texting "here" would false-link). Deliberate narrowing.
  let linkedPoId: string | null = null;
  try {
    linkedPoId = await matchSmsToPo(sb, {
      smsId: inserted.id,
      body: input.body,
      vendorGuessId,
      fromNumber: input.fromNumber,
      occurredAt: input.occurredAt,
    });
  } catch (poErr) {
    console.error(
      `[sms-messages] PO matching failed for sms=${inserted.id} (ingest unaffected):`,
      poErr instanceof Error ? poErr.message : poErr,
    );
  }

  await audit({
    actorId: null,
    actorRole: null,
    action: "sms.received",
    resourceTable: "sms_messages",
    resourceId: inserted.id,
    metadata: {
      sms_id: inserted.id,
      from_number: input.fromNumber,
      vendor_guess_id: vendorGuessId,
      linked_po_id: linkedPoId,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { smsId: inserted.id, linkedPoId };
}

/**
 * Normalize a phone number to its last-10 digits for matching. ASSUMPTION: US numbers —
 * strip every non-digit, then take the trailing 10 (drops a leading "1" country code and any
 * "+"/formatting). Returns null when fewer than 10 digits remain (unmatched, never a false
 * partial match). This is a deliberate US-only simplification for V1 (CO's vendors are US);
 * an international scheme would keep the full E.164 and match exact.
 */
export function normalizePhoneLast10(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Guess a vendor from an inbound from-number by matching its last-10 digits against
 * vendor_contacts.phone (active contacts with a non-null phone). Returns a single vendor id
 * ONLY when every match points at ONE vendor; null when the number is empty/unmatched OR
 * ambiguous across vendors (we never guess wrong — a bad guess would mis-attribute a text).
 * Batch-loads the active contacts with a phone (small table; normalize both sides in memory,
 * since Postgres has no last-10 index and the set is tiny).
 */
async function guessVendorByFromNumber(sb: ServiceClient, fromNumber: string): Promise<string | null> {
  const target = normalizePhoneLast10(fromNumber);
  if (!target) return null;

  const { data: contacts, error } = await sb
    .from("vendor_contacts")
    .select("vendor_id, phone")
    .eq("active", true)
    .not("phone", "is", null)
    .returns<Array<{ vendor_id: string; phone: string | null }>>();
  if (error) throw new Error(`guessVendorByFromNumber: ${error.message}`);

  const vendorIds = new Set<string>();
  for (const c of contacts ?? []) {
    if (normalizePhoneLast10(c.phone) === target) vendorIds.add(c.vendor_id);
  }
  return vendorIds.size === 1 ? [...vendorIds][0]! : null; // null when ambiguous/unmatched
}

interface SmsMatchInput {
  smsId: string;
  body: string | null;
  vendorGuessId: string | null;
  fromNumber: string;
  occurredAt: string;
}

/**
 * Resolve + link the ONE purchase order an inbound SMS confirms, then fill the PO's ack.
 * CODE-MATCH ONLY (spec §5c.3): extractPoCodes(body) → one batched display_code lookup → a
 * candidate is VALID iff status ∈ {placed, invoiced} AND (vendor agrees when guessed). Exactly
 * ONE distinct valid PO → link + ack; two-or-more distinct → null (ambiguous → no guess).
 *
 * The link write is a GUARDED UPDATE on sms_messages (`linked_po_id IS NULL`, count exact) so
 * a concurrent re-run never double-links. Returns the linked PO id (or null). Best-effort: a
 * query error returns null (matching never poisons the ingest).
 */
async function matchSmsToPo(sb: ServiceClient, sms: SmsMatchInput): Promise<string | null> {
  const codes = extractPoCodes(sms.body ?? "");
  if (codes.length === 0) return null; // no code → no match (no vendor-window fallback for SMS).

  const { data: pos, error } = await sb
    .from("purchase_orders")
    .select("id, status, vendor_id")
    .in("display_code", codes)
    .returns<Array<{ id: string; status: string; vendor_id: string }>>();
  if (error) {
    console.error(`[sms-messages] matchSmsToPo code lookup failed for sms=${sms.smsId}:`, error.message);
    return null;
  }
  const valid = (pos ?? []).filter(
    (p) =>
      SMS_PO_LINKABLE_STATUSES.has(p.status) &&
      (sms.vendorGuessId == null || p.vendor_id === sms.vendorGuessId),
  );
  const distinct = new Set(valid.map((p) => p.id));
  if (distinct.size !== 1) return null; // zero or ambiguous → no link (the code key never guesses).
  const poId = [...distinct][0]!;

  // GUARDED LINK WRITE (silent-UPDATE law): claim linked_po_id only while it is still null.
  const { error: uErr, count } = await sb
    .from("sms_messages")
    .update({ linked_po_id: poId }, { count: "exact" })
    .eq("id", sms.smsId)
    .is("linked_po_id", null);
  if (uErr) {
    console.error(`[sms-messages] matchSmsToPo link write failed for sms=${sms.smsId}:`, uErr.message);
    return null;
  }
  if (count === 0) return poId; // already linked (raced/re-run) — still return the target, no re-ack.

  // A linked inbound SMS carrying a PO code IS a confirmation by default (spec §5c.3) — fill
  // the PO's ack (SMS variant of applyReceiptPoEffects' confirmation branch; source 'sms').
  await fillPoAckFromSms(sb, poId, {
    smsId: sms.smsId,
    matchedBy: "po_code",
    at: sms.occurredAt,
    from: sms.fromNumber,
    source: "sms",
  });
  return poId;
}

/** One ack evidence entry (V2-D2 shape — parallel to email's ackEntry in lib/email-receipts.ts). */
interface SmsAckEntry {
  smsId: string;
  matchedBy: "po_code";
  at: string;
  from: string;
  source: "sms";
}

/**
 * Fill purchase_orders.ack from a matched inbound SMS (the SMS variant of the 'confirmation'
 * effect in applyReceiptPoEffects — see lib/email-receipts.ts). It does NOT read email_receipts
 * (SMS has no receipt row), so it can't share that function. IDEMPOTENT + guarded:
 *   - FIRST confirmation wins the top-level ack via `.is("ack", null)` (count exact).
 *   - if that lost the race (count 0) OR ack was already set, append to ack.additional[]
 *     unless this smsId is ALREADY recorded (idempotent re-run).
 * NEAR-SINGLE-WRITER posture (same as email): the append RMW is not CAS-guarded, so a
 * race could drop ONE advisory ack.additional entry — never the durable linked_po_id (that
 * was written by the guarded UPDATE above). NO invoice flip for SMS (a terse text is a
 * confirmation, not an invoice document — invoices ride email/PDF). Best-effort: reads are
 * error-checked; nothing here throws to the ingest (ledger-first).
 */
async function fillPoAckFromSms(sb: ServiceClient, poId: string, entry: SmsAckEntry): Promise<void> {
  const { error: fillErr, count } = await sb
    .from("purchase_orders")
    .update({ ack: entry }, { count: "exact" })
    .eq("id", poId)
    .is("ack", null);
  if (fillErr) {
    console.error(`[sms-messages] fillPoAckFromSms ack fill failed for po=${poId}:`, fillErr.message);
    return;
  }
  if (count && count > 0) return; // first confirmation won the top-level ack.

  // ack already set (a prior confirmation from email/sms, or a raced fill). Append this sms to
  // ack.additional[] unless it is ALREADY recorded (idempotent re-run).
  const { data: poRow, error: readErr } = await sb
    .from("purchase_orders")
    .select("ack")
    .eq("id", poId)
    .maybeSingle<{ ack: { smsId?: string; receiptId?: string; additional?: Array<{ smsId?: string }> } | null }>();
  if (readErr) {
    console.error(`[sms-messages] fillPoAckFromSms ack read failed for po=${poId}:`, readErr.message);
    return;
  }
  const ack = poRow?.ack ?? null;
  if (ack == null) return; // raced away to null (shouldn't happen; nothing to append safely).
  const already =
    ack.smsId === entry.smsId || (ack.additional ?? []).some((a) => a.smsId === entry.smsId);
  if (already) return; // duplicate re-run — no-op.
  const additional = [...(ack.additional ?? []), entry];
  const { error: appendErr } = await sb
    .from("purchase_orders")
    .update({ ack: { ...ack, additional } })
    .eq("id", poId);
  if (appendErr) {
    console.error(`[sms-messages] fillPoAckFromSms ack append failed for po=${poId}:`, appendErr.message);
  }
}
