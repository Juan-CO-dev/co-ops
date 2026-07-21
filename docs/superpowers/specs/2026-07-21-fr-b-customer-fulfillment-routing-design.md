# FR-b — Customer Fulfillment Routing (design)

**Date:** 2026-07-21
**Status:** approved (Juan), ready for implementation plan
**Companion to:** FR-a (catering fulfillment nodes + admin zone tool + `lib/geo.ts`), MERGED #152 `bec6bc5`, migration 0138.
**Backlog ref:** field-note ① (customer side) + field-note ② (delivery-time dropdown). See `project_coops_catering_wiring_ideas_backlog.md`.

---

## Goal

On `/order/start`, a **delivery** customer types their address → a free OSM/Nominatim geocode drops a **draggable pin** → we test the pin against the `offers_delivery` fulfillment nodes → route the order to the **nearest node that has capacity for the event date**, falling through to the next-nearest when the first is full or violates lead time. A **pickup** customer picks from the `offers_pickup` nodes. This replaces the manual "which of our locations" chooser and the free-text time window on the delivery path.

FR-b is **dormant until data**: it activates only once Juan configures fulfillment nodes (FR-a admin tool). Until then `/order/start` behaves exactly as it does today (manual chooser + free-text window) via graceful degradation.

## Non-goals

- No paid geocoding API (free OSM/Nominatim only).
- No **hard** capacity hold. Routing is **advisory** (a brand-new inquiry does not reserve a slot; two customers can be routed to the same node/date before either confirms). Hard hold stays deferred, consistent with W4a's advisory posture.
- No per-location delivery-window config table — field-note ② ships as a **fixed constant** window list, not per-location config (that heavier version is a separate future sub-project if wanted).
- No change to the delivery-**fee** model (`catering_delivery_zones` fee tiers) — that is orthogonal to routing and unchanged.

---

## Grounding (verified against live code + DB, 2026-07-21)

- **`lib/geo.ts`** (from FR-a) provides `haversineMeters`, `isWithinRadius`, `milesToMeters`, `metersToMiles`. Reused as-is; no change.
- **`lib/admin/catering/fulfillment.ts`** — `loadFulfillmentNodes` is staff-gated (`FULFILLMENT_MIN = 7`). FR-b needs a **new public** node read. The file's header comment already anticipates "FR-b adds the customer-facing (public) read."
- **`catering_fulfillment_nodes`** (migration 0138): `location_id` (UNIQUE, one per location), `lat`, `lng`, `delivery_radius_meters`, `offers_delivery`, `offers_pickup`, `active`.
- **`/order/start` (`app/order/start/start-client.tsx`)** — the pre-auth new-customer intake form. Today it has: a delivery/pickup toggle, a **manual location chooser** ("Nearest shop" / "Pickup location"), a **free-text delivery address**, and a **free-text time window**. On submit it POSTs an `intake` payload to `/api/portal/magic-link/request`.
- **`createDraftFromIntake` (`lib/portal/draft.ts`)** — writes the pipeline lead with `location_id: intake.locationId` (the fulfilling store), `delivery_address`, `time_window`, and a quote carrying `is_delivery`. **`intake.locationId` IS the routing output** — FR-b derives it instead of the customer picking it.
- **`catering_pipeline`** — has `location_id` (fulfilling node, nullable), `delivery_address` (text), `time_window` (text). Has **no** coords column, **no** delivery-vs-pickup flag (only `quotes.is_delivery`), **no** explicit node reference.
- **`catering_capacity_policy`** — per-location, advisory: `max_covers_per_day`, `max_events_per_day`, `min_lead_time_hours` (all nullable), `active`.
- **Pipeline stages** (`lib/catering/pipeline.ts`): `inquiry, quote_sent, confirmed, out, completed, lost`. Terminal = `completed, lost`. W4a reserves prep-demand at `confirmed`, consumes at `out`/`completed`.
- **No per-location delivery-window/hours table exists** (only `catering_blackout_dates` for whole-day blackouts).

---

## Architecture

FR-b is a **customer-facing routing layer over FR-a's nodes**. Four pieces:

1. A small **migration** adding routing provenance to the pipeline lead.
2. A server **routing brain** (`lib/catering/fulfillment-routing.ts`) that consumes `lib/geo.ts`, reads nodes + capacity + booked counts, and resolves a node.
3. A **customer UI** on `/order/start` (client-side Nominatim geocode + draggable Leaflet pin + live in/out-of-zone + node routing display + pickup picker + fixed time-window dropdown), consuming the routing brain via a **server action**.
4. **Wiring** the resolved node + geocoded coords through the existing intake → draft path.

### Component 1 — Migration 0139 (`catering_pipeline` routing provenance)

```sql
ALTER TABLE public.catering_pipeline
  ADD COLUMN geo_lat            double precision,
  ADD COLUMN geo_lng            double precision,
  ADD COLUMN fulfillment_routed boolean NOT NULL DEFAULT false;
```

