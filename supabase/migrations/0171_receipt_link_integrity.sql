-- 0171: delivery-intake P2 verifier fixes (cross-family review, card t_ff75c35a).
-- (a) One receipt links at most ONE delivery: the linkReceipt race (two deliveries
--     claiming the same receipt) is arbitrated by the DB, not app-level checks —
--     the 0169 lesson applied to the new FK.
-- (b) Webhook idempotency: Resend retries on our 500s; external_id (the svix-id)
--     dedupes re-deliveries so a retry never creates a duplicate receipt row.

create unique index if not exists vendor_deliveries_email_receipt_uq
  on public.vendor_deliveries (email_receipt_id)
  where email_receipt_id is not null;

alter table public.email_receipts
  add column if not exists external_id text null;

create unique index if not exists email_receipts_external_uq
  on public.email_receipts (external_id)
  where external_id is not null;
