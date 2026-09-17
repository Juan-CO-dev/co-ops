# Vendor Ordering V3-A — Order guides as a first-class entity

**Date:** 2026-09-16 · **Author:** CC (Fable) with Juan · **Status:** design approved by Juan in conversation ("Option 2 … Go"); Aggie-bench adversarial review r2 (2026-09-16, `.claude/hermes-dispatches/2026-09-16T*_v3a-spec-review-r2.md`) = *build with changes* — all eight points adjudicated in §11; her two owner questions answered 2026-09-16 (§11); pending Juan's read.

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
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),   -- the editor's optimistic-concurrency token
  unique (vendor_id)                         -- ONE guide per vendor (v3a; history = the audit rows)
);
create table public.order_guide_sections (
  id        uuid primary key default gen_random_uuid(),
  guide_id  uuid not null references public.vendor_order_guides(id) on delete cascade,
  name      text not null,
  position  integer not null,
  unique (guide_id, position) deferrable initially deferred,
  unique (guide_id, name)                    -- a section name appears once per guide (the seed appends to an existing one)
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
  unique (sku_id)                                              -- a SKU sits on at most one line (a SKU has one vendor → one guide; a sheet that repeats an item keeps the FIRST occurrence, the repeat goes to the seed report)
);
alter table public.po_lines add column guide_section_snapshot text null;
alter table public.vendor_items drop column guide_position;   -- never written (0174 → today); every reader is migrated in this PR; the po_lines snapshot column stays
```

Decisions baked in:

- **One guide per vendor.** The PFG laminate carries Leonard and Trimark lines; the seed splits them into three guides (PFG, Leonard Paper, Trimark) because each vendor's order is keyed separately. The Baldor and TRANSFER rows on that sheet are not guide lines (Baldor has no guide yet; TRANSFER is not a vendor) and land in the seed report.
- **A line without a SKU is allowed** so an unmatched sheet row is kept in place, visible in admin as "needs a SKU", rather than dropped. A SKU on more than one line is not allowed (the unique index), because the sort would be ambiguous.
- **Snapshot on the PO, live fallback.** `po_lines.guide_position_snapshot` keeps its meaning (a global sort key) and is now computed as `section.position * 1000 + line.position`; `guide_section_snapshot` carries the section name. Once a PO leaves draft its body never changes shape when the guide is edited later. **Read rule:** `loadPoDetail` hydrates each line's sort key as `snapshot ?? live guide lookup`, so a legacy PO (all snapshots null) and a line added to a draft after the guide was edited still render in guide order instead of falling to "Not on the guide"; a confirmed PO's snapshots win when present.
- **A sheet row whose SKU is already on the guide** (an item printed twice, or a second-sheet row matching a SKU on the laminate) is not a second line: the seed keeps the first occurrence and reports the repeat with both sheet positions. If Juan says a repeat is real (two pack sizes keyed to one SKU) the answer is two SKUs, per the pack-hierarchy model, not two lines.
- **Position numbers are dense, renumbered on every save** (1..n per section, 1..n per guide). No gaps arithmetic; the editor moves rows, the server renumbers. The deferrable unique constraints allow the swap inside one transaction.

## 4. The guide sort (one function, one law)

`lib/order-guide-sort.ts` (pure, shared):

```ts
export type GuideSortKey = { position: number | null; section: string | null; name: string };
export function compareByGuide(a: GuideSortKey, b: GuideSortKey): number
// position asc (nulls LAST) → then name.localeCompare. Callers group consecutive equal
// `section` values into headers; null section = "Not on the guide" (last, alphabetical).
```

Consumers (all of them, every tier — the `assisted`-only gate in `PoPanel.tsx:696-700` is removed). **One body renderer:** `renderPoBodyText(detail)` in `lib/po-body.ts` (pure) replaces both `PoPanel.tsx:325 bodyText` and the text half of `lib/po-email.ts:195 renderBodies`; the HTML email wraps the same line model. The copied order and the emailed order can no longer diverge (the asymmetry bug-class).

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

1. **Vendor routing and section naming.** `pfg_leonard` rows use their `vendor` key (PFG / Leonard Paper / TRIMARK → Trimark). The laminate's mixed section "Leonard Paper / Trimark" is split by vendor, and each vendor's guide names its sections in its own words via a fixed per-vendor map in the seed (Leonard: "Packaging", "Leonard Paper"; Trimark: "Trimark"; never a header naming another vendor). `boars_head` rows: section `Boar's Head`, `Peppers` → vendor Boar's Head; `Beverage`, `Chips-Flavored`, `Lrg. Utz Chips`, `Gluten Free Bread`, `Smallwares` are **not** Boar's Head lines — they are the shop's second sheet of other vendors' items — and are routed by the SKU they match (a matched SKU's `vendor_id` decides; unmatched → report, no line). A routed row lands in the target guide's section of the same name if one exists (PFG already has "Beverage"), else in a new section appended last. Baldor and TRANSFER rows → report only. **Juan 2026-09-16:** small vendors have no sheet of their own, so their guide is created from what we have: the second-sheet rows route onto each matched vendor's guide now, and — rule 6 — every other active vendor with active SKUs but no sheet rows gets a **starter guide**.
2. **SKU match.** Same vendor, active: (a) exact `item_number`; (b) exact normalized name (`norm` from `lib/po-match-shared.ts:123`); (c) unambiguous name-contains. Ambiguous or none → line created with `sku_id null`, row in the report.
3. **Sections and lines** in sheet order, positions dense from 1.
4. **Idempotency and reruns.** A guide that already exists for the vendor: the seed NEVER moves, relabels or removes an existing line or section (hand edits are sacred). A rerun does only two things: (a) re-matches lines whose `sku_id` is still null using the same rules, and (b) appends sheet rows that have no line yet (matched by label + item number) to the end of their section. Nothing to do → `already`. A guide whose `source_note` says it was created by hand (not `[seed-37]`) → `refused` in full, reported.
5. **Starter guides (rule 6).** For each active vendor with ≥1 active SKU and no guide after rules 1–4: one guide named "<vendor> — starter", one section named after the vendor, its active SKUs as lines in alphabetical order, `source_note` `[seed-37 starter]`. A manager reorders it once in admin (§6) and it is theirs from then on; the seed's rerun rules (rule 4) never touch it again. Baldor gets its starter this way (its single laminate row is reported, not lined, because the row is not Baldor's own sheet).
6. **Report** (`seed37-report-<target>.txt`): per vendor counts (lines, matched, unmatched-with-candidates, unmatched-none), Baldor/TRANSFER rows, SKUs active for the vendor but on no line.

