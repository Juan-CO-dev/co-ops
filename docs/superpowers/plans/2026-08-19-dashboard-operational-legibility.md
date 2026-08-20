# Dashboard Operational Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal**

Make the dashboard and the mid-shift pulse COMPOSE today's operational state — deliveries, count staleness, and the binding order cutoff — instead of rendering empty action CTAs, and fix the three sim defects that ride the same surfaces (SIM-25 false fridge all-clear, three-way close-status drift, SIM-18b stale ordering board).

**Architecture**

All compose logic is PURE and lives in one new client-safe module, `lib/dashboard-status-shared.ts`, whose per-tile functions take existing loader outputs and return `{headline, pills, rows}` view models carrying i18n KEYS (never resolved strings) — the established key-returning pattern from `components/reports-hub/shared.ts`. The dashboard tiles, the new mid-shift operational strip, and the rebuilt fridge strip are thin renderings of those same functions, so a fact composed once reads identically on every surface. No migration, no new routes, no new capture workflow; one small read-only loader is added for the counts tile (see **Deviation D1** — this needs the lead's sign-off).

**Tech Stack**

- Next.js 16.2.4 App Router (Server Components), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`
- Tailwind v4 (CSS-first, `app/globals.css` `@theme inline`) — token floor classes only
- Vitest (`tests/`, `npm test`) for the pure modules
- i18n: flat dotted keys in `lib/i18n/en.json` + `lib/i18n/es.json`; `TranslationKey = keyof typeof en`

---

## Deviations from the spec (READ FIRST — these need the lead's decision)

The spec's shapes are followed exactly except where the live code makes a line impossible or wasteful. Each is called out here rather than silently absorbed.

> **LEAD RULINGS (CC, 2026-08-19 — all seven deviations BLESSED as argued below; anchor claims independently verified: the `sku_inferred_baselines` upsert on `loadOnHand`'s path, the yesterday-temp/`no_reading_today` split in `loadMaintenanceOverview`, and the missing `auto_finalized` branch in the dashboard's `statusCopyFor`).**
> Additions to carry into the build: (1) the receiving compose's today-filter over `loadRecentDeliveries`' 20-row window is a CAP — name it in a code comment where the filter lives (no silent caps); (2) D2's follow-up (wiring `varianceCount` on the counts page, which already pays for `loadOnHand`) goes to the ROADMAP, not this build; (3) D5's shape is ratified as *one vocabulary, two granularities*: `deriveCloseState` must map FROM the canonical status set in `components/reports-hub/shared.ts`, never define a parallel reading.

**D1 — "No new loaders" vs. the CountsTile's data.** Spec §3 says *no new loaders*; spec §1 says the counts tile reads *"last count event date, anchored-SKU count, flagged variances"* from `lib/counts.ts`. The only existing loader is `loadOnHand` (`lib/counts.ts:704`), and it is unusable from the dashboard: it loads every active SKU, computes 28-day consumption lanes over paged `productions` + `production_inputs` + `toast_daily_depletion`, and **performs a WRITE** (`sku_inferred_baselines` upsert, `lib/counts.ts:467`) on the render path. Running it per dashboard render for every GM+ viewer is a serious perf and side-effect regression. This plan adds `loadCountsTileState` — a **read-only, 2-query** loader over `sku_count_events` + `sku_count_lines` (Task 9). It creates no artifact and reads only existing ones, which is the substance of the house law; it is a "new loader" only in the literal sense.

**D2 — `N variances` cannot be supplied.** Variance is **not persisted** anywhere. `sku_count_lines` (written at `lib/counts.ts:211`) carries `count_event_id, sku_id, level_label, qty, is_loose, partial_fraction, anchor_dimension, resolved_oz, resolved_units` — no variance column. Variance is computed live inside `loadOnHand` via `computeVariance` against each SKU's *previous* count. So a cheap read cannot produce it, and it is doubly dormant at launch: with zero count events there is nothing, and even after Juan's FIRST count every SKU's variance is `null` by design ("first count" → null, never 0 — `lib/counts.ts:696-699`). **Resolution:** `composeCountsTile` takes `varianceCount: number | null` and renders the red pill when a caller supplies it; the dashboard passes `null`, so the pill is an honest absence per the spec's own no-invented-data rule. The grammar ships complete and the counts page (which already pays for `loadOnHand`) can wire the term in a follow-up.

**D3 — `N short` is not on the receiving loader.** Spec §1 wants per-truck badges *"photo missing · N short · complete"*. `DeliveryView` (`lib/receiving.ts:163-185`) carries no short count; the short/over signal is collapsed into `matchState: "counted_only" | "matched" | "discrepant" | "override"`. Per-line `discrepancy_type` exists only on `DeliveryDetail` (a per-delivery query — an N+1 on a tile). **Resolution:** the tile uses the receiving page's *existing, already-translated* badge vocabulary (`receiving.badge.discrepant` / `photo_missing` / `in_progress` / `matched` / `override` / `email_missing`, rendered at `app/(authed)/operations/receiving/page.tsx:117-137`). "N short" becomes the `discrepant` badge. This is a vocabulary match with the surface the tile taps through to, which is better than a second grammar.

**D4 — "explicit md 2-up grid" is already exceeded; do not narrow it.** Spec §3 asks for an explicit `md` 2-up. `ReportsSection` (`app/(authed)/dashboard/page.tsx:902`) already ships `grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3` from #245, Juan-smoked. `sm:` (640px) already gives every `md` width 2-up; changing it to `md:` would *remove* 2-up from 640–767px — a regression against shipped recomposition law. **Resolution: leave the grid unchanged.** The spec's intent (tablets designed, not interpolated) is satisfied; the tiles' internal layouts get explicit `sm:`/`md:` handling instead.

**D5 — Converging the close status on all three surfaces would REGRESS the reports surface.** The three readings are not three copies of one thing:
- **Dashboard** `statusCopyFor` (`app/(authed)/dashboard/page.tsx:237-280`) branches on a 3-value `ClosingStatus = "open" | "confirmed" | "incomplete_confirmed"` and **has no `auto_finalized` branch** — an auto-finalized day falls through to the `// open` case at line 267 and renders *"In progress"* with a *"Continue closing"* CTA. **This is a live bug on a routine path**, not a theoretical one: `releaseClosingByOpener` (`lib/checklists.ts:2701`) asserts `template.type === "closing"` and writes `status: "auto_finalized"` (line 2740) — that is the designed outcome every time a closer walks out and the opener releases the closing next morning. The `system_auto` path reaches the same status via `evaluateAutoReleaseForUserLocations`, which **the dashboard itself fires** in its own `after()` block (line 321-326). So the dashboard invites a manager to "continue" a closing that is already finalized and that the dashboard's own background call finalized.
- **Mid-shift** `progressFor` (`lib/midshift.ts:108`) uses `isSubmitted` (`lib/midshift-shared.ts:23`), whose set *does* include `auto_finalized` — correct, but coarse (done / in_progress / not_started).
- **Reports** `REPORT_STATUS_LABEL_KEYS` (`components/reports-hub/shared.ts:20`) is the full 8-status vocabulary — correct **and** finest-grained.

Forcing the reports surface down to the spec's 4-state would delete `phase1_complete` / `phase2_complete` / `submitted` from its labels. **Resolution:** build the 4-state `deriveCloseState` helper, adopt it on the dashboard (fixing the bug) and mid-shift, keep the reports surface's raw-status labels, and put the *shared vocabulary* in one module so all three agree on what a status means. Reports-hub is the reference, not a defect.

**D6 — SIM-25 is worse than specced, and the obvious fix is wrong.** `loadMaintenanceOverview` (`lib/maintenance.ts:155-159`) computes:
```ts
const latest = readings.length ? readings[readings.length - 1]! : null;   // latest SINCE sinceDate
status: computeFridgeStatus(todays, ...)                                  // TODAY only
```
so `PulseFridge.latestF` (`lib/midshift.ts:378`) can display **yesterday's** temperature while `status === "no_reading_today"`. The strip then renders a neutral chip *with a number* next to "All fridges in range". Deriving `hasReadingToday` from `latestF !== null` would therefore be **silently wrong**. It must derive from `status !== "no_reading_today"` (Task 8), and unread chips must not print the stale number.

**D7 — the strip's LOUD rule intentionally diverges from the attention banner's time gate.** The existing unchecked-fridge attention item is gated behind `minutesOfDay > EXPECTED_BY.openingOverdueAfter` (`lib/midshift.ts:390`, council decision F4 — "else the 9am view is all noise"). Spec §2(b) says *any* unread fridge reddens **the strip**, with no clock. This plan makes the **strip** unconditionally loud and leaves the **attention banner's** F4 gate untouched. Both are deliberate; they are different surfaces.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `lib/dashboard-status-shared.ts` | The whole pure core: view-model types, `deriveCloseState`, `composeFridgeAggregate`, `daysBetweenYmd`, `composeCountsTile`, `deriveMissingEmailIds`, `composeReceivingTile`, `composeOrderingTile`. Zero I/O, no server imports. |
| `components/ordering/OrderingTile.tsx` | Dashboard status tile for ordering — cutoff-led headline, handled-state pills. |
| `components/midshift/OperationalStrip.tsx` | Mid-shift one-line forms of the three tile headlines, from the same compose helpers. |
| `tests/dashboard-status-close-state.test.ts` | Pins the 4-state close model incl. the `auto_finalized` regression. |
| `tests/dashboard-status-fridges.test.ts` | Pins the SIM-25 aggregation incl. the permanent false-all-clear regression case. |
| `tests/dashboard-status-tiles.test.ts` | Pins `daysBetweenYmd` + the three tile compose functions. |

**Modified**

| File | Change |
| --- | --- |
| `components/receiving/ReceivingTile.tsx` | Action tile → status tile (per-truck rows, cap 3, quiet CTA, unchanged empty state). |
| `components/counts/CountsTile.tsx` | Action tile → days-since gauge + pills + never-counted state. |
| `components/midshift/FridgeStrip.tsx` | Renders `composeFridgeAggregate`; LOUD unread rule; no stale-number claim. |
| `components/reports-hub/shared.ts` | Gains `CLOSE_STATE_LABEL_KEYS` + `closeStateLabelKey` (the shared close vocabulary). |
| `components/ordering/ParPassWalker.tsx` | SIM-18b: `router.refresh()` on successful walk submit. |
| `app/(authed)/dashboard/page.tsx` | Loads the three tile payloads (fail-soft), renders `OrderingTile`, adopts `deriveCloseState` in `statusCopyFor`. |
| `app/(authed)/mid-shift/page.tsx` | Mounts `OperationalStrip` above the report list. |
| `app/(authed)/operations/receiving/page.tsx` | Imports the now-shared `deriveMissingEmailIds` instead of its local copy. |
| `lib/midshift-shared.ts` | `PulseFridge` gains `hasReadingToday`. |
| `lib/midshift.ts` | Populates `hasReadingToday` from `status !== "no_reading_today"`. |
| `lib/counts.ts` | Adds read-only `loadCountsTileState` (see D1). |
| `lib/i18n/en.json`, `lib/i18n/es.json` | All new strings + ARIA, added in the task that introduces them. |

---

## Task 1 — Branch

- [ ] Create the branch off a clean `main`.

```bash
cd /c/Users/conta/co-ops
git fetch && git checkout main && git reset --hard origin/main
git checkout -b feat/dashboard-operational-legibility
```

- [ ] Confirm the base commit is `673ac06`:

```bash
git log --oneline -1
```

Expected: `673ac06 docs: dashboard operational-legibility design spec ...`

---

## Task 2 — Close state: failing test

- [ ] Create `tests/dashboard-status-close-state.test.ts`:

```ts
/**
 * The ONE close-state model (design 2026-08-19 §2). Before this helper the
 * dashboard branched on a 3-value union with NO auto_finalized case
 * (app/(authed)/dashboard/page.tsx statusCopyFor), so an auto-finalized day
 * rendered "In progress" + a "Continue closing" CTA. That case is pinned here
 * permanently.
 */
import { describe, it, expect } from "vitest";
import { deriveCloseState } from "@/lib/dashboard-status-shared";

describe("deriveCloseState", () => {
  it("no instance is pending, not in_progress", () => {
    expect(deriveCloseState(null)).toEqual({ status: "pending", incomplete: false });
    expect(deriveCloseState(undefined)).toEqual({ status: "pending", incomplete: false });
    expect(deriveCloseState("")).toEqual({ status: "pending", incomplete: false });
  });

  it("REGRESSION: auto_finalized is its own closed state, never in_progress", () => {
    expect(deriveCloseState("auto_finalized")).toEqual({
      status: "auto_finalized",
      incomplete: false,
    });
  });

  it("manual finalization is closed", () => {
    expect(deriveCloseState("confirmed")).toEqual({ status: "closed", incomplete: false });
    expect(deriveCloseState("phase2_complete")).toEqual({ status: "closed", incomplete: false });
  });

  it("incomplete_confirmed is closed WITH the incomplete flag (nuance preserved, no 5th state)", () => {
    expect(deriveCloseState("incomplete_confirmed")).toEqual({
      status: "closed",
      incomplete: true,
    });
  });

  it("every started-but-unfinalized status is in_progress", () => {
    for (const s of ["open", "in_progress", "phase1_complete", "submitted"]) {
      expect(deriveCloseState(s).status).toBe("in_progress");
    }
  });

  it("an unknown status degrades to in_progress, never to a false 'closed'", () => {
    expect(deriveCloseState("some_future_status").status).toBe("in_progress");
  });

  it("agrees with the mid-shift isSubmitted set on every submitted status", () => {
    for (const s of ["phase2_complete", "confirmed", "incomplete_confirmed", "auto_finalized"]) {
      expect(["closed", "auto_finalized"]).toContain(deriveCloseState(s).status);
    }
  });
});
```

- [ ] Run it and see it fail:

```bash
npx vitest run tests/dashboard-status-close-state.test.ts
```

Expected failure: `Error: Failed to resolve import "@/lib/dashboard-status-shared"` — the module does not exist yet.

---

## Task 3 — Close state: implementation + i18n

- [ ] Create `lib/dashboard-status-shared.ts`:

```ts
/**
 * Dashboard + mid-shift operational status — the CLIENT-SAFE pure core
 * (design: docs/superpowers/specs/2026-08-19-dashboard-operational-legibility-design.md).
 *
 * Zero I/O, no server imports, per the *-shared.ts pattern (AGENTS.md "Module
 * boundaries & testing"). Every function here is a pure transform from an
 * EXISTING loader's output to a view model; the dashboard tiles and the
 * mid-shift strip are thin renderings of these same functions, so one fact
 * reads identically on both surfaces.
 *
 * KEY-RETURNING, NOT STRING-RETURNING (the components/reports-hub/shared.ts
 * precedent): view models carry TranslationKeys + params; translation happens
 * at the call site, which already holds the viewer's language. That keeps
 * these functions testable without an i18n dictionary.
 *
 * NO INVENTED DATA (design §1): a term a loader cannot supply is modelled as
 * `null` and renders as an honest absence — never a fabricated number.
 */

import type { TranslationKey } from "@/lib/i18n/types";

// ─────────────────────────────────────────────────────────────────────────────
// View-model primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Semantic pill tone. Member names are deliberately identical to
 * `AlertPillTone` (components/ui/AlertPill.tsx) so a view model's tone is
 * structurally assignable to the primitive with no conversion — while lib/
 * keeps its no-imports-from-components/ direction.
 */
export type StatusPillTone = "warn" | "danger" | "ok" | "info";

export interface StatusPill {
  /** Stable React key (unique within its pill list). */
  id: string;
  key: TranslationKey;
  params?: Record<string, string | number>;
  tone: StatusPillTone;
}

export interface StatusRow {
  /** Stable React key. */
  id: string;
  /** Already-resolved display text — a vendor name, never translated. */
  title: string;
  /** Pre-formatted secondary text (a time/date from the house formatters), or null. */
  meta: string | null;
  pills: StatusPill[];
  /** True when this row carries a problem; problem rows sort first. */
  problem: boolean;
}

/**
 * The tile's leading fact. `form: "gauge"` renders the 28px numeral treatment
 * (days-since, a cutoff clock time) with `value` as the numeral and `key` as
 * the caption; `form: "text"` renders the sentence form and ignores `value`.
 */
export interface StatusHeadline {
  key: TranslationKey;
  params?: Record<string, string | number>;
  form: "gauge" | "text";
  value: string | null;
  tone: StatusPillTone;
}

export interface TileViewModel {
  headline: StatusHeadline;
  pills: StatusPill[];
  rows: StatusRow[];
  /** Rows suppressed by the row cap; 0 when nothing was hidden. */
  overflowCount: number;
  /** True when the tile should render its own empty/action state instead. */
  empty: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Close state — ONE reading of a day's close (design §2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A day's close state. Four states, exactly as specced:
 *   pending        — no closing instance today
 *   in_progress    — an instance exists but is not finalized
 *   closed         — manually finalized
 *   auto_finalized — the system closed it (the state the dashboard used to drop)
 */
export type CloseStatus = "pending" | "in_progress" | "closed" | "auto_finalized";

export interface CloseState {
  status: CloseStatus;
  /**
   * True when the day closed with required items still incomplete (raw
   * `incomplete_confirmed`). A flag rather than a fifth state so the operational
   * nuance survives without splitting the model.
   */
  incomplete: boolean;
}

/** Raw checklist_instances.status values that mean "manually finalized". */
const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  "confirmed",
  "incomplete_confirmed",
  "phase2_complete",
]);

/**
 * The single derivation of a day's close state from a raw
 * `checklist_instances.status`. Consumed by the dashboard tile and mid-shift;
 * the reports surface keeps its finer raw-status labels (they carry
 * phase1_complete/submitted, which this 4-state deliberately folds away).
 *
 * An UNKNOWN status degrades to `in_progress`, never to `closed` — claiming a
 * day is closed on a status we do not recognize is the dangerous direction.
 */
export function deriveCloseState(rawStatus: string | null | undefined): CloseState {
  if (rawStatus == null || rawStatus === "") return { status: "pending", incomplete: false };
  if (rawStatus === "auto_finalized") return { status: "auto_finalized", incomplete: false };
  if (CLOSED_STATUSES.has(rawStatus)) {
    return { status: "closed", incomplete: rawStatus === "incomplete_confirmed" };
  }
  return { status: "in_progress", incomplete: false };
}
```

- [ ] Add the close-state strings to `lib/i18n/en.json` (insert beside the existing `dashboard.status.*` block):

```json
  "close.status.pending": "Not started",
  "close.status.in_progress": "In progress",
  "close.status.closed": "Closed",
  "close.status.closed_incomplete": "Closed with items incomplete",
  "close.status.auto_finalized": "Auto-finalized",
```

- [ ] Add the same keys to `lib/i18n/es.json` (same insertion point):

```json
  "close.status.pending": "Sin empezar",
  "close.status.in_progress": "En progreso",
  "close.status.closed": "Cerrado",
  "close.status.closed_incomplete": "Cerrado con pendientes",
  "close.status.auto_finalized": "Cerrado automáticamente",
```

- [ ] Run the test and see it pass:

```bash
npx vitest run tests/dashboard-status-close-state.test.ts
```

Expected: 7 passed.

- [ ] Commit:

```bash
git add lib/dashboard-status-shared.ts tests/dashboard-status-close-state.test.ts lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(dashboard): one close-state model, with the auto_finalized regression pinned"
```

---

## Task 4 — Close-state vocabulary in the reports-hub module

- [ ] Append to `components/reports-hub/shared.ts` (after `reportStatusLabel`):

```ts
import type { CloseStatus, CloseState } from "@/lib/dashboard-status-shared";

/**
 * Close-STATE → translation key. The sibling of REPORT_STATUS_LABEL_KEYS above:
 * that map is the fine-grained RAW status vocabulary the reports surfaces render
 * (phase1_complete, submitted, …); this one is the 4-state operational close
 * reading the dashboard tile and the mid-shift strip render. Both live here so
 * the three surfaces share ONE vocabulary module (design §2).
 */
export const CLOSE_STATE_LABEL_KEYS: Record<CloseStatus, TranslationKey> = {
  pending: "close.status.pending",
  in_progress: "close.status.in_progress",
  closed: "close.status.closed",
  auto_finalized: "close.status.auto_finalized",
};

/**
 * Translation key for a close state. The `incomplete` flag promotes `closed` to
 * its more honest label — the day IS closed, but with required items unfinished.
 */
export function closeStateLabelKey(state: CloseState): TranslationKey {
  if (state.status === "closed" && state.incomplete) return "close.status.closed_incomplete";
  return CLOSE_STATE_LABEL_KEYS[state.status];
}
```

- [ ] Typecheck:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] Commit:

