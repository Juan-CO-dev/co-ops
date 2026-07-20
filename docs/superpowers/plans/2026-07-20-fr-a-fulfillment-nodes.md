# FR-a — Catering Fulfillment Nodes + Admin Zone Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model each catering store as a fulfillment node (center + delivery radius + pickup/delivery flags) and give staff a Leaflet map tool to set it, plus a pure geo helper (haversine / point-in-radius) that FR-b reuses.

**Architecture:** A `catering_fulfillment_nodes` table (migration 0138) in the catering-table family. A pure `lib/geo.ts` (no DB/deps). A `lib/admin/catering/fulfillment.ts` lib (load/upsert, mirrors `packages.ts`). A `PATCH /api/admin/catering/fulfillment` route. A staff map page (`react-leaflet` + free OSM tiles, dynamically imported `ssr:false`). No geocoding here (FR-b).

**Tech Stack:** Next.js 16 (App Router, `params`/`searchParams` Promises), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS), **new deps: `leaflet` + `react-leaflet` + `@types/leaflet`**. Tests = `tsx` scripts. Branch: `claude/fr-a-fulfillment-nodes`.

**Model tiering:** CC authors T1 (migration — CC owns prod), T2 (geo helper), T3 (lib), T4 (route) inline + installs deps (T5 step 1) + owns all git; Sonnet 4.6 on T5 (map UI); Fable 5 on T6 (smoke). CC is SOLE reviewer + runs gates.

---

## Confirm-before-authoring — VERIFIED (2026-07-20)

- **Next migration = 0138** (0137 is the tip). `locations` has `id, name, active, address (free text)` — **no lat/lng** → coords live on the new table.
- **Leaflet NOT installed** — `leaflet`, `react-leaflet`, `@types/leaflet` are new. Leaflet touches `window`/DOM → the map component MUST be dynamically imported with `{ ssr: false }`, and `import "leaflet/dist/leaflet.css"`. Known gotcha: Leaflet's default marker icons 404 under bundlers → fix via `L.Icon.Default` merge or a custom icon (T5).
- Catering-admin lib pattern (`lib/admin/catering/packages.ts`, verbatim-read): `AdminCateringError(status, code, message?)`; `requireLevel(actor, min)` throws `AdminCateringError(403,"forbidden")`; `audit({ actorId, actorRole, action, resourceTable, resourceId, metadata, ipAddress, userAgent })` from `@/lib/audit`; `getServiceRoleClient`, `getRoleLevel`, `AuthContext`.
- Route pattern (`app/api/admin/catering/packages/route.ts`, verbatim-read): `requireSession(req, path)` → `if (ctx instanceof Response) return ctx` → `if (ROLES[ctx.user.role].level < MIN) return jsonError(403,"forbidden")` → `assertStepUp(ctx, "A"|"B")` → `parseJsonBody` → validate → lib → `try/catch (AdminCateringError → jsonError)`. Helpers from `@/lib/api-helpers` (`jsonError`, `jsonOk`, `parseJsonBody`), `assertStepUp` from `@/lib/admin/step-up`.
- Hub `EDITORS` shape: `{ id, i18nKey: TranslationKey, href, minLevel }`; config cards at `minLevel 7`.

## File Structure

- Create `supabase/migrations/0138_catering_fulfillment_nodes.sql` (CC applies).
- Create `lib/geo.ts` + `scripts/geo-test.ts` (pure helper + assertion test).
- Create `lib/admin/catering/fulfillment.ts` (load/upsert).
- Create `app/api/admin/catering/fulfillment/route.ts` (PATCH).
- Create `app/admin/catering/fulfillment/page.tsx` + `components/admin/catering/fulfillment/FulfillmentClient.tsx` + `components/admin/catering/fulfillment/ZoneMap.tsx` (the `ssr:false` map).
- Modify `app/admin/catering/page.tsx` (hub card) + `lib/i18n/en.json` + `lib/i18n/es.json`.
- Create `scripts/fr-a-smoke.ts`.

---

## Task 1: Migration 0138 — `catering_fulfillment_nodes` (CC)

**Files:** Create `supabase/migrations/0138_catering_fulfillment_nodes.sql`; apply via Supabase MCP (CC only).

