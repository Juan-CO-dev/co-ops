# Vendor Ordering V3-B — Barcode scanning at the receiving door (optional path)

**Date:** 2026-09-16 · **Author:** CC (Fable) with Juan · **Status:** design approved by Juan in conversation ("Option 1 … Looks great"); Aggie-bench adversarial review r2 (2026-09-16, `.claude/hermes-dispatches/2026-09-16T19-25-50_v3b-spec-review-r2.md`) = *build with changes*, all eight points adjudicated in §11; pending Juan's read. Sibling of V3-A (`2026-09-16-vendor-ordering-v3a-order-guides-design.md`); builds after A.

## 1. Purpose

At the door a case comes off the truck and the receiver picks its line from a list, then sets a quantity. Juan (2026-09-16): scanning is **an option, never the way** — "allow people to do it the way we have set; scanning just becomes an option to make things easier and faster", and the door is where it earns its keep first (Leg B answer: A).

Success: a receiver with a phone, or a shop with a cheap Bluetooth scanner, can scan a case label and have the right delivery line open with its quantity stepped, teach an unknown code in one tap inside the delivery, and never be forced to scan. A manager who never taps Scan sees no change.

## 2. Facts (verified 2026-09-16)

- Door intake: `components/receiving/ReceivingForm.tsx` (line rows `components/receiving/IntakeLineRow.tsx`; the add-line picker calls `onAdd(sku: ReceivingSkuOption)` at `ReceivingForm.tsx:960`, `:1242-1255`). Lines carry an explicit `skuId`; the server resolves by id and enforces line vendor == delivery vendor (`lib/receiving.ts:707-722`, `lib/receiving-shared.ts findVendorMismatch`, DB floor mig 0178).
- `lib/security-headers.ts:132` sends `Permissions-Policy: camera=(), microphone=(), geolocation=()` — camera denied for every origin including our own; the module header (`:120-125`) says it was set because nothing used the camera. Existing photo capture is `<input accept="image/*" capture>` (`components/photos/PhotoCapture.tsx`), which is not affected by that header.
- No barcode column or table exists anywhere; no scanner library in `package.json`. `vendor_items.item_number` is PFG's item number (not a barcode). Multi-vendor twins share a `product_id` (mig 0179; doctrine 2026-08-20): the same physical product from two vendors is two SKU rows.
- Audit actions are declared in `lib/audit-actions.ts` (`NON_DESTRUCTIVE_ACTIONS` from `:43`).
- Receiving is gated at role level ≥ 4, key holder (`app/api/operations/receiving/route.ts:21`; `RECEIVE_MIN` in `.../continue/route.ts:16`). The people who receive ARE key holders, so teach-by-use at the same gate reaches everyone who scans.
- Boar's Head cases are weighed proteins: their GS1-128 labels carry the GTIN plus per-case lot and weight application identifiers, so the raw label string differs on every case.
- iOS Safari does not implement `BarcodeDetector`; Chrome/Android does.

## 3. Data model (migration 0206)

```sql
create table public.sku_barcodes (
  id          uuid primary key default gen_random_uuid(),
  sku_id      uuid not null references public.vendor_items(id),
  code        text not null,                       -- as scanned, digits/uppercase, no spaces (normalised in TS)
  symbology   text not null default 'unknown',     -- ean_13 | upc_a | code_128 | gs1_128 | itf_14 | qr | unknown
  level       text not null default 'case',        -- case | inner : what ONE scan of this code means
  taught_by   uuid null references public.users(id),
  taught_at   timestamptz not null default now(),
  note        text null,
  forgotten_at timestamptz null,                   -- soft delete; lookups ignore forgotten rows
  check (level in ('case','inner'))
);
-- a code is the MANUFACTURER's: twins at two vendors share it; the SAME code can mean case AND inner for one SKU
create unique index sku_barcodes_live_key on public.sku_barcodes (code, sku_id, level) where forgotten_at is null;
create index sku_barcodes_code_ix on public.sku_barcodes (code) where forgotten_at is null;
-- deny-all RLS, revoke from anon/authenticated/public (0174/0182/0203 posture)
```

