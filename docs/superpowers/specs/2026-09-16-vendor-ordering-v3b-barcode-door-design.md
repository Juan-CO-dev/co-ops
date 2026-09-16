# Vendor Ordering V3-B — Barcode scanning at the receiving door (optional path)

**Date:** 2026-09-16 · **Author:** CC (Fable) with Juan · **Status:** design approved by Juan in conversation ("Option 1 … Looks great"); spec pending his read. Sibling of V3-A (`2026-09-16-vendor-ordering-v3a-order-guides-design.md`); builds after A.

## 1. Purpose

At the door a case comes off the truck and the receiver picks its line from a list, then sets a quantity. Juan (2026-09-16): scanning is **an option, never the way** — "allow people to do it the way we have set; scanning just becomes an option to make things easier and faster", and the door is where it earns its keep first (Leg B answer: A).

Success: a receiver with a phone, or a shop with a cheap Bluetooth scanner, can scan a case label and have the right delivery line open with its quantity stepped, teach an unknown code in one tap inside the delivery, and never be forced to scan. A manager who never taps Scan sees no change.

## 2. Facts (verified 2026-09-16)

- Door intake: `components/receiving/ReceivingForm.tsx` (line rows `components/receiving/IntakeLineRow.tsx`; the add-line picker calls `onAdd(sku: ReceivingSkuOption)` at `ReceivingForm.tsx:960`, `:1242-1255`). Lines carry an explicit `skuId`; the server resolves by id and enforces line vendor == delivery vendor (`lib/receiving.ts:707-722`, `lib/receiving-shared.ts findVendorMismatch`, DB floor mig 0178).
- `lib/security-headers.ts:132` sends `Permissions-Policy: camera=(), microphone=(), geolocation=()` — camera denied for every origin including our own; the module header (`:120-125`) says it was set because nothing used the camera. Existing photo capture is `<input accept="image/*" capture>` (`components/photos/PhotoCapture.tsx`), which is not affected by that header.
- No barcode column or table exists anywhere; no scanner library in `package.json`. `vendor_items.item_number` is PFG's item number (not a barcode). Multi-vendor twins share a `product_id` (mig 0179; doctrine 2026-08-20): the same physical product from two vendors is two SKU rows.
- Audit actions are declared in `lib/audit-actions.ts` (`NON_DESTRUCTIVE_ACTIONS` from `:43`).
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
  unique (code, sku_id),                           -- a code is the MANUFACTURER's: twins at two vendors share it
  check (level in ('case','inner'))
);
create index sku_barcodes_code_ix on public.sku_barcodes (code);
-- deny-all RLS, revoke from anon/authenticated/public (0174/0182/0203 posture)
```

Why not `unique (code)`: a UPC/GTIN is printed by the manufacturer, so Boar's Head Turkey from PFG and from Leonard carry the same code on two `vendor_items` rows. One code → many SKUs is real; the lookup rule (§4) disambiguates by the delivery's vendor.

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

**Duplicate-scan window.** The same normalised code arriving within 2 000 ms of the previous scan is one more unit on the same line (a stack of five cases = five scans), never a second lookup. Implemented in the client scan field, not the server.

## 5. Server

Two routes beside the existing receiving routes, key holder and up (`ROLES.key_holder`), `assertSameOrigin`, location-bound to the actor (BC-asymmetry: same binding as every receiving route):

- `POST /api/receiving/scan/lookup` `{ deliveryId, code }` → `ScanMatch` (+ `ambiguous`). Read-only; no audit.
- `POST /api/receiving/scan/teach` `{ code, skuId, level, symbology?, deliveryId? }` → `{ ok, created: boolean }`. Idempotent on `(code, skuId)`; a second teach with a different `level` **updates** the level (the receiver just learned the truth) and audits it. Audit action `sku.barcode.taught` (NON_DESTRUCTIVE; metadata: code, sku_id, level, symbology, delivery_id, previous_level). Refuses (400 `vendor_mismatch`) if the SKU's vendor differs from the delivery's vendor when `deliveryId` is given.

No new write path into deliveries: a scan only manipulates the same client line state the stepper does, and the existing submit path validates it as today.

## 6. Client

`components/receiving/ScanField.tsx`, mounted once in `ReceivingForm` above the line list:

- **Keyboard-wedge path (always on when a delivery is open).** A visually hidden input keeps focus when no other field is focused; a Bluetooth/USB scanner types the code and Enter. Enter (or a 50 ms pause after ≥ 6 chars) submits the code. Typing in any other field takes focus away naturally; a small "Scan ready" pill shows when the field has focus so the receiver knows a gun will land.
- **Camera path (on tap).** A "Scan" button opens a bottom sheet with a live camera preview. Decoder: `BarcodeDetector` when `"BarcodeDetector" in window`, else `zxing-wasm` (npm, pinned) dynamically imported **only when the sheet opens** — nothing is added to the door page's bundle otherwise. Formats: EAN-13, UPC-A, Code 128 / GS1-128, ITF-14, QR. First decode closes the sheet and submits the code; a "keep scanning" toggle leaves it open for stacks.
- **After lookup.** `line` → expand that row, set its level picker from the code's level, quantity +1, haptic tick where supported. `sku` → the row is added through the existing `onAdd(sku)` path, then treated as `line`. `twin` → a one-line confirm ("Taught on the PFG twin — use Leonard's Turkey?") → add + teach. `unknown` → sheet lists this delivery's lines (tap = teach + step), a "not on this delivery" button that opens the existing add-line search (choosing teaches too), and a "case / inner" toggle defaulting to case.
- **Camera header.** `Permissions-Policy` becomes `camera=(self), microphone=(), geolocation=()`; the module comment is rewritten to name the door scanner as the one consumer. No other page requests the camera.
- i18n keys under `receiving.scan.*` (en + es).

## 7. Errors and edges

- Camera denied or unavailable → the sheet shows one sentence and the keyboard path stays; nothing else degrades.
- A code taught to the wrong SKU: the receiver opens the line's "…" menu → "Forget this code" (calls teach with `forget: true`, audit `sku.barcode.forgotten`, DESTRUCTIVE list because it deletes a row).
- A scan while the delivery is already submitted → the field is not mounted (the form is read-only past submit).
- Offline / slow: lookup timeout 4 s → treated as `unknown` with a "couldn't check — pick the line" note; the teach still records.

## 8. Tests

- `tests/barcodes.test.ts`: `normalizeCode` (spaces, dashes, GTIN-14 fold, rejects <6 chars); `resolveScan` order (line > sku > twin > unknown), ambiguity flag, twin only when a same-product SKU exists at this vendor.
- `tests/scan-routes.test.ts`: role gate, same-origin, location binding, vendor mismatch 400, teach idempotency, level update audits `previous_level`, forget audits.
- `tests/scan-field.test.tsx`: duplicate-scan window, Enter/pause submission, focus rules (a focused text field must not swallow a scan into itself).
- `tests/security-headers.test.ts` (existing): camera=(self) pinned, others unchanged.
- Sim: a claim in the `ordering` suite — teach a code on delivery 1, scan it on delivery 2 → the line opens with qty 1; a second scan → 2.

## 9. Out of scope

Scanning during the walk or a count · printing our own labels · reading PFG invoice/packing-list barcodes · a dedicated teach screen (teaching happens at the door; V3-C may bulk-load codes if the MOXē export carries GTINs).

## 10. Rollout

Mig 0206 → sim → harness `ordering` suite green → PR → CC review → Juan's word → merge + 0206 on prod. No seed: codes are taught by use. Optional hardware note for Pete: any Bluetooth barcode scanner in HID keyboard mode works; nothing to configure in the app.
