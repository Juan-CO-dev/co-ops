# Mid-shift Pulse v2 — implementation plan

Status: BUILD, 2026-10-09. Spec (Juan-approved, on main at `ee807b2`): `docs/superpowers/specs/2026-10-09-midshift-pulse-v2-design.md`. Juan: "let's supercharge mid shift pulse". Branch `feat/pulse-v2` from `a3f4cf8` in the dedicated worktree `C:\co\wt-pulse`. Builder: CO Claude (Fable 5.1). Behind `PULSE_V2=1` (off). Migration **0240** AUTHORED ONLY, never applied by this plan. No pushes, no merges, no prod writes.

Style: tests first, small steps, every commit green on `npx vitest run <targeted>` + `npx tsc --noEmit`; the full CI (discipline → vitest ×2 shards → build → training-trace) runs once at the end under the owner-only build lock.

## Ground truth read before authoring (confirm-before-authoring)

| Reference | Finding | Consequence |
|---|---|---|
| `app/(authed)/mid-shift/page.tsx`, `lib/midshift.ts`, `lib/midshift-shared.ts` | v1 pulse: KH+ (`MIDSHIFT_BASE_LEVEL=4`), server-rendered, `pulseScore` RED/YELLOW/GREEN, `AttentionItem` kinds overdue/fridge/fridge_unchecked/maintenance_note/shrinkage/ordering_cutoff. `loadCateringDueToday` / `loadCateringTomorrow` are NOT exported. | v1 stays byte-identical when the flag is off. v2 reuses `pulseScore`, `computeOverdue`, `EXPECTED_BY`, `operationalNow`, `loadReportStatuses`; exports the two catering loaders. |
| `lib/assignments.ts` `loadShiftBoard` + `lib/assignments-shared.ts` | Stations already carry `usuallyClosesAt` (0230) and positions `usuallyTrimsAt`; closures via `station_closures` RPC; presence (0233, `WHOS_HERE=1`) on `ShiftPerson.presence`; breaks; departures. Board is "metadata-only for every shop member" (crew may call it). | People / Stations / Floor derive from ONE board read per request. Crew payloads are STRIPPED server-side (own station + own tasks + counts; no other names). |
| Station close times (Astra, 0238) | Not on `origin/main`; no `origin/feat/station-close-times` ref visible from this clone. 0230's `usually_closes_at` / `usually_trims_at` are the only close-time facts today. | Seam: `lib/pulse/close-times-shared.ts` turns a `Station` into `{ closesAt, trimsAt, closedAt, closingSoon }`. When 0238 merges, only that module changes. DEVIATION noted. |
| `lib/sales-reports.ts` / `-shared.ts` | `SALES_READ_MIN=7`; `assertSalesScope` (level + UUID + `canReadScopedReport`, 8+ every shop); `loadSalesSummary`, `loadSalesBreakdown` (item / modifier / channel / hour_weekday / discount / server) on ≤31-day windows via 0232 RPCs; `resolveSalesRange({range:"today"})` gives today-so-far; 503 `sales_reads_not_installed` when 0232 absent. | Sales section = summary(today) + item/channel/discount/hour_weekday(today) + hour_weekday + daily over the trailing 28 days for the same-weekday baseline. ≤ 8 bounded RPCs, fan-out 2. Money never below 7 (the loader throws). |
| `lib/toast/labor-shared.ts`, `lib/whos-here.ts`, 0224 `toast_time_entries` | `user_id` NULL = unlinked clock-in; `employee_first_name` on the row. | "Unlinked Toast clock-in" attention item = today's open entries with `user_id IS NULL` (one indexed query). |
| `lib/catering/not-in-toast.ts` `readNotInToast` | System seam over `ezcater_reconciliation_status` (status `not_rung_in_toast`), no PII; `toastRingTiming` pure. | Catering card "not rung yet" + attention rows; `total_cents` stripped below 7. |
| `lib/maintenance.ts` `loadMaintenanceOverview` | Fridge status today-scoped (`ok` / `out_of_range` / `no_reading_today`), sparkline. | Food safety section; crew get counts only. |
| `lib/ordering.ts` | `loadOrderingAttention` (KH+), `loadRecentParPasses` / `loadParPassDetail` (KH+): the last walk's lines carry `parQty`, `impliedOnHandOz`, `orderQty`. `loadWalkerData` / `loadOnHandDerived` are the heavy order-walk reads. | Inventory = last par pass (low vs par, 86 risk) + recent receiving + cutoffs. The heavy derivation is NOT run every 60 s. DEVIATION noted. |
| Handoff notes | Nothing exists (`pm_reports` are evaluations; `shift_overlays.forecast_notes` is CGS-only). | 0240 adds `pulse_handoff_notes` + `pulse_handoff_acks`. Loaders fail-soft to a "not installed" state while 0240 is unapplied. |
| Saved station layout | No settings table. | 0240 adds `pulse_station_layouts` (one row per station per shop). GM+ write, audited `station.layout_update` (destructive: a human changes shared config). |
| `lib/audit-actions.ts` / `lib/destructive-actions.ts` | Closed vocabulary, compiler-enforced. | New actions: `station.layout_update`, `handoff.note_create`, `handoff.note_ack` registered in `DESTRUCTIVE_ACTIONS` (human acts on the shared record). |
| `vitest.config.ts` | `server-only` aliased to a no-op so pure front-door guards are testable; no Supabase env → any real I/O fails loudly. | Section loaders take an injectable `deps` object; tests pass fakes. |
| `package.json` | No `three`. | `three@0.182.0` + `@types/three` added. Only `components/pulse/floor/Floor3D.tsx` imports it, and only via `await import("three")` inside the client component that `next/dynamic` loads with `ssr:false`. A test pins the static-import invariant. |
| i18n | `TranslationKey = keyof en.json`; `serverT` / `useTranslation`; parity tests filter keys by prefix. | Every v2 string under `pulse.*` in en + es; `tests/pulse-i18n.test.ts` pins parity + placeholder parity. |

