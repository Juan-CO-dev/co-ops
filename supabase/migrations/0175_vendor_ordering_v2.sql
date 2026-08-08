-- 0175: vendor ordering V2 — channels wake on the PO spine
-- Spec: docs/superpowers/specs/2026-08-06-vendor-ordering-v2-design.md §2
-- Plan: Task 1 (migration only — additive schema; all channel legs dormant until errands)
--
-- Append-only: sms_messages / email_receipts / vendor_credits rows are never deleted by
-- the application. sms_messages is ledger-first (mirrors email_receipts discipline);
-- credit extensions append a new resolution column + widen the status domain — no row rewrites.
--
-- Dormancy note: sms_messages is unfed until the Twilio-number errand lands. The table +
-- indexes ship now so the V2 SMS webhook (503-safe until TWILIO_AUTH_TOKEN present) and
-- outbound seam require zero rebuild. Day-one behavior is identical to V1 until config lands.
--
-- RLS posture: deny-all on sms_messages (service-role writes; same 0172/0174 idiom).
-- email_receipts and vendor_credits already carry deny-all posture from 0170/0168 respectively;
-- the ALTER COLUMN extensions here do not touch their RLS. No stacked policies beyond the
-- revoke posture on sms_messages; the revoke is sufficient (0174 law).
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY;
--   REVOKE ALL ON … FROM anon, authenticated;
--   REVOKE ALL ON … FROM public;

-- ── (1) SMS MESSAGES (ledger-first, dormant until Twilio) ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'inbound' = vendor reply/text received; 'outbound' = order sent via SMS.
  direction        text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  -- Twilio message SID; null until the message is transmitted/received via Twilio.
  -- Partial unique index below enforces idempotency: no two rows share a non-null SID.
  provider_sid     text        NULL,
  from_number      text        NOT NULL,
  to_number        text        NOT NULL,
  body             text        NULL,
  -- Storage paths for MMS attachments (mirrors email_receipts.attachment_paths discipline).
  media            jsonb       NULL,
  -- null until attributed to a location (E.164 match vs vendor_contacts.phone).
  location_id      uuid        NULL REFERENCES public.locations(id),
  -- E.164 match of from_number vs vendor_contacts.phone; null when unmatched.
  vendor_guess_id  uuid        NULL REFERENCES public.vendors(id),
  -- Set when matched to a PO (inbound confirmation or outbound order placement).
  linked_po_id     uuid        NULL REFERENCES public.purchase_orders(id),
  occurred_at      timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Twilio idempotency: mirrors the 0171 partial-unique idiom for email_receipts.external_id.
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_provider_sid_uq
  ON public.sms_messages (provider_sid)
  WHERE provider_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_messages_linked_po_ix
  ON public.sms_messages (linked_po_id);

CREATE INDEX IF NOT EXISTS sms_messages_from_number_ix
  ON public.sms_messages (from_number);

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_messages FROM anon, authenticated;
REVOKE ALL ON public.sms_messages FROM public;

-- ── (2) EMAIL RECEIPTS EXTENSIONS (V2-D2 / V2-D3) ───────────────────────────────────────

-- linked_po_id: the confirmation/invoice→PO edge. Set by the inbound matching pass (§4)
-- when a PO display code is found in subject/body or when the vendor+date-window rule fires.
-- doc_kind: parse classification as a queryable column; parsed_json keeps the full extraction.
-- Inbound matching uses doc_kind to decide the PO effect (confirmation→ack; invoice→invoiced flip).
ALTER TABLE public.email_receipts
  ADD COLUMN IF NOT EXISTS linked_po_id uuid NULL REFERENCES public.purchase_orders(id),
  ADD COLUMN IF NOT EXISTS doc_kind     text NULL
    CHECK (doc_kind IN ('confirmation','invoice','statement','other'));

CREATE INDEX IF NOT EXISTS email_receipts_linked_po_ix
  ON public.email_receipts (linked_po_id);

-- ── (3) VENDOR CREDITS EXTENSIONS (V2-D4 redelivery closure) ────────────────────────────

-- resolved_by_delivery_id: the delivery that makes up the short, proof of redelivery.
-- Trail chains: new delivery → credit (resolved_redelivered) → original delivery → original PO.
-- Set at intake when the manager marks "makes up a short?" (KH+ gate; lib/credits.ts).
ALTER TABLE public.vendor_credits
  ADD COLUMN IF NOT EXISTS resolved_by_delivery_id uuid NULL REFERENCES public.vendor_deliveries(id);

-- Widen the status CHECK to include 'resolved_redelivered' (V2-D4).
-- Drop the live constraint by its exact name (0168: vendor_credits_status_check) and re-add
-- with the new value appended. Existing rows are unaffected — no status values change.
ALTER TABLE public.vendor_credits
  DROP CONSTRAINT vendor_credits_status_check;

ALTER TABLE public.vendor_credits
  ADD CONSTRAINT vendor_credits_status_check
    CHECK (status IN ('open','in_progress','resolved_credit','resolved_refund','resolved_redelivered','written_off'));
