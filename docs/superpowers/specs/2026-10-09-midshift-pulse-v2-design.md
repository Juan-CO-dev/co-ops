# Mid-shift Pulse v2 — design (approved by Juan 2026-10-09)

## Purpose
The pulse is the screen nearly everyone opens during a shift. v2 pulls in as much live information as possible, sectioned properly, with **visuals up front** on the pulse and **depth on each section's own page**, and every piece **scoped to the viewer's role**. Reports stay the place for finished history; the pulse owns everything live (including the live views deferred from Reports hub v2).

## Layout
**Pulse home (one scroll, visuals first):**
1. Header: shop tabs (8+ get a side-by-side both-shops view), pulse score (existing RED/YELLOW/GREEN, `midshift-shared`), last-refresh time.
2. **Needs attention** — one ranked list, each row with a one-tap action: uncovered station, station due to close/trim (station close times), late task, missed checklist, fridge out of range / unchecked, item low vs par, catering order not rung into Toast, upcoming catering not prepped, unlinked Toast clock-in (who's here).
3. **Live 3D shop floor** (hero visual card) — see below.
4. Section cards, each a compact visual + 2–3 key numbers + "See more" to its own page:
   - **People** — who's here (Toast + presence), on break, stations covered/open, clock-outs that freed stations.
   - **Stations & tasks** — open/covered/closing soon, tasks done vs left, by station.
   - **Sales** (GM+) — today's pace vs a normal day for that weekday (hour curve), sales so far, checks, avg check, top sellers now, refunds/discounts so far, channel mix.
   - **Catering** — next hours, prep status, ezCater vs Toast confirmation, not rung yet.
   - **Inventory** — items running low vs par, recent receiving, 86 risk.
   - **Food safety** — fridge temps/checks, excursions.
   - **Handoff** — AM→PM notes, done/left, incoming manager "Got it" acknowledgement.

**Section pages (depth):** each card's "See more" opens a full live page for that section with the detailed tables/charts (e.g. Sales: hourly heatmap today vs typical, item/modifier velocity, server and channel breakdown, refunds/discounts by name; People: timeline of clock-ins/outs/breaks/covers; Inventory: full low list with par, on-hand, last count, next delivery).

## Role scoping (enforced server-side; never hide-only)
- Crew (<4): own tasks/stations, shop status (stations, catering timing, food-safety reminders), handoff notes addressed to them. **No money, no other people's details.**
- KH/SL (4–5): + Needs attention, People, Stations & tasks actions, Inventory, Catering, Food safety.
- AGM (6): + Handoff authoring/ack.
- GM (7): + Sales/money for their shop.
- 8+: both shops side by side, all sections.
Each section and section page re-checks scope on the server; drill links never widen scope.

## 3D shop floor (three.js)
- Stylized per-shop layout, not a replica: stations auto-arranged by type (line, expo, walk-ins, Crunchy Boi, 3rd party, catering); GM+ can drag stations once to match the real shop (saved per shop, audited).
- Stations glow green (covered), yellow (closing soon / short), red (uncovered / overdue); assigned people shown at their station; a closed station dims.
- Tap a station → who's on it, its tasks, close/trim time, one-tap action (assign, cover, close) via existing actions.
- three.js lazy-loaded only when the card renders/expands; falls back to a 2D map on low-end devices or reduced-motion; never blocks the rest of the pulse.

## Charts
Polished, animated **2D** (fast to read mid-rush) for every number: pace curve, heatmap, bars. No 3D charts.

## Data & freshness
- Refresh every 60 s without reload; Needs attention first; each section loads independently (one failing section shows its own error, never blanks the page).
- Reuse existing sources: Toast capture (sales, refunds incl. late-refund sweep), who's here, stations lifecycle (0230/0233) + station close times, catering + ezCater reconcile, checklists, fridge checks, pars/inventory. No new external polling; every DB call well under the 8 s statement timeout; no N+1.
- "Normal day" baseline = trailing same-weekday average from captured Toast data (state the basis on the chart).

## Quality bar
en/es parity, 44 px targets, 360–1440 px with no page scroll, accessible colors (not color-only status), loading skeletons, empty states, behind `PULSE_V2` (off) until Juan tries it. Tests: role scoping per section + section page (server), attention ranking, section isolation on failure, 3D fallback, baseline math, i18n parity.

## Delivery
CO CC builds (Fable 5.1 for the 3D + overall), plan first from this spec; Astra reviews; CC verifies on the sim and merges. Depends on station close times (Astra, in flight) — integrate when merged, stub behind its absence otherwise.