- [ ] **Step 1: Write the migration**
```sql
-- Migration 0138_catering_fulfillment_nodes
-- Applied via Supabase MCP apply_migration on 2026-07-20.
-- Canonical reference: docs/superpowers/specs/2026-07-20-fr-a-fulfillment-nodes-design.md
--                      + lib/admin/catering/fulfillment.ts
--
-- FR-a: each catering-serving store's delivery zone = a center point + radius. One row per
-- store (a location with no row is not a catering node). Mutable config (lib upserts in place).

CREATE TABLE public.catering_fulfillment_nodes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id             uuid NOT NULL REFERENCES public.locations(id),
  lat                     double precision NOT NULL,
  lng                     double precision NOT NULL,
  delivery_radius_meters  integer NOT NULL CHECK (delivery_radius_meters > 0),
  offers_delivery         boolean NOT NULL DEFAULT true,
  offers_pickup           boolean NOT NULL DEFAULT true,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES public.users(id),
  CONSTRAINT catering_fulfillment_nodes_one_per_location UNIQUE (location_id)
);

ALTER TABLE public.catering_fulfillment_nodes ENABLE ROW LEVEL SECURITY;
-- Read: staff (>=5). FR-b's customer read is service-role (added there). Writes: service-role only.
CREATE POLICY catering_fulfillment_nodes_read ON public.catering_fulfillment_nodes FOR SELECT
  USING (public.current_user_role_level() >= 5);
CREATE POLICY catering_fulfillment_nodes_no_user_insert ON public.catering_fulfillment_nodes FOR INSERT WITH CHECK (false);
CREATE POLICY catering_fulfillment_nodes_no_user_update ON public.catering_fulfillment_nodes FOR UPDATE USING (false);
CREATE POLICY catering_fulfillment_nodes_no_user_delete ON public.catering_fulfillment_nodes FOR DELETE USING (false);
```

- [ ] **Step 2: (CC) apply + verify**
```sql
SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='catering_fulfillment_nodes'; -- Expect 12
SELECT relrowsecurity FROM pg_class WHERE relname='catering_fulfillment_nodes'; -- true
SELECT count(*)::int FROM pg_policies WHERE tablename='catering_fulfillment_nodes'; -- 4
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='catering_fulfillment_nodes_one_per_location'; -- UNIQUE (location_id)
```

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0138_catering_fulfillment_nodes.sql
git commit -m "feat(fr-a): migration 0138 — catering_fulfillment_nodes"
```

---

## Task 2: `lib/geo.ts` — pure geo helper + assertion test (CC)

**Files:** Create `lib/geo.ts`; Create `scripts/geo-test.ts`.

- [ ] **Step 1: `lib/geo.ts`**
```ts
/** Pure geo helpers — no DB, no external calls. Great-circle (haversine) distance + radius check. */
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_MILE = 1609.344;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` is within `radiusMeters` of `center` (the in/out-of-zone test). */
export function isWithinRadius(point: LatLng, center: LatLng, radiusMeters: number): boolean {
  return haversineMeters(point, center) <= radiusMeters;
}

export function milesToMeters(mi: number): number {
  return mi * METERS_PER_MILE;
}
export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}
```

- [ ] **Step 2: `scripts/geo-test.ts` (pure assertion test — no env/DB)**
```ts
import assert from "node:assert/strict";
import { haversineMeters, isWithinRadius, milesToMeters, metersToMiles } from "@/lib/geo";

// 1 degree of longitude at the equator ≈ 111,195 m (π/180 × 6,371,000).
const oneDeg = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
assert.ok(Math.abs(oneDeg - 111_195) < 50, `1° lng at equator ≈ 111195 m (got ${oneDeg})`);
// Symmetric for latitude.
const oneDegLat = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
assert.ok(Math.abs(oneDegLat - 111_195) < 50, `1° lat ≈ 111195 m (got ${oneDegLat})`);
// Same point → 0.
assert.equal(haversineMeters({ lat: 38.9, lng: -77.0 }, { lat: 38.9, lng: -77.0 }), 0, "same point = 0 m");

// A point ~1 mile north of a DC center (1 mi ≈ 1/69.0 deg lat).
const center = { lat: 38.9072, lng: -77.0369 };
const oneMileNorth = { lat: center.lat + 1 / 69.0, lng: center.lng };
const d = haversineMeters(oneMileNorth, center);
assert.ok(Math.abs(d - milesToMeters(1)) < 50, `~1 mi north ≈ ${milesToMeters(1)} m (got ${d})`);
assert.equal(isWithinRadius(oneMileNorth, center, milesToMeters(2)), true, "1 mi is within a 2 mi radius");
assert.equal(isWithinRadius(oneMileNorth, center, milesToMeters(0.5)), false, "1 mi is NOT within a 0.5 mi radius");

// Round-trip conversion.
assert.ok(Math.abs(metersToMiles(milesToMeters(3)) - 3) < 1e-9, "miles round-trip");

console.log("geo-test: PASS");
```