```bash
git add components/reports-hub/shared.ts
git commit -m "feat(reports-hub): close-state label vocabulary beside the raw-status map"
```

---

## Task 5 — SIM-25 fridge aggregation: failing test

- [ ] Create `tests/dashboard-status-fridges.test.ts`:

```ts
/**
 * SIM-25 — the fridge aggregate may NEVER claim "all in range" while any fridge
 * lacks a reading (design §2, safety-adjacent, LOUD by Juan's call).
 *
 * The shipped defect: components/midshift/FridgeStrip.tsx rendered
 * `flagCount === 0 ? "All fridges in range" : ...`, and flagCount counted only
 * out_of_range fridges (lib/midshift.ts:381). Eight fridges with zero readings
 * produced flagCount 0 → a green all-clear. Worse, PulseFridge.latestF is the
 * latest reading SINCE sinceDate (lib/maintenance.ts:155), not today's, so the
 * chip could print YESTERDAY's number beside that all-clear.
 *
 * The false-all-clear case below is a PERMANENT regression case.
 */
import { describe, it, expect } from "vitest";
import { composeFridgeAggregate, type FridgeFacts } from "@/lib/dashboard-status-shared";

const fridge = (over: Partial<FridgeFacts> & { equipId: string }): FridgeFacts => ({
  name: `Fridge ${over.equipId}`,
  latestF: null,
  outOfRange: false,
  hasReadingToday: false,
  ...over,
});

describe("composeFridgeAggregate", () => {
  it("REGRESSION (SIM-25): eight unread fridges is ALERT + 'no readings yet', never all-clear", () => {
    const fridges = ["1", "2", "3", "4", "5", "6", "7", "8"].map((equipId) => fridge({ equipId }));
    const vm = composeFridgeAggregate(fridges);
    expect(vm.state).toBe("alert");
    expect(vm.headline.key).toBe("midshift.fridges.none_read");
    expect(vm.headline.tone).toBe("danger");
    expect(vm.unreadCount).toBe(8);
    expect(vm.readCount).toBe(0);
  });

  it("REGRESSION (SIM-25): a stale yesterday reading does NOT count as read", () => {
    // latestF is populated (yesterday's 38F) but nobody temped it today.
    const vm = composeFridgeAggregate([fridge({ equipId: "1", latestF: 38, hasReadingToday: false })]);
    expect(vm.state).toBe("alert");
    expect(vm.readCount).toBe(0);
  });

  it("ONE unread fridge among read ones is still ALERT (rule b — no threshold)", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2", latestF: 37, hasReadingToday: true }),
      fridge({ equipId: "3" }),
    ]);
    expect(vm.state).toBe("alert");
    expect(vm.headline.key).toBe("midshift.fridges.some_unread");
    expect(vm.headline.params).toEqual({ unread: 1, total: 3 });
  });

  it("the in-range pill claims ONLY the fridges actually read (rule a)", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2", latestF: 37, hasReadingToday: true }),
      fridge({ equipId: "3" }),
    ]);
    const inRange = vm.pills.find((p) => p.key === "midshift.fridges.pill_in_range_of_read");
    expect(inRange?.params).toEqual({ count: 2 });
  });

  it("an out-of-range excursion outranks unread for the headline, and unread stays a pill", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 48, hasReadingToday: true, outOfRange: true }),
      fridge({ equipId: "2" }),
    ]);
    expect(vm.state).toBe("alert");
    expect(vm.headline.key).toBe("midshift.fridges.flagged");
    expect(vm.headline.params).toEqual({ count: 1 });
    expect(vm.pills.some((p) => p.key === "midshift.fridges.pill_unread")).toBe(true);
  });

  it("all read and all in range is the ONLY ok state, and it names the count", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2", latestF: 37, hasReadingToday: true }),
    ]);
    expect(vm.state).toBe("ok");
    expect(vm.headline.key).toBe("midshift.fridges.all_read_in_range");
    expect(vm.headline.params).toEqual({ count: 2 });
    expect(vm.unreadCount).toBe(0);
  });

  it("no fridges configured makes no claim either way", () => {
    const vm = composeFridgeAggregate([]);
    expect(vm.state).toBe("ok");
    expect(vm.headline.key).toBe("midshift.fridges.none_configured");
    expect(vm.pills).toEqual([]);
  });
});
```

- [ ] Run it and see it fail:

```bash
npx vitest run tests/dashboard-status-fridges.test.ts
```

Expected failure: `SyntaxError: The requested module '@/lib/dashboard-status-shared' does not provide an export named 'composeFridgeAggregate'`.

---

## Task 6 — SIM-25 fridge aggregation: implementation + i18n

