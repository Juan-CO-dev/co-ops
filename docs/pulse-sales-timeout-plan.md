# Pulse sales timeout: implementation plan

Scope: uncommitted work on fix/pulse-sales-timeout. No git writes, remote writes, deployment, production queries, or migration application.

References read: 0221/0222 capture schema and indexes; 0232 facts/classifier/daily/breakdown readers; 0237 modified capture; 0239 accounting reader; sales-reports loaders/shared types; pulse sections, baseline math, source cache, abort adapter and UI.

Findings: the pulse launches two daily RPCs (today and trailing 28 days), six breakdown RPCs (five today and one trailing), two modified-coverage reads and one latest-capture read: 11 requests on a cold source cache. Comparisons are disabled. The trailing window covers all 28 dates; four same weekdays feed pace. 0239 adds undated-refund examination through all historical payments before the report end and accounting JSON, even though pulse only displays legacy check totals and dated refund amounts. Pointer shop/date, check snapshot/check PK, payment snapshot PK, partial refund-date and capture shop/date/status indexes already exist. Exact production plan/scan attribution is not yet measured. Sales loaders currently bypass the injected deadline client.

Implementation:
1. Author 0242 with two service-role-only, stable, pinned-search-path read RPCs. pulse_sales_today keeps 0232 classified check totals, counted discounts and 0239 dated refund amount/count semantics, plus completed capture timestamp. No accounting JSON, undated-refund scan, tips or ezCater summary. Dated refunds remain on refund dates, including old sales. pulse_sales_baseline returns the existing 28-day hour_weekday breakdown and distinct completed capture days. No new tables/indexes (index growth 0 bytes).
2. Add lib/pulse/sales.ts: scope before I/O; today RPC plus five existing bounded breakdown readers using the injected client. Baseline RPC runs independently with an abortable 3-second deadline and an explicit promise race. Failure returns unavailable baseline, never a fake zero or failed today. All calls use the deadline client. Seven RPC requests per uncached source load, none on shared cache hits.
3. Wire sections to the pulse loader; retain existing baseline averaging/rounding and full heatmap. Add explicit unavailable-baseline en/es text. Keep Reports > Sales loaders/SQL untouched.
4. Tests: real pulse wiring request counts and windows; cached second poll; timeout/error baseline isolation and cancellation; permissions before I/O; baseline parity, empty captures; Sales page parity via SQL harness comparing the pulse's consumed fields against 0239 and existing report tests.
5. Add rollback-only sim harness and read-only EXPLAIN/timing instructions. Run npm.cmd test and npm.cmd run typecheck. Cold production performance remains a CC verification gate, not an invented result.

Risks: migration must precede app rollout; repeated breakdown facts still cost five single-day reads; baseline heatmap remains a bounded 28-day read and can be unavailable when its deadline expires. No production-sized cold guarantee can be made without measurement. Review required before implementation and CC before commit.