- [ ] **Step 3: Run + commit**
```bash
npx tsx scripts/geo-test.ts   # Expect: geo-test: PASS
npm run typecheck
git add lib/geo.ts scripts/geo-test.ts
git commit -m "feat(fr-a): lib/geo.ts — haversine/point-in-radius + assertion test"
```

---

## Task 3: `lib/admin/catering/fulfillment.ts` — load/upsert (CC)

**Files:** Create `lib/admin/catering/fulfillment.ts`.

**Context:** Mirrors `lib/admin/catering/packages.ts` conventions. `lat`/`lng` are `double precision` (return as numbers); radius stored as meters, exposed as miles.

- [ ] **Step 1: Write the lib**
```ts
/**
 * FR-a catering fulfillment nodes — SERVER-ONLY, service-role. Per-store delivery-zone config
 * (center + radius + pickup/delivery flags). Mutable config (upsert in place). Staff-gated (>=7).
 * FR-b adds the customer-facing (public) read of these nodes.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { milesToMeters, metersToMiles } from "@/lib/geo";

export const FULFILLMENT_MIN = 7;

export class FulfillmentError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "FulfillmentError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new FulfillmentError(403, "forbidden", "Insufficient role level");
}

export interface FulfillmentNodeView {
  locationId: string;
  locationName: string;
  configured: boolean; // has a node row
  lat: number | null;
  lng: number | null;
  radiusMiles: number | null;
  offersDelivery: boolean;
  offersPickup: boolean;
  active: boolean;
}

/** Every active location + its node row (if any), so the admin sees configured + unconfigured stores. */
export async function loadFulfillmentNodes(actor: AuthContext): Promise<FulfillmentNodeView[]> {
  requireLevel(actor, FULFILLMENT_MIN);
  const sb = getServiceRoleClient();
  const { data: locs, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`loadFulfillmentNodes locations: ${lErr.message}`);
  const { data: nodes, error: nErr } = await sb
    .from("catering_fulfillment_nodes")
    .select("location_id, lat, lng, delivery_radius_meters, offers_delivery, offers_pickup, active")
    .returns<Array<{ location_id: string; lat: number; lng: number; delivery_radius_meters: number; offers_delivery: boolean; offers_pickup: boolean; active: boolean }>>();
  if (nErr) throw new Error(`loadFulfillmentNodes nodes: ${nErr.message}`);
  const byLoc = new Map((nodes ?? []).map((n) => [n.location_id, n]));
  return (locs ?? []).map((l) => {
    const n = byLoc.get(l.id);
    return {
      locationId: l.id,
      locationName: l.name,
      configured: !!n,
      lat: n?.lat ?? null,
      lng: n?.lng ?? null,
      radiusMiles: n ? metersToMiles(n.delivery_radius_meters) : null,
      offersDelivery: n?.offers_delivery ?? true,
      offersPickup: n?.offers_pickup ?? true,
      active: n?.active ?? false,
    };
  });
}

export interface UpsertFulfillmentNodeInput {
  locationId: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  offersDelivery: boolean;
  offersPickup: boolean;
}

/** Create-or-update the node for a location (>=7, Tier-A step-up enforced at the route). */
export async function upsertFulfillmentNode(actor: AuthContext, input: UpsertFulfillmentNodeInput): Promise<{ id: string }> {
  requireLevel(actor, FULFILLMENT_MIN);
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) {
    throw new FulfillmentError(400, "invalid_coords", "lat/lng out of range");
  }
  if (!Number.isFinite(input.radiusMiles) || input.radiusMiles <= 0) {
    throw new FulfillmentError(400, "invalid_radius", "radius must be > 0");
  }
  const sb = getServiceRoleClient();
  const { data: loc, error: locErr } = await sb.from("locations").select("id").eq("id", input.locationId).eq("active", true).maybeSingle<{ id: string }>();
  if (locErr) throw new Error(`upsertFulfillmentNode location check: ${locErr.message}`);
  if (!loc) throw new FulfillmentError(404, "location_not_found", "Location not found or inactive");

  const radiusMeters = Math.round(milesToMeters(input.radiusMiles));
  const { data: existing, error: exErr } = await sb.from("catering_fulfillment_nodes").select("id").eq("location_id", input.locationId).maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`upsertFulfillmentNode dup check: ${exErr.message}`);

  const fields = {
    lat: input.lat,
    lng: input.lng,
    delivery_radius_meters: radiusMeters,
    offers_delivery: input.offersDelivery,
    offers_pickup: input.offersPickup,
    active: true,
    updated_by: actor.user.id,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await sb.from("catering_fulfillment_nodes").update(fields).eq("id", existing.id);
    if (error) throw new Error(`upsertFulfillmentNode update: ${error.message}`);
    void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.fulfillment.node_upsert", resourceTable: "catering_fulfillment_nodes", resourceId: existing.id, metadata: { location_id: input.locationId, radius_meters: radiusMeters, offers_delivery: input.offersDelivery, offers_pickup: input.offersPickup, updated: true }, ipAddress: null, userAgent: null });
    return { id: existing.id };
  }

  const { data: inserted, error } = await sb
    .from("catering_fulfillment_nodes")
    .insert({ location_id: input.locationId, created_by: actor.user.id, ...fields })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`upsertFulfillmentNode insert: ${error.message}`);
  if (!inserted) throw new Error("upsertFulfillmentNode insert returned no row");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.fulfillment.node_upsert", resourceTable: "catering_fulfillment_nodes", resourceId: inserted.id, metadata: { location_id: input.locationId, radius_meters: radiusMeters, offers_delivery: input.offersDelivery, offers_pickup: input.offersPickup, created: true }, ipAddress: null, userAgent: null });
  return { id: inserted.id };
}
```

