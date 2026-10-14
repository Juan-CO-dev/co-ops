-- check-overcounted-prep-demand.sql — READ-ONLY (SELECT only; no writes, no DDL, no temp tables).
--
-- HISTORICAL RECORD. Run on production 2026-10-14 (CC, read-only): it found NOTHING —
-- production had no catering_prep_demand rows at all, one catering quote and zero package quote
-- lines. B7c round 3 therefore removed the legacy (no line_kind) Prep Demand rules this script
-- mirrors, and migration 0251 now refuses any package line without a kind. The script is kept
-- only as the record of that check; there is nothing left for it to find.
--
-- B7c (2026-10-14). Finds leads whose STORED catering prep demand (catering_prep_demand) is
-- inflated by the package double expansion fixed in B7c (12e208d3 + migration 0251): before the
-- fix, Prep Demand read EVERY quote line with a package id and no item reference as "the whole
-- package × Qty", and the staff builder's "Choose your sub" placeholder lines carried the package
-- id too. A 16 pc platter (header Qty 1 + placeholder Qty 16) therefore reserved 16 + 16×16 = 272
-- picks instead of 16.
--
-- For every lead's live demand set (reserved + consumed rows of the quote it was resolved from) it
-- recomputes, from that quote's lines:
--   old_rule_qty  — what the pre-fix code produced (every bare package line expands the package);
--   expected_qty  — what the FIXED legacy rules produce (lib/catering/prep-demand-shared.ts, rule
--                   set B: a placeholder counts its own Qty once and is never also a header; a
--                   header skips the slots its placeholders reserve and its listed components);
-- and lists every (lead, item) where stored ≠ expected. diagnosis = 'inflated_by_double_expansion'
-- when stored = old_rule_qty > expected_qty (this bug), else 'other_difference' (e.g. the package's
-- catalog composition changed since the demand was reserved — review by hand).
--
-- Output carries NO customer data: quote id, lead id, lead stage, shop, event (need) date, item,
-- statuses, stored / old-rule / expected qty, diagnosis.
--
-- Safe before AND after migration 0251: line_kind is read through to_jsonb(row), so the script
-- runs whether or not the column exists. Quotes holding any kinded line were reserved by the
-- fixed code and are skipped.
--
-- RECOMPUTING an affected lead (see the report): re-saving (revising) its quote does NOT re-resolve
-- package demand — resyncPrepDemand deliberately skips any quote with a package line (picks are
-- not carried forward on revise). The recompute path is the stage round trip on the board:
-- Confirmed → Quote sent (releasePrepDemand marks the reserved rows released) → Confirmed
-- (reservePrepDemand re-resolves the CURRENT quote with the fixed rules). Rows already CONSUMED
-- (Out / Completed) are history and are not recomputed.

with
-- ── sources (the only table reads) ─────────────────────────────────────────────────────────
src_demand as (
  select pipeline_id, quote_id, location_id, need_date, item_id, menu_item_id, choice_package_item_id, portion, qty, status
  from public.catering_prep_demand
  where status in ('reserved', 'consumed')
),
src_lines as (
  select qi.id, qi.quote_id, qi.item_id, qi.menu_item_id, qi.package_id, qi.quantity, qi.portion,
         qi.unit_price_cents, qi.display_order, qi.description,
         to_jsonb(qi) ->> 'line_kind' as line_kind
  from public.catering_quote_items qi
  where qi.quote_id in (select quote_id from src_demand)
),
src_comps as (
  select id, package_id, slot_type, item_id, menu_item_id, quantity, description, display_order
  from public.catering_package_items
  where active
),
src_packages as (select id, label_en, label_es from public.catering_packages),
src_picks as (
  select quote_item_id, package_item_id, item_id, menu_item_id, quantity
  from public.catering_quote_item_options
  where quote_item_id in (select id from src_lines)
),

