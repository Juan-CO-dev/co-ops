# FR-a — Catering Fulfillment Nodes + Admin Zone Tool — Design

**Date:** 2026-07-20
**Status:** Design approved (Juan), pre-implementation
**Source:** note ① from the 2026-07-19 field-notes triage ([[project_coops_catering_wiring_ideas_backlog]]). First of two: **FR-a** (this — nodes + admin zone tool) → **FR-b** (customer address→zone→routing).

## 1. Context & goal

Catering delivery/pickup should route by geography: a store's **delivery zone = a radius on a map**. FR-a builds the substrate — a **fulfillment-node model** (each catering store's center point + delivery radius + pickup/delivery flags) and a **staff admin map tool** to set it — plus a **pure geo helper** (haversine / point-in-radius) that FR-b reuses. **No external geocoding here** (that's FR-b's customer-side concern); FR-a is staff-only config over free map tiles.

**Decision locked (Juan):** zones are radius circles; the customer's coordinate (FR-b) comes from a **free OpenStreetMap/Nominatim geocode of their typed address + a draggable pin** (no paid API) — but that's FR-b. FR-a just models + authors the zones.

**Posture:** buildable now; the zone data it produces is consumed by FR-b (dormant customer flow) later. CO has 2 stores (both DC).

## 2. Scope

**In scope (FR-a):**
- A `catering_fulfillment_nodes` table (migration 0138) — one row per catering-serving store.
- A pure geo helper `lib/geo.ts` (haversine, point-in-radius, mile/meter conversion) with a real assertion test.
- A lib `lib/admin/catering/fulfillment.ts` (`loadFulfillmentNodes`, `upsertFulfillmentNode`).
- A staff admin map page `/admin/catering/fulfillment` (Leaflet + OSM tiles: draggable center marker + radius circle + pickup/delivery toggles) + a hub card + i18n.
- A seeded smoke.

**Out of scope (FR-b / later):**
- The **customer-facing** geocode → pin → in/out-of-zone → node routing + capacity fallback + pickup picker = **FR-b** (its own spec).
- Fee-tiers-by-radius (mapping the existing `catering_delivery_zones` fee tiers to concentric rings); drive-time (vs straight-line) routing; multiple zones per node — future enrichments.
- Adding coordinates to core `locations` (kept in the catering-table family instead).

## 3. Node model + geo helper

**Migration 0138 — `catering_fulfillment_nodes`** (one row per catering store; a location with no row is not a node):

| Column | Type / rule |
|---|---|
| `id` | uuid PK, `gen_random_uuid()` |
| `location_id` | uuid NOT NULL, FK → `locations(id)`, **UNIQUE** (one node per store) |
| `lat` | double precision NOT NULL |
| `lng` | double precision NOT NULL |
| `delivery_radius_meters` | integer NOT NULL, CHECK > 0 |
| `offers_delivery` | boolean NOT NULL DEFAULT true |
| `offers_pickup` | boolean NOT NULL DEFAULT true |
| `active` | boolean NOT NULL DEFAULT true |
| `created_at` | timestamptz NOT NULL DEFAULT now() |
| `created_by` | uuid FK → users(id) |
| `updated_at` | timestamptz NOT NULL DEFAULT now() |
| `updated_by` | uuid FK → users(id) |

