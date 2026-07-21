# FR-b Customer Fulfillment Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/order/start`, a delivery customer's typed address is geocoded (free OSM/Nominatim, client-side, button-triggered) to a draggable pin, tested against FR-a's `offers_delivery` fulfillment nodes, and routed to the nearest node with capacity for the event date (falling through when full); pickup customers pick from `offers_pickup` nodes; the free-text time window becomes a fixed dropdown.

**Architecture:** A server routing brain (`lib/catering/fulfillment-routing.ts`) consumes the existing pure `lib/geo.ts` + reads active nodes / capacity policy / booked-lead counts and resolves a fulfilling node. A customer client subtree on `/order/start` does the geocode + Leaflet pin and calls the brain via a server action. The resolved node flows through the existing intake→token→draft path as `intake.locationId`; geocoded coords + a routed flag are persisted on the pipeline lead (migration 0139). When zero nodes are configured, the whole block is skipped and today's manual chooser renders unchanged (dormant-until-data).

**Tech Stack:** Next.js 16 (App Router, server actions, `proxy.ts`), React 19, TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres (service-role writes), Leaflet + react-leaflet v5 (already deps from FR-a), Tailwind v4. No unit-test framework — smoke via `tsx`.

**Model tiering:** CC (main loop) = sole reviewer + owns prod migration 0139 + all git; authors Tasks 1–3 + 6 inline. Sonnet 4.6 = Task 5 (`/order/start` UI). Fable 5 = Task 4 (routing smoke). Sonnet + Fable dispatched in parallel (disjoint files; neither commits).

**Grounding verified 2026-07-21 (confirm-before-authoring):** next migration = 0139; `catering_pipeline` RLS is column-agnostic and writes are service-role (no RLS change for new columns); `catering_capacity_policy` fields all nullable; `parseIntake` in the magic-link request route **whitelists** intake fields (must extend); the token stores/consumes `intake` whole; `createDraftFromIntake` lead insert shape captured.

---

## File Structure

- **`supabase/migrations/0139_catering_pipeline_geo_routing.sql`** (create) — adds `geo_lat`, `geo_lng`, `fulfillment_routed` to `catering_pipeline`.
- **`lib/catering/fulfillment-routing.ts`** (create) — the routing brain: public node reads, `routeDelivery`, capacity check, `CATERING_BOOKED_STAGES`, `CATERING_DELIVERY_WINDOWS`.
- **`lib/portal/draft.ts`** (modify) — extend `DraftIntake` + write the 3 new columns in `createDraftFromIntake`.
- **`app/api/portal/magic-link/request/route.ts`** (modify) — extend `parseIntake` to carry the 3 new fields.
- **`app/order/start/actions.ts`** (create) — `"use server"` server action `routeDeliveryAction`.
- **`app/order/start/page.tsx`** (modify) — load public nodes + pickup nodes server-side, pass to client.
- **`app/order/start/start-client.tsx`** (modify) — mount the routing subtree when nodes exist; fixed-window dropdown; graceful degradation.
- **`components/order/DeliveryRouteMap.tsx`** (create) — customer Leaflet map (dynamic `ssr:false`), draggable pin.
- **`lib/i18n/en.json` + `lib/i18n/es.json`** (modify) — new keys for the routing UI + window dropdown.
- **`scripts/fr-b-routing-smoke.ts`** (create) — seeded routing assertions.

---

## Task 1: Migration 0139 — pipeline geo/routing columns (CC)

**Files:**
- Create: `supabase/migrations/0139_catering_pipeline_geo_routing.sql`

- [ ] **Step 1: Apply the migration to prod via Supabase MCP** (CC only, project `bgcvurheqzylyfehqgzh`)

Apply this exact SQL via `apply_migration` (name `0139_catering_pipeline_geo_routing`):

```sql
-- Migration 0139_catering_pipeline_geo_routing
-- FR-b customer fulfillment routing: persist the geocoded pin + auto-routed marker on the lead.
-- location_id already carries the resolved fulfilling node (no new FK). Leads are mutable intake,
-- so plain nullable columns. RLS unchanged: catering_pipeline policies are column-agnostic and
-- intake writes are service-role (createDraftFromIntake). Canonical reference:
-- lib/catering/fulfillment-routing.ts + lib/portal/draft.ts createDraftFromIntake.

ALTER TABLE public.catering_pipeline
  ADD COLUMN geo_lat            double precision,
  ADD COLUMN geo_lng            double precision,
  ADD COLUMN fulfillment_routed boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Verify the columns landed**

Run via `execute_sql`:
```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='catering_pipeline'
  and column_name in ('geo_lat','geo_lng','fulfillment_routed')
