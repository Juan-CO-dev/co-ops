# Vendor Ordering Calendar — Slice B2 Design

**Date:** 2026-06-25
**Phase:** Item/Inventory Spine — vendor mini-arc, Slice B2 (aggregated calendar). Depends on B1 (#96, merged).
**Status:** draft, pending review

---

## Goal
A dashboard widget showing the week's vendor ordering/delivery schedule at a glance — what to order when — reading every active vendor's B1 schedule. **Lives on the dashboard (the landing page), outside the vendor cards.**

## Decisions (Juan-locked)
- **Placement:** main **dashboard** widget (the page everyone lands on).
- **Audience:** **SL+ (≥5)** — shift-leads (training toward AGM) and up.
- **Colors:** each vendor a **distinct color** (its B1 `color`); **order = solid, delivery = lighter shade** of that color.
- Recurring **weekly** pattern (order/delivery days are weekday sets, not dated) → a typical-week view with **today highlighted**.

## Architecture

### Data — `loadVendorOrderingWeek(actor)` (lib/admin/vendors.ts)
Read-only, gated **≥5** (SL+; below the ≥6 admin read floor — the calendar is non-sensitive: vendor name + color + weekday sets only). Returns active vendors that have ≥1 order or delivery day:
```ts
interface VendorWeekEntry { id; name; color: string | null; orderDays: number[]; deliveryDays: number[]; }
```
(Active only; vendors with no schedule omitted. No contacts/financials — just what the calendar needs.)

### Widget — dashboard
- Server component `components/dashboard/OrderingCalendar.tsx` (read-only; no client interactivity needed).
- Rendered on `app/(authed)/dashboard/page.tsx` **only when the viewer's level ≥ 5**, near the top (landing priority).
- Layout: 7 weekday rows (Sun..Sat, 0..6 to match the data), each listing the vendors that **order** that day (solid color chip + name) and **deliver** that day (lighter-shade chip + name). **Today's row highlighted** (`operationalDayOfWeek(today)`). Empty days show a muted "—".
- Each vendor chip uses the vendor's `color`; order chips solid, delivery chips a lighter tint (e.g. color at reduced opacity / a `color`+`/20` background with a colored dot). A small legend (order vs delivery).
- **Read-only** (no links — SL/<admin can't reach /admin/vendors; keeps it clean). A vendor with no `color` falls back to a neutral gray chip.
- Mobile-first: rows stack; chips wrap.
- EN+ES i18n (heading "This week's ordering", order/delivery legend, weekday labels reuse `people.weekday.*`, "today", empty "—").

### Today highlight
Use `operationalDayOfWeek` (lib/items.ts) for the current operational weekday (0=Sun..6=Sat), matching the data convention.

## Testing
tsc + build + throwaway smoke (deleted): `loadVendorOrderingWeek` returns active scheduled vendors with color/days for an SL-level actor; a <5 actor is rejected (or the widget is hidden — the loader gate is the guard). Operator smoke (Juan, preview): set a couple vendors' schedules + colors (admin), then the dashboard shows them on the right days, color-coded, today highlighted.

## Open decisions (your review)
- **D1 — vendor chip links.** Read-only (no link) recommended — SL/<6 can't open /admin/vendors, and the widget is at-a-glance. (Could link to the detail for ≥6 only later.) Confirm read-only.
- **D2 — week orientation.** Rows = weekdays (mobile-friendly list) vs a 7-column grid. *Recommend rows* (stacks cleanly on phones; the dashboard is phone-first). 

## Out of scope
- Dated calendar / month view / holiday exceptions (the schedule is weekday-recurring).
- Order placement / receiving workflow (later spine steps).
- Slice C (SKU catalog + SKU→item BOM).
