# W04/B008: repairing per-basis prices already in `vendor_price_history`

Status: **PROPOSAL ONLY. Nothing here has been run.** Every statement in section 1 is a read. Section 3 is an
append-only correction to be reviewed, rehearsed on the sim, and applied to prod only on Juan's word, under the
migration rules in AGENTS.md (one audit row, `actor_context = "migration_apply"`).

## Why

`vendor_price_history.unit_price` is dollars per internal purchase **root** (0210 column comment; costing divides it
by the root's content oz). Before PR #546 the vendor importer (`priceAtRoot`, `lib/vendor-import-shared/reconcile.ts`)
priced a row per ONE unit of the SKU's `price_basis` instead:

| `price_basis` | old value written | correct value (per root) |
|---|---|---|
| `per_case`, `per_bundle` | per root | unchanged (correct) |
| `per_lb` | per pound | old × root_oz / 16 |
| `per_dozen` | per dozen | old × root_count / 12 |
| `per_each` | per vendor each | old × root_qty / (vendor each contents) |

Example: Utz Ripples, root = box of 9 × 12.5 oz bags (112.5 oz), a $4.37/bag receipt line was written as **$4.37**
instead of **$39.33**, so the costing board priced Ripples 9× low.

PR #546 fixes new proposals and (round 1) refuses to apply any batch staged under the old adapter version
(`v3c2-v1`). It cannot fix rows already appended. Seed 38's own prices were written per root and are NOT affected.

## 1. Evidence (read-only)

### 1a. Import-written prices on a non-root basis (the B008 cohort)

```sql
-- Every price the importer appended for a SKU whose basis is not the root, with the batch evidence
-- needed to recompute it. source_note = '<batch_id>:row:<source_row>' (0211/0293 writers).
with imported as (
  select p.id as price_id, p.vendor_item_id as sku_id, p.unit_price, p.effective_date, p.recorded_at,
         p.location_id, p.price_lane_id,
         split_part(p.source_note, ':row:', 1)::uuid as batch_id,
         split_part(p.source_note, ':row:', 2)::int  as source_row
  from public.vendor_price_history p
  where p.source = 'vendor_import'
)
select i.*, vi.name, b.adapter_version, b.location_id as batch_location,
       b.report -> 'before_state' -> (i.source_row::text || ':price') ->> 'price_basis' as basis_at_stage,
       b.report -> 'before_state' -> (i.source_row::text || ':price') -> 'root'        as root_at_stage,
       o.payload as vendor_row, o.proposed
from imported i
join public.vendor_items vi on vi.id = i.sku_id
join public.vendor_import_batches b on b.id = i.batch_id
left join public.vendor_import_observations o on o.batch_id = i.batch_id and o.source_row = i.source_row and o.kind = 'price'
where coalesce(b.report -> 'before_state' -> (i.source_row::text || ':price') ->> 'price_basis', vi.price_basis)
      not in ('per_case', 'per_bundle')
order by i.sku_id, i.effective_date, i.recorded_at;
```

(The before-state key is `observationKey` = `<source_row>:<kind>`; check one row's `report.before_state` keys
first and adjust if the stored shape differs.)

### 1b. Which of those rows are LIVE (the number costing reads today)

```sql
-- For each affected SKU and scope, is the bad row still the current price? (Same ordering as
-- resolveCurrentPrices: effective_date desc, recorded_at desc, id desc; a live shop lane wins.)
select distinct on (p.vendor_item_id, coalesce(p.price_lane_id::text, 'global'))
       p.vendor_item_id, p.price_lane_id, p.id as current_price_id, p.source, p.unit_price, p.effective_date
from public.vendor_price_history p
where p.vendor_item_id in (/* sku ids from 1a */)
order by p.vendor_item_id, coalesce(p.price_lane_id::text, 'global'), p.effective_date desc, p.recorded_at desc nulls last, p.id desc;
```

### 1c. Prices that predate a seed-38 root repair (the "such as Butter" cohort)

Seed 38 replaced 15 pack roots (successor level ids start `38000001`). A price recorded BEFORE that root changed is
per the OLD root; if no later price exists it is still what costing divides by the NEW root's oz.

```sql
select l.sku_id, vi.name, l.effective_from as root_repaired_at,
       p.id as price_id, p.unit_price, p.effective_date, p.recorded_at, p.source
from public.sku_pack_levels l
join public.vendor_items vi on vi.id = l.sku_id
join lateral (
  select * from public.vendor_price_history p
  where p.vendor_item_id = l.sku_id and p.location_id is null
  order by p.effective_date desc, p.recorded_at desc nulls last, p.id desc limit 1
) p on true
where l.id::text like '38000001%'
  and coalesce(p.recorded_at, p.effective_date::timestamptz) < l.effective_from;
```

Expected: seed 38 wrote a fresh per-root price for every root it repaired that had evidence (PC-002..PC-008, Utz);
any row returned here is a root-repaired SKU whose live price is still per the old root, and needs a reviewed
per-root price (Juan/vendor evidence), not arithmetic: the old root's contents are recorded in the seed-38
audit row (`action = 'sku.pack_level_supersede'`, `metadata.before`), so the conversion is
`old_price × new_root_oz / old_root_oz`, but it should be checked against a current invoice before it is written.

## 2. Recomputing the correct value

Do NOT recompute `per_each` in SQL: the vendor each's contents come from the parsed pack in the observation payload.
For each 1a row, run the CURRENT `priceAtRoot(vendor_row, root_at_stage, basis_at_stage)` (the fixed importer, PR
#546) offline over the exported rows and produce a reviewed manifest:

| price_id (bad) | sku_id | scope (location_id / price_lane_id) | effective_date | bad unit_price | corrected unit_price | evidence (batch:row) |
|---|---|---|---|---|---|---|

Round to cents (`numeric(10,2)`). A row `priceAtRoot` refuses (null) goes to a person, never into the manifest.

When the same source row also carried an accepted `pack` change, the applied price was the before-state's
`price_with_pack` (computed against the PROPOSED root), not `root_at_stage`. The authoritative written value is
the op's `after.unit_price` in `vendor_import_applies.result` (and the `sku.price_supersede` audit row with
`metadata.actor_context = 'vendor_import'`); recompute against the root that op used, and match the manifest's
bad value to that `after`, not to the observation's `proposed`.

## 3. Proposed append-only repair (template; do not run)

Never UPDATE or DELETE a price row. Append a correcting row with the SAME `effective_date` and scope, recorded now:
it sorts after the bad row (same date, later `recorded_at`), so it becomes current exactly where the bad row was
current, and a newer real price stays current where one exists. The bad row stays as history, named by the
correction.

```sql
-- 03xx_w04_b008_price_root_repair.sql (sketch). Literal manifest from section 2.
begin;
do $$
declare
  m record; v_bad public.vendor_price_history%rowtype; v_n int := 0;
begin
  for m in select * from (values
    -- (bad_price_id, sku_id, bad_unit_price, corrected_unit_price, evidence)
    ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 4.37::numeric, 39.33::numeric, '<batch>:row:<n>')
  ) as t(bad_id, sku_id, bad_price, good_price, evidence) loop
    select * into v_bad from public.vendor_price_history where id = m.bad_id for update;
    -- A drifted ledger refuses: the row must still be the import's, unchanged, for this SKU.
    assert found and v_bad.vendor_item_id = m.sku_id and v_bad.unit_price = m.bad_price
       and v_bad.source = 'vendor_import', format('drift on %s', m.bad_id);
    assert not exists (select 1 from public.vendor_price_history
       where source = 'audit_w04_b008_repair' and source_note like m.bad_id::text || '%'), format('already repaired %s', m.bad_id);
    insert into public.vendor_price_history
      (vendor_item_id, unit_price, effective_date, recorded_at, recorded_by, source, source_note, location_id, price_lane_id)
    values (v_bad.vendor_item_id, m.good_price, v_bad.effective_date, clock_timestamp(), null,
      'audit_w04_b008_repair', m.bad_id::text || ' per-basis ' || m.bad_price || ' -> per-root ' || m.good_price || ' (' || m.evidence || ')',
      v_bad.location_id, v_bad.price_lane_id);
    v_n := v_n + 1;
  end loop;
  assert v_n = 1 /* literal manifest count */, 'manifest count';
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (null, null, 'sku.price_supersede', 'vendor_price_history', null,
    jsonb_build_object('actor_context', 'migration_apply', 'reason', 'audit W04/B008 per-basis import prices re-expressed per root',
      'count', v_n), true);
end $$;
commit;
```

Checks before applying:

1. Pre-flight `information_schema.columns` for `vendor_price_history` (the `location_id` / `price_lane_id` pair is
   CHECK-paired; a shop-lane row keeps both) and confirm `source` is free text.
2. Confirm `sku.price_supersede` is the right registered audit action and its `destructive` classification
   (`lib/destructive-actions.ts`); set the column to match.
3. Rehearse on the sim with a copy of the manifest; re-run 1b afterwards: every corrected SKU's current price must
   be the corrected row (or a newer real price).
4. Deploy PR #546 first, so no old-semantics batch can append another bad row after the manifest is frozen.