order by column_name;
```
Expected: 3 rows — `fulfillment_routed boolean NO false`, `geo_lat double precision YES`, `geo_lng double precision YES`.

- [ ] **Step 3: Write the repo migration file**

Write `supabase/migrations/0139_catering_pipeline_geo_routing.sql` with this content (provenance header + the SQL):

```sql
-- Migration 0139_catering_pipeline_geo_routing
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Canonical reference: lib/catering/fulfillment-routing.ts + lib/portal/draft.ts createDraftFromIntake.

-- FR-b customer fulfillment routing: persist the geocoded pin + auto-routed marker on the lead.
-- location_id already carries the resolved fulfilling node (no new FK). Leads are mutable intake,
-- so plain nullable columns. RLS unchanged: catering_pipeline policies are column-agnostic and
-- intake writes are service-role (createDraftFromIntake).

ALTER TABLE public.catering_pipeline
  ADD COLUMN geo_lat            double precision,
  ADD COLUMN geo_lng            double precision,
  ADD COLUMN fulfillment_routed boolean NOT NULL DEFAULT false;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0139_catering_pipeline_geo_routing.sql
git commit -m "feat(fr-b): migration 0139 — pipeline geo/routing columns"
```

---

## Task 2: Routing brain — `lib/catering/fulfillment-routing.ts` (CC)

**Files:**
- Create: `lib/catering/fulfillment-routing.ts`

Reference patterns: `lib/admin/catering/fulfillment.ts` (node read shape, `metersToMiles`), `lib/geo.ts` (`haversineMeters`, `isWithinRadius`), `lib/supabase-server.ts` (`getServiceRoleClient`), `lib/catering/pipeline.ts` (`PIPELINE_STAGES`).

- [ ] **Step 1: Write the full module**

Create `lib/catering/fulfillment-routing.ts`:

```ts
/**
 * FR-b customer fulfillment routing — SERVER-ONLY, service-role. Public (pre-auth) reads of
 * FR-a's fulfillment nodes + delivery routing (nearest in-zone node with capacity, fall through
 * when full). Advisory only: a new inquiry does not reserve a slot (hard hold deferred).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { haversineMeters, isWithinRadius } from "@/lib/geo";

/** Stages that count against a node's daily capacity (a "booked" event). Matches W4a reserve-at-confirmed. */
export const CATERING_BOOKED_STAGES = ["confirmed", "out", "completed"] as const;

/** Fixed delivery time windows (field-note ②). Language-neutral clock strings; no per-location config. */
export const CATERING_DELIVERY_WINDOWS = [
  "10:00–10:30 AM",
  "10:30–11:00 AM",
  "11:00–11:30 AM",
  "11:30 AM–12:00 PM",
  "12:00–12:30 PM",
  "12:30–1:00 PM",
  "1:00–1:30 PM",
  "1:30–2:00 PM",
] as const;

export interface PublicFulfillmentNode {
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  offersDelivery: boolean;
  offersPickup: boolean;
}

export type DeliveryRouteResult =
  | { status: "routed"; locationId: string; locationName: string; distanceMeters: number }
  | { status: "out_of_zone" }
  | { status: "no_capacity" };

interface NodeRow {
  location_id: string;
  lat: number;
  lng: number;
  delivery_radius_meters: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
}