-- ── the quote lines, normalised ────────────────────────────────────────────────────────────
kinded_quotes as (select distinct quote_id from src_lines where line_kind is not null),
lines as (
  select l.id, l.quote_id, l.item_id, l.menu_item_id, l.package_id, l.quantity::numeric as qty, l.portion,
         coalesce(l.unit_price_cents, 0) as unit_price_cents, l.display_order,
         lower(btrim(coalesce(l.description, ''))) as d
  from src_lines l
  where not exists (select 1 from kinded_quotes kq where kq.quote_id = l.quote_id)
),
slots as (
  select id, package_id, quantity::numeric as qty,
         coalesce(nullif(lower(btrim(coalesce(description, ''))), ''), 'item') as label,
         row_number() over (partition by package_id order by display_order, id) as rn
  from src_comps where slot_type = 'choice'
),
fixed as (
  select id, package_id, item_id, menu_item_id, quantity::numeric as qty
  from src_comps where slot_type <> 'choice' and (item_id is not null or menu_item_id is not null)
),
picks as (select quote_item_id, package_item_id, item_id, menu_item_id, quantity::numeric as qty from src_picks),
bare as (
  select l.*,
    exists (select 1 from picks p where p.quote_item_id = l.id) as has_picks,
    exists (select 1 from slots s where s.package_id = l.package_id) as has_slots,
    (l.d <> '' and exists (
      select 1 from src_packages p where p.id = l.package_id
        and l.d in (lower(btrim(coalesce(p.label_en, ''))), lower(btrim(coalesce(p.label_es, ''))))
    )) as is_label,
    (select s.id from slots s where s.package_id = l.package_id and l.d <> '' and s.label = l.d order by s.rn limit 1) as slot_by_label,
    (select s.id from slots s where s.package_id = l.package_id and s.rn = 1) as first_slot
  from lines l
  where l.package_id is not null and l.item_id is null and l.menu_item_id is null
),

-- ── OLD rule (pre-fix): referenced lines + every bare package line expands the whole package ─
old_rows as (
  select quote_id, case when item_id is not null then 'item' else 'menu_item' end as ref_kind,
         coalesce(item_id, menu_item_id) as ref_id, portion, qty
  from lines where item_id is not null or menu_item_id is not null
  union all
  select b.quote_id, 'choice', s.id, null, b.qty * s.qty
  from bare b join slots s on s.package_id = b.package_id
  where not exists (select 1 from picks k where k.quote_item_id = b.id and k.package_item_id = s.id)
  union all
  select b.quote_id, case when k.item_id is not null then 'item' else 'menu_item' end, coalesce(k.item_id, k.menu_item_id), null, b.qty * k.qty
  from bare b join slots s on s.package_id = b.package_id join picks k on k.quote_item_id = b.id and k.package_item_id = s.id
  union all
  select b.quote_id, case when f.item_id is not null then 'item' else 'menu_item' end, coalesce(f.item_id, f.menu_item_id), null, b.qty * f.qty
  from bare b join fixed f on f.package_id = b.package_id
),

-- ── FIXED legacy rule ─────────────────────────────────────────────────────────────────────
classified as (
  select b.*,
    (b.has_picks or not b.has_slots or b.is_label or (b.slot_by_label is null and b.unit_price_cents > 0)) as is_header,
    coalesce(b.slot_by_label, b.first_slot) as slot_id
  from bare b
),
pkg_lines as (  -- every legacy line of a package, in display order, segmented by header
  select l.id, l.quote_id, l.package_id, l.display_order,
         (l.item_id is not null or l.menu_item_id is not null) as is_ref,
         coalesce(c.is_header, false) as is_header
  from lines l left join classified c on c.id = l.id
  where l.package_id is not null
),
segmented as (
  select p.*, sum(case when p.is_header then 1 else 0 end)
           over (partition by p.quote_id, p.package_id order by p.display_order, p.id rows unbounded preceding) as seg
  from pkg_lines p
),
seg_header as (select quote_id, package_id, seg, id as header_id from segmented where is_header),
placeholders as (
  select c.id, c.quote_id, c.package_id, c.slot_id, c.qty, sg.seg, sh.header_id
  from classified c
  join segmented sg on sg.id = c.id
  left join seg_header sh on sh.quote_id = c.quote_id and sh.package_id = c.package_id and sh.seg = sg.seg
  where not c.is_header and c.slot_id is not null
),
placeholder_counted as (  -- a placeholder under a header that holds stored picks for its slot is not counted
  select p.* from placeholders p
  where p.header_id is null
     or not exists (select 1 from picks k where k.quote_item_id = p.header_id and k.package_item_id = p.slot_id)
),
headers as (
  select c.id, c.quote_id, c.package_id, c.qty, sg.seg,
    exists (select 1 from segmented r where r.quote_id = c.quote_id and r.package_id = c.package_id and r.seg = sg.seg and r.is_ref) as listed
  from classified c join segmented sg on sg.id = c.id
  where c.is_header
),
header_slots as (  -- the choice slots a header still reserves (not covered by its own placeholders)
  select h.id as header_id, h.quote_id, h.qty as header_qty, s.id as slot_id, s.qty as slot_qty
  from headers h join slots s on s.package_id = h.package_id
  where not exists (
    select 1 from placeholder_counted pc
    where pc.quote_id = h.quote_id and pc.package_id = h.package_id and pc.seg = h.seg and pc.slot_id = s.id
  )
),
expected_rows as (
  select quote_id, case when item_id is not null then 'item' else 'menu_item' end as ref_kind,
         coalesce(item_id, menu_item_id) as ref_id, portion, qty
  from lines where item_id is not null or menu_item_id is not null
  union all
  select quote_id, 'choice', slot_id, null, qty from placeholder_counted
  union all
  select hs.quote_id, 'choice', hs.slot_id, null, hs.header_qty * hs.slot_qty
  from header_slots hs
  where not exists (select 1 from picks k where k.quote_item_id = hs.header_id and k.package_item_id = hs.slot_id)
  union all
  select hs.quote_id, case when k.item_id is not null then 'item' else 'menu_item' end, coalesce(k.item_id, k.menu_item_id), null, hs.header_qty * k.qty
  from header_slots hs join picks k on k.quote_item_id = hs.header_id and k.package_item_id = hs.slot_id
  union all
  select h.quote_id, case when f.item_id is not null then 'item' else 'menu_item' end, coalesce(f.item_id, f.menu_item_id), null, h.qty * f.qty
  from headers h join fixed f on f.package_id = h.package_id
  where not h.listed
),