## Role matrix (server-enforced in `lib/pulse/scope-shared.ts`; the page, the section pages and the API all call the same function)

| Section | Min level | Scoping below full |
|---|---|---|
| `attention` | 2 | crew (<4): only items about THEM (own station closing/trim, own late task) + shop-wide food-safety reminder counts; no names, no money |
| `floor` (3D) | 2 | crew: station statuses only, no names except their own; GM+ (7) may save the layout |
| `people` | 4 | — |
| `stations` | 2 | crew: own station + own tasks + open/covered/closed COUNTS; 4+: per-station detail with names |
| `sales` | 7 | GM: own shop (`assertSalesScope`); 8+: any shop |
| `catering` | 4 | `total_cents` only at 7+ |
| `inventory` | 4 | — |
| `food_safety` | 2 | crew: counts + reminder; 4+: per-fridge rows |
| `handoff` | 2 | crew read `crew`/`all` audience; 4–5 read all audiences; 6+ author + ack |

Page floor under the flag: level ≥ 2 (`PULSE_V2_BASE_LEVEL`); 8+ get the "Both shops" side-by-side tab. Every section page `/mid-shift/<section>` re-runs the same check and renders `AccessDeniedBanner` on failure; `/api/pulse/section` returns 403. Drill links never widen scope (a crew drill to `/mid-shift/people` is a 403 page, not a different payload).

## Data & freshness contract

- `GET /api/pulse/section?section=S&location=L` → `{ ok, section, asOf, data }` or `{ ok:false, error }`; 404 when `PULSE_V2` is off; 403 on scope; 400 on a bad section/location.
- The client polls each section on its own 60 s timer (paused while the tab is hidden; `attention` fires first), and a section's failure renders inside that card only.
- Every section loader is wrapped in `withSectionDeadline` (7 000 ms race → a named `timeout` error) so a slow lane can never approach the 8 s statement timeout at the page level; no loader is called per row (no N+1): the board, the fridges, the par pass, the sales RPCs are each ONE bounded read, windowed by location + date first.
- First paint: the server page runs every visible section through `loadPulseSections` (`Promise.allSettled`) and hands the results to the client, so the page is never blank and a failing section is already in its error state on load.

## Tasks

Each task = tests first → implementation → `npx vitest run tests/pulse-*.test.ts` + `npx tsc --noEmit` → one commit.

### T0 — plan + spec copy (this commit)
- The spec is on main; no copy needed. Commit the plan.