Expected on prod (from the transcription): PFG ≈58 lines, Leonard Paper ≈36+, Trimark ≈10+, Boar's Head 14; the 19 Smallwares and 12 Beverage rows of the second sheet distribute by matched SKU.

## 6. Admin editing — "Order guide" tab on the vendor page

`components/admin/vendors/OrderGuidePanel.tsx` (client island), fed by `loadOrderGuide(vendorId)` from `lib/order-guides.ts`, mutations through `POST /api/admin/vendors/[id]/order-guide` (GM+, `assertSameOrigin`, `updated_at` precondition, audit `vendor.order_guide.edited` NON_DESTRUCTIVE with the full before/after line model).

- Sections listed in order, each with ▲ ▼ and rename; "Add section".
- Lines under each section with ▲ ▼, the label, the item number, and the SKU chip (or "needs a SKU" in red with a picker); "Add line → pick SKU" appends to that section; "Move to section" dropdown.
- A side bucket, "Active SKUs not on the guide", each with "Place in [section]" → appended last in that section.
- Remove line (not delete SKU). Removing a section requires it to be empty.
- Save = one transaction: the server rewrites positions dense (1..n) for the touched guide, enforces one-line-per-SKU, returns the new state. Optimistic UI, then reconcile.
- Phone-first: 44px targets, no drag and drop.

The old per-SKU "guide position" column is dropped in 0205; any form field or seed line that referenced it (seed 35 writes an explicit null) is removed in the same PR.

## 7. Error handling

