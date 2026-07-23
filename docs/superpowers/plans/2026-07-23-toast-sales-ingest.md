# Toast Sales Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. CC executes inline fully-auto per Juan; HOLD at CI-green PR (no merge, no prod migration).

**Goal:** Toast checks → append-only toast_sales_events → derived prep/SKU consumption projection with configurable catering exclusions.
**Architecture + all contracts:** the spec is the source of truth — docs/superpowers/specs/2026-07-23-toast-sales-ingest-design.md. Patterns: PR #173 (client/fixture/matcher/routes/tab), 0146 migration RLS shape, ToastTab step-up client pattern.

### Task 1: Migration 0147 (staged only) — spec §Data model SQL verbatim + deny-all policies for both tables. Commit.
### Task 2: Orders flatten (TDD) — tests/fixtures/toast/orders-v2-sample.json (REAL ordersBulk shape: top-level array of orders; checks[].selections[] with item.guid, modifiers[] nested selections; dining option object; void flags at all 3 levels) → tests/toast-orders.test.ts → lib/toast/orders-shared.ts (flattenToastOrders + selectionChanged) → green → commit.
### Task 3: lib/toast/orders.ts (server fetch, pagination, fixture key) + FIXTURE_KEYS entry (client-shared). Typecheck. Commit.
### Task 4: firstLevelItemConsumption in lib/prep-consumption-graph.ts + tests (count/weight refs, share scaling, no-recipe empty). Green → commit.
### Task 5: lib/catering/toast-sales-shared.ts (matchesExclusion pure + types) + tests; lib/catering/toast-sales.ts (pullSales version-diff append, exclusions CRUD, salesConsumption per spec incl. suspectedCatering heuristics + parent-excluded modifiers). Typecheck → commit.
### Task 6: routes (pull/consumption/exclusions/exclusions[id]) + app/api/cron/toast-sales-pull (constant-time secret, 503 unset, per-location error collection) + vercel.json cron + .env.local.example CRON_SECRET. Typecheck → commit.
### Task 7: [Sales] tab — components/admin/catering/prep-demand/SalesTab.tsx (self-fetching; date picker; pull w/ step-up; tables; advisories; exclusions manager) wired into PrepDemandClient tabs; i18n en+es (admin.toastsales.*). Typecheck → commit.
### Task 8: Full vitest + build; push; PR (spec link, staged-migration warning, done-criteria); opus code-review subagent over diff; fix real findings; HOLD.
