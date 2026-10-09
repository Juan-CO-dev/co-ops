# Station schedule handoff — CC close-contract ruling implemented

Worktree: C:/Users/conta/co-ops-stclose. Branch: feat/station-close-times. All changes remain UNCOMMITTED; no push, merge, deployment or database application.

## Fix 2

- `components/assignments/StationNudges.tsx:48`: close notices now render an ActionLink to `/operations/closing?location=<shop>#<closingStationAnchor(station.name)>`. The existing closing page resolves or creates today's instance, and its client reveals the anchored section. Prefetch is disabled so merely rendering the notice does not start the checklist. Crew visibility stays gated at level 4.
- `lib/i18n/en.json:12` / `lib/i18n/es.json:12`: “Close {name} station” / “Cerrar la estación {name}”. Display names localize; the anchor uses the canonical English station name.
- `tests/station-close-nudge.test.ts:41`: rendered href and actual page loader tests with mocked existing/new instance outcomes; translated label/canonical anchor and crew-level suppression. Existing schedule tests pin en/es key and interpolation parity. These are mocked component/page tests, not a browser or database integration smoke.
- Trim choices still use the existing explicit single-person unassign/override-reason flow. No manual closure writer: 0230 checklist completion remains the closure authority.
- Plan updated in `2026-10-09-station-close-times.md` to reflect CC's supplied ruling.

## Findings 2–4 preserved

- Finding 2: Eastern noon-to-noon timing, before-noon targets anchored to the following morning, latest due trims ordered by anchored dates. Summer/winter and midnight regression coverage retained.
- Finding 3: both station and legacy position trim hints are KH+ only; crew retain the close label. Full/compact coverage retained.
- Finding 4: migration 0238 refuses drift in deny-all RLS and effective privileges; the rollback-only sim harness includes staff denial probes. SQL harness remains unrun because psql/sim access is unavailable; DB timing remains unverified.

## Verification

- `npm.cmd test -- tests/station-close-nudge.test.ts tests/station-schedules.test.ts`: 2 files, 20 tests passed. Initial test-mock failure (missing `.returns`) corrected before this run.
- `npm.cmd test`: 391 files passed; 6,122 tests passed, 1 skipped (74.90s). TEMP/TMP set to workspace-local `.tmp-station-rework`. Log: `.tmp-station-rework/fix2-full-test.log` (ignored).
- `npm.cmd run typecheck`: exit 1, the same six pre-existing TS2307 Leaflet PNG imports in `components/admin/catering/fulfillment/ZoneMap.tsx:24-26` and `components/order/DeliveryRouteMap.tsx:6-8`; no new diagnostics.
- `git diff --check`: passed.
- Browser scroll/expansion smoke and SQL harness not run. CC owns cross-family review and migration approval.

## Draft PR body

Daily station schedules now support a close time and staffing targets per shop. GM+ configure them through the existing Tier B step-up and audit; level 8+ can edit any shop. Boards show localized schedule labels and KH+ notices when targets are due. Morning targets belong to the following morning of the station day; station and legacy position trim hints stay hidden from crew.

“Close {name} station” opens that station's section of today's closing checklist. The existing route resolves or creates the day's instance. Completing its closing items remains the only way to close the station, after which the existing lifecycle releases assignees. The link does not prefetch. Trims release only the person explicitly selected through the existing unassign/override flow. Dismissal lasts for the station day in that user's browser; timers only recompute notices.

Migration 0238 adds validated station trim configuration and asserts the existing deny-all RLS/privilege protections. Sim verification is required before application; the supplied SQL harness has not been executed.

Validation: 391 Vitest files passed, 6,122 tests passed and 1 skipped, including existing/new closing instance navigation, station anchors, crew suppression, timing/authz/scope and en/es parity. Typecheck remains failing only on six previously documented Leaflet PNG TS2307 imports. Browser interaction smoke remains outstanding.