- [ ] Append to `lib/dashboard-status-shared.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Fridge aggregate — SIM-25 (design §2, safety-adjacent, LOUD)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One fridge's facts. `hasReadingToday` is the SIM-25 term and MUST be derived
 * from the today-scoped FridgeStatus (`status !== "no_reading_today"`), never
 * from `latestF != null` — `latest` in lib/maintenance.ts is the latest reading
 * since `sinceDate`, so a fridge unread today can still carry yesterday's value.
 */
export interface FridgeFacts {
  equipId: string;
  name: string;
  latestF: number | null;
  outOfRange: boolean;
  hasReadingToday: boolean;
}

export type FridgeAggregateState = "ok" | "alert";

export interface FridgeAggregateVm {
  state: FridgeAggregateState;
  headline: StatusHeadline;
  pills: StatusPill[];
  outOfRangeCount: number;
  unreadCount: number;
  readCount: number;
}

/**
 * The fridge aggregate, per the three locked rules:
 *   (a) "in range" is a claim ONLY about fridges actually read;
 *   (b) ANY unread fridge renders the alert state until it is read — no clock
 *       gate, no threshold (the mid-shift ATTENTION BANNER keeps its separate
 *       F4 time gate; this is the strip);
 *   (c) zero readings = the "no readings yet" alert.
 *
 * An out-of-range excursion outranks unread for the HEADLINE (it is the worse
 * fact) but never suppresses the unread pill.
 */
export function composeFridgeAggregate(fridges: FridgeFacts[]): FridgeAggregateVm {
  const total = fridges.length;
  const readCount = fridges.filter((f) => f.hasReadingToday).length;
  const unreadCount = total - readCount;
  const outOfRangeCount = fridges.filter((f) => f.outOfRange).length;
  // "In range" counts only fridges READ today and not flagged (rule a).
  const inRangeCount = fridges.filter((f) => f.hasReadingToday && !f.outOfRange).length;

  if (total === 0) {
    return {
      state: "ok",
      headline: { key: "midshift.fridges.none_configured", form: "text", value: null, tone: "info" },
      pills: [],
      outOfRangeCount: 0,
      unreadCount: 0,
      readCount: 0,
    };
  }

  const pills: StatusPill[] = [];
  if (unreadCount > 0) {
    pills.push({
      id: "unread",
      key: "midshift.fridges.pill_unread",
      params: { count: unreadCount },
      tone: "danger",
    });
  }
  if (inRangeCount > 0) {
    pills.push({
      id: "in-range",
      key: "midshift.fridges.pill_in_range_of_read",
      params: { count: inRangeCount },
      tone: "ok",
    });
  }

  if (outOfRangeCount > 0) {
    return {
      state: "alert",
      headline: {
        key: "midshift.fridges.flagged",
        params: { count: outOfRangeCount },
        form: "text",
        value: null,
        tone: "danger",
      },
      pills,
      outOfRangeCount,
      unreadCount,
      readCount,
    };
  }

  if (readCount === 0) {
    // Rule (c) — nothing has been read; there is no "in range" claim to make.
    return {
      state: "alert",
      headline: {
        key: "midshift.fridges.none_read",
        params: { count: total },
        form: "text",
        value: null,
        tone: "danger",
      },
      pills,
      outOfRangeCount,
      unreadCount,
      readCount,
    };
  }

  if (unreadCount > 0) {
    // Rule (b) — partial coverage is still the alert state.
    return {
      state: "alert",
      headline: {
        key: "midshift.fridges.some_unread",
        params: { unread: unreadCount, total },
        form: "text",
        value: null,
        tone: "danger",
      },
      pills,
      outOfRangeCount,
      unreadCount,
      readCount,
    };
  }

  return {
    state: "ok",
    headline: {
      key: "midshift.fridges.all_read_in_range",
      params: { count: total },
      form: "text",
      value: null,
      tone: "ok",
    },
    pills: [],
    outOfRangeCount,
    unreadCount,
    readCount,
  };
}
```

- [ ] Add to `lib/i18n/en.json` beside the existing `midshift.fridges.*` block (~line 1460):

```json
  "midshift.fridges.none_configured": "No fridges set up",
  "midshift.fridges.none_read": "No readings yet — {count} fridges unread",
  "midshift.fridges.some_unread": "{unread} of {total} fridges not read yet",
  "midshift.fridges.all_read_in_range": "All {count} fridges read · in range",
  "midshift.fridges.pill_unread": "{count} unread",
  "midshift.fridges.pill_in_range_of_read": "{count} read · in range",
  "midshift.fridges.chip_unread": "not read",
  "midshift.fridges.aria": "Fridge temps: {summary}",
```

- [ ] Add to `lib/i18n/es.json` at the same block:

```json
  "midshift.fridges.none_configured": "No hay refrigeradores configurados",
  "midshift.fridges.none_read": "Todavía sin lecturas — {count} refrigeradores sin revisar",
  "midshift.fridges.some_unread": "{unread} de {total} refrigeradores sin revisar",
  "midshift.fridges.all_read_in_range": "Los {count} refrigeradores revisados · en rango",
  "midshift.fridges.pill_unread": "{count} sin revisar",
  "midshift.fridges.pill_in_range_of_read": "{count} revisados · en rango",
  "midshift.fridges.chip_unread": "sin revisar",
  "midshift.fridges.aria": "Temperaturas de refrigeradores: {summary}",
```

- [ ] Run the test and see it pass:

```bash
npx vitest run tests/dashboard-status-fridges.test.ts
```

Expected: 7 passed.

- [ ] Commit:

```bash
git add lib/dashboard-status-shared.ts tests/dashboard-status-fridges.test.ts lib/i18n/en.json lib/i18n/es.json
git commit -m "fix(midshift): SIM-25 fridge aggregate never claims all-clear with unread fridges"
```

---

## Task 7 — Tile compose functions: failing test

- [ ] Create `tests/dashboard-status-tiles.test.ts`:

```ts
/**
 * The three status-tile compose functions (design §1). Pure transforms from
 * existing loader outputs to {headline, pills, rows} view models — the
 * dashboard tiles and the mid-shift strip are thin renderings of these.
 */
import { describe, it, expect } from "vitest";
import {
  daysBetweenYmd,
  deriveMissingEmailIds,
  composeCountsTile,
  composeReceivingTile,
  composeOrderingTile,
  type ReceivingDeliveryFacts,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
} from "@/lib/dashboard-status-shared";

const delivery = (over: Partial<ReceivingDeliveryFacts> & { id: string }): ReceivingDeliveryFacts => ({
  vendorName: `Vendor ${over.id}`,
  deliveryDate: "2026-08-19",
  matchState: "counted_only",
  deliveryStatus: "complete",
  receiptUrl: "/api/photos/x",
  arrivedAt: "9:14 AM",
  missingEmail: false,
  ...over,
});

describe("daysBetweenYmd", () => {
  it("counts calendar days, not elapsed milliseconds", () => {
    expect(daysBetweenYmd("2026-08-19", "2026-08-19")).toBe(0);
    expect(daysBetweenYmd("2026-08-18", "2026-08-19")).toBe(1);
    expect(daysBetweenYmd("2026-07-19", "2026-08-19")).toBe(31);
  });

  it("crosses a DST boundary without drifting (UTC-midnight arithmetic)", () => {
    // US DST ends 2026-11-01; a naive local-time diff would return 30.958…
    expect(daysBetweenYmd("2026-10-25", "2026-11-24")).toBe(30);
  });

  it("never returns a negative day count", () => {
    expect(daysBetweenYmd("2026-08-20", "2026-08-19")).toBe(0);
  });
});

describe("deriveMissingEmailIds", () => {
  const nowMs = Date.parse("2026-08-19T12:00:00Z");
  const base = { deliveryStatus: "complete" as const, matchState: "counted_only" as const, emailReceiptId: null };

  it("flags a completed, unclaimed, never-attested delivery past the 48h grace", () => {
    const ids = deriveMissingEmailIds(
      [{ id: "a", ...base, createdAt: "2026-08-16T12:00:00Z" }],
      nowMs,
    );
    expect([...ids]).toEqual(["a"]);
  });

  it("does not flag inside the grace window", () => {
    const ids = deriveMissingEmailIds(
      [{ id: "a", ...base, createdAt: "2026-08-18T12:00:00Z" }],
      nowMs,
    );
    expect(ids.size).toBe(0);
  });

  it("does not flag an in-progress door, an attested match, or a claimed delivery", () => {
    const old = "2026-08-01T12:00:00Z";
    const ids = deriveMissingEmailIds(
      [
        { id: "a", ...base, deliveryStatus: "in_progress", createdAt: old },
        { id: "b", ...base, matchState: "matched", createdAt: old },
        { id: "c", ...base, emailReceiptId: "rcpt-1", createdAt: old },
      ],
      nowMs,
    );
    expect(ids.size).toBe(0);
  });
});

describe("composeReceivingTile", () => {
  const today = "2026-08-19";

  it("is empty when nothing landed today (yesterday's trucks do not count)", () => {
    const vm = composeReceivingTile({
      deliveries: [delivery({ id: "a", deliveryDate: "2026-08-18" })],
      today,
    });
    expect(vm.empty).toBe(true);
    expect(vm.rows).toEqual([]);
  });

  it("leads with the problem count and sorts problem rows first", () => {
    const vm = composeReceivingTile({
      deliveries: [
        delivery({ id: "clean", vendorName: "PFG" }),
        delivery({ id: "short", vendorName: "Ferraro", matchState: "discrepant" }),
      ],
      today,
    });
    expect(vm.headline.key).toBe("dashboard.receiving.headline_problems");
    expect(vm.headline.params).toEqual({ count: 1 });
    expect(vm.headline.tone).toBe("danger");
    expect(vm.rows.map((r) => r.id)).toEqual(["short", "clean"]);
    expect(vm.rows[0]!.problem).toBe(true);
  });

  it("all-clean reads as received-and-clean, not as a problem", () => {
    const vm = composeReceivingTile({
      deliveries: [delivery({ id: "a" }), delivery({ id: "b" })],
      today,
    });
    expect(vm.headline.key).toBe("dashboard.receiving.headline_clean");
    expect(vm.headline.params).toEqual({ count: 2 });
    expect(vm.headline.tone).toBe("ok");
    expect(vm.rows[0]!.pills.map((p) => p.key)).toEqual(["dashboard.receiving.badge_complete"]);
  });

  it("reuses the receiving page's badge vocabulary", () => {
    const vm = composeReceivingTile({
      deliveries: [delivery({ id: "a", matchState: "discrepant", receiptUrl: null, missingEmail: true })],
      today,
    });
    expect(vm.rows[0]!.pills.map((p) => p.key)).toEqual([
      "receiving.badge.discrepant",
      "receiving.badge.photo_missing",
      "receiving.badge.email_missing",
    ]);
  });

  it("caps at three rows and reports the overflow", () => {
    const vm = composeReceivingTile({
      deliveries: ["a", "b", "c", "d", "e"].map((id) => delivery({ id })),
      today,
    });
    expect(vm.rows).toHaveLength(3);
    expect(vm.overflowCount).toBe(2);
  });
});

describe("composeCountsTile", () => {
  it("never-counted renders the em-dash gauge and the start-your-first-count pill, no numbers", () => {
    const vm = composeCountsTile({
      lastCountDate: null,
      today: "2026-08-19",
      anchoredSkuCount: 0,
      varianceCount: null,
    });
    expect(vm.headline.form).toBe("gauge");
    expect(vm.headline.value).toBe("—");
    expect(vm.headline.key).toBe("dashboard.counts.never_caption");
    expect(vm.pills.map((p) => p.key)).toEqual(["dashboard.counts.never_pill"]);
  });

  it("climbs the days-since gauge and warms its tone as it ages", () => {
    const at = (d: string) =>
      composeCountsTile({ lastCountDate: d, today: "2026-08-19", anchoredSkuCount: 163, varianceCount: null });
    expect(at("2026-08-19").headline.value).toBe("0");
    expect(at("2026-08-19").headline.tone).toBe("ok");
    expect(at("2026-08-11").headline.value).toBe("8");
    expect(at("2026-08-11").headline.tone).toBe("warn");
    expect(at("2026-07-04").headline.value).toBe("46");
    expect(at("2026-07-04").headline.tone).toBe("danger");
  });

  it("shows the anchored pill once SKUs are anchored", () => {
    const vm = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: null,
    });
    const anchored = vm.pills.find((p) => p.key === "dashboard.counts.pill_anchored");
    expect(anchored?.params).toEqual({ count: 163 });
    expect(anchored?.tone).toBe("warn");
  });

  it("NO INVENTED DATA: a null variance term renders no variance pill at all", () => {
    const vm = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: null,
    });
    expect(vm.pills.some((p) => p.key === "dashboard.counts.pill_variances")).toBe(false);
  });

  it("renders the red variance pill when the term IS supplied, and omits it at zero", () => {
    const withVar = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: 4,
    });
    const pill = withVar.pills.find((p) => p.key === "dashboard.counts.pill_variances");
    expect(pill?.params).toEqual({ count: 4 });
    expect(pill?.tone).toBe("danger");

    const zeroVar = composeCountsTile({
      lastCountDate: "2026-08-18",
      today: "2026-08-19",
      anchoredSkuCount: 163,
      varianceCount: 0,
    });
    expect(zeroVar.pills.some((p) => p.key === "dashboard.counts.pill_variances")).toBe(false);
  });
});

describe("composeOrderingTile", () => {
  const cutoff = (over: Partial<OrderingCutoffFacts> & { vendorId: string }): OrderingCutoffFacts => ({
    vendorName: `Vendor ${over.vendorId}`,
    cutoffTime: "3:00 PM",
    hasDraft: false,
    ...over,
  });
  const order = (over: Partial<OrderingOrderFacts> & { poId: string }): OrderingOrderFacts => ({
    vendorName: `Vendor ${over.poId}`,
    status: "placed",
    ...over,
  });

  it("an open cutoff IS the headline — the clock as the gauge numeral, in red", () => {
    const vm = composeOrderingTile({
      openCutoffs: [cutoff({ vendorId: "ferraro", vendorName: "Ferraro", cutoffTime: "3:00 PM" })],
      orders: [],
    });
    expect(vm.headline.form).toBe("gauge");
    expect(vm.headline.value).toBe("3:00 PM");
    expect(vm.headline.key).toBe("dashboard.ordering.headline_cutoff");
    expect(vm.headline.params).toEqual({ vendor: "Ferraro" });
    expect(vm.headline.tone).toBe("danger");
  });

  it("the NEAREST cutoff leads; the rest become red pills (loader order is authoritative)", () => {
    const vm = composeOrderingTile({
      openCutoffs: [
        cutoff({ vendorId: "a", vendorName: "Baldor", cutoffTime: "11:00 AM" }),
        cutoff({ vendorId: "b", vendorName: "Ferraro", cutoffTime: "3:00 PM" }),
      ],
      orders: [],
    });
    expect(vm.headline.params).toEqual({ vendor: "Baldor" });
    const extra = vm.pills.filter((p) => p.key === "dashboard.ordering.pill_cutoff");
    expect(extra).toHaveLength(1);
    expect(extra[0]!.params).toEqual({ vendor: "Ferraro", time: "3:00 PM" });
    expect(extra[0]!.tone).toBe("danger");
  });

  it("handled orders shrink to per-status pills alongside an open cutoff", () => {
    const vm = composeOrderingTile({
      openCutoffs: [cutoff({ vendorId: "a", vendorName: "Ferraro" })],
      orders: [
        order({ poId: "1", vendorName: "PFG", status: "placed" }),
        order({ poId: "2", vendorName: "Baldor", status: "draft" }),
      ],
    });
    const placed = vm.pills.find((p) => p.id === "order-1");
    expect(placed?.key).toBe("dashboard.ordering.pill_placed");
    expect(placed?.params).toEqual({ vendor: "PFG" });
    expect(placed?.tone).toBe("ok");
    const draft = vm.pills.find((p) => p.id === "order-2");
    expect(draft?.key).toBe("dashboard.ordering.pill_draft");
    expect(draft?.tone).toBe("warn");
  });

  it("no open cutoff with orders in flight reads 'all orders in'", () => {
    const vm = composeOrderingTile({ openCutoffs: [], orders: [order({ poId: "1" })] });
    expect(vm.headline.key).toBe("dashboard.ordering.headline_all_in");
    expect(vm.headline.form).toBe("text");
    expect(vm.headline.tone).toBe("ok");
    expect(vm.empty).toBe(false);
  });

  it("a no-cutoff, no-order day is empty and claims nothing", () => {
    const vm = composeOrderingTile({ openCutoffs: [], orders: [] });
    expect(vm.empty).toBe(true);
    expect(vm.headline.key).toBe("dashboard.ordering.headline_none");
    expect(vm.headline.tone).toBe("info");
  });

  it("an unknown PO status still renders a pill rather than vanishing", () => {
    const vm = composeOrderingTile({
      openCutoffs: [],
      orders: [order({ poId: "1", vendorName: "PFG", status: "some_future_status" })],
    });
    const pill = vm.pills.find((p) => p.id === "order-1");
    expect(pill?.key).toBe("dashboard.ordering.pill_open");
    expect(pill?.tone).toBe("info");
  });
});
```

