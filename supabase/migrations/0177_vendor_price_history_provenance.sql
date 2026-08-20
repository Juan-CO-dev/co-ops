-- 0177: vendor_price_history provenance — `source` + `source_note`
-- Source: docs/seed/source/angel-reconciliation-report.md §F.1 ("Provenance caveat"),
--         sequenced there as step 3 of §F.4 ("must precede bulk fills, or provenance
--         is lost forever"). Juan-approved for prod apply 2026-08-20.
--
-- WHY. Before this migration the price ledger's only provenance carriers were
-- `recorded_by` (a user id) and the audit_log row. That is enough to say WHO wrote a
-- price and WHEN, and nothing at all about WHERE THE NUMBER CAME FROM. The Angel
-- catalog import makes that gap load-bearing:
--
--   * Angel has no canonical-item grouping, so one of our SKUs can be quoted by
--     several Angel rows at once (report §B.3: 25 duplicate clusters over 62 rows).
--     The two `BASIL FRSH` rows are $10.34/lb and $19.55/lb — an 89% spread for what
--     is nominally the same line item; the two `OREGANO LEAVES` rows are $11.05 and
--     $16.27. Which duplicate a price came from changes the derived cost by up to 2×,
--     so "Angel says basil is $X" is not a well-formed statement without the row.
--   * Angel's case price is almost never our pack price (report §F3): of the rows
--     where both sides resolve to ounces, only 12 agree outright and 18 require a
--     divisor between ÷2 and ÷36. A stored unit_price is therefore usually a DERIVED
--     number, and the divisor that produced it is part of its meaning.
--
-- Without these columns an Angel-derived estimate is indistinguishable from an
-- invoice-derived fact once it lands in the ledger. That erasure is precisely the
-- trust property the product differentiates on, so the provenance rides WITH the row.
--
-- SHAPE. Both columns are additive, nullable text. Nullable is deliberate and
-- permanent: the append-only ledger already holds rows (and will keep accepting
-- delivery-derived and hand-entered rows) that have no external source to name, and
-- back-dating a synthetic source onto them would itself be a provenance lie. NULL
-- `source` reads as "recorded through the app by recorded_by", which is true.
--
-- No CHECK constraint and no enum: the vocabulary of price sources is expected to
-- grow (invoice OCR, vendor EDI, a second catalog export) and pinning it in DDL now
-- would force a migration per source. The convention is carried in the column comment
-- and by the writers.
--
-- RLS: unchanged. vendor_price_history keeps its existing policy set — adding a
-- nullable column to a table alters no policy predicate, and the append-only posture
-- (no user DELETE, history sacred) is untouched. No new grants.
--
-- Reversibility: additive-only. Dropping these two columns restores the prior shape
-- exactly; no existing column, index, constraint, or policy is modified.

alter table public.vendor_price_history
  add column if not exists source text;

alter table public.vendor_price_history
  add column if not exists source_note text;

comment on column public.vendor_price_history.source is
  'WHERE this price came from, as a stable machine key — the provenance CLASS of the row, not free text. NULL = recorded through the app by recorded_by (delivery capture or hand entry), which is the pre-0177 default and stays valid forever. Convention: a dated dataset key, e.g. ''angel-catalog-2026-08''. Deliberately unconstrained (no enum/CHECK): the source vocabulary grows with each new price feed and should not cost a migration. Consumers that must distinguish derived estimates from invoice-derived facts filter on this column.';

comment on column public.vendor_price_history.source_note is
  'WHICH specific record inside `source` produced this number, plus the arithmetic that turned it into a price of ONE OF OUR PACKS. Load-bearing, not decorative: Angel quotes several rows per SKU (report §B.3 — the two BASIL FRSH rows differ by 89%), and its case price usually needs a divisor to become our pack price (report §F3 — Ham is ÷13, Butter ÷36). A note therefore names the source row verbatim and shows the division, e.g. ''HAM 35% WATER FC 4X6 TFF | case $36.06 / 1-13 LB (208 oz) ÷ 13 = $2.77 per 16 oz pack''. Free text by design — it is read by humans auditing a number, never parsed.';
