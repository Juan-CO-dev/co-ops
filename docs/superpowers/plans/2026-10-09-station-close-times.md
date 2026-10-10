# Station close times and staffing trims

Branch: feat/station-close-times. Uncommitted implementation; no git writes.

## Confirmed contracts

- 0230 stores stations.usually_closes_at and station_positions.usually_trims_at. station_closures derives closure from closing checklist completions; release_closed_stations releases holders under the station/day lock. CC ruled that the close nudge navigates to today's closing checklist section; no standalone human close action is needed.
- lib/assignments.ts and /api/admin/stations currently permit KH timing edits without step-up. Superseded by the binding GM+ / level 8 all-shop ruling.
- ShiftBoardClient renders assignments, My shift, and Team today; its existing station mutation and override-reason dialog are the unassign path.
- Operational days use America/New_York; station_business_date can differ from calendar day across midnight.

## Implementation

1. Extend Station with daily trims [{at,to_count}], retain the existing close-time field. Migration 0238 adds validated JSON configuration, no seeds. Validate shape in a pure shared module and SQL.
2. Gate timing settings at GM+ with fresh role/membership checks, level 8+ any shop, Tier B step-up, existing station.timing_update audit. Extend station settings with a triggered schedule editor, en/es labels and 44px controls.
3. Pure nudge projection uses ET date/clock, current station heads, closure state, role and daily dismissal. Show close/trim labels on all board surfaces; KH+ nudges never perform mutations on timers or render. Trim choices use the existing single-person unassign + override-reason flow, one explicit choice at a time. Daily dismissals are browser/user/shop/day scoped, best effort if storage unavailable.
4. CC ruling (Fix 2): wire StationNudges to the existing /operations/closing?location=<shop>#<closingStationAnchor(name)> route. Its getOrCreateInstance flow handles both an existing instance and first entry today, and ClosingClient reveals the anchored section. Use the canonical English station key for navigation and localized name in en/es action copy. Disable prefetch because opening the route may create the instance. Keep trim release and findings 2–4 intact. Touch StationNudges, en/es, regression tests and this handoff/PR body; no database contract changes. Test both instance states, KH+/crew rendering, anchor encoding and i18n; run full tests and typecheck. Risk: browser scroll behavior still needs a preview smoke. This implements CC's supplied close-contract ruling.

## Verification and risks

Tests: settings scope/live roles/step-up, schedule validation, before/at/after and DST/day timing, closed/dismissed/crew suppression, only selected holder released, no automatic actions, en/es parity. Add rolled-back SQL harness for 0238; run npm.cmd test and npm.cmd run typecheck (known Leaflet PNG TS2307 excluded). Live SQL requires a sim connection; no production access or application.

Deliver file/line handoff and PR body. CC owns cross-family review and migration apply. Risks: stale board during a human action remains subject to existing RPC authority; dismissals are local to a browser; existing per-position advisory hints remain readable for compatibility.