- [ ] Run it and see it fail:

```bash
npx vitest run tests/dashboard-status-tiles.test.ts
```

Expected failure: `SyntaxError: The requested module '@/lib/dashboard-status-shared' does not provide an export named 'daysBetweenYmd'`.

---

## Task 8 — Tile compose functions: implementation + i18n

- [ ] Append to `lib/dashboard-status-shared.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Day math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole CALENDAR days between two YYYY-MM-DD strings in the operational TZ.
 * UTC-midnight arithmetic sidesteps DST entirely — we are walking calendar
 * days, not converting between zones (the same trick app/(authed)/dashboard's
 * todayAndYesterday uses). Clamped at 0: a future anchor is not negative time.
 */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Receiving tile (design §1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of lib/receiving.ts `DeliveryView` this tile composes, plus the
 * caller-derived `missingEmail` flag (deriving it reads a clock, which must not
 * happen inside a pure compose or a render tree).
 */
export interface ReceivingDeliveryFacts {
  id: string;
  vendorName: string;
  /** YYYY-MM-DD — loadRecentDeliveries is NOT today-filtered, so we filter here. */
  deliveryDate: string;
  matchState: "counted_only" | "matched" | "discrepant" | "override";
  deliveryStatus: "in_progress" | "complete";
  receiptUrl: string | null;
  /** Pre-formatted arrival time (house formatTime), or null. */
  arrivedAt: string | null;
  missingEmail: boolean;
}

export interface ReceivingTileInput {
  deliveries: ReceivingDeliveryFacts[];
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
  /** Rows rendered before the "and N more" line. */
  cap?: number;
}

/** Default row cap — Juan-ratified at 3 (design §1). */
export const RECEIVING_ROW_CAP = 3;

/** Grace window before an unclaimed, never-attested delivery flags "missing email". */
export const MISSING_EMAIL_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * Deliveries that should flag "missing email": completed, no vendor claim on
 * file, never attested (still counted_only), older than the 48h grace window.
 * `nowMs` is INJECTED so this stays pure — the clock is read once by the caller.
 *
 * Extracted from app/(authed)/operations/receiving/page.tsx so the dashboard
 * tile and the receiving list apply ONE rule (they showed the same badge from
 * two copies otherwise).
 */
export function deriveMissingEmailIds(
  deliveries: Array<{
    id: string;
    deliveryStatus: "in_progress" | "complete";
    matchState: "counted_only" | "matched" | "discrepant" | "override";
    emailReceiptId: string | null;
    createdAt: string | null;
  }>,
  nowMs: number,
): Set<string> {
  const out = new Set<string>();
  for (const d of deliveries) {
    if (
      d.deliveryStatus === "complete" &&
      d.matchState === "counted_only" &&
      !d.emailReceiptId &&
      d.createdAt != null &&
      nowMs - Date.parse(d.createdAt) > MISSING_EMAIL_GRACE_MS
    ) {
      out.add(d.id);
    }
  }
  return out;
}

/** Badge pills for one delivery, in the receiving list's own order/vocabulary. */
function receivingBadges(d: ReceivingDeliveryFacts): StatusPill[] {
  const pills: StatusPill[] = [];
  if (d.deliveryStatus === "in_progress") {
    pills.push({ id: `${d.id}-progress`, key: "receiving.badge.in_progress", tone: "info" });
  }
  if (d.matchState === "discrepant") {
    pills.push({ id: `${d.id}-discrepant`, key: "receiving.badge.discrepant", tone: "danger" });
  }
  if (d.matchState === "override") {
    pills.push({ id: `${d.id}-override`, key: "receiving.badge.override", tone: "info" });
  }
  if (d.matchState === "matched") {
    // Attested clean — a GOOD state, kept for vocabulary parity with the
    // receiving list. Never counts toward isReceivingProblem.
    pills.push({ id: `${d.id}-matched`, key: "receiving.badge.matched", tone: "ok" });
  }
  if (d.receiptUrl === null) {
    pills.push({ id: `${d.id}-photo`, key: "receiving.badge.photo_missing", tone: "warn" });
  }
  if (d.missingEmail) {
    pills.push({ id: `${d.id}-email`, key: "receiving.badge.email_missing", tone: "warn" });
  }
  if (pills.length === 0) {
    // Nothing wrong: say so rather than rendering a bare row.
    pills.push({ id: `${d.id}-complete`, key: "dashboard.receiving.badge_complete", tone: "ok" });
  }
  return pills;
}

/** A delivery is a PROBLEM when any badge is a real alert (not the clean marker). */
function isReceivingProblem(d: ReceivingDeliveryFacts): boolean {
  return (
    d.deliveryStatus === "in_progress" ||
    d.matchState === "discrepant" ||
    d.receiptUrl === null ||
    d.missingEmail
  );
}

/**
 * Receiving as a per-truck mini-list. Leads with per-truck PROBLEMS (the design
 * grammar: the most urgent operational fact is the headline; everything handled
 * shrinks). Problems sort first, then the list caps.
 *
 * `loadRecentDeliveries` is NOT today-filtered (it orders by delivery_date desc
 * with a row limit), so today's set is filtered HERE against the operational
 * date the caller resolved.
 */
export function composeReceivingTile(input: ReceivingTileInput): TileViewModel {
  const cap = input.cap ?? RECEIVING_ROW_CAP;
  const todays = input.deliveries.filter((d) => d.deliveryDate === input.today);

  if (todays.length === 0) {
    return {
      headline: { key: "dashboard.receiving.headline_none", form: "text", value: null, tone: "info" },
      pills: [],
      rows: [],
      overflowCount: 0,
      empty: true,
    };
  }

  // Problems first, then original loader order (newest first) within each class.
  const sorted = [...todays].sort((a, b) => Number(isReceivingProblem(b)) - Number(isReceivingProblem(a)));
  const problemCount = todays.filter(isReceivingProblem).length;

  const rows: StatusRow[] = sorted.slice(0, cap).map((d) => ({
    id: d.id,
    title: d.vendorName,
    meta: d.arrivedAt,
    pills: receivingBadges(d),
    problem: isReceivingProblem(d),
  }));

  return {
    headline:
      problemCount > 0
        ? {
            key: "dashboard.receiving.headline_problems",
            params: { count: problemCount },
            form: "text",
            value: null,
            tone: "danger",
          }
        : {
            key: "dashboard.receiving.headline_clean",
            params: { count: todays.length },
            form: "text",
            value: null,
            tone: "ok",
          },
    pills: [],
    rows,
    overflowCount: Math.max(0, sorted.length - rows.length),
    empty: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Counts tile (design §1)
// ─────────────────────────────────────────────────────────────────────────────

export interface CountsTileInput {
  /** ET calendar date of the most recent count event; null = NEVER counted. */
  lastCountDate: string | null;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
  /** Distinct SKUs carrying a census anchor at this location. */
  anchoredSkuCount: number;
  /**
   * Flagged variances, or NULL when the calling surface cannot supply the term.
   * Variance is not persisted (see the plan's deviation D2) — a caller that has
   * not paid for the full drift math passes null and the pill is honestly absent.
   */
  varianceCount: number | null;
}

/** Days-since thresholds for the gauge's tone. The pressure is deliberate. */
export const COUNT_STALE_WARN_DAYS = 7;
export const COUNT_STALE_DANGER_DAYS = 14;

/**
 * Counts as a days-since gauge. Staleness IS the lead (design grammar).
 *
 * NEVER-COUNTED is the launch-day rendering: an em-dash, a start-your-first-count
 * pill, and a sub-line that is honest that on-hand runs on estimates until then.
 * We never invent a number for a count that has not happened.
 */
export function composeCountsTile(input: CountsTileInput): TileViewModel {
  if (input.lastCountDate == null) {
    return {
      headline: {
        key: "dashboard.counts.never_caption",
        form: "gauge",
        value: "—",
        tone: "info",
      },
      pills: [{ id: "first-count", key: "dashboard.counts.never_pill", tone: "warn" }],
      rows: [],
      overflowCount: 0,
      empty: true,
    };
  }

  const days = daysBetweenYmd(input.lastCountDate, input.today);
  const tone: StatusPillTone =
    days >= COUNT_STALE_DANGER_DAYS ? "danger" : days >= COUNT_STALE_WARN_DAYS ? "warn" : "ok";

  const pills: StatusPill[] = [];
  // Variance: rendered ONLY when supplied AND non-zero (zero variances is not a
  // finding worth a red pill; null is "we cannot say").
  if (input.varianceCount != null && input.varianceCount > 0) {
    pills.push({
      id: "variances",
      key: "dashboard.counts.pill_variances",
      params: { count: input.varianceCount },
      tone: "danger",
    });
  }
  if (input.anchoredSkuCount > 0) {
    pills.push({
      id: "anchored",
      key: "dashboard.counts.pill_anchored",
      params: { count: input.anchoredSkuCount },
      tone: "warn",
    });
  }

  return {
    headline: {
      key: "dashboard.counts.days_caption",
      form: "gauge",
      value: String(days),
      tone,
    },
    pills,
    rows: [],
    overflowCount: 0,
    empty: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordering tile (design §1)
// ─────────────────────────────────────────────────────────────────────────────

/** One open vendor cutoff — the shape lib/ordering.ts `OrderingCutoffAttention` returns. */
export interface OrderingCutoffFacts {
  vendorId: string;
  vendorName: string;
  /** Already formatted by the loader via the house formatTime. */
  cutoffTime: string;
  hasDraft: boolean;
}

/** One of today's POs — the shape lib/purchase-orders.ts `TodaysOrderVendor` returns. */
export interface OrderingOrderFacts {
  poId: string;
  vendorName: string;
  /** Raw purchase_orders.status. */
  status: string;
}

export interface OrderingTileInput {
  /** Open cutoffs, EARLIEST FIRST — loadOrderingAttention already sorts; we do not re-sort. */
  openCutoffs: OrderingCutoffFacts[];
  orders: OrderingOrderFacts[];
}

/** PO status → its pill key + tone. Unknown statuses fall back to a neutral pill. */
const ORDER_STATUS_PILL: Record<string, { key: TranslationKey; tone: StatusPillTone }> = {
  draft: { key: "dashboard.ordering.pill_draft", tone: "warn" },
  confirmed: { key: "dashboard.ordering.pill_confirmed", tone: "ok" },
  placed: { key: "dashboard.ordering.pill_placed", tone: "ok" },
  invoiced: { key: "dashboard.ordering.pill_invoiced", tone: "ok" },
  received: { key: "dashboard.ordering.pill_received", tone: "ok" },
  reconciled: { key: "dashboard.ordering.pill_reconciled", tone: "ok" },
};

/**
 * Ordering as a cutoff-led tile. When a vendor cutoff is open today with no
 * order started, THE CUTOFF TIME IS THE HEADLINE (28px, red) — it is the only
 * fact on this dashboard with a hard deadline. Multiple open cutoffs: the
 * nearest leads, the others become red pills beside the handled ones.
 */
export function composeOrderingTile(input: OrderingTileInput): TileViewModel {
  const pills: StatusPill[] = [];

  // Every open cutoff BEYOND the nearest becomes a red pill.
  for (const c of input.openCutoffs.slice(1)) {
    pills.push({
      id: `cutoff-${c.vendorId}`,
      key: "dashboard.ordering.pill_cutoff",
      params: { vendor: c.vendorName, time: c.cutoffTime },
      tone: "danger",
    });
  }

  // Handled state shrinks to pills.
  for (const o of input.orders) {
    const mapped = ORDER_STATUS_PILL[o.status] ?? {
      key: "dashboard.ordering.pill_open" as TranslationKey,
      tone: "info" as StatusPillTone,
    };
    pills.push({
      id: `order-${o.poId}`,
      key: mapped.key,
      params: { vendor: o.vendorName },
      tone: mapped.tone,
    });
  }

  const nearest = input.openCutoffs[0];
  if (nearest) {
    return {
      headline: {
        key: "dashboard.ordering.headline_cutoff",
        params: { vendor: nearest.vendorName },
        form: "gauge",
        value: nearest.cutoffTime,
        tone: "danger",
      },
      pills,
      rows: [],
      overflowCount: 0,
      empty: false,
    };
  }

  if (input.orders.length > 0) {
    return {
      headline: {
        key: "dashboard.ordering.headline_all_in",
        params: { count: input.orders.length },
        form: "text",
        value: null,
        tone: "ok",
      },
      pills,
      rows: [],
      overflowCount: 0,
      empty: false,
    };
  }

  return {
    headline: { key: "dashboard.ordering.headline_none", form: "text", value: null, tone: "info" },
    pills: [],
    rows: [],
    overflowCount: 0,
    empty: true,
  };
}
```