/** All active nodes at active locations. Public read (intake is pre-auth). Service-role bypasses RLS. */
export async function loadPublicFulfillmentNodes(): Promise<PublicFulfillmentNode[]> {
  const sb = getServiceRoleClient();
  const { data: nodes, error: nErr } = await sb
    .from("catering_fulfillment_nodes")
    .select("location_id, lat, lng, delivery_radius_meters, offers_delivery, offers_pickup")
    .eq("active", true)
    .returns<NodeRow[]>();
  if (nErr) throw new Error(`loadPublicFulfillmentNodes nodes: ${nErr.message}`);
  const rows = nodes ?? [];
  if (rows.length === 0) return [];
  const locIds = rows.map((n) => n.location_id);
  const { data: locs, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .in("id", locIds)
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`loadPublicFulfillmentNodes locations: ${lErr.message}`);
  const nameById = new Map((locs ?? []).map((l) => [l.id, l.name]));
  return rows
    .filter((n) => nameById.has(n.location_id)) // active-location gate
    .map((n) => ({
      locationId: n.location_id,
      locationName: nameById.get(n.location_id)!,
      lat: n.lat,
      lng: n.lng,
      radiusMeters: n.delivery_radius_meters,
      offersDelivery: n.offers_delivery,
      offersPickup: n.offers_pickup,
    }));
}

/** The pickup picker's option set. */
export async function loadPickupNodes(): Promise<PublicFulfillmentNode[]> {
  const all = await loadPublicFulfillmentNodes();
  return all.filter((n) => n.offersPickup);
}

interface CapacityPolicy {
  max_covers_per_day: number | null;
  max_events_per_day: number | null;
  min_lead_time_hours: number | null;
}

/** Advisory capacity check for one node + date. Null policy / null fields = no limit (pass). */
async function passesCapacity(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  eventDate: string | null,
  headcount: number | null,
): Promise<boolean> {
  const { data: policyRow, error: pErr } = await sb
    .from("catering_capacity_policy")
    .select("max_covers_per_day, max_events_per_day, min_lead_time_hours")
    .eq("location_id", locationId)
    .eq("active", true)
    .maybeSingle<CapacityPolicy>();
  if (pErr) throw new Error(`passesCapacity policy: ${pErr.message}`);
  if (!policyRow) return true; // no policy => unlimited

  // min_lead_time_hours (needs a date)
  if (policyRow.min_lead_time_hours != null && eventDate) {
    const eventStart = new Date(`${eventDate}T00:00:00`).getTime();
    const earliest = Date.now() + policyRow.min_lead_time_hours * 3_600_000;
    if (eventStart < earliest) return false;
  }

  // max_events / max_covers (need a date to count that day's booked leads)
  const needsCount =
    (policyRow.max_events_per_day != null || policyRow.max_covers_per_day != null) && !!eventDate;
  if (needsCount) {
    const { data: booked, error: bErr } = await sb
      .from("catering_pipeline")
      .select("headcount")
      .eq("location_id", locationId)
      .eq("event_date", eventDate)
      .in("stage", CATERING_BOOKED_STAGES as unknown as string[])
      .returns<Array<{ headcount: number | null }>>();
    if (bErr) throw new Error(`passesCapacity booked: ${bErr.message}`);
    const rows = booked ?? [];
    if (policyRow.max_events_per_day != null && rows.length + 1 > policyRow.max_events_per_day) return false;
    if (policyRow.max_covers_per_day != null) {
      const covers = rows.reduce((s, r) => s + (r.headcount ?? 0), 0);
      if (covers + (headcount ?? 0) > policyRow.max_covers_per_day) return false;
    }
  }
  return true;
}

/**
 * Route a delivery to the nearest in-zone node that has capacity for the date; fall through to the
 * next-nearest on capacity failure. Advisory (does not reserve). Invalid coords => out_of_zone.
 */
