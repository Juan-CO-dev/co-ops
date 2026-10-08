Title: Close stations from closing sections and release work on breaks or Toast clock-out

Completing the last active item in a closing section closes its station and appends system releases for its holders. Retracting an item reopens the station without restoring anyone. Staff can mark themselves on break; KH+ can send peers/lower-level staff on break without choosing cover. Open spots can be claimed or assigned, including manager self-cover; returning never restores a position automatically.

Today’s Toast labor pull now rides the ten-minute pinger with a reserved bounded budget and heartbeat. Successful day + correction pulls reconcile linked clock-outs idempotently, retire active daily task delegations and show who left each vacancy open. Historical pulls and partial failures cannot release work. Existing 0228 human override rules and RPC arguments are preserved. KH+ can edit optional closing/trim hints; these never auto-close a slot.

Migration 0230 adds append-only break/departure evidence, coherent system release CHECKs, advisory time columns, derived closure functions, completion triggers and service-only RPCs with grant self-checks. No seed times or identity guesses.

Validation: `npm.cmd test` — 357 files, 5,732 passed, one skipped. `npm.cmd run typecheck` — only six pre-existing permitted Leaflet PNG TS2307 errors. Discipline check and diff whitespace check pass. Four bilingual/mobile/desktop fixture previews have no horizontal overflow; they are not sim evidence.

Before rollout: CC must apply 0230 to sim, execute the rollback harness and concurrency cases, capture live interaction screens and complete cross-family review. Apply 0230 before app code; enable `STATION_LIFECYCLE=1` alongside `TOAST_LABOR_PULL=1` after verifying explicit Toast `user_id` links. The current pull does not populate those links. Juan/managers enter the optional station/position times. `next build` remains the normal CI gate.

See `docs/reviews/station-lifecycle/HANDOFF.md`, `scripts/test-station-lifecycle.sql`, and `docs/reviews/station-lifecycle/FIXTURE-PREVIEWS.md`.

Tested uncommitted tree is based on `9e1b519e`; `origin/main` advanced to `3e2b37eb` (#418 / 0229) during implementation. CC must integrate that newer base; no git writes were performed.