### T1 — flag + scope core (pure)
- `tests/pulse-scope.test.ts`: the matrix above for levels 2,3,4,5,6,7,8,9; `visibleSections(level)`; `canViewSection`; `crewScoped`; `moneyVisible`; `pageAccess(level, flagOn)`.
- `lib/pulse/flag.ts` (`pulseV2Enabled()` reads `process.env.PULSE_V2 === "1"`), `lib/pulse/scope-shared.ts`.
- Commit: `feat(pulse): v2 flag + role matrix (pure, server-enforced seam)`.

### T2 — pure models: attention ranking, close-time seam, floor statuses + layout, baseline math
- `tests/pulse-attention.test.ts`: rank order (uncovered station → closing soon → late task → missed checklist → fridge → low item → catering not rung → upcoming catering unprepped → unlinked clock-in), one action href per row, crew filter keeps only own items, dedupe by key, `pulseScore` compatibility (red kinds).
- `tests/pulse-close-times.test.ts`: `closeTimeFacts(station, nowMinutes)` → `closingSoon` within 60 min, closed wins, trim per position, null-safe; the seam module is the only place that reads `usuallyClosesAt`.
- `tests/pulse-floor.test.ts`: `stationStatus` (closed / uncovered / short / closing_soon / covered), `autoArrange(stations, cols)` serpentine grid by `sort`, `mergeLayout(auto, saved)`, name stripping for crew, `choose3D({webgl, reducedMotion, lowPower, saveData})`.
- `tests/pulse-baseline.test.ts`: `hourCurve(todayRows)`, `baselineCurve(rows, dow, weeksWithData)` average per hour with the basis stated, `cumulative`, `paceDeltaPct`, empty → nulls (never 0), unknown-amount → `partial`.
- Modules: `lib/pulse/attention-shared.ts`, `lib/pulse/close-times-shared.ts`, `lib/pulse/floor-shared.ts`, `lib/pulse/baseline-shared.ts`, `lib/pulse/types.ts` (section payload DTOs).
- Commit: `feat(pulse): pure models - attention ranking, close-time seam, floor statuses/layout, pace baseline`.

### T3 — migration 0240 (authored only) + audit actions
- `tests/pulse-0240-migration.test.ts`: header `-- Migration 0240_pulse_v2` + `AUTHORED ONLY … NOT APPLIED`; `begin;`/`commit;`; three tables; RLS enabled; split policies (`_no_user_select/insert/update/delete`, never `for all`); grants to `service_role` only; `pulse_station_layouts` unique `(location_id, station_id)`; acks unique `(note_id, user_id)`; notes `audience in ('crew','managers','all')`; `superseded_at` append-only shape. Audit actions present in `DESTRUCTIVE_ACTIONS`.
- `supabase/migrations/0240_pulse_v2.sql`, `lib/destructive-actions.ts`.
- Commit: `feat(pulse): 0240 handoff notes/acks + saved station layouts (AUTHORED ONLY) + audit actions`.

### T4 — server section loaders with injectable deps + isolation
- `tests/pulse-sections.test.ts`: `loadPulseSections` with fake deps — one loader throws → that section `{ state:"error" }`, others `{ state:"ok" }`; scope refusal before any dep call (crew → sales/people never reach a dep); crew `stations` payload has no other names; catering strips money below 7; deadline race yields `timeout`; sales 503 maps to `not_installed`; handoff 42P01 maps to `not_installed`.
- `lib/pulse/sections.ts` (server): `loadPulseSection(deps, ctx, section)`, `loadPulseSections(...)`, `defaultPulseDeps()`; `lib/pulse/handoff.ts` (read/author/ack, service role, gates inside), `lib/pulse/layout.ts` (read/save, GM+ bind + audit); `lib/midshift.ts` exports `loadCateringDueToday`, `loadCateringTomorrow`.
- Commit: `feat(pulse): section loaders (scope first, one bounded read each, per-section isolation + deadline)`.

### T5 — API routes
- `tests/pulse-api.test.ts` (mock `@/lib/session`, `@/lib/supabase-server`, `@/lib/pulse/sections`): flag off → 404; bad section → 400; location not in actor's list → 403; crew → `sales` 403 before the loader; GM → 200 with payload; `POST /api/pulse/layout` 403 below 7, 400 bad body, 200 calls `saveStationLayout`; `POST /api/pulse/handoff` note create 403 below 6, ack 403 below 6.
- `app/api/pulse/section/route.ts`, `app/api/pulse/layout/route.ts`, `app/api/pulse/handoff/route.ts`.
- Commit: `feat(pulse): /api/pulse section, layout, handoff routes (flag + scope + bind)`.

