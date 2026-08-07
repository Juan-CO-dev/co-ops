# Vendor Ordering V2 — Design (channels wake on the PO spine)

**Date:** 2026-08-06 · **Status:** for Juan's spec review · **Owner:** CC
**Lineage:** V1 design (`2026-08-06-vendor-ordering-v1-design.md`, shipped PR #242 `42342c9`, mig 0174) → Juan's V2 decisions (this doc §1). V2 = the email/SMS/parse legs the V1 seams were cut for. Everything additive, everything dormant-until-errand (Resend DNS · Twilio number); day-one behavior identical until config lands.

## 1. Decisions register (Juan, 2026-08-06)

- **V2-D1 — Two-tap send.** Confirm freezes the snapshot (unchanged); for auto-tier vendors a **Send to vendor** affordance then appears showing the exact rendered email (to/from/subject/body). Sending transmits + auto-marks placed with `provider_message_id`. A mis-tapped Confirm never emails a vendor.
- **V2-D2 — Acknowledged = evidence on placed, NOT a new status.** A matched inbound confirmation fills `purchase_orders.ack` (jsonb: receiptId, matchedBy key, at, excerpt) and the PO renders "placed · vendor confirmed ✓". The status CHECK is untouched; `invoiced` flips when an invoice-classified document attaches (placed→invoiced, guarded single UPDATE). Honors V1-D3's intent (acknowledgment becomes real + data-backed) without widening the state machine.
- **V2-D3 — Auto email targets ALL active email-type `vendor_ordering_details` rows** (rep + orders desk both see it). FROM/reply-to = the ordering location's alias (`locations.receipt_email_address`) per V1 §5b.2 — replies self-sort to the right store. Juan curates the rows at vendor-seeding time.
- **V2-D4 — Multi-delivery-per-PO stays deferred (rare: shorts, not split orders). Instead: redelivery credit closure at intake.** His words: "we capture what we have at intake, and then have a backend process (the credit) making sure we get our items one way or the other… the resent order we intake the next day gets attached to the already received but short order… and the system kills the credit." → the intake form, when open credits exist for vendor+location, offers "makes up a short": picking credits links them to THIS delivery and resolves them `resolved_redelivered` with `resolved_by_delivery_id` as proof. Trail chains new delivery → credit → original delivery → original PO. The PO's own 409-on-second-claim behavior is unchanged.
- **V2-D5 — SMS legs build now, dormant** (V1 §5c.3 executed): `sms_messages` ledger + Twilio inbound webhook (503 until secrets exist) + outbound seam. Wakes on the Twilio-number errand with zero rebuild.

## 2. Data model (migration 0175 — additive only)

1. **`sms_messages`** (ledger-first, mirrors `email_receipts` discipline): id, direction `inbound|outbound`, provider_sid text null **unique where not null** (Twilio idempotency), from_number, to_number, body text null, media jsonb null (storage paths), location_id FK null, vendor_guess_id FK null (E.164 match vs `vendor_contacts.phone`), linked_po_id FK null, occurred_at timestamptz, created_at. RLS deny-all house idiom.
2. **`email_receipts` extensions:** `linked_po_id uuid null references purchase_orders(id)` (+ index) — the confirmation/invoice→PO edge; `doc_kind text null check (doc_kind in ('confirmation','invoice','statement','other'))` — parse classification as a queryable column (`parsed_json` keeps the full extraction).
3. **`vendor_credits` extensions:** `resolved_by_delivery_id uuid null references vendor_deliveries(id)`; status CHECK gains `resolved_redelivered` (drop + re-add constraint; existing rows unaffected).
4. **No new vendor/location columns.** Outbound FROM reuses `locations.receipt_email_address` (one alias column serves both directions). Auto-tier availability is derived, not stored (§6).

## 3. Outbound — the auto email adapter (two-tap)

- **Render:** subject `Order {display_code} — {TENANT_NAME} {location.name}`; body = the frozen snapshot's lines (qty · unit label · SKU name · item number), the PO code repeated in-body (V1 §5b.3 key), location ship-to address block, and the store's reply-to. Plain-text-first with the existing `renderEmailLayout` shell; NOTHING user-generated beyond line notes (escaped — house DOM law applies to inbound render, but outbound escapes too).
- **Send path:** `lib/po-email.ts sendOrderEmail(actor, poId)` — confirmed-status-only (409 otherwise); recipients = active email-type ordering details (V2-D3, 409 `no_email_target` when zero); `lib/email.ts sendEmail` extended to accept `to: string[]`, `from`, `replyTo` overrides (existing callers unchanged — defaults preserved). Success → `markPlaced` machinery records the transmission (channel email, target = joined recipients, sent_by = actor, `provider_message_id` = Resend id) + status placed. **Failure → error surfaced, PO stays confirmed, manual affordances remain** (no pipe failure blocks ordering — standing law).
- **UI (PoPanel):** auto-tier transmit block = email preview card (to/from/subject/lines) + Send to vendor (busy-guarded, double-send guarded server-side: placed-status re-check makes the second tap a 409) + the ever-present manual fallback affordances.

## 4. Inbound — matching + parse

- **Matching precedence (V1 §5b.4, now executed):** on ingest AND on parse completion, attempt PO link: **(1) PO display code** in subject/body — deterministic regex `[A-Z0-9]{1,8}-\d{8}-[A-Z0-9]{1,6}(?:-\d+)?` validated against real POs (vendor+location must agree when known) → **(2) to-alias** (location attribution, already shipped) narrowing + **(3) parse-time ship-to** vs `locations.address` → **(4) vendor + open-PO date window, single-candidate rule** (auto-link ONLY when exactly one candidate; else triage — the shipped P2 law). Links write `email_receipts.linked_po_id` (rowcount-checked).
- **Effects of a link:** doc_kind `confirmation` → fill `purchase_orders.ack` (V2-D2) when empty (first confirmation wins; later ones append to a jsonb array `ack.additional`). doc_kind `invoice` → guarded placed→invoiced flip (tolerant: already received/reconciled POs just gain the link, no status regression — invoices often arrive after the truck).
- **Parse engine:** `lib/receipt-parse.ts` (server-only) calling the Anthropic API (`ANTHROPIC_API_KEY`, model env `AI_PARSE_MODEL` default `claude-sonnet-4-6`) with the stored raw eml/attachments (PDF/image native). Extraction contract: `{docKind, poCode?, invoiceNumber?, shipTo?, vendorName?, totalCents?, lines: [{description, qty?, unit?, unitPriceCents?, extendedCents?}]}` → `parsed_json`, `parse_state` parsed|failed, doc_kind column. **The /api/ai 501 stub is NOT this** — it stays reserved for the Phase-6 client proxy; parse is a server lib.
- **Trigger:** cron `app/api/cron/parse-receipts` (CRON_SECRET pattern, 503 dormant-safe; also skips 503 when no ANTHROPIC_API_KEY) sweeping `parse_state='unparsed'` inbound rows oldest-first, batch-capped; plus a manual "Parse now" affordance on the triage queue (KH+). Parse failures mark `failed` with reason in parsed_json — retryable manually, never retried infinitely.
- **LLM output = untrusted vendor content:** rendered as text/data ONLY (no DOM mounting, no link hrefs from parse output); numeric fields validated finite/[0..) before storage-adjacent math.

## 5. Three-way match + reconcile upgrade (read-time, advisory)

`lib/po-match.ts buildThreeWayView(actor, poId)` derives — NO schema: frozen `confirmed_snapshot` (ordered) vs received delivery lines (counted at door) vs linked invoice `parsed_json.lines` (billed). Line-level joins by SKU where possible (invoice lines fuzzy-join by item number then name-contains; unjoined rows render as advisory "unmatched invoice line"). Surfaced on the PO detail as the [Three-way] section: ordered/received/billed columns + variance chips (billed>received = flag; short-received with open credit = already-tracked chip). **Advisory-null law: missing legs render "no invoice yet", never fabricate.** `markReconciled` gains no new hard gates (credits gate stays the only blocker) — the three-way view is the manager's evidence, the human stays the judge (V1 thesis: order generation is the value; judgment is Juan's).

