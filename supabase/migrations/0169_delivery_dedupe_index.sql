-- 0169: delivery-intake P1 verifier blocker #2 (cross-family review, card t_dd3afb23).
-- The app-level select-then-insert dedupe guard races under concurrent POSTs; the DB
-- is the only honest arbiter. Case-insensitive to match the guard's ilike semantics.
-- Null-invoice deliveries are INTENTIONALLY exempt (multiple same-day COD/no-invoice
-- drops are legitimate) — hence the partial index.
-- Pre-flighted 2026-08-02: zero existing (vendor, location, date, lower(invoice)) duplicates.

create unique index if not exists vendor_deliveries_dedupe_uq
  on public.vendor_deliveries (vendor_id, location_id, delivery_date, lower(invoice_number))
  where invoice_number is not null;
