# Vendor Ordering V3-A — Order guides as a first-class entity

**Date:** 2026-09-16 · **Author:** CC (Fable) with Juan · **Status:** design approved by Juan in conversation ("Option 2 … Go"), spec pending his read and an Aggie-bench review.

**Arc context.** V1 (#242, mig 0174) built the PO spine; V2 (#243, mig 0175) added multi-vendor drafts, credits and the three-way match. V3 was parked until two Juan errands landed: the physical order guides (transcribed 2026-09-13 → `docs/seed/source/order-guide-2026-09-13.json`) and a MOXē export (due Friday 2026-09-18). V3 is three sub-projects with their own specs, built in order: **A** order guides (this spec) · **B** barcode scanning as an optional path · **C** MOXē catalog import (blocked on the export).

## 1. Purpose

On ordering day a manager walks the shelf in the app, confirms one order per vendor, then keys it into the vendor's portal (PFG's MOXē), reads it over the phone, or emails it. Every vendor's guide has its own fixed order — the laminated PFG sheet runs Produce → Dairy → Packaging → Dry Goods → Meat → Beverage with a fixed line order inside each section — and today the app's order lists SKUs by usage then name, so the manager hunts line by line while keying.

**Juan's rule (2026-09-16):** *the walk stays as it is; the order, once ready, follows the guide, and once the guide is set nobody has to set it again.*

Success: every list a manager reads while keying or reading out an order shows lines under the guide's section headers, in the guide's line order, for every vendor with a guide, with anything not on the guide visible at the end. The walk is untouched.

## 2. What exists today (facts, verified 2026-09-16)