- A PO whose vendor has no guide: every line has null position → "Not on the guide" is the only group; the header is suppressed when it is the only one.
- Guide edited after a PO was drafted: a draft renders live for lines without a snapshot; a confirmed PO keeps its snapshot (by design).
- Seed ambiguity never writes; the report is the resolution path (floor question, then a manager places the line in admin, or fixes the SKU and reruns the seed, which re-matches only null-SKU lines).
- Concurrent admin saves: the editor sends the guide's `updated_at` it loaded; a stale token → 409 `guide_stale`, the client reloads and replays nothing (the manager redoes the move on the fresh state). The audit row stores the FULL before and after line model (section → [label, sku_id, position]), not counts, so a bad save is recoverable by hand.

## 8. Tests

- `tests/order-guide-sort.test.ts`: positions win over names for all tiers; nulls last; section grouping helper yields headers in order with "Not on the guide" last and suppressed when alone.
- `tests/seed-37-order-guides.test.ts`: routing of both sheets (incl. second-sheet rows routed by SKU vendor, Baldor/TRANSFER to report), the three match rules and ambiguity → null sku_id, idempotent `already`, hand-edited guide → `refused`, `verifyWriteScope`.
- `tests/order-guides-editor.test.ts`: move up/down renumbers dense; move-to-section; one-line-per-SKU rejection; empty-section delete rule; stale `updated_at` → 409.
- `tests/po-body.test.ts`: `renderPoBodyText`: section headers, guide order, "Not on the guide" last and suppressed when alone; the email text body equals the copied body byte for byte.
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

## 11. Aggie review r2 — adjudication (2026-09-16)

| # | Finding | Decision |
|---|---|---|
| 1 | `unique (sku_id)` collides with a repeated sheet item / second-sheet rows matching a laminate SKU | **Accepted in part.** Uniqueness stays (one vendor per SKU → one guide; two lines for one SKU makes the sort ambiguous). The seed dedups: first occurrence wins, repeats go to the report (§3, §5). Juan Q1 below settles whether repeats are real. |
| 2 | Snapshot-only render buries legacy POs and late-added lines under "Not on the guide" | **Accepted.** Read rule = `snapshot ?? live` in `loadPoDetail` (§3). |
| 3 | Audit counts vs "both states"; last-write-wins loses deletions | **Accepted.** Full before/after model in the audit row + `updated_at` precondition → 409 (§6, §7). |
| 4 | Seed rerun path dead after any hand edit | **Accepted.** Reruns only re-match null-SKU lines and append new sheet rows; hand edits are never touched (§5 rule 4). |
| 5 | Mixed "Leonard Paper / Trimark" header; duplicate section names from the second sheet | **Accepted.** Per-vendor section-name map in the seed; `unique (guide_id, name)`; routed rows join a same-named section (§3, §5 rule 1). |
| 6 | `active` column unusable under `unique (vendor_id)` | **Accepted.** Column dropped (§3). |
| 7 | Copied body and emailed body are two implementations | **Accepted.** One pure `renderPoBodyText` feeds both (§4, tests). |
| 8 | `guide_position` fallback reads permanent NULL | **Accepted.** Dropped in 0205; all readers migrated in the PR (§3, §6). |

**Model limits she named, left as-is on purpose:** a SKU sold by two vendors is two `vendor_items` by the multi-vendor doctrine (2026-08-20), and each sits on its own vendor's guide; that is the intended shape, not a gap. Pack and size on a line stay free text until V3-C brings the vendor's own catalog fields.

**Owner questions, answered 2026-09-16.** Q1 (repeats): Juan was not sure, so CC scanned the transcription: exactly one repeat exists, PFG item 439686 printed twice as "Eggs" (Dairy, row 22) and "Eggs (cooked)" (Dairy, row 23) — the second is a prep par written on the order sheet, not a second order line. Every other near-match is a distinct product (pan / pan lid, cup / cup lid, box top / box bottom). The rule stands: first occurrence is the line, the repeat goes to the report; `unique (sku_id)` holds. Q2 (small vendors): Juan — "some vendors' ordering is small, so they don't have their own; we would have to create it for them from what we have or know" → second-sheet rows route onto matched vendors' guides now, and every remaining vendor gets a starter guide (§5 rule 6).