RLS: `ENABLE ROW LEVEL SECURITY`; read `current_user_role_level() >= 5` (staff view — FR-b's public customer read will use service-role, added in FR-b); **writes service-role only** (deny user insert/update/delete; the lib is the authority). This is mutable **config** (like vendors) — the lib `upsert`s in place; `active=false` soft-disables. (No append-only ledger semantics here.)

**Pure geo helper `lib/geo.ts`** (no DB, no external calls):
```
haversineMeters(a: {lat:number,lng:number}, b: {lat:number,lng:number}): number   // great-circle distance
isWithinRadius(point: {lat,lng}, center: {lat,lng}, radiusMeters: number): boolean // haversine <= radius
milesToMeters(mi: number): number   // × 1609.344
metersToMiles(m: number): number    // ÷ 1609.344
```
`isWithinRadius` is the load-bearing primitive FR-b reuses. Tested with a **real assertion test** (`scripts/geo-test.ts` or folded into the FR-a smoke): known DC point pairs for `haversineMeters` (± tolerance), `isWithinRadius` true at ~1 mi inside a 2-mi radius / false at ~3 mi.

## 4. Admin zone tool

- **Surface:** a new admin page `app/admin/catering/fulfillment/page.tsx` + a hub card in `app/admin/catering/page.tsx` `EDITORS` (`{ id: "fulfillment", i18nKey: "admin.catering.hub.fulfillment", href: "/admin/catering/fulfillment", minLevel: 7 }`). Distinct from the fee-tier `/admin/catering/zones`.
- **Map:** **Leaflet + react-leaflet + free OpenStreetMap tiles** (`@types/leaflet` too; OSM attribution control included). The map component is a **client component dynamically imported with `{ ssr: false }`** (Leaflet touches `window`/DOM — SSR would break the build; this is the known Next.js+Leaflet trap, baked in). Per catering location: a map with a **draggable center marker** + a **radius `<Circle>`** that redraws as the radius changes; a **miles input** for the radius; **offers-delivery / offers-pickup** toggles; the map defaults to a DC center when a node has no coordinates yet.
- **Lib `lib/admin/catering/fulfillment.ts`** (service-role, mirrors the catering-admin lib pattern — `AdminCateringError`, `requireLevel`, `audit`):
  - `FULFILLMENT_MIN = 7`.
  - `loadFulfillmentNodes(actor) → FulfillmentNodeView[]` — all locations the actor can configure + their node row (if any), so the UI shows configured + unconfigured stores. `FulfillmentNodeView = { locationId, locationName, lat, lng, radiusMiles, offersDelivery, offersPickup, active, configured }`.
  - `upsertFulfillmentNode(actor, { locationId, lat, lng, radiusMiles, offersDelivery, offersPickup }) → { id }` — requires `level ≥ 7` + step-up **Tier A** (config edit); validates `lat`/`lng` finite + `radiusMiles > 0`; converts `radiusMiles → delivery_radius_meters` (`Math.round(milesToMeters)`); create-or-update by `location_id`; audits `catering.fulfillment.node_upsert`.
- **Route:** `PATCH /api/admin/catering/fulfillment` (`{ locationId, lat, lng, radiusMiles, offersDelivery, offersPickup }` in the body) → `upsertFulfillmentNode`, Tier A step-up, `jsonError`/`jsonOk` shape (mirror the packages route).
- i18n EN+ES (tú-form) for all new strings + the map controls.

## 5. Auth, edge cases, testing

- **Auth:** admin page gate `level ≥ 7 → redirect`; lib read ≥7, write ≥7 + Tier-A step-up, audited. Writes service-role only (RLS deny-user-writes).
- **Edge cases:** a location with no node row = not a node (shown as "unconfigured"); `offers_delivery=false` → pickup-only; `offers_pickup=false` → delivery-only; save **requires** `lat`/`lng` + `radius > 0`; default DC map center when unconfigured; `active=false` soft-disables. OSM tiles: attribution required (added), fair-use (fine for a low-traffic admin tool).
- **Testing:**
  - **Geo helper assertion test** — `haversineMeters` vs known DC pairs (± tolerance), `isWithinRadius` in/out. Pure/deterministic.
  - **Seeded smoke** `scripts/fr-a-smoke.ts` (service-role, seed→drive→assert→hard-delete, zero residue): `upsertFulfillmentNode` at a real location (lat/lng/radius/flags) → `loadFulfillmentNodes` reads it back + asserts (incl. `radiusMiles` round-trip through meters) → update the radius → re-read asserts the change → hard-delete the node row → verify zero residue → PASS.
  - `build` (must pass with the `ssr:false` dynamic-imported map) / `typecheck` / `eslint`.

## 6. Confirm-before-authoring — VERIFIED (2026-07-20)

- **Next migration = 0138** (0137 `catering_prep_demand` is the tip; W4b + Pipeline Search added no migration).
- `locations` has **no `lat`/`lng`** (free-text `address` only) → the coordinates live on the new `catering_fulfillment_nodes` (catering-table family, not core `locations`).
- **Leaflet is NOT installed** — new deps: `leaflet`, `react-leaflet`, `@types/leaflet`. First map integration in the codebase → the `ssr:false` dynamic-import is mandatory (Next 16 build/SSR).
- Catering hub `EDITORS` shape: `{ id, i18nKey: TranslationKey, href, minLevel }` (config cards at `minLevel 7`: menu/capacity/zones). Add the `fulfillment` card at `minLevel 7`.
- Catering-admin lib pattern (`lib/admin/catering/packages.ts`): `AdminCateringError`, `requireLevel`, step-up Tier A (edits) / Tier B (create/deactivate), `audit`, `getServiceRoleClient`. `catering_capacity_policy` is the existing per-location catering config precedent.

## 7. FR-b boundary (deferred)

FR-b consumes FR-a's nodes: a **public** (service-role) read of node zones for the customer order flow; free OSM/Nominatim geocode of the typed address → draggable pin → `isWithinRadius` (from `lib/geo.ts`) against each `offers_delivery` node → nearest in-zone node (capacity fallback via `catering_capacity_policy`); a **pickup picker** over `offers_pickup` nodes. Wired into `/order/*` (dormant until data).
