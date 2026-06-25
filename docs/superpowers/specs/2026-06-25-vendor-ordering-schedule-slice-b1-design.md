# Vendor Ordering Schedule — Slice B1 Design

**Date:** 2026-06-25
**Phase:** Item/Inventory Spine — vendor mini-arc, Slice B1 (of B1 schedule / B2 aggregated calendar)
**Depends on:** Vendor Slice A shipped (#95). Branches off main.
**Status:** draft, pending review

---

## Goal
Capture, per vendor, a weekly **order-days + delivery-days** schedule and a **vendor color**, on the vendor detail page (GM+). This is the data the **B2 aggregated landing-page calendar** will render (each vendor a distinct color; order vs delivery = two shades). B1 = the data + per-vendor editor only; B2 = the dashboard widget.

## Decisions (Juan-locked)
- Aggregated calendar colors = **each vendor a distinct color**, order/delivery shown as two shades → so a vendor carries a **color**.
- **Split:** B1 (this) = per-vendor schedule + color. B2 = the aggregated calendar.

## Architecture (B1)

### Migration 0094
`vendors` gains:
- `order_days smallint[]` (weekday set; **confirm the weekday convention at build** — match `item_par_levels.day_of_week` if it has one, else 0=Sun..6=Sat per JS `getDay`). Default `'{}'`.
- `delivery_days smallint[]`. Default `'{}'`.
- `color text` (a hex from a fixed palette — see UI). Nullable.

(Arrays on the vendor row, not a child table — it's a fixed weekly pattern, single set per vendor. RLS unchanged; service-role writes.)

### Lib `lib/admin/vendors.ts`
- `VendorView` gains `orderDays: number[]`, `deliveryDays: number[]`, `color: string | null`.
- `loadVendors`/`getVendor` select + return them.
- `setVendorSchedule(actor, { vendorId, orderDays, deliveryDays, color })` — **GM+** (vendor-profile data, same tier as classification). Validate days ∈ the weekday range, dedup; color ∈ the allowed palette (or null). Set updated_*. Audit `vendor.full_profile_edit` (scope:"schedule", before/after).

### Route
`PATCH /api/admin/vendors/[id]/schedule` (GM+ Tier A) `{ orderDays:[], deliveryDays:[], color }` → setVendorSchedule. Validate types.

### UI — vendor detail "Ordering schedule" card (GM+)
- A weekly strip rendered twice: an **Order days** row + a **Delivery days** row, each a M–S toggle set.
- A **color picker** = a fixed palette of ~10 distinguishable, on-brand colors (swatches); pick one (the vendor's calendar color). Fixed palette (not free hex) → legible, non-clashing calendar in B2.
- Read-only below GM+. Save → PATCH schedule (Tier A).
- (Optional: show a small color dot + the order-day abbreviations on the vendor list row.)
- EN+ES i18n (weekday abbreviations reuse existing day i18n if present; else add).

### No B2 here
The aggregated dashboard calendar (reads all vendors' order/delivery days, color-coded by vendor with order/delivery shades, manager-visible) is **Slice B2** — its own brainstorm→build once schedules can be set.

## Testing
tsc + build + throwaway smoke (deleted): setVendorSchedule (GM+) sets order/delivery days + color → loadVendors reflects them; AGM blocked (403); invalid weekday/color rejected. Operator smoke (Juan, preview): set a vendor's order/delivery days + color on the detail page.

## Open decisions (your review)
- **D1 — color source.** Fixed palette of ~10 swatches (recommended — legible calendar) vs free hex picker. *Default: fixed palette.*
- **D2 — schedule edit authority.** GM+ (vendor-profile, matches classification). *Default GM+* — confirm (vs AGM+ since it's operational scheduling managers maintain).

## Out of scope
- B2 aggregated landing-page calendar.
- Slice C (SKU catalog + SKU→item BOM).