- [ ] Add to `lib/i18n/en.json` beside the existing `dashboard.receiving.*` / `dashboard.counts.*` block (~line 2731):

```json
  "dashboard.receiving.label_count": "{count} today",
  "dashboard.receiving.headline_problems": "{count} need attention",
  "dashboard.receiving.headline_clean": "{count} received · all clean",
  "dashboard.receiving.headline_none": "No deliveries logged yet today",
  "dashboard.receiving.badge_complete": "Complete",
  "dashboard.receiving.more": "and {count} more",
  "dashboard.receiving.log_another": "+ Log another delivery",
  "dashboard.receiving.aria": "Receiving: {summary}",
  "dashboard.counts.days_caption": "days since last count",
  "dashboard.counts.never_caption": "days since last count",
  "dashboard.counts.never_pill": "Start your first count",
  "dashboard.counts.never_sub": "On-hand runs on estimates until the first count.",
  "dashboard.counts.pill_variances": "{count} variances",
  "dashboard.counts.pill_anchored": "{count} SKUs anchored",
  "dashboard.counts.aria": "Inventory audit: {summary}",
  "dashboard.ordering.tile_label": "Ordering",
  "dashboard.ordering.headline_cutoff": "{vendor} cutoff — not started",
  "dashboard.ordering.headline_all_in": "All orders in",
  "dashboard.ordering.headline_none": "No orders today",
  "dashboard.ordering.pill_cutoff": "{vendor} {time}",
  "dashboard.ordering.pill_draft": "{vendor} draft",
  "dashboard.ordering.pill_confirmed": "{vendor} confirmed",
  "dashboard.ordering.pill_placed": "{vendor} placed",
  "dashboard.ordering.pill_invoiced": "{vendor} invoiced",
  "dashboard.ordering.pill_received": "{vendor} received",
  "dashboard.ordering.pill_reconciled": "{vendor} reconciled",
  "dashboard.ordering.pill_open": "{vendor} open",
  "dashboard.ordering.cta": "Open ordering",
  "dashboard.ordering.aria": "Ordering: {summary}",
  "dashboard.tile.unavailable": "Couldn't load right now",
```

- [ ] Add to `lib/i18n/es.json` at the same block:

```json
  "dashboard.receiving.label_count": "{count} hoy",
  "dashboard.receiving.headline_problems": "{count} necesitan atención",
  "dashboard.receiving.headline_clean": "{count} recibidas · todo limpio",
  "dashboard.receiving.headline_none": "Todavía no hay entregas registradas hoy",
  "dashboard.receiving.badge_complete": "Completa",
  "dashboard.receiving.more": "y {count} más",
  "dashboard.receiving.log_another": "+ Registrar otra entrega",
  "dashboard.receiving.aria": "Recepción: {summary}",
  "dashboard.counts.days_caption": "días desde el último conteo",
  "dashboard.counts.never_caption": "días desde el último conteo",
  "dashboard.counts.never_pill": "Haz tu primer conteo",
  "dashboard.counts.never_sub": "El inventario corre con estimados hasta el primer conteo.",
  "dashboard.counts.pill_variances": "{count} diferencias",
  "dashboard.counts.pill_anchored": "{count} SKUs con conteo",
  "dashboard.counts.aria": "Auditoría de inventario: {summary}",
  "dashboard.ordering.tile_label": "Pedidos",
  "dashboard.ordering.headline_cutoff": "Cierre de {vendor} — sin empezar",
  "dashboard.ordering.headline_all_in": "Todos los pedidos hechos",
  "dashboard.ordering.headline_none": "No hay pedidos hoy",
  "dashboard.ordering.pill_cutoff": "{vendor} {time}",
  "dashboard.ordering.pill_draft": "{vendor} borrador",
  "dashboard.ordering.pill_confirmed": "{vendor} confirmado",
  "dashboard.ordering.pill_placed": "{vendor} enviado",
  "dashboard.ordering.pill_invoiced": "{vendor} facturado",
  "dashboard.ordering.pill_received": "{vendor} recibido",
  "dashboard.ordering.pill_reconciled": "{vendor} conciliado",
  "dashboard.ordering.pill_open": "{vendor} abierto",
  "dashboard.ordering.cta": "Abrir pedidos",
  "dashboard.ordering.aria": "Pedidos: {summary}",
  "dashboard.tile.unavailable": "No se pudo cargar ahora",
```

- [ ] Run the test and see it pass:

```bash
npx vitest run tests/dashboard-status-tiles.test.ts
```

Expected: 18 passed.

- [ ] Commit:

```bash
git add lib/dashboard-status-shared.ts tests/dashboard-status-tiles.test.ts lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(dashboard): pure compose functions for the receiving, counts and ordering tiles"
```

---

## Task 9 — Receiving page adopts the shared missing-email rule

- [ ] In `app/(authed)/operations/receiving/page.tsx`, delete the local `MISSING_EMAIL_GRACE_MS` constant and the whole `deriveMissingEmailIds` function (lines 16–42), and remove the now-unused `DeliveryView` type import if nothing else uses it. Add the shared import beside the other lib imports:

```ts
import { deriveMissingEmailIds } from "@/lib/dashboard-status-shared";
```

- [ ] Change the call site (was line 59) to pass the clock explicitly:

```ts
  // Missing-email flags derived once per request — the ONE rule, shared with the
  // dashboard's receiving tile (lib/dashboard-status-shared.ts). The clock is read
  // here so no impure call lands in the render tree (react-hooks/purity).
  const missingEmailIds = deriveMissingEmailIds(recent, Date.now());
```

- [ ] Typecheck and build:

```bash
npx tsc --noEmit && npx next build
```

Expected: no type errors; build succeeds.

- [ ] Commit:

```bash
git add app/(authed)/operations/receiving/page.tsx
git commit -m "refactor(receiving): one missing-email rule, shared with the dashboard tile"
```

---

## Task 10 — Counts tile state loader (read-only)

> **Deviation D1 applies — confirm with the lead before running this task.**

- [ ] Append to `lib/counts.ts` (after `loadOnHandDerived`):

```ts
// ── Dashboard counts-tile state (READ-ONLY, cheap) ───────────────────────────────
export interface CountsTileState {
  /** ET calendar date of the most recent active count event; null = never counted. */
  lastCountDate: string | null;
  /** Distinct SKUs carrying a census anchor at this location. */
  anchoredSkuCount: number;
}

/**
 * The two facts the dashboard's counts tile needs, at the cheapest correct cost:
 * one indexed read for the latest event, one paged read for the anchored SKU set.
 *
 * WHY NOT loadOnHand: that loader exists for the counts PAGE and is the wrong
 * tool here — it walks every active SKU, computes 28-day consumption lanes over
 * paged productions/production_inputs/toast_daily_depletion, and WRITES
 * (sku_inferred_baselines upsert). Putting it on the dashboard render path would
 * add a write and ~15 queries to every GM+ page view. Variance is deliberately
 * NOT returned: it is not persisted anywhere (sku_count_lines has no variance
 * column) and only exists inside loadOnHand's live drift math, so the tile
 * renders its honest absence rather than a fabricated number.
 *
 * Same gates as the surface it feeds: COUNT_READ_MIN (AGM+) + location-bind.
 * A failed read MUST throw — an empty result is the COLD START signal ("this
 * location was never counted"), so a swallowed error would fabricate it.
 */
export async function loadCountsTileState(
  actor: AuthContext,
  locationId: string,
): Promise<CountsTileState> {
  requireLevel(actor, COUNT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new CountError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();

  // (1) All active count events at this location. PAGED (the PR #63 lesson):
  // one row per session accumulates forever, and a truncated page would both
  // move the "last counted" head and under-count the anchored set. `id` is a
  // tiebreaker only — counted_at stays the primary sort key.
  const events = await selectAllRows<{ id: string; counted_at: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("sku_count_events")
        .select("id, counted_at")
        .eq("location_id", locationId)
        .eq("active", true)
        .order("counted_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<Array<{ id: string; counted_at: string }>>();
      if (error) throw new Error(`loadCountsTileState events: ${error.message}`);
      return { data };
    },
  );
  const head = events[0];
  if (!head) return { lastCountDate: null, anchoredSkuCount: 0 };

  // (2) Distinct SKUs ever counted here. PostgREST has no DISTINCT, so we page
  // the sku_id column and dedupe in memory (still one batched read, never per-SKU).
  const eventIds = events.map((e) => e.id);
  const lines = await selectAllRows<{ sku_id: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("sku_count_lines")
        .select("sku_id")
        .in("count_event_id", eventIds)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ sku_id: string }>>();
      if (error) throw new Error(`loadCountsTileState lines: ${error.message}`);
      return { data };
    },
  );

  return {
    lastCountDate: etCalendarDate(head.counted_at),
    anchoredSkuCount: new Set(lines.map((l) => l.sku_id)).size,
  };
}
```

- [ ] Confirm `etCalendarDate` is imported in `lib/counts.ts`; if not, add it to the existing `@/lib/operational-day` import:

```bash
grep -n "operational-day" lib/counts.ts
```

If the import exists without `etCalendarDate`, add it to the named list; if there is no import, add `import { etCalendarDate } from "@/lib/operational-day";` beside the other lib imports.

- [ ] Typecheck:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] Commit:

```bash
git add lib/counts.ts
git commit -m "feat(counts): read-only counts-tile state loader (last count date + anchored SKUs)"
```

---

## Task 11 — PulseFridge carries today's read state

- [ ] In `lib/midshift-shared.ts`, replace the `PulseFridge` interface (lines 57–63):

```ts
export interface PulseFridge {
  /** Equipment-registry id — the stable React key (names can collide). */
  equipId: string;
  name: string;
  /**
   * The latest reading value SINCE the overview's window start — NOT necessarily
   * today's (lib/maintenance.ts loadMaintenanceOverview computes `latest` over
   * `sinceDate` while `status` is today-scoped). Only claim this as a current
   * temperature when `hasReadingToday` is true.
   */
  latestF: number | null;
  outOfRange: boolean; // any reading today > safe max
  /**
   * SIM-25: did anyone actually temp this fridge TODAY? Derived from the
   * today-scoped FridgeStatus, never from `latestF != null` — a fridge unread
   * today can still carry yesterday's value, and treating that as "read" is
   * exactly the false all-clear this field exists to prevent.
   */
  hasReadingToday: boolean;
}
```

- [ ] In `lib/midshift.ts`, replace the fridge mapping (lines 375–380):

```ts
  const fridges: PulseFridge[] = overview.fridges.map((f) => ({
    equipId: f.equip.id,
    name: f.equip.name,
    latestF: f.latest?.valueF ?? null,
    outOfRange: f.status === "out_of_range",
    // SIM-25: today-scoped. `f.status` is computed from TODAY's readings
    // (lib/maintenance.ts:159); `f.latest` is not.
    hasReadingToday: f.status !== "no_reading_today",
  }));
```

- [ ] Typecheck and run the full suite:

```bash
npx tsc --noEmit && npm test
```

Expected: no type errors; all tests pass.

- [ ] Commit:

```bash
git add lib/midshift-shared.ts lib/midshift.ts
git commit -m "feat(midshift): PulseFridge carries today-scoped hasReadingToday (SIM-25 term)"
```

---

## Task 12 — FridgeStrip renders the LOUD aggregate