- [ ] **Step 2: Typecheck + commit**
```bash
npm run typecheck
git add lib/admin/catering/fulfillment.ts
git commit -m "feat(fr-a): fulfillment lib — loadFulfillmentNodes + upsertFulfillmentNode"
```

---

## Task 4: `PATCH /api/admin/catering/fulfillment` route (CC)

**Files:** Create `app/api/admin/catering/fulfillment/route.ts`.

**Context:** Mirror the packages POST route: `requireSession` → level ≥7 → `assertStepUp("A")` → validate → `upsertFulfillmentNode`.

- [ ] **Step 1: Write the route**
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadFulfillmentNodes,
  upsertFulfillmentNode,
  FulfillmentError,
  FULFILLMENT_MIN,
  type UpsertFulfillmentNodeInput,
} from "@/lib/admin/catering/fulfillment";

// GET — list nodes (configured + unconfigured stores). No step-up (read).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/fulfillment");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < FULFILLMENT_MIN) return jsonError(403, "forbidden");
  try {
    const nodes = await loadFulfillmentNodes(ctx);
    return jsonOk({ nodes });
  } catch (e) {
    if (e instanceof FulfillmentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// PATCH — upsert a node (>=7, Tier A). Body: { locationId, lat, lng, radiusMiles, offersDelivery, offersPickup }.
export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/fulfillment");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < FULFILLMENT_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.lat !== "number" || typeof b.lng !== "number" || typeof b.radiusMiles !== "number") {
    return jsonError(400, "invalid_payload", { message: "locationId, lat, lng, radiusMiles required" });
  }
  if (typeof b.offersDelivery !== "boolean" || typeof b.offersPickup !== "boolean") {
    return jsonError(400, "invalid_payload", { message: "offersDelivery, offersPickup required" });
  }
  const input: UpsertFulfillmentNodeInput = {
    locationId: b.locationId,
    lat: b.lat,
    lng: b.lng,
    radiusMiles: b.radiusMiles,
    offersDelivery: b.offersDelivery,
    offersPickup: b.offersPickup,
  };
  try {
    const { id } = await upsertFulfillmentNode(ctx, input);
    return jsonOk({ id });
  } catch (e) {
    if (e instanceof FulfillmentError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2: Typecheck + commit**
```bash
npm run typecheck
git add app/api/admin/catering/fulfillment/route.ts
git commit -m "feat(fr-a): fulfillment route — GET nodes + PATCH upsert (Tier A)"
```

---

## Task 5: Install Leaflet (CC) + admin map UI (Sonnet)

**Files:** (CC) `package.json`/lock; (Sonnet) Create `app/admin/catering/fulfillment/page.tsx`, `components/admin/catering/fulfillment/FulfillmentClient.tsx`, `components/admin/catering/fulfillment/ZoneMap.tsx`; Modify `app/admin/catering/page.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`.

- [ ] **Step 1 (CC): install deps + commit**
```bash
npm install leaflet react-leaflet
npm install -D @types/leaflet
npm run build   # sanity: install didn't break the build
git add package.json package-lock.json
git commit -m "chore(fr-a): add leaflet + react-leaflet for the zone map"
```

- [ ] **Step 2 (Sonnet): the map UI.** Context to read first: `app/admin/catering/packages/page.tsx` (admin server-gate pattern: `requireSessionFromHeaders("/admin")` → `ROLES[auth.user.role].level < MIN → redirect("/dashboard")`), `components/admin/catering/packages/PackagesClient.tsx` (`.co-*` visual system, `useTranslation`, `postJson`/`resolveErrorKey` from `@/components/admin/catering/shared`, `useStepUp` for step-up). Contracts: `loadFulfillmentNodes(auth) → FulfillmentNodeView[]` (`{locationId, locationName, configured, lat, lng, radiusMiles, offersDelivery, offersPickup, active}`); `FULFILLMENT_MIN = 7`; the route `PATCH /api/admin/catering/fulfillment` (body `{locationId, lat, lng, radiusMiles, offersDelivery, offersPickup}`), Tier-A step-up (call `requestStepUp("A")` before `postJson`, like PackagesClient's line ops).
  - `page.tsx` (server): gate `level >= FULFILLMENT_MIN` (redirect below); `const nodes = await loadFulfillmentNodes(auth)`; render `<FulfillmentClient nodes={nodes} actorLevel={level} />` with a title/subtitle.
  - `ZoneMap.tsx` (`"use client"`): the react-leaflet map — `import "leaflet/dist/leaflet.css"`; `MapContainer` centered on the node's `[lat,lng]` (default DC `[38.9072,-77.0369]` when unconfigured) zoom ~12; `TileLayer` `url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"` + `attribution='&copy; OpenStreetMap contributors'`; a **draggable** `Marker` at the center (on `dragend`, read `e.target.getLatLng()` → call an `onCenterChange(lat,lng)` prop); a `Circle` `center={[lat,lng]} radius={radiusMeters}` (convert the miles input → meters for the circle: `milesToMeters` from `@/lib/geo`). **Fix the default marker icon** (Leaflet's icons 404 under bundlers): at module top, `import icon from "leaflet/dist/images/marker-icon.png"; import iconShadow from "leaflet/dist/images/marker-shadow.png"; L.Marker.prototype.options.icon = L.icon({ iconUrl: icon.src ?? icon, shadowUrl: iconShadow.src ?? iconShadow })` (or `L.Icon.Default.mergeOptions`). This component is imported ONLY via `next/dynamic(() => import(...), { ssr: false })`.
  - `FulfillmentClient.tsx` (`"use client"`): a location picker (the `nodes` list — show configured/unconfigured); for the selected node: local state `{lat, lng, radiusMiles, offersDelivery, offersPickup}` (seeded from the node, or DC + radius 5 + both-true when unconfigured); `const ZoneMap = dynamic(() => import("./ZoneMap"), { ssr: false })` wired to the state (draggable marker updates lat/lng; miles input updates radius → circle redraws); delivery/pickup toggles; a **Save** button → `requestStepUp("A")` then `postJson("/api/admin/catering/fulfillment", { locationId, lat, lng, radiusMiles, offersDelivery, offersPickup }, "PATCH")`; on ok `router.refresh()`, else show `t(resolveErrorKey(result.code))`. Single busy+error state (mirror PackagesClient). `min-h-[44px]`, `.co-*` tokens.
  - Hub card: add to `app/admin/catering/page.tsx` `EDITORS`: `{ id: "fulfillment", i18nKey: "admin.catering.hub.fulfillment" as TranslationKey, href: "/admin/catering/fulfillment", minLevel: 7 }`.
  - i18n: `admin.catering.hub.fulfillment` + `admin.catering.fulfillment.*` keys (EN + ES tú-form): title, subtitle, location, radius_miles, offers_delivery, offers_pickup, save, saved, unconfigured, drag_hint, plus ARIA. One key per string.

- [ ] **Step 3 (Sonnet): build gate**
```bash
npm run build   # must pass with the ssr:false dynamic-imported map
```
- [ ] **Step 4 (CC): commit** (after review)
```bash
git add app/admin/catering/fulfillment components/admin/catering/fulfillment app/admin/catering/page.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(fr-a): admin zone map tool (Leaflet) + hub card + i18n"
```

---

## Task 6: Seeded smoke (Fable)

**Files:** Create `scripts/fr-a-smoke.ts`.

**Context:** Mirror `scripts/w4a-smoke.ts` (service-role, seed→drive REAL lib→assert→hard-delete, zero residue, `fr-a-smoke: PASS`, plain `main().catch()`, minimal cgs actor `{ user:{id,role}, locations:[] } as unknown as AuthContext`). Run: `npx tsx --env-file=.env.local scripts/fr-a-smoke.ts`.

- [ ] **Step 1:** Load a real active location (capture id). Call `upsertFulfillmentNode(actor, { locationId, lat: 38.9072, lng: -77.0369, radiusMiles: 5, offersDelivery: true, offersPickup: true })` → capture the node id.
- [ ] **Step 2:** `loadFulfillmentNodes(actor)` → find the row for `locationId`; assert `configured===true`, `lat===38.9072`, `lng===-77.0369`, `Math.abs(radiusMiles - 5) < 1e-6`, `offersDelivery===true`, `offersPickup===true`, `active===true`.
- [ ] **Step 3:** Update — `upsertFulfillmentNode(actor, { ...same locationId, radiusMiles: 3, offersDelivery: false, offersPickup: true, lat: 38.9072, lng: -77.0369 })` → `loadFulfillmentNodes` again → assert the SAME node (one per location — count nodes for this location is 1) now has `radiusMiles≈3`, `offersDelivery===false`. Also assert `isWithinRadius({lat:38.9072+1/69,lng:-77.0369}, {lat:38.9072,lng:-77.0369}, milesToMeters(3))===true` (geo sanity, ~1mi in 3mi).
- [ ] **Step 4:** Cleanup — hard-delete the `catering_fulfillment_nodes` row by `location_id`; verify zero residue (re-select by location_id → 0). Print `fr-a-smoke: PASS`.
- [ ] **Step 5: Commit**
```bash
git add scripts/fr-a-smoke.ts
git commit -m "test(fr-a): seeded fulfillment-node upsert/load smoke (PASS, zero residue)"
```

---

## Task 7: Final gates + PR

- [ ] **Step 1:** `npm run build` → PASS (incl. the `ssr:false` map). `npm run typecheck` → PASS. `npx eslint` new/changed files → clean. `npx tsx scripts/geo-test.ts` → PASS.
- [ ] **Step 2:** `npx tsx --env-file=.env.local scripts/fr-a-smoke.ts` → PASS, zero residue.
- [ ] **Step 3:** CC recurring-bug-class checklist: admin gate ≥7 + Tier-A step-up on write; service-role-only writes + RLS deny-user-writes; upsert is location-unique (the UNIQUE constraint + dup-check); coords validated (range); no silent-at-scale (bounded to locations); migration committed + applied; Leaflet map is `ssr:false` (build green).
- [ ] **Step 4:** Open the PR (verify `gh pr view --json state`; don't chain branch-delete). Title: `feat(fr-a): catering fulfillment nodes + admin zone tool`. Body: the node model, the geo helper, the Leaflet zone tool, the new deps, dormant/FR-b boundary.

---

## Self-Review (against the spec)

**Spec coverage:** §3 node model → T1; geo helper → T2. §4 admin tool (surface + map + lib + route) → T3 (lib) + T4 (route) + T5 (UI + hub card + i18n). §5 auth/edge/testing → T3/T4 (gate + step-up + validation) + T2/T6 (tests). §6 confirm-before-authoring → top + T1/T5 (migration 0138, Leaflet deps).

**Placeholder scan:** T5 (UI) gives contracts + explicit Leaflet integration guidance (dynamic ssr:false, leaflet.css, icon fix, Circle radius in meters) + the files to read — deliberate. T1-T4 + T2's test have complete code.

**Type consistency:** `FulfillmentNodeView`, `UpsertFulfillmentNodeInput`, `FulfillmentError`, `FULFILLMENT_MIN`, `loadFulfillmentNodes`, `upsertFulfillmentNode` defined in T3 + consumed in T4/T5/T6; `LatLng`/`haversineMeters`/`isWithinRadius`/`milesToMeters`/`metersToMiles` defined T2 + consumed in T3 (miles↔meters) + T6 (geo sanity). Migration column names match the lib's select/insert keys.