Why not `unique (code)`: a UPC/GTIN is printed by the manufacturer, so Boar's Head Turkey from PFG and from Leonard carry the same code on two `vendor_items` rows. One code → many SKUs is real; the lookup rule (§4) disambiguates by the delivery's vendor. Why `level` is in the key: case and inner pack often print the identical UPC; both meanings may be taught, and a scan that matches both asks case/inner once (default case).

**What `code` holds.** The GTIN (or the plain code for non-GS1 symbologies), never the raw label. `normalizeCode` parses GS1-128 / GS1 DataBar application identifiers: AI 01 or 02 → the GTIN; AI 10 (lot), 31xx (weight), 11/15/17 (dates) are stripped and discarded (V3-B does not keep lot or weight; V3-C or a later spec may). A code whose check digit fails is still stored as scanned (a reprinted label is a real object on the floor) and flagged `symbology = 'unknown'`.

**Forget is a soft delete:** `forgotten_at` is stamped; lookups ignore forgotten rows; the unique key covers live rows only, so a forgotten code can be re-taught cleanly.

## 4. Lookup rule (pure, tested)

`lib/barcodes.ts`:

```ts
export function normalizeCode(raw: string): string          // trim, strip spaces/dashes, GTIN-14 leading-zero fold to 13/12 where valid
export type ScanMatch =
  | { kind: "line";  lineIndex: number; skuId: string; level: "case" | "inner" }   // on this delivery
  | { kind: "sku";   skuId: string; level: "case" | "inner" }                        // this vendor's SKU, not on the delivery yet
  | { kind: "twin";  skuId: string; viaSkuId: string; level: "case" | "inner" }      // taught on another vendor's twin; this vendor's twin offered
  | { kind: "unknown" };
export function resolveScan(code, ctx: { vendorId, deliveryLines, codesForVendor, codesElsewhere, twinsByProduct }): ScanMatch
```