export async function routeDelivery(args: {
  lat: number;
  lng: number;
  eventDate: string | null;
  headcount: number | null;
}): Promise<DeliveryRouteResult> {
  const { lat, lng, eventDate, headcount } = args;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: "out_of_zone" };
  }
  const point = { lat, lng };
  const candidates = (await loadPublicFulfillmentNodes())
    .filter((n) => n.offersDelivery)
    .filter((n) => isWithinRadius(point, { lat: n.lat, lng: n.lng }, n.radiusMeters))
    .map((n) => ({ node: n, distanceMeters: haversineMeters(point, { lat: n.lat, lng: n.lng }) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  if (candidates.length === 0) return { status: "out_of_zone" };

  const sb = getServiceRoleClient();
  for (const c of candidates) {
    if (await passesCapacity(sb, c.node.locationId, eventDate, headcount)) {
      return {
        status: "routed",
        locationId: c.node.locationId,
        locationName: c.node.locationName,
        distanceMeters: c.distanceMeters,
      };
    }
  }
  return { status: "no_capacity" };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/co-ops && npx tsc --noEmit 2>&1 | grep -E "fulfillment-routing" ; echo "EXIT ${PIPESTATUS[0]}"`
Expected: no `fulfillment-routing` errors (EXIT 1 from grep = no match, which is what we want; confirm no lines printed above it).

- [ ] **Step 3: Commit**

```bash
git add lib/catering/fulfillment-routing.ts
git commit -m "feat(fr-b): fulfillment routing brain (public node reads + routeDelivery + capacity)"
```

---

## Task 3: Intake wiring — persist coords + routed flag (CC)

**Files:**
- Modify: `lib/portal/draft.ts` (DraftIntake type ~48-63; createDraftFromIntake insert ~212-229)
- Modify: `app/api/portal/magic-link/request/route.ts` (parseIntake ~43-57)
- Create: `app/order/start/actions.ts`

- [ ] **Step 1: Extend `DraftIntake` in `lib/portal/draft.ts`**

Add three fields after `dropoffDoor?: string | null;` (line 62), inside the `DraftIntake` interface:

```ts
  dropoffDoor?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  fulfillmentRouted?: boolean;
```

- [ ] **Step 2: Write the new columns in `createDraftFromIntake`**

In the `.from("catering_pipeline").insert({...})` block, add after `dropoff_door: intake.dropoffDoor ?? null,` (line 223):

```ts
      dropoff_door: intake.dropoffDoor ?? null,
      geo_lat: intake.geoLat ?? null,
      geo_lng: intake.geoLng ?? null,
      fulfillment_routed: intake.fulfillmentRouted ?? false,
```

- [ ] **Step 3: Extend `parseIntake` in the magic-link request route**

In `app/api/portal/magic-link/request/route.ts`, inside `parseIntake`'s returned object, add after `dropoffDoor: cap(o.dropoffDoor, CAP_SHORT),` (line 56):

```ts
    dropoffDoor: cap(o.dropoffDoor, CAP_SHORT),
    geoLat: typeof o.geoLat === "number" && Number.isFinite(o.geoLat) && Math.abs(o.geoLat) <= 90 ? o.geoLat : null,
    geoLng: typeof o.geoLng === "number" && Number.isFinite(o.geoLng) && Math.abs(o.geoLng) <= 180 ? o.geoLng : null,
    fulfillmentRouted: o.fulfillmentRouted === true,
```

- [ ] **Step 4: Create the server action**

Create `app/order/start/actions.ts`:

```ts
"use server";

import { routeDelivery, type DeliveryRouteResult } from "@/lib/catering/fulfillment-routing";

/** Public server action: route a delivery from a customer's pin. No auth (intake is pre-auth). */
export async function routeDeliveryAction(input: {
  lat: number;
  lng: number;
  eventDate: string | null;
  headcount: number | null;
}): Promise<DeliveryRouteResult> {
  return routeDelivery({
    lat: Number(input.lat),
    lng: Number(input.lng),
    eventDate: input.eventDate ?? null,
    headcount: input.headcount ?? null,
  });
}
```

- [ ] **Step 5: Typecheck + build**

Run: `cd ~/co-ops && npx tsc --noEmit 2>&1 | tail -5 ; echo "EXIT ${PIPESTATUS[0]}"`
Expected: EXIT 0, no errors in `draft.ts` / `route.ts` / `actions.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/portal/draft.ts app/api/portal/magic-link/request/route.ts app/order/start/actions.ts
git commit -m "feat(fr-b): carry geo coords + routed flag through intake→token→draft + route server action"
```

---

## Task 4: Routing smoke — `scripts/fr-b-routing-smoke.ts` (Fable)

**Files:**
- Create: `scripts/fr-b-routing-smoke.ts`

Run pattern: `npx tsx --env-file=.env.local scripts/fr-b-routing-smoke.ts`. Uses `getServiceRoleClient`. Must seed its own nodes + capacity policy + booked leads, assert, then delete everything it created (zero residue). Pick two REAL active location ids at runtime (query `locations` where active) so FKs are satisfied; if fewer than 2 active locations exist, skip with a clear message.

- [ ] **Step 1: Write the smoke script**

Create `scripts/fr-b-routing-smoke.ts`:

```ts
/**
 * FR-b routing smoke — seeds 2 fulfillment nodes + a capacity policy + booked leads at 2 real
 * active locations, asserts routeDelivery behavior, then removes everything it created.
 * Run: npx tsx --env-file=.env.local scripts/fr-b-routing-smoke.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { routeDelivery } from "@/lib/catering/fulfillment-routing";
import { milesToMeters } from "@/lib/geo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, name").eq("active", true).limit(2)
    .returns<Array<{ id: string; name: string }>>();
  if (!locs || locs.length < 2) {
    console.log("SKIP: need >=2 active locations to seed two nodes.");
    return;
  }
  const near = locs[0]!; // will be the closest node to the test point
  const far = locs[1]!;

  // Test point + two nodes: NEAR ~0.5mi away (5mi radius), FAR ~1.5mi away (5mi radius) — both in-zone.
  const pt = { lat: 38.9000, lng: -77.0300 };
  const nearCenter = { lat: 38.9050, lng: -77.0300 }; // ~0.35mi north
  const farCenter = { lat: 38.9200, lng: -77.0300 };  // ~1.4mi north
  const radius = Math.round(milesToMeters(5));

  const createdNodeIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdPolicyIds: string[] = [];

  async function seedNode(locationId: string, c: { lat: number; lng: number }) {
    const { data, error } = await sb.from("catering_fulfillment_nodes")
      .insert({ location_id: locationId, lat: c.lat, lng: c.lng, delivery_radius_meters: radius,
        offers_delivery: true, offers_pickup: true, active: true, created_by: null })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`seedNode: ${error.message}`);
    createdNodeIds.push(data.id);
  }

  try {
    // Clean any pre-existing nodes at these locations (UNIQUE one-per-location) so seeding is idempotent.
    await sb.from("catering_fulfillment_nodes").delete().in("location_id", [near.id, far.id]);
    await seedNode(near.id, nearCenter);
    await seedNode(far.id, farCenter);

    const future = "2030-01-15";

    // (a) nearest in-zone wins
    let r = await routeDelivery({ lat: pt.lat, lng: pt.lng, eventDate: future, headcount: 20 });
    assert(r.status === "routed" && r.locationId === near.id, "nearest in-zone node wins");

    // (b) out of zone: a point far from both
    r = await routeDelivery({ lat: 40.0, lng: -80.0, eventDate: future, headcount: 20 });
    assert(r.status === "out_of_zone", "point outside all radii => out_of_zone");

    // (c) capacity fallback: cap NEAR at max_events_per_day=1, book 1 confirmed lead there that date
    const { data: pol, error: polErr } = await sb.from("catering_capacity_policy")
      .insert({ location_id: near.id, max_events_per_day: 1, active: true })
      .select("id").single<{ id: string }>();
    if (polErr) throw new Error(`seed policy: ${polErr.message}`);
    createdPolicyIds.push(pol.id);
    const { data: lead, error: leadErr } = await sb.from("catering_pipeline")
      .insert({ contact_name: "smoke-booked", stage: "confirmed", location_id: near.id,
        event_date: future, headcount: 10, lead_source: "smoke", created_by: null })
      .select("id").single<{ id: string }>();
    if (leadErr) throw new Error(`seed lead: ${leadErr.message}`);
    createdLeadIds.push(lead.id);

    r = await routeDelivery({ lat: pt.lat, lng: pt.lng, eventDate: future, headcount: 20 });
    assert(r.status === "routed" && r.locationId === far.id, "NEAR over max_events => falls through to FAR");

    // (d) min_lead_time_hours rejects a too-soon date (FAR has no policy => still routes; so also cap FAR)
    await sb.from("catering_capacity_policy").update({ min_lead_time_hours: 100000 }).eq("id", pol.id);
    const { data: pol2, error: pol2Err } = await sb.from("catering_capacity_policy")
      .insert({ location_id: far.id, min_lead_time_hours: 100000, active: true })
      .select("id").single<{ id: string }>();
    if (pol2Err) throw new Error(`seed policy2: ${pol2Err.message}`);
    createdPolicyIds.push(pol2.id);
    r = await routeDelivery({ lat: pt.lat, lng: pt.lng, eventDate: future, headcount: 20 });
    assert(r.status === "no_capacity", "both nodes lead-time-blocked => no_capacity");

    console.log("\nFR-b routing smoke: ALL PASS");
  } finally {
    if (createdLeadIds.length) await sb.from("catering_pipeline").delete().in("id", createdLeadIds);
    if (createdPolicyIds.length) await sb.from("catering_capacity_policy").delete().in("id", createdPolicyIds);
    if (createdNodeIds.length) await sb.from("catering_fulfillment_nodes").delete().in("id", createdNodeIds);
    console.log("cleanup done");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `cd ~/co-ops && npx tsx --env-file=.env.local scripts/fr-b-routing-smoke.ts`
Expected: `FR-b routing smoke: ALL PASS` then `cleanup done` (or a clean `SKIP` if <2 active locations).

Note: `catering_pipeline` INSERT requires `contact_name` (NOT NULL). The smoke seeds it. If the insert fails on a missing NOT NULL column, add it and re-run — do not remove the assertion.

- [ ] **Step 3: Commit** (CC runs the smoke itself before committing)

```bash
git add scripts/fr-b-routing-smoke.ts
git commit -m "test(fr-b): routing smoke — nearest/fallback/out-of-zone/lead-time"
```

---

## Task 5: `/order/start` routing UI (Sonnet)

**Files:**
- Create: `components/order/DeliveryRouteMap.tsx`
- Modify: `app/order/start/page.tsx`
- Modify: `app/order/start/start-client.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

Reference patterns: `components/admin/catering/fulfillment/ZoneMap.tsx` (Leaflet SSR-safety: icon fix + dynamic import contract), `components/admin/catering/fulfillment/FulfillmentClient.tsx` (dynamic `ssr:false` mount + `mapKey` remount discipline).

- [ ] **Step 1: Create the customer map component**

Create `components/order/DeliveryRouteMap.tsx` — a customer variant of ZoneMap. It MUST be imported only via `dynamic(..., { ssr:false })` (Leaflet touches `document` at import). Copy the Leaflet default-icon fix from `ZoneMap.tsx` verbatim. Props: `{ mapKey: string; lat: number; lng: number; onPinChange: (lat:number, lng:number) => void }`. Render a `<MapContainer key={mapKey}>` centered on lat/lng, OSM `TileLayer`, one **draggable** `Marker` whose `dragend` calls `onPinChange`. `key={mapKey}` must be a STABLE value (e.g. `"pin"`), NOT `${lat},${lng}` — keying on coords remounts the map on every drag (the FR-a bug). Height 320px.

```tsx
"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import iconPng from "leaflet/dist/images/marker-icon.png";
import icon2xPng from "leaflet/dist/images/marker-icon-2x.png";
import shadowPng from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconUrl: (iconPng as unknown as { src?: string }).src ?? (iconPng as unknown as string),
  iconRetinaUrl: (icon2xPng as unknown as { src?: string }).src ?? (icon2xPng as unknown as string),
  shadowUrl: (shadowPng as unknown as { src?: string }).src ?? (shadowPng as unknown as string),
});

export interface DeliveryRouteMapProps {
  /** Stable key ("pin") — do NOT key on coords or the map remounts every drag. */
  mapKey: string;
  lat: number;
  lng: number;
  onPinChange: (lat: number, lng: number) => void;
}

export default function DeliveryRouteMap({ mapKey, lat, lng, onPinChange }: DeliveryRouteMapProps) {
  const center: [number, number] = [lat, lng];
  return (
    <MapContainer key={mapKey} center={center} zoom={13} style={{ height: "320px", width: "100%" }}
      className="rounded-xl border-2 border-co-border-2">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      <Marker position={center} draggable
        eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onPinChange(p.lat, p.lng); } }} />
    </MapContainer>
  );
}
```

- [ ] **Step 2: Load nodes server-side in `page.tsx`**

In `app/order/start/page.tsx`, import `loadPublicFulfillmentNodes` and `loadPickupNodes` from `@/lib/catering/fulfillment-routing`, call both, and pass `nodes` + `pickupNodes` (mapped to the `{ locationId, locationName, offersDelivery, offersPickup }` fields the client needs) into `OrderStartClient` alongside the existing `locations`. Do not pass raw lat/lng of nodes to the client unless needed for display (routing runs server-side via the action).

- [ ] **Step 3: Wire the routing subtree into `start-client.tsx`**

In `start-client.tsx`:
- Accept new props: `deliveryNodesExist: boolean` (true when `loadPublicFulfillmentNodes()` returned ≥1 `offersDelivery` node) and `pickupNodes: { locationId: string; locationName: string }[]`.
- Import `routeDeliveryAction` from `./actions` and `CATERING_DELIVERY_WINDOWS` from `@/lib/catering/fulfillment-routing`. Import the map: `const DeliveryRouteMap = dynamic(() => import("@/components/order/DeliveryRouteMap"), { ssr: false });`
- Add state: `geo: { lat: number; lng: number } | null`, `route: DeliveryRouteResult | null`, `locating: boolean`.
- **Graceful degradation:** when `!deliveryNodesExist`, render the EXISTING delivery block unchanged (manual "which of our locations" chooser + free-text address). Only when `deliveryNodesExist` AND `f.fulfillment === "delivery"`, render the new block:
  - Address input (reuse `f.address`) + a **"Locate on map"** button (disabled while `locating`) that calls Nominatim **client-side**: `fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(f.address))`, debounced by disabling the button during the request; on a result set `geo` to `{lat:+r[0].lat, lng:+r[0].lon}`; on empty/error, keep any existing pin and show a hint to drag the pin.
  - When `geo` is set, render `<DeliveryRouteMap mapKey="pin" lat={geo.lat} lng={geo.lng} onPinChange={(lat,lng) => { setGeo({lat,lng}); void runRoute(lat,lng); }} />`.
  - `runRoute(lat,lng)` = `const res = await routeDeliveryAction({ lat, lng, eventDate: f.date || null, headcount: Number(f.guests) || null }); setRoute(res);` — also call it right after a successful geocode.
  - Render the routing result: `routed` → "✓ You're in our delivery zone — {locationName} will cater this."; `out_of_zone` → "That address is outside our delivery area."; `no_capacity` → "You're in our area, but we're fully booked on that date — try another date or choose pickup." Use i18n keys.
  - Hold the resolved `locationId` (from a `routed` result) as the value submitted as `intake.locationId` for delivery; when the result is not `routed`, keep the Continue button's delivery path disabled (can't submit a delivery order with no fulfilling node).
- **Pickup path:** when `f.fulfillment === "pickup"` AND `deliveryNodesExist` (nodes configured), render the location chooser filtered to `pickupNodes`; otherwise keep the existing chooser.
- **Time window:** replace the free-text `timeWindow` input with a `<select>` over `CATERING_DELIVERY_WINDOWS` (add a blank "Any / flexible" first option that maps to `""`). Applies on both delivery and pickup when nodes exist; keep free-text when `!deliveryNodesExist` (dormant).
- Extend the intake payload POSTed to `/api/portal/magic-link/request` with: `geoLat: geo?.lat ?? null`, `geoLng: geo?.lng ?? null`, `fulfillmentRouted: route?.status === "routed"`. For delivery, set the payload `locationId` to the routed node's `locationId` (when routed); pickup uses the chosen pickup node id.

- [ ] **Step 4: Add i18n keys**

Add to BOTH `lib/i18n/en.json` and `lib/i18n/es.json` (Spanish = operational tú-form). Keys: `order.route.locate` ("Locate on map" / "Ubicar en el mapa"), `order.route.drag_hint` ("Not quite right? Drag the pin to your exact spot." / "¿No es exacto? Arrastra el pin a tu ubicación."), `order.route.in_zone` ("✓ You're in our delivery zone — {location} will cater this." / "✓ Estás en nuestra zona de entrega — {location} preparará tu pedido."), `order.route.out_of_zone` ("That address is outside our delivery area." / "Esa dirección está fuera de nuestra zona de entrega."), `order.route.no_capacity` ("You're in our area, but we're fully booked that date — try another date or choose pickup." / "Estás en nuestra zona, pero estamos llenos esa fecha — prueba otra fecha o elige recoger."), `order.route.window_label` ("Delivery time window" / "Horario de entrega"), `order.route.window_any` ("Flexible / any time" / "Flexible / cualquier hora"). Escape inner quotes with `\"`; validate JSON parses.

