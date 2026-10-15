-- Migration 0254_toast_payments_cash_paid_date_index
-- AUTHORED 2026-10-14. NOT YET APPLIED — apply via MCP after review (any time AFTER 0253; sim first, then prod).
--
-- MUST RUN OUTSIDE A TRANSACTION. CREATE INDEX CONCURRENTLY refuses to run inside a transaction
-- block, which is why this file has no begin/commit and is separate from 0253. Concurrently, so the
-- Toast capture writers (every 10 min, 6 AM–11 PM ET) are never blocked while it builds.
--
-- OPTIONAL FOR CORRECTNESS. It only speeds up the paid-day half of cash_toast_projected_facts (0253):
-- `type = 'CASH' and paid_business_date = <day>`. Measured on prod without it: ~45 ms over ~298k
-- toast_payments rows. Nothing depends on it existing; it can be applied, skipped, or dropped freely.
-- If a concurrent build is interrupted it leaves an INVALID index: drop it and re-run.

create index concurrently if not exists toast_payments_cash_paid_date
  on public.toast_payments(paid_business_date)
  where type = 'CASH';