Order: (1) a code taught on a SKU that is **on this delivery** → `line`; (2) taught on another SKU of **this vendor** → `sku`; (3) taught only on a SKU of **another vendor** whose product has a twin at this vendor → `twin` (accepting teaches the code for the twin, same level); (4) otherwise `unknown`. Ties inside a step (two of this vendor's SKUs with the same code — a data error) → the one on the delivery, else the first by name, and the response carries `ambiguous: true` so the UI shows the picker instead of auto-opening.

**Counting rule.** One *scan event* = one unit on the matched line at the code's level: every scanner trigger (a code followed by Enter) is an event, and in the camera sheet's keep-scanning mode a decode of the same code is one event only after the code has left the frame or 1 500 ms have passed, so a label held still does not rack up phantom units. A stack of five cases is five triggers. The rule lives in the client scan field and is keyed to the open tab; one scan tab per delivery (a reload or a second tab does not carry the window, and the line's quantity is the source of truth the receiver sees either way).

## 5. Server

Two routes beside the existing receiving routes under `app/api/operations/receiving/scan/`, gated at the SAME level as receiving (`RECEIVE_MIN`, key holder, the people who actually receive), `assertSameOrigin`, location-bound to the actor (BC-asymmetry: same binding as every receiving route):

- `POST …/scan/lookup` `{ deliveryId, code }` → `ScanMatch` (+ `ambiguous`, + `levels: ('case'|'inner')[]` when more than one is taught). Read-only; no audit.
- `POST …/scan/teach` `{ code, skuId, level, symbology?, deliveryId, confirmLevelChange?: true }` → `{ ok, created: boolean }`. Idempotent on `(code, skuId, level)`. If the code is already taught for this SKU at a **different** level, the route answers 409 `level_differs` with the stored level; the client shows a one-line confirm ("Taught as CASE. Also teach it as INNER?") and re-posts with `confirmLevelChange: true`, which ADDS the second level (both may be true) — nothing is silently rewritten. Audit action `sku.barcode.taught` (NON_DESTRUCTIVE; metadata: code, sku_id, level, symbology, delivery_id). `deliveryId` is required, so every teach is queryable by delivery from the audit row. Refuses (400 `vendor_mismatch`) if the SKU's vendor differs from the delivery's vendor.
- `POST …/scan/forget` `{ code, skuId, level }` → soft delete (`forgotten_at`), audit `sku.barcode.forgotten` (DESTRUCTIVE list: it removes a live code from lookups).

No new write path into deliveries: a scan only manipulates the same client line state the stepper does, and the existing submit path validates it as today.

## 6. Client

`components/receiving/ScanField.tsx`, mounted once in `ReceivingForm` above the line list:

- **Keyboard-wedge path (always on when a delivery is open).** No focus-holding input. A document-level `keydown` listener keeps a burst buffer: keys arriving with ≤ 35 ms between them are a scanner, not a person (HID guns emit a whole code in well under 100 ms end to end; human typing is > 80 ms per key). A buffer of ≥ 6 chars terminated by Enter, or by a 300 ms silence, is a scan event; the keystrokes are swallowed (`preventDefault`) so a scan never lands in whatever text field happens to be focused, and the burst heuristic means a person typing a search never becomes a scan. A small "Scanner ready" pill shows while a delivery is open. Numeric-keypad and IME edge cases are out of scope for V3-B.
- **Camera path (on tap).** A "Scan" button opens a bottom sheet with a live camera preview. Decoder: `BarcodeDetector` when `"BarcodeDetector" in window`, else `zxing-wasm` (npm, pinned) dynamically imported **only when the sheet opens** — nothing is added to the door page's bundle otherwise. Formats: EAN-13, UPC-A, Code 128 / GS1-128, ITF-14, QR. First decode closes the sheet and submits the code; a "keep scanning" toggle leaves it open for stacks.
- **After lookup.** `line` → expand that row, set its level picker from the code's level, quantity +1, haptic tick where supported. `sku` → the row is added through the existing `onAdd(sku)` path, then treated as `line`. `twin` → a one-line confirm ("Taught on the PFG twin — use Leonard's Turkey?") → add + teach. `unknown` → sheet lists this delivery's lines (tap = teach + step), a "not on this delivery" button that opens the existing add-line search (choosing teaches too), and a "case / inner" toggle defaulting to case.
- **Camera header.** `Permissions-Policy` becomes `camera=(self), microphone=(), geolocation=()` — global to every route (the header is app-wide by construction), but only the door page ever calls `getUserMedia`, so the permission prompt appears there and nowhere else; the module comment is rewritten to name the door scanner as the one consumer. The existing header test pins all three tokens, not just camera.
- i18n keys under `receiving.scan.*` (en + es).

## 7. Errors and edges

- Camera denied or unavailable → the sheet shows one sentence and the keyboard path stays; nothing else degrades.
- A code taught to the wrong SKU: the receiver opens the line's "…" menu → "Forget this code" (the forget route, soft delete, audited).
- A scan while the delivery is already submitted → the field is not mounted (the form is read-only past submit).
- Offline / slow: lookup timeout 4 s → treated as `unknown` with a "couldn't check — pick the line" note. **Teaching needs connectivity**, same as submitting the delivery does; if the teach POST fails the line is still stepped (that part is local state) and the sheet says the code was not remembered. No offline queue (YAGNI; the door has Wi-Fi and the delivery submit needs it anyway).

## 8. Tests

- `tests/barcodes.test.ts`: `normalizeCode` (spaces, dashes, GTIN-14 fold, GS1-128 AI parsing: 01/02 → GTIN, 10/31xx/11/15/17 stripped, bad check digit kept + flagged, rejects <6 chars); `resolveScan` order (line > sku > twin > unknown), ambiguity flag, both-levels case, twin only when a same-product SKU exists at this vendor, forgotten rows ignored.
- `tests/scan-routes.test.ts`: `RECEIVE_MIN` gate (employee 403, key holder 200), same-origin, location binding, vendor mismatch 400, teach idempotency on (code, sku, level), 409 `level_differs` then add with confirm, forget soft-deletes and audits, deliveryId required.
- `tests/scan-field.test.tsx`: burst heuristic (35 ms keys = scan, 120 ms keys = typing), Enter and 300 ms termination, keystrokes swallowed while a burst is open, camera keep-scanning re-decode rule (same code held = one event; away and back = two), a focused search box never receives a scan.
- `tests/security-headers.test.ts` (existing): all three Permissions-Policy tokens pinned (`camera=(self)`, `microphone=()`, `geolocation=()`).
- Sim: a claim in the `ordering` suite — teach a code on delivery 1, scan it on delivery 2 → the line opens with qty 1; a second scan → 2.

## 9. Out of scope

Scanning during the walk or a count · printing our own labels · reading PFG invoice/packing-list barcodes · a dedicated teach screen (teaching happens at the door; V3-C may bulk-load codes if the MOXē export carries GTINs) · keeping GS1 lot/weight/date data · an offline teach queue.

## 10. Rollout

Mig 0206 → sim → harness `ordering` suite green → PR → CC review → Juan's word → merge + 0206 on prod. No seed: codes are taught by use. Optional hardware note for Pete: any Bluetooth barcode scanner in HID keyboard mode works; nothing to configure in the app.

## 11. Aggie review r2 — adjudication (2026-09-16)

| # | Finding | Decision |
|---|---|---|
| 1 | Key-holder gate could sever teach-by-use if receivers hold a lower role | **Resolved by fact.** Receiving itself is gated at level ≥ 4 (`RECEIVE_MIN`); receivers are key holders. Scan routes use the same constant (§2, §5). |
| 2 | Focus-holding hidden input is fragile; 50 ms pause splits scans | **Accepted.** Document-level keydown burst buffer (≤ 35 ms inter-key = scanner), Enter or 300 ms silence terminates, keystrokes swallowed (§6). |
| 3 | GS1-128 variable AIs (weighed Boar's Head cases) never re-match | **Accepted.** `normalizeCode` parses AIs, stores the GTIN, strips lot/weight/dates (§3, §4, tests). |
| 4 | 2 s duplicate window yields phantom units; client-only across tabs | **Accepted, reframed.** One scan event = one unit; camera re-decode of a held label is one event until it leaves the frame or 1.5 s pass; one scan tab per delivery (§4). |
| 5 | "Teach still records" offline is impossible | **Accepted.** Teaching needs connectivity, stated plainly; the line still steps locally; no queue (§7). |
| 6 | Silent level rewrite on re-teach | **Accepted.** 409 `level_differs` + confirm; the second level is ADDED, never rewritten (§5). |
| 7 | Permissions-Policy is global; tests pin only camera | **Accepted.** Stays global by construction; all three tokens pinned; prompt appears only on the door page (§6, §8). |
| 8 | Same UPC on case and inner cannot coexist | **Accepted.** Key is `(code, sku_id, level)`; lookup returns both levels and asks once (§3, §4). |

**Data-model gaps she named:** forget is now a soft delete (history kept); invalid check digits are stored and flagged; GS1 payload data is discarded on purpose (named in §9); every teach carries `deliveryId` so "codes taught on delivery N" is a query on the audit log.

**Owner questions.** Q1 (receivers' role) answered by the codebase: key holder, same as receiving. Q2 (cases vs inners): the existing received-level picker already distinguishes them; a scan sets the level from the code, so an inner scan steps the inner count and a case scan the case count — no new counting rule. Juan to confirm on his read.
