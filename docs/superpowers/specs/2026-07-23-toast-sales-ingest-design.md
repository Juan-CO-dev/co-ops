# Toast Spec #2 — Sales Ingest → Depletion Projection (design)

**Date:** 2026-07-23 · **Approved:** Juan (approach A chosen live; "mixed" catering answer recorded; build on auto, HOLD at CI-green PR — merge + prod migration on his go)
**Grounding:** landscape council (read-first; append-only idempotent ingest w/ reconciliation, 4 seats; batch-at-day-end D3 call; sonnet's double-count boundary) + spec #1's crosswalk (PR #173, migration 0146) + the depletion-audit thread ("Toast sales-pull = regular-sales prep depletion", deferred until now).
**Companion decision:** catering intake & attribution (source labels, per-order team-member assignee, punch-in flow, EZCater-API seam) = **spec #2b, separately** — Juan's adds, decomposed.

## Purpose

Regular (non-catering) sales flow: Toast checks → an append-only `toast_sales_events` ledger → a **derived** consumption projection (prep-item units + SKU oz through the crosswalk and the existing graph engines). Advisory reads only — no stored on-hand mutation. The **double-count rule** (Juan: catering is MIXED across Toast/invoice/EZCater): admin-configurable exclusions on Toast-side checks + a suspected-catering advisory; outside-platform orders that touch neither system are a NAMED visibility gap until spec #2b's punch-in closes it.

## Data model (migration 0147 — staged; prod apply on Juan's go)

```sql
create table public.toast_sales_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  business_date date not null,
  check_guid text not null,
  selection_guid text not null,
  parent_selection_guid text,          -- modifiers point at their parent selection
  toast_item_guid text not null,
  item_name text not null,
  quantity numeric not null,
  price_cents integer,
  voided boolean not null default false,
  dining_option text,
  menu_group text,                     -- enriched from the menus pull at ingest time
  snapshot_version integer not null,   -- per (location,check,selection): 1..n, latest wins
  pulled_at timestamptz not null default now(),
  created_by uuid,
  unique (location_id, check_guid, selection_guid, snapshot_version)
);
create index tse_loc_date_idx on public.toast_sales_events(location_id, business_date);
create table public.toast_ingest_exclusions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),  -- null = all locations
  kind text not null check (kind in ('dining_option','menu_group','toast_item_guid','item_name_contains')),
  value text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
-- BOTH tables: enable RLS + deny-all split policies (0143/0146 pattern). No user reads/writes; lib is sole authority.
```

Ledger semantics: every pull compares incoming selection state (quantity, voided, price, name) to the LATEST stored version; changed or new → append version+1; identical → skip (idempotent re-pulls). Voids arrive as a new version with `voided=true`. Nothing updates in place; nothing deletes. Depletion reads latest-version-per-selection, filters voided + excluded.

## Toast orders pull

- `lib/toast/orders-shared.ts` (PURE): `flattenToastOrders(json)` — walks Toast `GET /orders/v2/ordersBulk?businessDate=YYYYMMDD` pages: orders[] → checks[] → selections[] (+nested `modifiers[]` selections, recursively; `parentSelectionGuid` threaded). Extracts `{checkGuid, selectionGuid, parentSelectionGuid, itemGuid (selection.item.guid), displayName, quantity, priceCents, voided (selection.voided || check.voided || order.voided), diningOptionGuid (order.diningOption?.guid — a bare ToastReference; NAMES resolve via a /config/v2/diningOptions pull at ingest, lib/toast/config.ts — corrected per PR #174 review finding #1)}`. Malformed → throw (whole pull poisons). Fixture-driven tests; fixture models the REAL Toast shape (lesson from review finding #1 on PR #173: object roots, real field names — `ordersBulk` returns a top-level ARRAY of orders; verify against docs when authoring the fixture and note shape source in the fixture).
- `lib/toast/orders.ts` (server-only): `fetchToastOrders(restaurantGuid, businessDate)` — paginates (`page`/`pageSize=100`) until short page; concatenates; fixture key `orders-v2-sample` (add to `FIXTURE_KEYS`).
- Menu-group enrichment: ingest calls `fetchToastMenuItems` once per pull and maps itemGuid → groupName for the `menu_group` column (powers `menu_group` exclusions, e.g. a Toast "Catering" menu group).

## Ingest — `lib/catering/toast-sales.ts` (server-only)

- `pullSales(actor, locationId, businessDate)` (≥7 + Tier-A at route): fetch orders + menu map → flatten → per selection compute latest stored version → append changed/new rows → audit `toast_sales.pull` {counts}. Returns {selections, appended, unchanged, voids}.
- `listExclusions/addExclusion/deactivateExclusion` (≥7 + Tier-A; append-only active-flag; audits `toast_sales.exclusion_add/remove`).
- `salesConsumption(actor, locationId, businessDate)` (≥6, read): latest non-void versions → drop excluded (any active exclusion matching dining_option / menu_group / toast_item_guid / item_name_contains, location-scoped or global) → drop modifier rows whose PARENT is excluded → resolve via crosswalk (confirmed, active) → quantities × per-unit flatten:
  - menu_item → `perUnitSkuOzForMenuItemFromGraph` (SKU oz) + `firstLevelItemConsumption` (prep-item par-units),
  - item → `perUnitSkuOzForItemFromGraph` + itself as 1:1 item consumption.
  Output: `{ soldLines[], prepConsumed: [{itemId,name,units}], skuConsumed: [{skuId,name,oz,packs?}], unmappedToastItems[], excludedCount, suspectedCatering[] }`.
  `suspectedCatering` advisory = non-excluded checks whose dining_option or item_name matches catering-ish heuristics (name contains "catering"/"platter"/"box lunch", or any single check with total quantity ≥ a threshold of 20) — visibility for misconfigured exclusions, per Juan's "mixed" reality.
- **New pure fn** in `lib/prep-consumption-graph.ts`: `firstLevelItemConsumption(graph, menuItemId): Map<itemId, parUnits>` — the consumer recipe's direct item-ref inputs per ONE unit of the sub, converted by the SAME `itemRefParUnits` weight-honest semantics (÷ batchYield, share-scaled like the menu engine). Unit tests beside the existing ones.

## Scheduling (new infra, dormant-safe)

- `app/api/cron/toast-sales-pull/route.ts`: GET; auth = `x-cron-secret` header must equal env `CRON_SECRET` (constant-time compare; 401 otherwise; 503 no-op when unset). Pulls YESTERDAY (America/New_York business date) for every active location with a `toast_restaurant_guid`, service-role actor context (`actor_context: "cron"` in audit metadata). Never throws to the platform — per-location failures collected and returned.
- `vercel.json`: `{"crons":[{"path":"/api/cron/toast-sales-pull","schedule":"0 9 * * *"}]}` (09:00 UTC ≈ 4–5am ET, after close). `CRON_SECRET` documented in `.env.local.example`. Fixture/no-creds mode: locations without GUIDs are skipped — the cron is a no-op until Juan's Toast errand.

## Routes

- `POST /api/admin/toast-sales/pull` {locationId, businessDate} — ≥7 + step-up A.
- `GET /api/admin/toast-sales/consumption?locationId&date` — ≥6 (matches the prep-demand page floor).
- `POST /api/admin/toast-sales/exclusions` {locationId?, kind, value, note?} + `POST /api/admin/toast-sales/exclusions/[id]` {action:"deactivate"} — ≥7 + step-up A.
- All errors typed (`AdminToastSalesError` | `ToastApiError`) → advisory states; never 500 a page.

## UI — [Sales] tab on `/admin/catering/prep-demand`

Self-fetching client panel (page load untouched — no Toast call blocks render): date picker (default yesterday, ET), for the page's selected location: **Pull sales** (step-up) + counts; consumption tables (prep-items with units · SKUs with oz); advisories (unmapped Toast items → link to the crosswalk tab, excluded count, suspected-catering list); collapsible **Exclusions** manager (list + add kind/value + deactivate; ≥7). Empty/not-configured states mirror the Toast tab. Full en+es i18n (`admin.toastsales.*`).

## Testing

- `tests/toast-orders.test.ts`: flatten on fixture — nesting/modifiers/parent threading, voided propagation (selection/check/order level), price cents, malformed poisons, pagination-shape tolerance.
- `tests/prep-consumption-graph.test.ts` additions: `firstLevelItemConsumption` — count-unit refs, weight-unit refs (oz→par-units via registered + fallback ozPerPar), share scaling on multi-output, empty on no recipe.
- Pure exclusion matcher (`matchesExclusion(sel, exclusions)`) exported from a client-safe shared module + unit tests (dining_option, menu_group, guid, name_contains, location scoping, parent-excluded-modifier).
- Version-diff helper (`selectionChanged(prev, next)`) pure + tested.

## Deliberately OUT

Spec #2b (intake sources, assignees, punch-in, EZCater API seam) · variance (spec #3 — this ledger feeds it) · webhooks · real-time · SKU-par writes/ordering · any Toast write. The known gap: outside-platform catering that never enters CO-OPS depletes via neither system until #2b's punch-in — named, not silent.

## Done criteria

Typecheck + tests green with zero creds; Sales tab pulls + projects end-to-end on fixtures (`TOAST_FIXTURES=1`); cron route 503s without `CRON_SECRET` and no-ops without GUIDs; migration 0147 staged in the PR only. **HOLD at CI-green PR.**