- [ ] **Step 5: Typecheck + build**

Run: `cd ~/co-ops && npx tsc --noEmit 2>&1 | tail -8 ; echo "TSC EXIT ${PIPESTATUS[0]}"` — expect EXIT 0.
Run: `cd ~/co-ops && npm run build 2>&1 | tail -15` — expect a successful build (no prerender/Suspense error on `/order/start`; the map is a client subtree behind `ssr:false`).

- [ ] **Step 6: Report to CC (do NOT commit — CC serializes commits)**

Report: files changed, the tsc/build results, and confirm the `mapKey` is a stable `"pin"` (not coord-keyed).

---

## Task 6: Gates, review, PR (CC)

**Files:** none (verification + git)

- [ ] **Step 1: CC reviews Sonnet's diff** against the recurring-bug-class checklist — focus: `mapKey` stable (not coord-keyed), graceful degradation truly renders today's flow when `!deliveryNodesExist`, delivery Continue disabled unless `routed`, intake payload carries the 3 new fields + routed locationId, i18n JSON valid, no `useSearchParams` without Suspense.

- [ ] **Step 2: Full gates**

```bash
cd ~/co-ops && npx tsc --noEmit 2>&1 | tail -5 ; echo "TSC EXIT ${PIPESTATUS[0]}"
cd ~/co-ops && npm run build 2>&1 | tail -8
```
Expected: TSC EXIT 0; build success. (eslint is not a CI gate — do not block on pre-existing warnings.)