-- ── compare per (lead, quote, item) ───────────────────────────────────────────────────────
stored as (
  select pipeline_id, quote_id, location_id, need_date,
         case when item_id is not null then 'item' when menu_item_id is not null then 'menu_item' else 'choice' end as ref_kind,
         coalesce(item_id, menu_item_id, choice_package_item_id) as ref_id, portion,
         sum(qty) as stored_qty, string_agg(distinct status, ',') as statuses
  from src_demand
  where quote_id is not null and not exists (select 1 from kinded_quotes kq where kq.quote_id = src_demand.quote_id)
  group by 1, 2, 3, 4, 5, 6, 7
),
sets as (select distinct pipeline_id, quote_id, location_id, need_date from stored),
old_agg as (
  select quote_id, ref_kind, ref_id, portion, sum(qty) as qty from old_rows where qty > 0 group by 1, 2, 3, 4
),
exp_agg as (
  select quote_id, ref_kind, ref_id, portion, sum(qty) as qty from expected_rows where qty > 0 group by 1, 2, 3, 4
),
keys as (
  select st.pipeline_id, st.quote_id, st.location_id, st.need_date, st.ref_kind, st.ref_id, st.portion from stored st
  union
  select s.pipeline_id, s.quote_id, s.location_id, s.need_date, e.ref_kind, e.ref_id, e.portion
  from sets s join exp_agg e on e.quote_id = s.quote_id
),
compared as (
  select k.*, coalesce(st.stored_qty, 0) as stored_qty, st.statuses,
         coalesce(o.qty, 0) as old_rule_qty, coalesce(e.qty, 0) as expected_qty
  from keys k
  left join stored st on st.pipeline_id = k.pipeline_id and st.quote_id = k.quote_id and st.ref_kind = k.ref_kind
                     and st.ref_id = k.ref_id and st.portion is not distinct from k.portion
  left join old_agg o on o.quote_id = k.quote_id and o.ref_kind = k.ref_kind and o.ref_id = k.ref_id and o.portion is not distinct from k.portion
  left join exp_agg e on e.quote_id = k.quote_id and e.ref_kind = k.ref_kind and e.ref_id = k.ref_id and e.portion is not distinct from k.portion
)
select
  c.quote_id,
  c.pipeline_id as lead_id,
  pl.stage as lead_stage,
  loc.name as shop,
  c.need_date as event_date,
  case c.ref_kind
    when 'item' then coalesce(it.name, 'item ' || c.ref_id)
    when 'menu_item' then coalesce(mi.name, 'sub ' || c.ref_id)
    else 'NEEDS PICK: ' || coalesce(nullif(btrim(pi.description), ''), 'choice slot')
  end || coalesce(' (' || c.portion || ')', '') as item,
  coalesce(c.statuses, '(none stored)') as stored_status,
  c.stored_qty,
  c.old_rule_qty,
  c.expected_qty,
  case when c.stored_qty > c.expected_qty and c.stored_qty = c.old_rule_qty then 'inflated_by_double_expansion'
       else 'other_difference' end as diagnosis
from compared c
left join public.catering_pipeline pl on pl.id = c.pipeline_id
left join public.locations loc on loc.id = c.location_id
left join public.items it on c.ref_kind = 'item' and it.id = c.ref_id
left join public.menu_items mi on c.ref_kind = 'menu_item' and mi.id = c.ref_id
left join public.catering_package_items pi on c.ref_kind = 'choice' and pi.id = c.ref_id
where c.stored_qty <> c.expected_qty
order by c.need_date, loc.name, c.pipeline_id, item;