## 6. Dormancy & gating matrix

| Capability | Wakes when | Gate expression |
|---|---|---|
| Auto tier selectable (admin) | DNS verified + alias set | `EMAIL_FROM` domain ≠ resend.dev AND ordering location has `receipt_email_address` (server-derived per location, replaces V1's static disabled state) |
| Send to vendor (PoPanel) | same | same check at send time (409 `email_dormant`) — UI hides, server re-checks |
| Inbound matching | DNS + aliases (already-shipped webhook) | no new gate — pipeline live, just unfed |
| Parse cron | `ANTHROPIC_API_KEY` present | 503 dormant-safe |
| SMS webhook | `TWILIO_AUTH_TOKEN` present | 503 dormant-safe; signature-verified (X-Twilio-Signature HMAC) when live |
| Outbound SMS | V2 seam only — adapter fn + config, no UI send button until number provisioned | — |
| Redelivery credit closure | **live immediately** (no external dep) | — |

## 7. Redelivery credit closure at intake (V2-D4 — live day one)

Intake form (ReceivingForm), when `loadVendorOutstandingCredits` returns open credits for vendor+location: a default-collapsed "Makes up a short?" section (D-doctrine) listing open credit rows (item · qty · age · origin delivery/PO code). Manager checks the ones THIS truck fulfills → on delivery submit, each checked credit resolves `resolved_redelivered` + `resolved_by_delivery_id` + audit `credit.resolved {outcome: redelivered, resolving_delivery_id}` (rowcount-checked; already-resolved race → skip + note, never block the intake — walk-data-sacred pattern). **Gate: KH+** (evidence-backed by the delivery itself), while judgment outcomes (credit/refund/write-off) stay AGM+ — column-level-style split documented in lib/credits.ts.

## 8. Non-goals (V2)

Full multi-delivery-per-PO lifecycle (V2.5 if split orders become real) · guide-sequence data entry + MOXē import (V3) · barcode (V3) · PFG EDI (V4) · outbound SMS UI/send button (needs the Twilio number — seam only) · auto-parse of MANUAL uploads (inbound only first; manual uploads keep the existing flow + can be parsed via "Parse now") · vendor-facing portal/links · any auto-ordering (human confirms, always).

## 9. Rollout

0175 additive-only. Ships fully dormant except §7 (credit closure — live, zero-dep). Juan's errand order determines wake sequence: (1) DNS verify + set aliases in locations + flip first vendor to auto → email leg live; (2) ANTHROPIC key already present → parse cron live on first inbound; (3) Twilio number → SMS inbound live. Seed guidance for tomorrow's vendor pass: ordering-details email rows = the addresses orders should really go to (V2-D3 sends to ALL active email rows).
