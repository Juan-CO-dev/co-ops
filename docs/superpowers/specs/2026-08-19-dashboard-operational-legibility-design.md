# Dashboard operational legibility — design (2026-08-19)

Supersedes the seed at `2026-08-11-dashboard-operational-legibility.md` (problem statement there stands; this locks the shapes). Decisions below were made with Juan on 2026-08-19 via mockup selection (visual-companion session, mockups persisted in `.superpowers/brainstorm/93085-1787185110/content/`).

## Problem (proven)
The 2-day sim's #1 finding, 3/3 manager personas independently: **the dashboard can't show the operation.** After a real day of deliveries, counts, and orders, the landing page still renders empty action CTAs; managers reconstructed the day by opening receiving + counts + ordering across two locations. This build makes the dashboard (and mid-shift) COMPOSE today's operational state.

## The design grammar (Juan-ratified, extends to all future status tiles)
**The most urgent operational fact is the headline; everything handled shrinks to pills.**
Receiving leads with per-truck problems · counts leads with staleness · ordering leads with the deadline.

## §1 The three status tiles (dashboard)

### ReceivingTile → per-truck mini-list
- Label row: `RECEIVING · N today`.
- One row per delivery: **vendor** (bold) + badge pills (photo missing · N short · complete) + time, problems sorted first.
- **Cap 3 rows** + "and N more" line when exceeded.
- Quiet action underneath: "+ Log another delivery" (small-control label grammar).
- **Empty state: today's "Log a delivery" action tile, unchanged.**
- Data: existing `loadRecentDeliveries` (lib/receiving.ts) — today's deliveries with badges, PO thread, missing-photo flags. No new loader.
- Gate: ≥4, as today.

### CountsTile → days-since gauge (pressure is deliberate)
- Big number: **days since last count** (28px, climbs — Juan: "the pressure is good for us"). Computed server-side.
- Pills once real counts exist: `N variances` (red pill) · `N SKUs anchored` (gold pill).
- **Never-counted state (launch-day truth): "—" + "start your first count" pill**, sub-line honest that on-hand runs on estimates until the first count. Never invent numbers.
- Data: counts state from lib/counts.ts (last count event date, anchored-SKU count, flagged variances).

### Ordering surface → cutoff-led tile
- When a vendor cutoff is open today and no order started: **the cutoff time is the headline — 28px, `co-cta-text` red** — "3:00p · Ferraro cutoff — not started". Multiple open cutoffs: the NEAREST one is the headline; the others render as red pills alongside the handled ones.
- Handled state shrinks to pills: `PFG placed` (green) · `Baldor draft` (gold).
- No open cutoff: headline is "All orders in" or the placed count.
- Data: existing `loadTodaysOrders` (lib/purchase-orders.ts) + vendor cutoff config (the ordering attention item logic).
- Gate: ≥4 (matches the nav `minLevel` fix, PR #254). Below 4 the tile hides.

Tile-wide rules: whole tile taps through to its full surface · all strings en+es incl. ARIA · EmptyState component for genuine empties · no invented data — a term the loader can't supply renders as its honest absence, never a fabricated number.

## §2 Mid-shift composition + bundled sim fixes

- **Operational strip**: the three composed HEADLINE facts (one-line forms of §1, not full tiles) on the mid-shift pulse page, same shared compose helpers.
- **SIM-25 (safety-adjacent, LOUD by Juan's call — "we need people to keep the fridge temp"):** the fridge aggregate may never claim "all in range" while any fridge lacks a reading. Rules: (a) "in range" is a claim only about fridges actually read; (b) **any unread fridge renders the strip's alert state (red) until it is read**; (c) zero readings = red "no readings yet". The false-all-clear case becomes a permanent vitest case.
- **Close status, one source of truth**: one shared helper defining a day's close state (closed / auto-finalized / pending / in-progress), consumed by the dashboard tile, mid-shift, and the reports surface — the sim found one close reading three different ways on three screens. Build near `components/reports-hub/shared.ts` (the status-label module from PR #254); implementer verifies the three current call sites and converges them.
- **SIM-18b**: ordering board refreshes after a walk completes (router.refresh gap — verify the exact seam before fixing).

## §3 Architecture

- **No migration. No new routes. No new loaders.** Read surfaces over existing artifacts (house law).
- **Compose logic is pure and lives in `lib/`** (client-safe shared module per the `*-shared.ts` pattern): per-tile functions taking loader outputs → `{headline, pills, rows}` view models. Tiles and the mid-shift strip are thin renderings of the same functions. Vitest in the same PR (new-pure-logic law).
- **Tile grammar normalization** (this build owns the dashboard's skin — the restyle sweep excludes it): tile labels move from the rogue `tracking-[0.16em]` to the design-law field-label spec (`tracking-[0.12em]`); tile CTAs adopt ActionButton (operational surface). Token floor (PR #255) supplies all colors — zero raw hex.
- **Tablets designed, not interpolated** (recomposition law): explicit md 2-up grid; phone stacks; desktop 3-up per #245's shell.
- Server components stay server; gauge/day math computed server-side.

## §4 Verification
- Vitest: every compose function; SIM-25 aggregation (incl. the false-all-clear regression case); close-status helper.
- `npm test` + `next build` + CI; `scripts/check-ui-tokens.ts` over the diff.
- Juan smokes the preview on phone AND tablet width. Visual gate = his eyes.

## Out of scope (explicit)
- SIM-13 (on-hand panel as a gauge with par/variance/cost) — own follow-up.
- The restyle sweep for every other surface (arc Phase 2).
- Coverage bars on the staff quote builder (Juan: later; could ride a future dashboard pass).
- Any new capture workflow — this build only reads.

## Sequencing note
Bug 8's seed fix (PR #253) is merged, so the receiving numbers this dashboard composes are honest. First physical count remains Juan's errand; the CountsTile never-counted state is the launch-day rendering.