- `vendor_items.guide_position integer null` (mig 0174:168) — "global guide position", **never written** by anything; `po_lines.guide_position_snapshot` (0174:98) copies it at draft creation (`lib/purchase-orders.ts:227-234`, `:437-446`).
- The PO panel sorts lines by that snapshot **only when the vendor's transmission tier is `assisted`** (`components/ordering/PoPanel.tsx:696-700`); every vendor is still `manual`, so the sort never fires. The SKU picker inside a PO orders by `guide_position` nulls-last (`lib/purchase-orders.ts:1443-1447`). Receiving prefill orders by the snapshot (`lib/receiving.ts:1095-1099`).
- The walker sorts SKUs by trailing usage desc then name (`lib/ordering.ts:1221-1226`); its placed-order preview sorts vendors by name and leaves lines in walk order (`components/ordering/ParPassWalker.tsx:341`, `:371-390`).
- The order body text is built client-side in `PoPanel.tsx:325` (`bodyText`), and server-side for email in `lib/po-email.ts:195` (`renderBodies`).
- The transcription: `sheets.pfg_leonard` (106 rows: PFG 58, Leonard 36, Trimark 10, Baldor 1, TRANSFER 1; sections Produce 14 · Dairy 10 · Packaging (Leonard Paper) 30 · Dry Goods 27 · Meat 5 · Beverage 3 · Leonard Paper/Trimark 17) and `sheets.boars_head` (53 rows, no vendor key; sections Boar's Head 11 · Peppers 3 · Beverage 12 · Chips-Flavored 5 · Lrg. Utz Chips 2 · Gluten Free Bread 1 · Smallwares 19). Order is implicit in array index. PFG rows carry `item_number`; `vendor_items.item_number` already holds PFG item numbers.
- Vendor admin is one server page, `app/admin/vendors/[id]/page.tsx`, composing panels from `lib/admin/vendors`, `lib/vendor-rhythm`, `lib/admin/skus`.

## 3. Data model (migration 0205)

Three tables, deny-all RLS (service-role only, the 0174/0182/0203 posture), `updated_at` maintained by the app.

```sql
create table public.vendor_order_guides (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id),
  name        text not null,                 -- "PFG laminated guide 2026-09"
  source_note text null,                     -- where it came from (seed 37 / manager edit)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vendor_id)                         -- ONE active guide per vendor (v3a; history = edit in place)
);
create table public.order_guide_sections (
  id        uuid primary key default gen_random_uuid(),
  guide_id  uuid not null references public.vendor_order_guides(id) on delete cascade,
  name      text not null,
  position  integer not null,
  unique (guide_id, position) deferrable initially deferred
);
create table public.order_guide_lines (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.order_guide_sections(id) on delete cascade,
  position    integer not null,
  sku_id      uuid null references public.vendor_items(id),   -- null = guide row not yet matched to a SKU
  label       text not null,                                   -- the sheet's own words ("Arugula", "Solar Green gallons")
  item_number text null,                                       -- the sheet's vendor code, if printed
  note        text null,
  unique (section_id, position) deferrable initially deferred,
  unique (sku_id)                                              -- a SKU sits on at most one line, across all guides
);
alter table public.po_lines add column guide_section_snapshot text null;
comment on column public.vendor_items.guide_position is
  'DEPRECATED 0205: the guide is order_guide_lines now. Kept for one release as a read fallback; no writer.';
```

Decisions baked in:

- **One guide per vendor.** The PFG laminate carries Leonard and Trimark lines; the seed splits them into three guides (PFG, Leonard Paper, Trimark) because each vendor's order is keyed separately. The Baldor and TRANSFER rows on that sheet are not guide lines (Baldor has no guide yet; TRANSFER is not a vendor) and land in the seed report.
- **A line without a SKU is allowed** so an unmatched sheet row is kept in place, visible in admin as "needs a SKU", rather than dropped. A SKU on more than one line is not allowed (the unique index), because the sort would be ambiguous.
- **Snapshot on the PO, not a join.** `po_lines.guide_position_snapshot` keeps its meaning (a global sort key) and is now computed as `section.position * 1000 + line.position`; `guide_section_snapshot` carries the section name. A printed or emailed order never changes shape when the guide is edited later. No PO code reads the guide tables at render time.
- **Position numbers are dense, renumbered on every save** (1..n per section, 1..n per guide). No gaps arithmetic; the editor moves rows, the server renumbers. The deferrable unique constraints allow the swap inside one transaction.

## 4. The guide sort (one function, one law)

`lib/order-guide-sort.ts` (pure, shared):

```ts
export type GuideSortKey = { position: number | null; section: string | null; name: string };
export function compareByGuide(a: GuideSortKey, b: GuideSortKey): number
// position asc (nulls LAST) → then name.localeCompare. Callers group consecutive equal
// `section` values into headers; null section = "Not on the guide" (last, alphabetical).
```

Consumers (all of them, every tier — the `assisted`-only gate in `PoPanel.tsx:696-700` is removed):

| Surface | Today | V3-A |
|---|---|---|
| PO panel line list (`PoPanel.tsx`) | guide order only if `assisted`, else insertion order | guide order with section headers, all tiers |
| Copied / read-out body (`PoPanel.tsx:325 bodyText`) | walk order | section header lines + guide order |
| Emailed body (`lib/po-email.ts:195 renderBodies`) | walk order | same, text and HTML |
| Walker placed-order preview (`ParPassWalker.tsx:371-390`) | walk order per vendor | guide order per vendor, section headers |
| Receiving prefill (`lib/receiving.ts:1095`) | snapshot nulls-last | unchanged (already the snapshot) |
| PO SKU picker (`lib/purchase-orders.ts:1443`) | `guide_position` nulls-last | guide order via the line table, then name |

The walker's SKU order during the walk (`lib/ordering.ts:1221-1226`) is **not touched**.

Snapshot computation moves into one helper, `guideSnapshotsFor(skuIds)` in `lib/order-guides.ts`, used by both draft-creation paths (`createDraftsFromLines`, `updateDraftLines`), replacing the two `vendor_items.guide_position` reads.

## 5. Seed 37 — `scripts/seed/37-order-guides.ts`

Seed-32 shape (pinned source, pure planner, dry-run digest, `--target sim|prod --execute --plan-digest`, audit readback, `verifyWriteScope`, idempotent rerun). Prod executes need `ANGEL_WAVE7_PROD_CONFIRM` inline as before.

Planner rules, in order, per sheet row:

1. **Vendor routing.** `pfg_leonard` rows use their `vendor` key (PFG / Leonard Paper / TRIMARK → Trimark). `boars_head` rows: section `Boar's Head`, `Peppers` → vendor Boar's Head; `Beverage`, `Chips-Flavored`, `Lrg. Utz Chips`, `Gluten Free Bread`, `Smallwares` are **not** Boar's Head lines — they are the shop's second sheet of other vendors' items — and are routed by the SKU they match (a matched SKU's `vendor_id` decides; unmatched → report, no line). Baldor and TRANSFER rows → report only.
2. **SKU match.** Same vendor, active: (a) exact `item_number`; (b) exact normalized name (`norm` from `lib/po-match-shared.ts:123`); (c) unambiguous name-contains. Ambiguous or none → line created with `sku_id null`, row in the report.
3. **Sections and lines** in sheet order, positions dense from 1.
4. **Idempotency.** A guide that already exists for the vendor with `source_note` starting `[seed-37]` is compared line-by-line: identical → `already`; different → `refused` with the diff (a manager may have edited; the seed never overwrites a hand edit). A guide with a foreign `source_note` → `refused`.
5. **Report** (`seed37-report-<target>.txt`): per vendor counts (lines, matched, unmatched-with-candidates, unmatched-none), Baldor/TRANSFER rows, SKUs active for the vendor but on no line.

Expected on prod (from the transcription): PFG ≈58 lines, Leonard Paper ≈36+, Trimark ≈10+, Boar's Head 14; the 19 Smallwares and 12 Beverage rows of the second sheet distribute by matched SKU.

## 6. Admin editing — "Order guide" tab on the vendor page

`components/admin/vendors/OrderGuidePanel.tsx` (client island), fed by `loadOrderGuide(vendorId)` from `lib/order-guides.ts`, mutations through `POST /api/admin/vendors/[id]/order-guide` (GM+, `assertSameOrigin`, audit `vendor.order_guide.edited` NON_DESTRUCTIVE with before/after line counts).

- Sections listed in order, each with ▲ ▼ and rename; "Add section".
- Lines under each section with ▲ ▼, the label, the item number, and the SKU chip (or "needs a SKU" in red with a picker); "Add line → pick SKU" appends to that section; "Move to section" dropdown.
- A side bucket, "Active SKUs not on the guide", each with "Place in [section]" → appended last in that section.
- Remove line (not delete SKU). Removing a section requires it to be empty.
- Save = one transaction: the server rewrites positions dense (1..n) for the touched guide, enforces one-line-per-SKU, returns the new state. Optimistic UI, then reconcile.
- Phone-first: 44px targets, no drag and drop.

The old per-SKU "guide position" number, if it is exposed anywhere in the SKU editor, is removed from the form.

## 7. Error handling

- A PO whose vendor has no guide: every line has null position → "Not on the guide" is the only group; the header is suppressed when it is the only one.
- Guide edited after a PO was drafted: the PO keeps its snapshot (by design). A note in the PO panel is **not** added — the snapshot is the record.
- Seed ambiguity never writes; the report is the resolution path (floor question, then a manager places the line in admin or the seed is re-run after the SKU is fixed).
- Concurrent admin saves: last write wins on the whole guide (one editor per vendor in practice); the audit row keeps both states.

## 8. Tests

- `tests/order-guide-sort.test.ts`: positions win over names for all tiers; nulls last; section grouping helper yields headers in order with "Not on the guide" last and suppressed when alone.
- `tests/seed-37-order-guides.test.ts`: routing of both sheets (incl. second-sheet rows routed by SKU vendor, Baldor/TRANSFER to report), the three match rules and ambiguity → null sku_id, idempotent `already`, hand-edited guide → `refused`, `verifyWriteScope`.
- `tests/order-guides-editor.test.ts`: move up/down renumbers dense; move-to-section; one-line-per-SKU rejection; empty-section delete rule.
- `tests/po-guide-snapshot.test.ts`: `guideSnapshotsFor` produces `section*1000+line` and the section name; both draft paths use it (existing PO tests extended, not duplicated).
- Sim: the ordering LRA suite (`ordering cold-empty`) must stay green; add one claim that a confirmed PO body lists lines in guide order with section headers.

## 9. Out of scope (named so nobody builds them by accident)

- Per-location guides (both shops use the same laminates today; `unique (vendor_id)` is the YAGNI fence — lift it if the shops ever diverge).
- Guide versions/history beyond the audit row.
- Changing the walk order (Juan's rule).
- Barcode (V3-B) and MOXē import (V3-C) — their own specs. V3-C will *update* guide lines from the export (item numbers, new lines) and is designed against the real file.

## 10. Migration and rollout

1. Mig 0205 to sim → seed 37 dry-run → execute on sim → harness `ordering` suite green.
2. PR: migration + lib + seed + admin tab + surfaces + tests. CI green. CC review (bug-class groups: asymmetry between the two draft paths, RLS grants, actor binding on the admin route).
3. Juan's word → merge → 0205 on prod → seed 37 on prod → report to Juan → floor resolution of unmatched rows.