- `location_id` already carries the resolved fulfilling node — **no new FK**.
- `fulfillment_routed = true` = "auto-routed and verified in-zone at intake."
- `geo_lat` / `geo_lng` = the pin the customer confirmed; lets staff re-plot it.
- Leads are **mutable intake** (not append-only config), so plain nullable columns are correct. No RLS change needed (existing `catering_pipeline` policies cover the new columns; writes are service-role via `createDraftFromIntake`).
- No CHECK on lat/lng range at the DB layer (the routing brain + FR-a's coord validation already bound them); columns are nullable because pickup / non-routed / legacy leads have no coords.

### Component 2 — Routing brain: `lib/catering/fulfillment-routing.ts` (server-only, service-role)

```ts
export interface PublicFulfillmentNode {
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  offersDelivery: boolean;
  offersPickup: boolean;
}

/** Stages that count against a node's daily capacity (a "booked" event). */
export const CATERING_BOOKED_STAGES = ["confirmed", "out", "completed"] as const;

export type DeliveryRouteResult =
  | { status: "routed"; locationId: string; locationName: string; distanceMeters: number }
  | { status: "out_of_zone" }
  | { status: "no_capacity" };   // in zone, but every in-zone node is full / lead-time-blocked for the date

/** Public read: active nodes joined to active locations. No auth (intake is pre-auth). */
export async function loadPublicFulfillmentNodes(): Promise<PublicFulfillmentNode[]>;

/** The pickup picker's option set: active nodes with offers_pickup. */
export async function loadPickupNodes(): Promise<PublicFulfillmentNode[]>;

/**
 * Route a delivery. Nearest in-zone node that passes capacity wins; fall through on
 * capacity failure to the next-nearest. Advisory (a new inquiry doesn't reserve).
 * @param eventDate  YYYY-MM-DD (customer's event date; used for lead-time + daily counts)
 * @param headcount  guests (used for the max_covers_per_day check); null => treat as 0 for the cover math
 */
export async function routeDelivery(args: {
  lat: number;
  lng: number;
  eventDate: string | null;
  headcount: number | null;
}): Promise<DeliveryRouteResult>;
```

**`routeDelivery` algorithm:**

1. `nodes = loadPublicFulfillmentNodes()` filtered to `offersDelivery`.
2. `candidates = nodes.filter(n => isWithinRadius({lat,lng}, {lat:n.lat,lng:n.lng}, n.radiusMeters))`.
   - Empty → `{ status: "out_of_zone" }`.
3. Sort candidates by `haversineMeters` ascending.
4. For each candidate nearest→farthest, check capacity (see below). First that **passes** → `{ status: "routed", locationId, locationName, distanceMeters }`.
5. All candidates fail capacity → `{ status: "no_capacity" }`.

**Capacity check** (`passesCapacity(node, eventDate, headcount)`), all advisory — a null policy or null field = **no limit** (skip that sub-check; missing policy row = unlimited):

- Load `catering_capacity_policy` for `node.locationId` where `active = true` (nullable/absent → pass).
- **min_lead_time_hours:** if set and `eventDate` is non-null, require `eventDate` (interpreted at start-of-day, operational TZ) ≥ `now + min_lead_time_hours`. Too soon → fail. (If `eventDate` is null, skip — routing can still happen before a date is chosen.)
- **max_events_per_day / max_covers_per_day:** if either is set and `eventDate` is non-null, load the booked set for `(node.locationId, eventDate)` = leads with `stage ∈ CATERING_BOOKED_STAGES`; `events = count`, `covers = sum(headcount)`. Require `events + 1 ≤ max_events_per_day` (if set) AND `covers + (headcount ?? 0) ≤ max_covers_per_day` (if set). Over → fail.
  - One counting query per candidate as it's evaluated (short-circuits at the first pass; in practice ≤ a couple of nodes).

**Notes:**
- Booked-set definition matches W4a's reserve-at-`confirmed` semantics — an intake still at `inquiry` never counts against capacity, so the new lead doesn't count itself.
- No hard hold: two simultaneous pre-confirm routes to the same node/date are accepted. Advisory by design (Juan-locked).

### Component 3 — Geocode: client-side direct to Nominatim, button-triggered

- Browser calls `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<address>` **directly** (Juan's choice — no server hop).
- **Guardrail (Juan-approved):** the call fires only on an explicit **"Locate on map"** button, never per-keystroke, and is debounced, to respect OSM's ≤1 req/s usage policy.
- The response seeds the pin. **The pin is the source of truth** — if geocode returns nothing (or is wrong), the customer **drags the pin** to correct it. Every pin settle re-runs `routeDelivery`.
- No PII beyond the address the customer already typed; the address is not logged client-side.

### Component 4 — Customer UI: augment `/order/start`

A new client subtree, mounted only when **nodes exist** (see graceful degradation):

- **Delivery path:**
  - Address field + **"Locate on map"** button → geocode → pin.
  - **Leaflet map**, dynamic-imported `ssr:false` (same SSR-safety pattern as FR-a's `ZoneMap`; Leaflet touches `document` at import). Read-only-ish customer variant: draggable pin + (optionally) the routed node's radius circle.
  - On pin settle → **server action** `routeDeliveryAction({lat,lng,eventDate,headcount})` → render one of:
    - `routed` → **"✓ You're in our delivery zone — {locationName} will cater this."** (+ distance is internal, not necessarily shown)
    - `out_of_zone` → **"That address is outside our delivery area."** (offer pickup instead)
    - `no_capacity` → **"You're in our area, but we're fully booked on that date — try another date or pick up."**
  - This **replaces** the manual location chooser for delivery. Resolved `locationId` is held in form state for the intake payload.
- **Pickup path:** the existing chooser stays, filtered to `offers_pickup` nodes (`loadPickupNodes`, passed from the server wrapper).
- **Time window:** free-text field → **fixed dropdown** from `CATERING_DELIVERY_WINDOWS` (a shared i18n'd constant, e.g. 30-minute slots across service hours). Field-note ②.
- **Graceful degradation (critical — dormant until data):** the server wrapper loads `loadPublicFulfillmentNodes()`. **If it returns empty**, the address/map/routing block and the window dropdown's node-dependence are **skipped entirely** and the **current manual chooser + free-text window render unchanged.** Zero nodes today → intake behaves exactly as it ships on main now. FR-b activates automatically when the first node is configured.

### Component 5 — Wiring the result through

- **`DraftIntake`** (`lib/portal/draft.ts`) extended with `geoLat?: number | null`, `geoLng?: number | null`, `fulfillmentRouted?: boolean`. `createDraftFromIntake` writes them to the new `catering_pipeline` columns (`fulfillment_routed` defaults false when absent).
- **Magic-link request payload** (`/order/start` → `/api/portal/magic-link/request`) carries `geoLat`, `geoLng`, `fulfillmentRouted` inside `intake`. The magic-link request handler already forwards the `intake` object to draft creation — the new fields ride along (verify the handler passes the whole object through; if it whitelists fields, add the three).
- `intake.locationId` continues to be the fulfilling node — now set by routing on the delivery path, by the pickup picker on the pickup path.
- **Server action** lives with the `/order/start` server code (no new public API route; simpler, nothing new to rate-limit). The action calls `routeDelivery`.

---

## Error handling & edge cases

- **Geocode empty / network fail** → non-fatal; customer drags the pin manually. Never blocks the form.
- **No nodes configured** → graceful degradation to today's manual flow (above).
- **Pin outside all delivery zones** → `out_of_zone`; delivery can't be selected for that address; prompt pickup or a different address.
- **All in-zone nodes full for the date** → `no_capacity`; informative message; customer can change date or choose pickup.
- **`eventDate` not yet chosen when the customer locates** → routing still runs on distance + zone; capacity/lead-time sub-checks that need a date are skipped until a date is present (re-route when the date changes).
- **Malformed coords from a dragged pin** → the routing brain validates finite lat/lng in range (mirrors FR-a's `upsertFulfillmentNode` guard) and treats invalid input as `out_of_zone` rather than throwing.

## Testing

- **`scripts/fr-b-routing-smoke.ts`** (Fable) — seed 2 nodes + a capacity policy + booked leads; assert: (a) in-zone nearest wins, (b) over-capacity nearest falls through to next-nearest in-zone, (c) out-of-zone rejected, (d) `min_lead_time_hours` rejects a too-soon date, (e) null/absent policy = unlimited passes. Clean up seeded rows.
- **Public-node-read smoke** — `loadPublicFulfillmentNodes` / `loadPickupNodes` return only active nodes at active locations, no auth.
- **Build gate** (`npm run build`) — the customer map is a client subtree; confirm `ssr:false` dynamic import + any `useSearchParams` stay Suspense-safe.
- Recurring-bug-class review over the diff (CC).

## Model-tiered build (same loop as FR-a)

- **CC (main loop):** migration 0139 (apply to prod via Supabase MCP, verify, commit the repo file) + routing brain `lib/catering/fulfillment-routing.ts` + `DraftIntake`/`createDraftFromIntake` wiring + the server action. Sole reviewer; owns migration + deps + all git.
- **Sonnet 4.6:** the customer map/address UI on `/order/start` (client subtree, dynamic `ssr:false`, pickup picker, fixed-window dropdown, graceful-degradation branch) + i18n (EN/ES).
- **Fable 5:** `scripts/fr-b-routing-smoke.ts` + public-read smoke.

Dispatched Sonnet + Fable in parallel (disjoint files; neither touches git). CC serializes commits and runs smokes itself.

---

## Open items / deferred

- **Per-location delivery windows** (a config table + admin, the heavier ② version) — deferred; ships here as a fixed constant.
- **Hard capacity hold** — deferred (advisory only), consistent with W4a.
- **Optional public `/api/portal/fulfillment/route`** — not built; server action chosen instead.
- **Showing the customer the delivery fee** at routing time — out of scope (fee model is the separate `catering_delivery_zones` tier system; unchanged here).