- [ ] Replace `components/midshift/FridgeStrip.tsx` entirely:

```tsx
import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { ActionLink } from "@/components/ActionButton";
import { composeFridgeAggregate } from "@/lib/dashboard-status-shared";
import type { PulseFridge } from "@/lib/midshift";

/**
 * Fridge temps — a thin rendering of composeFridgeAggregate (SIM-25, design §2).
 *
 * The summary line used to read `flagCount === 0 ? "All fridges in range"`, which
 * rendered a green all-clear over eight fridges nobody had temped. The aggregate
 * now owns the claim: any unread fridge is the alert state, "in range" speaks only
 * for fridges actually read, and an unread chip never prints a stale number.
 *
 * `flagCount` stays in the props for the caller's existing wiring; the aggregate
 * recomputes it from the fridge facts so the strip has ONE source for its claim.
 */
export function FridgeStrip({
  fridges,
  locationId,
  language,
}: {
  fridges: PulseFridge[];
  locationId: string;
  language: Language;
}) {
  const agg = composeFridgeAggregate(fridges);
  const alert = agg.state === "alert";
  const summary = serverT(language, agg.headline.key, agg.headline.params);

  return (
    <section aria-label={serverT(language, "midshift.fridges.aria", { summary })}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.fridges.heading")}
      </h2>

      {/* Summary line — the aggregate's claim, loud when anything is unread or hot. */}
      <p
        {...(alert ? { role: "alert" as const } : {})}
        className={`mb-2 text-sm font-bold ${alert ? "text-co-cta-text" : "text-co-text"}`}
      >
        {summary}
      </p>

      {agg.pills.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {agg.pills.map((p) => (
            <span
              key={p.id}
              className={`rounded-md px-2 py-1 text-[11px] font-bold ${
                p.tone === "danger"
                  ? "bg-co-danger-surface text-co-cta-text"
                  : "bg-co-success-surface text-co-success"
              }`}
            >
              {serverT(language, p.key, p.params)}
            </span>
          ))}
        </div>
      )}

      {/* Fridge chips. An UNREAD fridge renders in the alert treatment and makes NO
          temperature claim — its `latestF` may be a stale reading from a prior day
          (lib/maintenance.ts computes `latest` over the window, `status` over today). */}
      {fridges.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {fridges.map((fridge) => {
            const bad = fridge.outOfRange || !fridge.hasReadingToday;
            return (
              <span
                key={fridge.equipId}
                className={[
                  "rounded-md border px-2 py-1 text-xs font-semibold",
                  bad ? "border-co-cta-text text-co-cta-text" : "border-co-border text-co-text-muted",
                ].join(" ")}
              >
                {fridge.name}{" "}
                {fridge.hasReadingToday && fridge.latestF !== null
                  ? serverT(language, "midshift.degrees", { value: fridge.latestF })
                  : serverT(language, "midshift.fridges.chip_unread")}
              </span>
            );
          })}
        </div>
      )}

      <ActionLink
        href={`/maintenance?location=${locationId}`}
        variant="secondary"
        className="w-full"
      >
        {serverT(language, "midshift.fridges.view")}
      </ActionLink>
    </section>
  );
}
```

- [ ] Update the call site in `app/(authed)/mid-shift/page.tsx` (lines 168–173) — `flagCount` is no longer a prop:

```tsx
      <FridgeStrip
        fridges={pulse.fridges}
        locationId={locationId}
        language={language}
      />
```

- [ ] Typecheck and build:

```bash
npx tsc --noEmit && npx next build
```

Expected: no type errors; build succeeds.

- [ ] Commit:

```bash
git add components/midshift/FridgeStrip.tsx "app/(authed)/mid-shift/page.tsx"
git commit -m "fix(midshift): SIM-25 — fridge strip is loud on any unread fridge, no stale-number claim"
```

---

## Task 13 — ReceivingTile becomes a status tile

- [ ] Replace `components/receiving/ReceivingTile.tsx` entirely:

```tsx
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import { ActionLink } from "@/components/ActionButton";
import { composeReceivingTile, type ReceivingDeliveryFacts } from "@/lib/dashboard-status-shared";

/**
 * Receiving status tile — a per-truck mini-list of TODAY's deliveries (design §1).
 *
 * Leads with per-truck PROBLEMS; everything handled shrinks to badges. Caps at 3
 * rows with an "and N more" line, and keeps a quiet "Log another delivery" action
 * underneath. When nothing landed today it falls back to the original action tile,
 * unchanged, because "log a delivery" is genuinely the right thing to offer.
 *
 * `deliveries === null` means the loader FAILED — we say so rather than rendering
 * an empty state that would falsely claim no trucks came.
 */
export function ReceivingTile({
  language,
  locationId,
  deliveries,
  today,
}: {
  language: Language;
  locationId: string;
  /** Today-inclusive delivery facts, or null when the read failed. */
  deliveries: ReceivingDeliveryFacts[] | null;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
}) {
  const href = `/operations/receiving?location=${locationId}`;

  if (deliveries === null) {
    return (
      <section className="co-card p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.receiving.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.tile.unavailable")}
        </p>
      </section>
    );
  }

  const vm = composeReceivingTile({ deliveries, today });

  // Empty state — today's original action tile, unchanged in intent. NOT a
  // tap-through card: the ActionLink is the affordance, and wrapping it in an
  // outer <Link> would nest anchors (invalid HTML + an a11y trap).
  if (vm.empty) {
    return (
      <section
        className="co-card p-4 sm:p-5"
        aria-label={serverT(language, "dashboard.receiving.aria", {
          summary: serverT(language, "dashboard.receiving.headline_none"),
        })}
      >
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.receiving.tile_label")}
        </p>
        <p className="mt-2 text-[11px] italic text-co-text-muted">
          {serverT(language, "dashboard.receiving.hint")}
        </p>
        <div className="mt-3">
          <ActionLink href={href} variant="primary" className="w-full sm:w-auto">
            {serverT(language, "dashboard.receiving.cta")}
          </ActionLink>
        </div>
      </section>
    );
  }

  const summary = serverT(language, vm.headline.key, vm.headline.params);
  const todaysCount = deliveries.filter((d) => d.deliveryDate === today).length;

  return (
    <section
      className="co-card p-4 sm:p-5"
      aria-label={serverT(language, "dashboard.receiving.aria", { summary })}
    >
      {/* Whole tile taps through to receiving; the quiet action below is a sibling
          link, so it is never a nested-interactive. */}
      <Link
        href={href}
        className="block rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
      >
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.receiving.tile_label")} ·{" "}
          {serverT(language, "dashboard.receiving.label_count", { count: todaysCount })}
        </p>

        <p
          className={`mt-2 text-base font-bold ${
            vm.headline.tone === "danger" ? "text-co-cta-text" : "text-co-text"
          }`}
        >
          {summary}
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {vm.rows.map((row) => (
            <li key={row.id} className="rounded-lg bg-co-surface-inset px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-bold text-co-text">{row.title}</span>
                {row.meta ? (
                  <span className="shrink-0 text-[11px] text-co-text-dim">{row.meta}</span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {row.pills.map((p) => (
                  <AlertPill key={p.id} tone={p.tone} uppercase={false}>
                    {serverT(language, p.key, p.params)}
                  </AlertPill>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {vm.overflowCount > 0 ? (
          <p className="mt-2 text-[11px] text-co-text-dim">
            {serverT(language, "dashboard.receiving.more", { count: vm.overflowCount })}
          </p>
        ) : null}
      </Link>

      {/* Quiet action — small-control label grammar (0.08em), not a primary CTA. */}
      <div className="mt-3">
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {serverT(language, "dashboard.receiving.log_another")}
        </Link>
      </div>
    </section>
  );
}
```

- [ ] Typecheck (the dashboard call site is still un-migrated, so expect an error there — it is fixed in Task 16):

```bash
npx tsc --noEmit
```

Expected: exactly one class of error, in `app/(authed)/dashboard/page.tsx`, about the missing `deliveries` / `today` props on `<ReceivingTile>`.

- [ ] Commit:

```bash
git add components/receiving/ReceivingTile.tsx
git commit -m "feat(dashboard): ReceivingTile renders today's per-truck status list"
```

---

## Task 14 — CountsTile becomes a days-since gauge

- [ ] Replace `components/counts/CountsTile.tsx` entirely:

```tsx
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import { composeCountsTile } from "@/lib/dashboard-status-shared";

/**
 * Inventory-audit status tile — a days-since-last-count gauge (design §1).
 *
 * Staleness is the lead and the number CLIMBS (Juan: "the pressure is good for
 * us"). The never-counted state is the launch-day rendering: an em-dash, a
 * start-your-first-count pill, and a sub-line that is honest that on-hand runs
 * on estimates until then. We never invent a count that has not happened.
 *
 * `state === null` means the loader FAILED — distinct from never-counted.
 */
export function CountsTile({
  language,
  locationId,
  state,
  today,
}: {
  language: Language;
  locationId: string;
  /** Counts-tile facts, or null when the read failed. */
  state: { lastCountDate: string | null; anchoredSkuCount: number } | null;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
}) {
  const href = `/operations/counts?location=${locationId}`;

  if (state === null) {
    return (
      <section className="co-card p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.counts.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.tile.unavailable")}
        </p>
      </section>
    );
  }

  const vm = composeCountsTile({
    lastCountDate: state.lastCountDate,
    today,
    anchoredSkuCount: state.anchoredSkuCount,
    // Variance is not persisted and only exists inside loadOnHand's live drift
    // math — too expensive (and write-bearing) for the dashboard. The term
    // renders as its honest absence rather than a fabricated number.
    varianceCount: null,
  });

  const caption = serverT(language, vm.headline.key);
  const neverCounted = state.lastCountDate === null;

  return (
    <Link
      href={href}
      className="co-card block p-4 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:p-5"
      aria-label={serverT(language, "dashboard.counts.aria", {
        summary: `${vm.headline.value ?? ""} ${caption}`.trim(),
      })}
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {serverT(language, "dashboard.counts.tile_label")}
      </p>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`text-[28px] font-extrabold leading-none ${
            vm.headline.tone === "danger"
              ? "text-co-cta-text"
              : vm.headline.tone === "warn"
                ? "text-co-gold-text"
                : "text-co-text"
          }`}
        >
          {vm.headline.value}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {caption}
        </span>
      </div>

      {vm.pills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {vm.pills.map((p) => (
            <AlertPill key={p.id} tone={p.tone} uppercase={false}>
              {serverT(language, p.key, p.params)}
            </AlertPill>
          ))}
        </div>
      ) : null}

      {neverCounted ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">
          {serverT(language, "dashboard.counts.never_sub")}
        </p>
      ) : null}
    </Link>
  );
}
```

- [ ] Typecheck (the dashboard call site is fixed in Task 16):

```bash
npx tsc --noEmit
```

Expected: errors only in `app/(authed)/dashboard/page.tsx` about the tiles' new props.

- [ ] Commit:

```bash
git add components/counts/CountsTile.tsx
git commit -m "feat(dashboard): CountsTile renders the days-since gauge + never-counted state"
```

---

## Task 15 — OrderingTile (new)

- [ ] Create `components/ordering/OrderingTile.tsx`:

```tsx
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import {
  composeOrderingTile,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
} from "@/lib/dashboard-status-shared";

/**
 * Ordering status tile — cutoff-led (design §1).
 *
 * When a vendor cutoff is open today with no order started, THE CUTOFF TIME IS
 * THE HEADLINE (28px, co-cta-text red): it is the only fact on this dashboard
 * with a hard deadline. Multiple open cutoffs — the NEAREST leads, the rest are
 * red pills beside the handled ones. Nothing open: "All orders in".
 *
 * Gate is the caller's (level >= 4, matching the /ordering route's PAR_PASS_MIN
 * and the nav minLevel from PR #254). A null payload means the read failed.
 */
export function OrderingTile({
  language,
  locationId,
  openCutoffs,
  orders,
}: {
  language: Language;
  locationId: string;
  /** Open cutoffs earliest-first (loadOrderingAttention order), or null on read failure. */
  openCutoffs: OrderingCutoffFacts[] | null;
  /** Today's POs (loadTodaysOrders), or null on read failure. */
  orders: OrderingOrderFacts[] | null;
}) {
  const href = `/ordering?location=${locationId}`;

  if (openCutoffs === null || orders === null) {
    return (
      <section className="co-card p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.ordering.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.tile.unavailable")}
        </p>
      </section>
    );
  }

  const vm = composeOrderingTile({ openCutoffs, orders });
  const caption = serverT(language, vm.headline.key, vm.headline.params);

  return (
    <Link
      href={href}
      className="co-card block p-4 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:p-5"
      aria-label={serverT(language, "dashboard.ordering.aria", {
        summary: vm.headline.value ? `${vm.headline.value} ${caption}` : caption,
      })}
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {serverT(language, "dashboard.ordering.tile_label")}
      </p>

      {vm.headline.form === "gauge" ? (
        <div className="mt-2">
          <p className="text-[28px] font-extrabold leading-none text-co-cta-text">
            {vm.headline.value}
          </p>
          <p className="mt-1 text-sm font-bold text-co-cta-text">{caption}</p>
        </div>
      ) : (
        <p
          className={`mt-2 text-base font-bold ${
            vm.headline.tone === "ok" ? "text-co-text" : "text-co-text-muted"
          }`}
        >
          {caption}
        </p>
      )}

      {vm.pills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {vm.pills.map((p) => (
            <AlertPill key={p.id} tone={p.tone} uppercase={false}>
              {serverT(language, p.key, p.params)}
            </AlertPill>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
```