### T6 — i18n + charts + cards + client shell
- `tests/pulse-i18n.test.ts`: every `pulse.*` key in en exists in es and vice versa; placeholders match; no empty strings.
- `tests/pulse-charts.test.ts`: `PaceCurve`, `Bars`, `Heatmap` render to static markup with the basis line, accessible `<title>`/`aria-label`, and render an empty state with no data (no fake zeros).
- `components/pulse/charts/*.tsx` (SVG), `components/pulse/PulseClient.tsx` (per-section polling, `useSectionPoll`), `components/pulse/SectionCard.tsx` (skeleton / error / empty / ok states, 44 px "See more"), one card per section under `components/pulse/sections/`.
- `lib/i18n/en.json` + `es.json` `pulse.*`.
- Commit: `feat(pulse): client shell with per-section 60 s refresh + 2D charts + cards (en/es)`.

### T7 — 3D floor (lazy) + 2D fallback + drawer
- `tests/pulse-floor-bundle.test.ts`: under `components/` and `app/`, the only file whose source mentions `"three"` is `components/pulse/floor/Floor3D.tsx`, and there it appears only as `import("three")` (dynamic); `FloorCard.tsx` references `Floor3D` only through `next/dynamic` with `ssr: false`.
- `tests/pulse-floor-2d.test.ts`: `Floor2D` static markup shows every station with a text status (not colour-only) and the crew variant shows no names.
- `components/pulse/floor/FloorCard.tsx` (decides 2D/3D with `choose3D`, loads `Floor3D` lazily), `Floor2D.tsx` (SVG map, pointer drag for GM+), `Floor3D.tsx` (three.js: boxes per station, emissive status colour, sprites for names, raycast tap, drag for GM+), `StationDrawer.tsx` (who / tasks / closes-trims / one-tap actions through the existing `/api/assignments` + links to the board).
- Commit: `feat(pulse): live shop floor - three.js lazy-loaded, 2D fallback, station drawer`.

### T8 — pages
- `tests/pulse-page-access.test.ts`: pure `resolvePulsePage({flagOn, level, requestedLocation, accessible, actor})` → v1 / denied / v2 / both-shops; section page helper `resolveSectionPage(...)` → 404 when flag off, denied below floor, ok otherwise.
- `app/(authed)/mid-shift/page.tsx` (flag gate → v2 shell, else the unchanged v1), `app/(authed)/mid-shift/[section]/page.tsx` (depth view per section), `components/pulse/sections/*Detail.tsx`.
- Commit: `feat(pulse): v2 pulse home + per-section depth pages behind PULSE_V2`.

### T9 — CI under the build lock + hand-back
- `mkdir C:/co/scratch/w1-build.lock && { discipline; vitest shard 1/2; vitest shard 2/2; NODE_OPTIONS=--max-old-space-size=4096 npm run build; training-trace; rmdir …; }`.
- Post-build evidence: `three` lives in its own `.next/static/chunks/*` file; the `/mid-shift` page chunks do not contain `WebGLRenderer`.
- Merge `origin/main`, bundle `C:\co\scratch\pulse-v2-<shorthead>.bundle` (`origin/main..feat/pulse-v2`), verify, write `CO-CHIEF/05-BRIDGE/to-cc/2026-10-09-pulse-v2-done.md`.

## Deviations (declared up front)
1. Station "type" does not exist on `stations`; auto-arrange uses `sort` order in a serpentine grid (tenant-neutral; no name-keyword classification, per the T0 tenant-vocabulary law). GM+ drag fixes the real shape.
2. Inventory "low vs par / 86 risk" reads the LAST par pass (stated as of its walk time) instead of re-running the order-walk derivation every 60 s.
3. Catering "prep status" is the day's report progress (AM prep / mid-day) beside each event, not the catering prep-demand ledger (level 6 + heavy).
4. Station close times: 0230's advisory `usually_closes_at` / `usually_trims_at` through the seam; 0238 integration is one module swap.
5. Handoff + layout need 0240 (authored only); both sections degrade to an explicit "not installed yet" state until it is applied.