- [ ] **Step 3: Commit Sonnet's work + push**

```bash
git add components/order/DeliveryRouteMap.tsx app/order/start/page.tsx app/order/start/start-client.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(fr-b): /order/start delivery routing UI — geocode + pin + node routing + window dropdown"
git push -u origin claude/fr-b-customer-routing
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(fr-b): customer fulfillment routing (address→geocode→pin→node)" --body "$(cat <<'EOF'
## FR-b — Customer Fulfillment Routing

Customer side of the radius-on-a-map delivery-zone idea (companion to FR-a #152). On `/order/start`, a delivery customer's address is geocoded (free OSM/Nominatim, client-side, button-triggered) to a draggable pin, tested against FR-a's `offers_delivery` nodes, and routed to the nearest node with capacity for the date (falling through when full). Pickup customers pick from `offers_pickup` nodes. Free-text time window → fixed dropdown (field-note ②).

### What shipped
- **Migration 0139** — `catering_pipeline.geo_lat / geo_lng / fulfillment_routed`.
- **`lib/catering/fulfillment-routing.ts`** — public node reads + `routeDelivery` (nearest-in-zone with advisory capacity fallback: min-lead-time + max-events + max-covers, counting `confirmed/out/completed` leads) + `CATERING_DELIVERY_WINDOWS`.
- **Intake wiring** — coords + routed flag flow through intake → token → `createDraftFromIntake`; `parseIntake` whitelist extended; `routeDeliveryAction` server action.
- **`/order/start` UI** — geocode + draggable Leaflet pin + live in/out-of-zone + node routing + pickup picker + window dropdown.
- **Smoke** — nearest / fallback / out-of-zone / lead-time.

### Dormant until data
Zero nodes configured today → the whole routing block is skipped and the current manual chooser + free-text window render unchanged. FR-b activates when Juan configures the first node (FR-a admin tool).

### Human smoke suggested
First customer-facing map. Worth a visual check of `/order/start` (delivery path) once a node is configured: geocode drops a pin, drag re-routes, in/out-of-zone message shows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Watch CI to green**

```bash
gh pr checks --watch
```
Expected: `build` passes. Then report the PR number + state to Juan; do NOT merge (Juan reviews + merges).

---

## Notes for the implementer

- **CC owns migration 0139 + all commits + the smoke run.** Sonnet reports, does not commit. Fable's smoke is run by CC before committing.
- **`noUncheckedIndexedAccess`:** array access returns `T | undefined` — the smoke's `locs[0]!` / `booked` reduce and the Nominatim `r[0]` access need guards or non-null assertions where provably safe.
- **Nominatim policy:** button-triggered only (never per-keystroke), one request per press. The pin is the source of truth; geocode just seeds it.
- **Graceful degradation is load-bearing:** with zero nodes (today), `/order/start` must behave exactly as on `main`. Test both branches.