- [ ] Typecheck (dashboard wiring lands next):

```bash
npx tsc --noEmit
```

Expected: errors only in `app/(authed)/dashboard/page.tsx`.

- [ ] Commit:

```bash
git add components/ordering/OrderingTile.tsx
git commit -m "feat(dashboard): cutoff-led OrderingTile"
```

---

## Task 16 — Dashboard wiring + close-status convergence

- [ ] In `app/(authed)/dashboard/page.tsx`, add the new imports beside the existing lib imports:

```ts
import { loadRecentDeliveries } from "@/lib/receiving";
import { loadTodaysOrders } from "@/lib/purchase-orders";
import { loadOrderingAttention } from "@/lib/ordering";
import { loadCountsTileState, COUNT_READ_MIN } from "@/lib/counts";
import { OrderingTile } from "@/components/ordering/OrderingTile";
import {
  deriveCloseState,
  deriveMissingEmailIds,
  type ReceivingDeliveryFacts,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
} from "@/lib/dashboard-status-shared";
import { closeStateLabelKey } from "@/components/reports-hub/shared";
```

- [ ] Replace `statusCopyFor` (lines 237–280) so the close reading comes from the ONE helper:

```tsx
interface StatusCopy {
  label: string;
  cta: string;
  ctaTone: "primary" | "review";
}

/**
 * Today's closing status copy. The close STATE comes from the one shared
 * derivation (lib/dashboard-status-shared.ts deriveCloseState) — this used to
 * branch on a 3-value union with no `auto_finalized` case, so an auto-finalized
 * day fell through to the "open" branch and rendered "In progress" with a
 * "Continue closing" CTA (design §2 "one close reading three different ways").
 */
function statusCopyFor(state: OperationalState, language: Language): StatusCopy {
  if (!state.hasClosingTemplate) {
    return {
      label: serverT(language, "dashboard.status.no_template"),
      cta: serverT(language, "dashboard.cta.open_closing"),
      ctaTone: "review",
    };
  }

  const close = deriveCloseState(state.todayInstance?.status ?? null);

  if (close.status === "pending") {
    return {
      label: serverT(language, "dashboard.status.not_started"),
      cta: serverT(language, "dashboard.cta.start_closing"),
      ctaTone: "primary",
    };
  }

  if (close.status === "in_progress") {
    const p = state.todayProgress;
    const progress = p
      ? serverT(language, "dashboard.status.in_progress_progress", {
          completed: p.completed,
          required: p.required,
        })
      : serverT(language, "dashboard.status.in_progress_fallback");
    return {
      label: serverT(language, "dashboard.status.in_progress", { progress }),
      cta: serverT(language, "dashboard.cta.continue_closing"),
      ctaTone: "primary",
    };
  }

  // closed / closed-incomplete / auto_finalized — all resolved days, review-tone.
  return {
    label: serverT(language, closeStateLabelKey(close)),
    cta: serverT(language, "dashboard.cta.review_closing"),
    ctaTone: "review",
  };
}
```

- [ ] Widen the `ClosingStatus` type (line 68) so the DB's full status set is representable rather than mis-typed:

```ts
/** Raw checklist_instances.status. Kept as a string: `auto_finalized` (and the
 *  phase statuses) are reachable here, and narrowing them away is what let the
 *  dashboard render an auto-finalized day as "in progress". deriveCloseState
 *  owns the interpretation. */
type ClosingStatus = string;
```

- [ ] Add the three tile payloads to the existing concurrent block. Insert immediately AFTER the `Promise.all` that resolves `[amPrepDashboard, …, teamHealth]` (line 370):

```tsx
  // Status-tile payloads (dashboard operational legibility, 2026-08-19). These
  // are READ surfaces over existing artifacts — no new capture, no writes.
  //
  // FAIL-SOFT, BUT NEVER FABRICATING: a loader hiccup must not 500 the whole
  // dashboard, and it must also not render an empty state that would falsely
  // claim "no trucks today". Each catch returns null, which the tile renders as
  // an explicit "couldn't load" — distinct from a genuine empty.
  const tileLocationId = selectedLocation?.id ?? null;
  const [receivingRaw, todaysOrders, cutoffAttention, countsState] = await Promise.all([
    tileLocationId && auth.level >= 4
      ? loadRecentDeliveries(auth, tileLocationId, 20).catch((e) => {
          console.error("dashboard receiving tile load failed", e);
          return null;
        })
      : null,
    tileLocationId && auth.level >= 4
      ? loadTodaysOrders(auth, tileLocationId).catch((e) => {
          console.error("dashboard ordering tile orders load failed", e);
          return null;
        })
      : null,
    tileLocationId && auth.level >= 4
      ? loadOrderingAttention(auth, tileLocationId).catch((e) => {
          console.error("dashboard ordering tile cutoff load failed", e);
          return null;
        })
      : null,
    tileLocationId && auth.level >= COUNT_READ_MIN
      ? loadCountsTileState(auth, tileLocationId).catch((e) => {
          console.error("dashboard counts tile load failed", e);
          return null;
        })
      : null,
  ]);

  // Project the loader rows into the pure compose functions' fact shapes. The
  // missing-email rule and the arrival-time formatting both read a clock / the
  // viewer's language, so they happen HERE — never inside a compose or a render.
  const missingEmailIds = receivingRaw ? deriveMissingEmailIds(receivingRaw, Date.now()) : new Set<string>();
  const receivingFacts: ReceivingDeliveryFacts[] | null = receivingRaw
    ? receivingRaw.map((d) => ({
        id: d.id,
        vendorName: d.vendorName,
        deliveryDate: d.deliveryDate,
        matchState: d.matchState,
        deliveryStatus: d.deliveryStatus,
        receiptUrl: d.receiptUrl,
        arrivedAt: formatTime(d.createdAt, language),
        missingEmail: missingEmailIds.has(d.id),
      }))
    : null;
  const orderFacts: OrderingOrderFacts[] | null = todaysOrders
    ? todaysOrders.map((o) => ({ poId: o.poId, vendorName: o.vendorName, status: o.status }))
    : null;
  const cutoffFacts: OrderingCutoffFacts[] | null = cutoffAttention
    ? cutoffAttention.vendors.map((v) => ({
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        cutoffTime: v.cutoffTime,
        hasDraft: v.hasDraft,
      }))
    : null;
```

- [ ] Replace the two tile call sites (lines 647–658) and add the ordering tile. `selectedLocation` and `operational` are already narrowed truthy by the enclosing `ReportsSection` condition (the same narrowing `MidDayPrepTile` relies on at line 645), so no re-check is needed:

```tsx
            {auth.level >= 4 ? (
              <ReceivingTile
                language={language}
                locationId={selectedLocation.id}
                deliveries={receivingFacts}
                today={operational.todayDate}
              />
            ) : null}
            {auth.level >= 4 ? (
              <OrderingTile
                language={language}
                locationId={selectedLocation.id}
                openCutoffs={cutoffFacts}
                orders={orderFacts}
              />
            ) : null}
            {auth.level >= COUNT_READ_MIN ? (
              <CountsTile
                language={language}
                locationId={selectedLocation.id}
                state={countsState}
                today={operational.todayDate}
              />
            ) : null}
```

- [ ] Typecheck and build:

```bash
npx tsc --noEmit && npx next build
```

Expected: no type errors; build succeeds.

- [ ] Commit:

```bash
git add "app/(authed)/dashboard/page.tsx"
git commit -m "feat(dashboard): compose today's receiving, ordering and counts state; one close reading"
```

---

## Task 17 — Mid-shift operational strip

- [ ] Create `components/midshift/OperationalStrip.tsx`:

```tsx
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import {
  composeReceivingTile,
  composeCountsTile,
  composeOrderingTile,
  type ReceivingDeliveryFacts,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
  type StatusHeadline,
} from "@/lib/dashboard-status-shared";

/**
 * The mid-shift operational strip (design §2): the three composed HEADLINE facts
 * in one-line form, from the SAME compose helpers the dashboard tiles render. A
 * manager reading the pulse and a manager reading the dashboard see the same
 * three sentences — that is the point of the shared module.
 *
 * Any payload may be null (its read failed or the actor is below its gate); a
 * null lane is simply omitted rather than claiming anything.
 */
function StripItem({
  headline,
  href,
  labelKey,
  language,
}: {
  headline: StatusHeadline;
  href: string;
  labelKey: TranslationKey;
  language: Language;
}) {
  const text = serverT(language, headline.key, headline.params);
  const loud = headline.tone === "danger";
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
      >
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, labelKey)}
        </span>
        <span
          className={`min-w-0 text-right text-sm font-bold ${loud ? "text-co-cta-text" : "text-co-text"}`}
        >
          {headline.value ? `${headline.value} · ` : ""}
          {text}
        </span>
      </Link>
    </li>
  );
}

export function OperationalStrip({
  language,
  locationId,
  today,
  deliveries,
  openCutoffs,
  orders,
  countsState,
}: {
  language: Language;
  locationId: string;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
  deliveries: ReceivingDeliveryFacts[] | null;
  openCutoffs: OrderingCutoffFacts[] | null;
  orders: OrderingOrderFacts[] | null;
  countsState: { lastCountDate: string | null; anchoredSkuCount: number } | null;
}) {
  const receiving = deliveries ? composeReceivingTile({ deliveries, today }) : null;
  const ordering =
    openCutoffs && orders ? composeOrderingTile({ openCutoffs, orders }) : null;
  const counts = countsState
    ? composeCountsTile({
        lastCountDate: countsState.lastCountDate,
        today,
        anchoredSkuCount: countsState.anchoredSkuCount,
        varianceCount: null,
      })
    : null;

  if (!receiving && !ordering && !counts) return null;

  return (
    <section aria-label={serverT(language, "midshift.ops.heading")}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.ops.heading")}
      </h2>
      <ul className="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-2 xl:grid-cols-3">
        {ordering ? (
          <StripItem
            headline={ordering.headline}
            href={`/ordering?location=${locationId}`}
            labelKey="dashboard.ordering.tile_label"
            language={language}
          />
        ) : null}
        {receiving ? (
          <StripItem
            headline={receiving.headline}
            href={`/operations/receiving?location=${locationId}`}
            labelKey="dashboard.receiving.tile_label"
            language={language}
          />
        ) : null}
        {counts ? (
          <StripItem
            headline={counts.headline}
            href={`/operations/counts?location=${locationId}`}
            labelKey="dashboard.counts.tile_label"
            language={language}
          />
        ) : null}
      </ul>
    </section>
  );
}
```

- [ ] Add to `lib/i18n/en.json`:

```json
  "midshift.ops.heading": "Today's operation",
```

- [ ] Add to `lib/i18n/es.json`:

```json
  "midshift.ops.heading": "La operación de hoy",
```

- [ ] In `app/(authed)/mid-shift/page.tsx`, add the imports:

```ts
import { OperationalStrip } from "@/components/midshift/OperationalStrip";
import { loadRecentDeliveries } from "@/lib/receiving";
import { loadTodaysOrders } from "@/lib/purchase-orders";
import { loadOrderingAttention } from "@/lib/ordering";
import { loadCountsTileState, COUNT_READ_MIN } from "@/lib/counts";
import {
  deriveMissingEmailIds,
  type ReceivingDeliveryFacts,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
} from "@/lib/dashboard-status-shared";
```

- [ ] Insert the strip payload loads immediately after the existing `const [pulse, salesPulse] = await Promise.all([...])` block (after line 115):

```tsx
  // Operational strip payloads (design §2) — the same reads the dashboard tiles
  // compose. Fail-soft per lane, matching the pulse's shrinkage/cutoff discipline:
  // a secondary read hiccup must never break the pulse. A null lane is omitted,
  // never rendered as a false empty.
  const [stripDeliveries, stripOrders, stripCutoffs, stripCounts] = await Promise.all([
    loadRecentDeliveries(auth, locationId, 20).catch((e) => {
      console.error("midshift strip receiving failed", e);
      return null;
    }),
    loadTodaysOrders(auth, locationId).catch((e) => {
      console.error("midshift strip orders failed", e);
      return null;
    }),
    loadOrderingAttention(auth, locationId).catch((e) => {
      console.error("midshift strip cutoffs failed", e);
      return null;
    }),
    auth.level >= COUNT_READ_MIN
      ? loadCountsTileState(auth, locationId).catch((e) => {
          console.error("midshift strip counts failed", e);
          return null;
        })
      : null,
  ]);

  const stripMissingEmailIds = stripDeliveries
    ? deriveMissingEmailIds(stripDeliveries, Date.now())
    : new Set<string>();
  const stripReceivingFacts: ReceivingDeliveryFacts[] | null = stripDeliveries
    ? stripDeliveries.map((d) => ({
        id: d.id,
        vendorName: d.vendorName,
        deliveryDate: d.deliveryDate,
        matchState: d.matchState,
        deliveryStatus: d.deliveryStatus,
        receiptUrl: d.receiptUrl,
        arrivedAt: formatTime(d.createdAt, language),
        missingEmail: stripMissingEmailIds.has(d.id),
      }))
    : null;
  const stripOrderFacts: OrderingOrderFacts[] | null = stripOrders
    ? stripOrders.map((o) => ({ poId: o.poId, vendorName: o.vendorName, status: o.status }))
    : null;
  const stripCutoffFacts: OrderingCutoffFacts[] | null = stripCutoffs
    ? stripCutoffs.vendors.map((v) => ({
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        cutoffTime: v.cutoffTime,
        hasDraft: v.hasDraft,
      }))
    : null;
```

- [ ] Mount the strip in the JSX, directly above `<ReportStatusList …>` (line 167):

```tsx
      <OperationalStrip
        language={language}
        locationId={locationId}
        today={date}
        deliveries={stripReceivingFacts}
        openCutoffs={stripCutoffFacts}
        orders={stripOrderFacts}
        countsState={stripCounts}
      />
```

- [ ] Typecheck and build:

```bash
npx tsc --noEmit && npx next build
```

Expected: no type errors; build succeeds.

- [ ] Commit:

```bash
git add components/midshift/OperationalStrip.tsx "app/(authed)/mid-shift/page.tsx" lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(midshift): operational strip composed from the shared tile helpers"
```

---

## Task 18 — SIM-18b: ordering board refreshes after a walk

- [ ] In `components/ordering/ParPassWalker.tsx`, inside `submit()` (line 160), add the refresh immediately after the success state is set:

```tsx
      setResult({ draftOrders: j.draftOrders ?? [], shrinkage: j.shrinkage ?? [], poError: j.poError ?? false });
      setPhase("done");
      // SIM-18b: a completed walk CREATES draft POs, so the server payload above
      // this island (OrderingSurfaces' "Today's orders" + the draftless-cutoff
      // list, both server props from app/ordering/page.tsx) is now stale — it
      // still shows the pre-walk board. Only `startNew` refreshed, so a manager
      // who finished a walk and scrolled up saw the old board until a hard
      // reload. router.refresh() re-pulls the server payload; it does NOT reset
      // this island's useState (house law), so the success state below survives.
      router.refresh();
      window.scrollTo({ top: 0 });
```

- [ ] Typecheck and build:

```bash
npx tsc --noEmit && npx next build
```

Expected: no type errors; build succeeds.

- [ ] Commit:

```bash
git add components/ordering/ParPassWalker.tsx
git commit -m "fix(ordering): SIM-18b — refresh the board when a walk completes"
```

---

## Task 19 — Full verification

- [ ] Run the whole unit spine:

```bash
npm test
```

Expected: all suites pass, including the three new files (`dashboard-status-close-state`, `dashboard-status-fridges`, `dashboard-status-tiles`).

- [ ] Run the production build (a separate gate from typecheck):

```bash
npx next build
```

Expected: `Compiled successfully`, no type errors, no `useSearchParams`-outside-Suspense failures.

- [ ] Run the token-floor guard:

```bash
npx tsx scripts/check-ui-tokens.ts
```

Expected: exit 0 with no findings attributable to the files this branch touched. If a pre-existing allowlisted site reports, confirm via `git diff --name-only origin/main` that it is not one of ours — **do not extend the allowlist**.

- [ ] Confirm every new string exists in BOTH dictionaries:

```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const missing=Object.keys(en).filter(k=>!(k in es));console.log(missing.length?'MISSING IN ES: '+missing.join(', '):'en/es key parity OK')"
```

Expected: `en/es key parity OK`.

- [ ] Confirm no raw hex landed in the diff:

```bash
git diff origin/main --unified=0 | grep -nE "^\+.*#[0-9a-fA-F]{6}" || echo "no raw hex added"
```

Expected: `no raw hex added`.

- [ ] Confirm the rogue tracking value is gone from the tiles:

```bash
grep -rn "tracking-\[0.16em\]" components/receiving/ReceivingTile.tsx components/counts/CountsTile.tsx components/ordering/OrderingTile.tsx || echo "0.16em cleared from the tiles"
```

Expected: `0.16em cleared from the tiles`.

---

## Task 20 — Push and open the PR

- [ ] Push the branch:

```bash
git push -u origin feat/dashboard-operational-legibility
```

- [ ] Open the PR (do NOT merge — the lead reviews, Juan smokes, Juan clicks merge):

```bash
gh pr create --title "feat: dashboard operational legibility — status tiles, mid-shift strip, SIM-25/SIM-18b" --body "$(cat <<'EOF'
## What

Makes the dashboard and mid-shift COMPOSE today's operational state instead of rendering empty action CTAs — the 2-day sim's #1 finding, 3/3 manager personas: *"the dashboard can't show the operation."*

Design: `docs/superpowers/specs/2026-08-19-dashboard-operational-legibility-design.md`
Plan: `docs/superpowers/plans/2026-08-19-dashboard-operational-legibility.md`

**⛔ DO NOT MERGE** — awaits T0 review + Juan's preview smoke + Juan's explicit merge word.

### Status tiles (dashboard)
- **ReceivingTile** → per-truck mini-list of today's deliveries, problems first, capped at 3 + "and N more", quiet "log another" action. Empty state keeps today's action tile.
- **CountsTile** → days-since-last-count gauge (28px, climbs). Never-counted renders "—" + "start your first count" + the honest estimates sub-line.
- **OrderingTile** (new) → cutoff-led: an open cutoff is the 28px red headline; handled orders shrink to pills.

### Mid-shift
- **OperationalStrip** — the three composed headline facts, one-line, from the same pure helpers.
- **SIM-25 (safety-adjacent)** — the fridge aggregate can no longer claim "all in range" while any fridge is unread. Any unread fridge is the alert state; "in range" speaks only for fridges actually read; zero readings is a red "no readings yet". Pinned as a permanent vitest regression case.
- **Close status, one source of truth** — `deriveCloseState` replaces the dashboard's 3-value branch, which had **no `auto_finalized` case** and rendered auto-finalized days as "In progress" with a "Continue closing" CTA. Live bug, fixed.
- **SIM-18b** — the ordering board refreshes when a walk completes (`router.refresh()` was only wired to "start a new walk").

### Architecture
All compose logic is pure in `lib/dashboard-status-shared.ts` (client-safe, `*-shared.ts` pattern), returning `{headline, pills, rows}` view models that carry i18n keys. Tiles and the strip are thin renderings. No migration, no new routes, no new capture workflow. One read-only loader (`loadCountsTileState`) was added — see the plan's deviation **D1** for why `loadOnHand` could not be reused (it is ~15 queries and **writes** `sku_inferred_baselines` on the render path).

### Tests
`npm test` — 3 new suites: close-state model (incl. the `auto_finalized` regression), SIM-25 aggregation (incl. the false-all-clear regression), and the three tile compose functions + day math.

## Reviewer notes — deviations from the spec (each argued in the plan)
- **D1** new read-only counts loader vs. spec's "no new loaders"
- **D2** `N variances` is not persisted anywhere → renders as an honest absence
- **D3** `N short` is not on `DeliveryView` → uses the receiving page's existing badge vocabulary
- **D4** the `sm:grid-cols-2` shell from #245 already exceeds "explicit md 2-up" — left unchanged
- **D5** converging the *reports* surface onto the 4-state would delete label fidelity — reports is the reference, not a defect
- **D6** `PulseFridge.latestF` is window-scoped while `status` is today-scoped — the obvious SIM-25 fix would have been silently wrong
- **D7** the strip's LOUD rule intentionally bypasses the attention banner's F4 time gate

## Smoke checklist for Juan (preview URL, not prod)

**Phone width (390px) AND tablet width — both required.**

Dashboard:
- [ ] Receiving tile with deliveries logged today: vendor rows, badges, problems at the top, "and N more" when >3
- [ ] Receiving tile with **no deliveries today**: the familiar "Log a delivery" tile, unchanged
- [ ] Counts tile **never-counted** (today's truth): "—", "Start your first count", the estimates sub-line — **no invented numbers**
- [ ] Ordering tile on a day with an **open vendor cutoff**: the time is the big red headline, vendor named
- [ ] Ordering tile on a **no-cutoff day**: "All orders in" / "No orders today", nothing red
- [ ] Ordering tile hidden below key-holder; counts tile hidden below AGM
- [ ] Every tile taps through to its full surface
- [ ] Closing status on a day that **auto-finalized** now reads "Auto-finalized", not "In progress"

Mid-shift:
- [ ] The operational strip shows the same three sentences as the dashboard tiles
- [ ] **Fridge strip with an unread fridge → RED**, and the unread chip shows "not read" rather than a temperature
- [ ] Fridge strip with all fridges read and in range → the only green state
- [ ] Ordering: finish a par-pass walk, scroll up — the board reflects the new drafts **without a reload**

Both languages:
- [ ] Toggle to Spanish and re-check every tile — no raw keys, no English leaking

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XRNkwXzBLo4JFcCE75LKZy
EOF
)"
```

- [ ] Confirm CI goes green on the PR, then hand the preview URL to Juan. **Do not merge.**

---

## Spec → task coverage

| Spec section | Requirement | Task(s) |
| --- | --- | --- |
| §1 ReceivingTile | Label row `RECEIVING · N today` | 8 (`dashboard.receiving.label_count`), 13 |
| §1 ReceivingTile | Per-delivery row: vendor bold + badge pills + time | 7, 8 (`composeReceivingTile`, `receivingBadges`), 13 |
| §1 ReceivingTile | Problems sorted first | 7, 8 (`isReceivingProblem` sort) |
| §1 ReceivingTile | Cap 3 rows + "and N more" | 7, 8 (`RECEIVING_ROW_CAP`, `overflowCount`), 13 |
| §1 ReceivingTile | Quiet "+ Log another delivery" (small-control grammar) | 13 (`tracking-[0.08em]`) |
| §1 ReceivingTile | Empty state = today's action tile, unchanged | 7, 8 (`empty: true`), 13 |
| §1 ReceivingTile | Data = existing `loadRecentDeliveries`, no new loader | 16 |
| §1 ReceivingTile | Gate ≥4 | 16 |
| §1 CountsTile | 28px days-since number, computed server-side | 7, 8 (`daysBetweenYmd`), 14 |
| §1 CountsTile | `N variances` red pill · `N SKUs anchored` gold pill | 7, 8 (`composeCountsTile` pills), 14 — variance term per **D2** |
| §1 CountsTile | Never-counted: "—" + start-your-first-count + honest sub-line | 7, 8, 14 |
| §1 CountsTile | Data from `lib/counts.ts` | 10 (`loadCountsTileState`, per **D1**) |
| §1 Ordering | Open cutoff = 28px `co-cta-text` headline | 7, 8 (`form: "gauge"`, `tone: "danger"`), 15 |
| §1 Ordering | Nearest cutoff leads; others become red pills | 7, 8 (`openCutoffs.slice(1)`) |
| §1 Ordering | Handled state shrinks to pills (placed green / draft gold) | 7, 8 (`ORDER_STATUS_PILL`), 15 |
| §1 Ordering | No open cutoff → "All orders in" / placed count | 7, 8, 15 |
| §1 Ordering | Data = `loadTodaysOrders` + the cutoff attention logic | 16 (`loadOrderingAttention`) |
| §1 Ordering | Gate ≥4 matching the #254 nav minLevel | 16 |
| §1 tile-wide | Whole tile taps through | 13, 14, 15 |
| §1 tile-wide | All strings en+es incl. ARIA | 3, 6, 8, 17 (keys in the introducing task) |
| §1 tile-wide | EmptyState for genuine empties | 13 (receiving action-tile empty), 15 |
| §1 tile-wide | No invented data — honest absence | 8 (`varianceCount: null`), 14, 16 (null vs `[]`) |
| §2 | Operational strip on mid-shift, same helpers | 17 |
| §2 SIM-25 (a) | "In range" claims only fridges read | 5, 6 (`inRangeCount`) |
| §2 SIM-25 (b) | Any unread fridge → alert state | 5, 6, 11, 12 |
| §2 SIM-25 (c) | Zero readings → red "no readings yet" | 5, 6 |
| §2 SIM-25 | False-all-clear = permanent vitest case | 5 |
| §2 close status | One shared helper, 4 states | 3 |
| §2 close status | Verify + converge the three call sites | 4, 12/16 — see **D5** |
| §2 SIM-18b | Ordering board refreshes after a walk | 18 |
| §3 | No migration, no new routes, no new capture | all (none added) |
| §3 | Pure compose in a client-safe `*-shared.ts` | 3, 6, 8 |
| §3 | Vitest in the same PR | 2, 5, 7 |
| §3 | Tile labels → `tracking-[0.12em]` | 12, 13, 14, 15, 19 |
| §3 | Tile CTAs adopt ActionButton | 12, 13 |
| §3 | Token floor, zero raw hex | 19 |
| §3 | Explicit md 2-up; phone stacks; desktop 3-up | 17 (strip grid); dashboard grid unchanged per **D4** |
| §3 | Server components stay server; day math server-side | 10, 16, 17 |
| §4 | Vitest over every compose fn + SIM-25 + close status | 2, 5, 7 |
| §4 | `npm test` + `next build` + CI | 19, 20 |
| §4 | `scripts/check-ui-tokens.ts` over the diff | 19 |
| §4 | Juan smokes phone AND tablet | 20 (smoke checklist) |
| Out of scope | SIM-13, restyle sweep, quote-builder bars, new capture | not touched |
