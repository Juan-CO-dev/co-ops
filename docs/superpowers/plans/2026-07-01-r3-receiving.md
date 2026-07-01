# R3 — Receiving (manual foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operational receiving surface where KH+ logs a delivery per SKU (qty + optional invoice price + optional observed produce-oz), feeding R2's price ledger and self-refining R1's `avg_oz_per_each` — the first non-admin inventory surface, touching no existing operator flow.

**Architecture:** New `vendor_delivery_items` line-table under the dormant `vendor_deliveries` header (migration 0100). New operational `lib/receiving.ts` (service-role + app-layer KH+ gate + location-bind IDOR — NOT under `lib/admin/`). A `POST /api/operations/receiving` route + a `/operations/receiving` page (mirrors the mid-day page's `requireSessionFromHeaders` + `lockLocationContext` + `?location` pattern) with a `ReceivingForm` client + recent-deliveries list, and a dashboard tile.

**Tech Stack:** Next 16 App Router (authed pages under `app/(authed)/`; async params `Promise<{}>`), React 19, Supabase Postgres (custom-JWT + RLS; these writes go service-role + app-gate), TS strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, EN+ES i18n, migrations via Supabase MCP + captured. No test framework → `tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit). PostgREST numeric→string → coerce with `Number(...)`.

**Spec:** `docs/superpowers/specs/2026-07-01-r3-receiving-design.md`.
**Branch:** `claude/r3-receiving` off `origin/main` at `db1738b`.
**Prod ref:** `bgcvurheqzylyfehqgzh`.
**Authority:** `RECEIVE_MIN = 4` (key_holder+; confirmed in `lib/roles.ts`).

---

## File Structure

**New:**
- `lib/receiving.ts` — operational receiving data layer (types + `recordDelivery`, `loadReceivingFormData`, `loadRecentDeliveries`, `loadDeliveryDetail`, `ReceivingError`).
- `app/api/operations/receiving/route.ts` — `POST` (KH+, location-bound).
- `app/(authed)/operations/receiving/page.tsx` — server page.
- `components/receiving/ReceivingForm.tsx` — client form (vendor + date + invoice + line editor).
- `components/receiving/ReceivingTile.tsx` — dashboard tile (server component).
- `supabase/migrations/0100_vendor_delivery_items.sql` — captured.

**Modified:**
- `app/(authed)/dashboard/page.tsx` — render `ReceivingTile` (KH+).
- `lib/i18n/en.json` + `lib/i18n/es.json` — new keys.

---

## Task 1: Branch + migration 0100

**Files:** Create `supabase/migrations/0100_vendor_delivery_items.sql`

- [ ] **Step 1: Branch**
```bash
git fetch origin
git switch -c claude/r3-receiving origin/main
git log --oneline -1   # expect db1738b docs(R3): receiving (manual foundation) design
```

- [ ] **Step 2: Re-read live schema** (Supabase MCP `execute_sql`): confirm `vendor_deliveries` exists (header) and `vendor_delivery_items` does NOT:
```sql
select table_name from information_schema.tables where table_schema='public' and table_name in ('vendor_deliveries','vendor_delivery_items');
```
Expected: only `vendor_deliveries`.

- [ ] **Step 3: Apply migration 0100 via Supabase MCP `apply_migration`** (name `0100_vendor_delivery_items`). Mirror the deny-all RLS convention of the vendor/SKU tables (service-role writes; end users denied):
```sql
create table vendor_delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references vendor_deliveries(id),
  vendor_item_id uuid not null references vendor_items(id),
  qty_received numeric not null check (qty_received > 0),
  unit_price numeric check (unit_price is null or unit_price > 0),
  observed_oz_per_each numeric check (observed_oz_per_each is null or observed_oz_per_each > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index vendor_delivery_items_delivery_idx on vendor_delivery_items(delivery_id);
create index vendor_delivery_items_sku_idx on vendor_delivery_items(vendor_item_id);

alter table vendor_delivery_items enable row level security;
create policy vendor_delivery_items_no_user_select on vendor_delivery_items for select using (false);
create policy vendor_delivery_items_no_user_insert on vendor_delivery_items for insert with check (false);
create policy vendor_delivery_items_no_user_update on vendor_delivery_items for update using (false);
create policy vendor_delivery_items_no_user_delete on vendor_delivery_items for delete using (false);
```

- [ ] **Step 4: Verify**
```sql
select count(*) from information_schema.tables where table_name='vendor_delivery_items';  -- 1
select count(*) from pg_policies where tablename='vendor_delivery_items';  -- 4
```

- [ ] **Step 5: Capture** `supabase/migrations/0100_vendor_delivery_items.sql`:
```sql
-- Migration 0100_vendor_delivery_items
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-r3-receiving-design.md §3
-- R3 receiving: per-SKU delivery lines under the dormant vendor_deliveries header.
-- Deny-all RLS (service-role writes; app-layer KH+ gate in lib/receiving.ts).

<the exact SQL from Step 3>
```

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/0100_vendor_delivery_items.sql
git commit -m "feat(R3): migration 0100 — vendor_delivery_items"
```

---

## Task 2: `lib/receiving.ts` — the receiving data layer

**Files:** Create `lib/receiving.ts`; Test `scripts/_smoke_receiving.ts` (throwaway, deleted Task 8)

- [ ] **Step 1: Confirm-before-authoring** — read `lib/admin/cost.ts` (`recordSkuPrice` — the `vendor_price_history` insert shape + the `audit()` call + `num()` coercion), `lib/session.ts` (`AuthContext` shape — confirm `actor.user.id`, `actor.user.role`, and `actor.locations`), `lib/locations.ts` (`lockLocationContext`, `LocationActor`), `lib/roles.ts` (`getRoleLevel`), and `lib/audit.ts` (the `audit()` param shape — no beforeState/afterState; ip/ua nested in metadata).

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_receiving.ts` (live DB — proves the multi-write + avg recompute):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordDelivery, loadRecentDeliveries, type RecordDeliveryInput } from "@/lib/receiving";

function log(label: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${label} ${extra}`); if (!ok) process.exitCode = 1; }

void (async () => {
  const sb = getServiceRoleClient();
  // Pick a real location, an active vendor, and one active SKU.
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: vend } = await sb.from("vendors").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: sku } = await sb.from("vendor_items").select("id, avg_oz_per_each").eq("active", true).limit(1).maybeSingle<{ id: string; avg_oz_per_each: number | string | null }>();
  if (!loc || !vend || !sku) { console.log("missing fixtures", { loc, vend, sku }); return; }

  // A CGS actor (level 10 → passes KH+ and all-locations).
  const { data: cgs } = await sb.from("users").select("id, role").eq("role", "cgs").limit(1).maybeSingle<{ id: string; role: string }>();
  const actor = { user: { id: cgs!.id, role: cgs!.role }, locations: [] as string[] } as any; // level 10 → all-locations

  const input: RecordDeliveryInput = {
    vendorId: vend.id, locationId: loc.id, deliveryDate: "2026-07-01",
    invoiceNumber: "SMOKE-1", invoiceTotal: 100,
    lines: [
      { skuId: sku.id, qtyReceived: 3, unitPrice: 48 },
      { skuId: sku.id, qtyReceived: 2, observedOzPerEach: 12 },
    ],
  };
  const { deliveryId } = await recordDelivery(actor, input);
  log("delivery created", !!deliveryId, deliveryId);

  const { count: lineCount } = await sb.from("vendor_delivery_items").select("*", { count: "exact", head: true }).eq("delivery_id", deliveryId);
  log("2 lines", lineCount === 2, `count=${lineCount}`);
  const { data: prices } = await sb.from("vendor_price_history").select("unit_price, effective_date").eq("vendor_item_id", sku.id).eq("effective_date", "2026-07-01");
  log("price row", (prices ?? []).some((p: any) => Number(p.unit_price) === 48));
  const { data: after } = await sb.from("vendor_items").select("avg_oz_per_each").eq("id", sku.id).maybeSingle<{ avg_oz_per_each: number | string | null }>();
  log("avg_oz updated (number)", typeof (after?.avg_oz_per_each) !== "undefined" && after?.avg_oz_per_each != null && !Number.isNaN(Number(after.avg_oz_per_each)), `avg=${after?.avg_oz_per_each}`);

  const recent = await loadRecentDeliveries(actor, loc.id, 5);
  log("recent list", recent.length >= 1, `n=${recent.length}`);

  // Cleanup (smoke rows) — delete the delivery + its lines + the smoke price rows.
  await sb.from("vendor_delivery_items").delete().eq("delivery_id", deliveryId);
  await sb.from("vendor_deliveries").delete().eq("id", deliveryId);
  await sb.from("vendor_price_history").delete().eq("effective_date", "2026-07-01").eq("vendor_item_id", sku.id);
  console.log("cleaned up");
})();
```

- [ ] **Step 3: Run — verify FAIL** (`npx tsx --env-file=.env.local scripts/_smoke_receiving.ts` → cannot resolve `@/lib/receiving`).

- [ ] **Step 4: Create `lib/receiving.ts`**:
```ts
/**
 * Operational receiving data layer (Item/Inventory Spine — R3). SERVER-ONLY,
 * service-role client; authorization is APP-LAYER (KH+ gate + location-bind IDOR)
 * — this is an OPERATIONAL surface (not lib/admin/). Captures what physically
 * arrived per SKU; feeds R2's vendor_price_history + refines R1's avg_oz_per_each.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const RECEIVE_MIN = 4; // key_holder+

export class ReceivingError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "ReceivingError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireReceive(actor: AuthContext): void {
  if (getRoleLevel(actor.user.role) < RECEIVE_MIN) {
    throw new ReceivingError(403, "forbidden", "Insufficient role level to receive");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

export interface DeliveryLineInput {
  skuId: string;
  qtyReceived: number;
  unitPrice?: number | null;
  observedOzPerEach?: number | null;
  notes?: string | null;
}
export interface RecordDeliveryInput {
  vendorId: string;
  locationId: string;
  deliveryDate: string; // YYYY-MM-DD
  invoiceNumber?: string | null;
  invoiceTotal?: number | null;
  notes?: string | null;
  lines: DeliveryLineInput[];
}
export interface ReceivingFormData {
  vendors: Array<{ id: string; name: string }>;
  skus: Array<{ id: string; name: string; vendorId: string | null }>;
}
export interface DeliveryView {
  id: string;
  vendorName: string;
  deliveryDate: string;
  invoiceNumber: string | null;
  lineCount: number;
  receivedByName: string | null;
}
export interface DeliveryDetail extends DeliveryView {
  locationId: string;
  invoiceTotal: number | null;
  notes: string | null;
  lines: Array<{ skuName: string; qtyReceived: number; unitPrice: number | null; observedOzPerEach: number | null; notes: string | null }>;
}

/** Form pools (KH+): active vendors + active SKUs (service-role; page gates + location-binds). */
export async function loadReceivingFormData(actor: AuthContext, locationId: string): Promise<ReceivingFormData> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: vendors, error: vErr } = await sb.from("vendors").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadReceivingFormData vendors: ${vErr.message}`);
  const { data: skus, error: sErr } = await sb.from("vendor_items").select("id, name, vendor_id").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string; vendor_id: string | null }>>();
  if (sErr) throw new Error(`loadReceivingFormData skus: ${sErr.message}`);
  return {
    vendors: vendors ?? [],
    skus: (skus ?? []).map((s) => ({ id: s.id, name: s.name, vendorId: s.vendor_id })),
  };
}

/** Record a delivery: header + lines + per-priced-line price row + avg_oz refinement. */
export async function recordDelivery(actor: AuthContext, input: RecordDeliveryInput): Promise<{ deliveryId: string }> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || Number.isNaN(Date.parse(input.deliveryDate))) {
    throw new ReceivingError(400, "invalid_date", "Delivery date must be YYYY-MM-DD");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ReceivingError(400, "no_lines", "At least one line is required");
  for (const l of input.lines) {
    if (!Number.isFinite(l.qtyReceived) || l.qtyReceived <= 0) throw new ReceivingError(400, "invalid_qty", "Quantity must be positive");
    if (l.unitPrice != null && (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0)) throw new ReceivingError(400, "invalid_price", "Price must be positive");
    if (l.observedOzPerEach != null && (!Number.isFinite(l.observedOzPerEach) || l.observedOzPerEach <= 0)) throw new ReceivingError(400, "invalid_observed", "Observed oz must be positive");
  }
  const sb = getServiceRoleClient();

  // Vendor + SKUs active.
  const { data: vend } = await sb.from("vendors").select("id").eq("id", input.vendorId).eq("active", true).maybeSingle<{ id: string }>();
  if (!vend) throw new ReceivingError(400, "invalid_vendor", "Vendor not found or inactive");
  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items").select("id").in("id", skuIds).eq("active", true).returns<Array<{ id: string }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");

  // Header.
  const { data: header, error: hErr } = await sb.from("vendor_deliveries").insert({
    vendor_id: input.vendorId, location_id: input.locationId, delivery_date: input.deliveryDate,
    invoice_number: input.invoiceNumber?.trim() || null, invoice_total: input.invoiceTotal ?? null,
    notes: input.notes?.trim() || null, received_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordDelivery header: ${hErr.message}`);
  if (!header) throw new Error("recordDelivery header returned no row");

  // Lines.
  const { error: lErr } = await sb.from("vendor_delivery_items").insert(
    input.lines.map((l) => ({
      delivery_id: header.id, vendor_item_id: l.skuId, qty_received: l.qtyReceived,
      unit_price: l.unitPrice ?? null, observed_oz_per_each: l.observedOzPerEach ?? null,
      notes: l.notes?.trim() || null, created_by: actor.user.id,
    })),
  );
  if (lErr) throw new Error(`recordDelivery lines: ${lErr.message}`);

  // Prices → R2 ledger (one row per priced line).
  const priced = input.lines.filter((l) => l.unitPrice != null);
  if (priced.length > 0) {
    const { error: pErr } = await sb.from("vendor_price_history").insert(
      priced.map((l) => ({ vendor_item_id: l.skuId, unit_price: l.unitPrice, effective_date: input.deliveryDate, recorded_by: actor.user.id })),
    );
    if (pErr) throw new Error(`recordDelivery prices: ${pErr.message}`);
  }

  // avg_oz refinement — recompute each observed SKU's running mean over ALL observations.
  const observedSkuIds = [...new Set(input.lines.filter((l) => l.observedOzPerEach != null).map((l) => l.skuId))];
  const avgUpdated: string[] = [];
  for (const id of observedSkuIds) {
    const { data: obs } = await sb.from("vendor_delivery_items").select("observed_oz_per_each").eq("vendor_item_id", id).not("observed_oz_per_each", "is", null).returns<Array<{ observed_oz_per_each: number | string }>>();
    const vals = (obs ?? []).map((o) => num(o.observed_oz_per_each)).filter((v): v is number => v != null);
    if (vals.length === 0) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const { error: uErr } = await sb.from("vendor_items").update({ avg_oz_per_each: mean, updated_by: actor.user.id, updated_at: new Date().toISOString() }).eq("id", id);
    if (uErr) throw new Error(`recordDelivery avg update: ${uErr.message}`);
    avgUpdated.push(id);
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.received", resourceTable: "vendor_deliveries", resourceId: header.id,
    metadata: { vendor_id: input.vendorId, location_id: input.locationId, line_count: input.lines.length, priced_lines: priced.length, avg_oz_updated: avgUpdated },
    ipAddress: null, userAgent: null,
  });

  return { deliveryId: header.id };
}

/** Recent deliveries for a location (KH+, location-bound). */
export async function loadRecentDeliveries(actor: AuthContext, locationId: string, limit = 20): Promise<DeliveryView[]> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, delivery_date, invoice_number, received_by")
    .eq("location_id", locationId).order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; vendor_id: string; delivery_date: string; invoice_number: string | null; received_by: string | null }>>();
  if (error) throw new Error(`loadRecentDeliveries: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];
  // Hydrate vendor names, receiver names, line counts (batch).
  const vendorIds = [...new Set(list.map((r) => r.vendor_id))];
  const userIds = [...new Set(list.map((r) => r.received_by).filter((v): v is string => v !== null))];
  const deliveryIds = list.map((r) => r.id);
  const [{ data: vs }, { data: us }, { data: lines }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    userIds.length ? sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    sb.from("vendor_delivery_items").select("delivery_id").in("delivery_id", deliveryIds).returns<Array<{ delivery_id: string }>>(),
  ]);
  const vName = new Map((vs ?? []).map((v) => [v.id, v.name]));
  const uName = new Map((us ?? []).map((u) => [u.id, u.name]));
  const lineCount = new Map<string, number>();
  for (const l of lines ?? []) lineCount.set(l.delivery_id, (lineCount.get(l.delivery_id) ?? 0) + 1);
  return list.map((r) => ({
    id: r.id, vendorName: vName.get(r.vendor_id) ?? "(vendor)", deliveryDate: r.delivery_date,
    invoiceNumber: r.invoice_number, lineCount: lineCount.get(r.id) ?? 0,
    receivedByName: r.received_by ? (uName.get(r.received_by) ?? null) : null,
  }));
}

/** One delivery + its lines (KH+, IDOR location-bind on the delivery's location). */
export async function loadDeliveryDetail(actor: AuthContext, deliveryId: string): Promise<DeliveryDetail> {
  requireReceive(actor);
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, received_by")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; invoice_number: string | null; invoice_total: number | string | null; notes: string | null; received_by: string | null }>();
  if (error) throw new Error(`loadDeliveryDetail: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found"); // IDOR → 404
  const { data: lineRows } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received, unit_price, observed_oz_per_each, notes").eq("delivery_id", deliveryId).order("created_at", { ascending: true }).returns<Array<{ vendor_item_id: string; qty_received: number | string; unit_price: number | string | null; observed_oz_per_each: number | string | null; notes: string | null }>>();
  const [{ data: vend }, { data: rx }] = await Promise.all([
    sb.from("vendors").select("name").eq("id", h.vendor_id).maybeSingle<{ name: string }>(),
    h.received_by ? sb.from("users").select("name").eq("id", h.received_by).maybeSingle<{ name: string }>() : Promise.resolve({ data: null }),
  ]);
  const skuIds = [...new Set((lineRows ?? []).map((l) => l.vendor_item_id))];
  const { data: skus } = skuIds.length ? await sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>() : { data: [] as Array<{ id: string; name: string }> };
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  return {
    id: h.id, vendorName: vend?.name ?? "(vendor)", deliveryDate: h.delivery_date, invoiceNumber: h.invoice_number,
    lineCount: (lineRows ?? []).length, receivedByName: rx?.name ?? null, locationId: h.location_id,
    invoiceTotal: num(h.invoice_total), notes: h.notes,
    lines: (lineRows ?? []).map((l) => ({ skuName: skuName.get(l.vendor_item_id) ?? "(sku)", qtyReceived: num(l.qty_received) ?? 0, unitPrice: num(l.unit_price), observedOzPerEach: num(l.observed_oz_per_each), notes: l.notes })),
  };
}
```

- [ ] **Step 5: Run the smoke — verify all PASS** + "cleaned up".
- [ ] **Step 6: `npx tsc --noEmit`** — clean.
- [ ] **Step 7: Commit**
```bash
git add lib/receiving.ts scripts/_smoke_receiving.ts
git commit -m "feat(R3): receiving data layer (record delivery, prices, avg-oz refinement)"
```

---

## Task 3: `POST /api/operations/receiving` route

**Files:** Create `app/api/operations/receiving/route.ts`

- [ ] **Step 1: Re-read** an existing operations POST route (e.g. `app/api/prep/mid-day/**/route.ts`) for the `requireSession` + `jsonError`/`jsonOk`/`parseJsonBody` pattern, and `lib/receiving.ts` `recordDelivery` signature.

- [ ] **Step 2: Create the route** (KH+ ≥4; location-bind is enforced INSIDE `recordDelivery` via `lockLocationContext`):
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordDelivery, ReceivingError, type RecordDeliveryInput } from "@/lib/receiving";

// Log a delivery. KH+ (≥4), location-bound (checked in recordDelivery).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");

  const b = parsed as Partial<RecordDeliveryInput>;
  if (typeof b.vendorId !== "string" || typeof b.locationId !== "string" || typeof b.deliveryDate !== "string") {
    return jsonError(400, "invalid_payload");
  }
  if (!Array.isArray(b.lines)) return jsonError(400, "no_lines");

  try {
    const res = await recordDelivery(ctx, b as RecordDeliveryInput);
    return jsonOk({ deliveryId: res.deliveryId }, 201);
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: `npx tsc --noEmit`** — clean. **Step 4: Commit**
```bash
git add app/api/operations/receiving/route.ts
git commit -m "feat(R3): receiving POST route (KH+, location-bound)"
```

---

## Task 4: `ReceivingForm` client component

**Files:** Create `components/receiving/ReceivingForm.tsx`

- [ ] **Step 1: Re-read** an existing operational client form (e.g. `components/MidDayPhase2Form.tsx` or `components/prep/AmPrepForm.tsx`) for the `useTranslation` + `useRouter` + fetch-post + error patterns, and `lib/receiving.ts` `ReceivingFormData`/`RecordDeliveryInput` types.

- [ ] **Step 2: Implement** — vendor `<select>`, delivery-date `<input type=date>` (default = passed `today`), optional invoice # + total, and a **repeatable line editor** (each line: SKU `<select>` filtered by chosen vendor + qty + optional price + optional observed-oz + remove; an "add line" button). Submit POSTs to `/api/operations/receiving`. Full component:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { ReceivingFormData } from "@/lib/receiving";

interface LineDraft { skuId: string; qty: string; price: string; observed: string; }
const emptyLine = (): LineDraft => ({ skuId: "", qty: "", price: "", observed: "" });
const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

export function ReceivingForm({ formData, locationId, today }: { formData: ReceivingFormData; locationId: string; today: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [date, setDate] = useState(today);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const vendorSkus = formData.skus.filter((s) => s.vendorId === vendorId || s.vendorId === null);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const num = (s: string): number | null => { const v = s.trim(); return v === "" ? null : Number(v); };

  const canSubmit = vendorId !== "" && date !== "" && lines.some((l) => l.skuId !== "" && l.qty.trim() !== "") && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    const payload = {
      vendorId, locationId, deliveryDate: date,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceTotal: num(invoiceTotal),
      lines: lines.filter((l) => l.skuId !== "" && l.qty.trim() !== "").map((l) => ({
        skuId: l.skuId, qtyReceived: Number(l.qty), unitPrice: num(l.price), observedOzPerEach: num(l.observed),
      })),
    };
    const res = await fetch("/api/operations/receiving", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (res.ok) { router.refresh(); setVendorId(""); setInvoiceNumber(""); setInvoiceTotal(""); setLines([emptyLine()]); }
    else { const j = await res.json().catch(() => ({})); setErr(t(("receiving.error." + (j?.error?.code ?? "generic")) as never)); }
  };

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("receiving.form.title")}</h2>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.vendor")}</span>
        <select className={field} value={vendorId} disabled={busy} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">{t("receiving.form.pick_vendor")}</option>
          {formData.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block"><span className="text-sm font-bold text-co-text">{t("receiving.form.date")}</span>
          <input className={field} type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_number")}</span>
          <input className={field} value={invoiceNumber} disabled={busy} onChange={(e) => setInvoiceNumber(e.target.value)} /></label>
      </div>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_total")}</span>
        <input className={field} type="number" min={0} step="any" inputMode="decimal" value={invoiceTotal} disabled={busy} onChange={(e) => setInvoiceTotal(e.target.value)} /></label>

      <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">{t("receiving.form.lines")}</h3>
      <div className="mt-2 flex flex-col gap-3">
        {lines.map((l, i) => (
          <div key={i} className="rounded-lg border-2 border-co-border-2 p-3">
            <select className={field} value={l.skuId} disabled={busy || vendorId === ""} onChange={(e) => setLine(i, { skuId: e.target.value })}>
              <option value="">{t("receiving.form.pick_sku")}</option>
              {vendorSkus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.qty")} value={l.qty} disabled={busy} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.price")} value={l.price} disabled={busy} onChange={(e) => setLine(i, { price: e.target.value })} />
              <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.observed")} value={l.observed} disabled={busy} onChange={(e) => setLine(i, { observed: e.target.value })} />
            </div>
            {lines.length > 1 ? (
              <button type="button" disabled={busy} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="mt-2 text-xs font-bold text-co-cta">{t("receiving.form.remove_line")}</button>
            ) : null}
          </div>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("receiving.form.add_line")}</button>

      {err ? <p className="mt-3 text-sm text-co-cta">{err}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("receiving.form.submit")}</button>
      </div>
    </div>
  );
}
```
> The error-code path uses `j.error.code`; confirm the API error envelope shape from `lib/api-helpers.ts` `jsonError` when re-reading (it returns `{ error: { code, ... } }` or `{ code }` — match it). The `t(... as never)` cast avoids TranslationKey narrowing on the dynamic error key; keep it minimal.

- [ ] **Step 3: `npx tsc --noEmit`** — clean (i18n keys land Task 7; if the `t()` dynamic-key cast doesn't fully suppress, the static keys `receiving.form.*` will error until Task 7 — acceptable, note which). **Step 4: Commit**
```bash
git add components/receiving/ReceivingForm.tsx
git commit -m "feat(R3): ReceivingForm client (vendor + date + invoice + line editor)"
```

---

## Task 5: `/operations/receiving` page

**Files:** Create `app/(authed)/operations/receiving/page.tsx`

- [ ] **Step 1: Re-read** `app/(authed)/operations/mid-day/page.tsx` (the `requireSessionFromHeaders` + `lockLocationContext` + `?location` + `DashboardBackLink` + `serverT` pattern) and `lib/receiving.ts` loaders.

- [ ] **Step 2: Implement** — resolve `?location`, gate KH+ (≥4), IDOR-bind, load form data + recent deliveries, render the form + list:
```tsx
import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadReceivingFormData, loadRecentDeliveries } from "@/lib/receiving";
import { ReceivingForm } from "@/components/receiving/ReceivingForm";
import { DashboardBackLink } from "@/components/DashboardBackLink";

const OPERATIONAL_TZ = "America/New_York";
function nyDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/receiving");
  const { location } = await searchParams;
  if (auth.level < 4) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");

  const lang = auth.user.language;
  const [formData, recent] = await Promise.all([
    loadReceivingFormData(auth, location),
    loadRecentDeliveries(auth, location, 20),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "receiving.page.title")}</h1>
      <ReceivingForm formData={formData} locationId={location} today={nyDate()} />

      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "receiving.page.recent")}</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "receiving.page.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {recent.map((d) => (
            <li key={d.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-co-text">{d.vendorName}</span>
                <span className="text-xs text-co-text-muted">{d.deliveryDate}</span>
              </div>
              <div className="text-[11px] text-co-text-dim">
                {serverT(lang, "receiving.page.line_count", { n: d.lineCount })}
                {d.invoiceNumber ? ` · #${d.invoiceNumber}` : ""}
                {d.receivedByName ? ` · ${d.receivedByName}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```
> Confirm `auth.level`, `auth.role`, `auth.locations`, `auth.user.language` exist on `requireSessionFromHeaders`'s return (mid-day uses them). `loadReceivingFormData`/`loadRecentDeliveries` take the `AuthContext` — pass `auth` (confirm it satisfies the `AuthContext` param; mid-day passes `auth` shapes to lib loaders similarly, or adapt).

- [ ] **Step 3: `npx tsc --noEmit`** — clean (except pending i18n keys). **Step 4: Commit**
```bash
git add "app/(authed)/operations/receiving/page.tsx"
git commit -m "feat(R3): /operations/receiving page (KH+, location-bound)"
```

---

## Task 6: Dashboard tile

**Files:** Create `components/receiving/ReceivingTile.tsx`; Modify `app/(authed)/dashboard/page.tsx`

- [ ] **Step 1: Re-read** `components/MidDayPrepTile.tsx` (tile pattern) + `app/(authed)/dashboard/page.tsx` (how tiles are rendered + the `locationId`/`language`/`level` in scope + where to gate KH+).

- [ ] **Step 2: Create `components/receiving/ReceivingTile.tsx`** (server component, Link to the page):
```tsx
import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

export function ReceivingTile({ language, locationId }: { language: Language; locationId: string }) {
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">{serverT(language, "dashboard.receiving.tile_label")}</p>
      <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(language, "dashboard.receiving.hint")}</p>
      <div className="mt-3">
        <Link href={`/operations/receiving?location=${locationId}`} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60">
          {serverT(language, "dashboard.receiving.cta")}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it on the dashboard** gated KH+ (≥4). In `app/(authed)/dashboard/page.tsx`, import `ReceivingTile`, and where the other operational tiles render (with a `locationId` + `language` in scope + the viewer's level), add — matching the file's existing tile-gating idiom (confirm the level variable name):
```tsx
{level >= 4 && locationId ? <ReceivingTile language={lang} locationId={locationId} /> : null}
```
(Use the actual in-scope variable names the dashboard already uses for language / location / level — read the file and adapt; if the dashboard maps over multiple locations, place the tile per its existing per-location pattern.)

- [ ] **Step 4: `npx tsc --noEmit`** — clean (except pending i18n). **Step 5: Commit**
```bash
git add components/receiving/ReceivingTile.tsx "app/(authed)/dashboard/page.tsx"
git commit -m "feat(R3): dashboard receiving tile (KH+)"
```

---

## Task 7: i18n (EN + ES parity)

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Re-read** both files near `dashboard.*` and existing `operations`/`mid_day_prep` keys for placement.

- [ ] **Step 2: EN keys** (`lib/i18n/en.json`):
```json
"receiving.page.title": "Receiving",
"receiving.page.recent": "Recent deliveries",
"receiving.page.none": "No deliveries logged yet.",
"receiving.page.line_count": "{n} item(s)",
"receiving.form.title": "Log a delivery",
"receiving.form.vendor": "Vendor",
"receiving.form.pick_vendor": "Pick a vendor…",
"receiving.form.date": "Delivery date",
"receiving.form.invoice_number": "Invoice #",
"receiving.form.invoice_total": "Invoice total ($)",
"receiving.form.lines": "Items received",
"receiving.form.pick_sku": "Pick a SKU…",
"receiving.form.qty": "Qty (packs)",
"receiving.form.price": "Price/pack ($)",
"receiving.form.observed": "Oz/each (opt)",
"receiving.form.add_line": "+ Add item",
"receiving.form.remove_line": "Remove",
"receiving.form.submit": "Log delivery",
"receiving.error.invalid_payload": "Please fill in vendor, date, and at least one item.",
"receiving.error.no_lines": "Add at least one item.",
"receiving.error.invalid_qty": "Quantity must be a positive number.",
"receiving.error.invalid_price": "Price must be a positive number.",
"receiving.error.invalid_observed": "Oz per each must be a positive number.",
"receiving.error.invalid_date": "Pick a valid delivery date.",
"receiving.error.invalid_vendor": "That vendor isn't available.",
"receiving.error.invalid_sku": "One of the items isn't available.",
"receiving.error.not_found": "Not found.",
"receiving.error.forbidden": "You don't have permission to receive.",
"receiving.error.generic": "Something went wrong — try again.",
"dashboard.receiving.tile_label": "Receiving",
"dashboard.receiving.hint": "Log a delivery when a truck arrives.",
"dashboard.receiving.cta": "Log a delivery"
```

- [ ] **Step 3: ES keys** (`lib/i18n/es.json`, tú-form):
```json
"receiving.page.title": "Recepción",
"receiving.page.recent": "Entregas recientes",
"receiving.page.none": "Aún no se han registrado entregas.",
"receiving.page.line_count": "{n} artículo(s)",
"receiving.form.title": "Registrar una entrega",
"receiving.form.vendor": "Proveedor",
"receiving.form.pick_vendor": "Elige un proveedor…",
"receiving.form.date": "Fecha de entrega",
"receiving.form.invoice_number": "Factura #",
"receiving.form.invoice_total": "Total de factura ($)",
"receiving.form.lines": "Artículos recibidos",
"receiving.form.pick_sku": "Elige un SKU…",
"receiving.form.qty": "Cant. (paquetes)",
"receiving.form.price": "Precio/paquete ($)",
"receiving.form.observed": "Oz/unidad (opc)",
"receiving.form.add_line": "+ Agregar artículo",
"receiving.form.remove_line": "Quitar",
"receiving.form.submit": "Registrar entrega",
"receiving.error.invalid_payload": "Llena proveedor, fecha y al menos un artículo.",
"receiving.error.no_lines": "Agrega al menos un artículo.",
"receiving.error.invalid_qty": "La cantidad debe ser un número positivo.",
"receiving.error.invalid_price": "El precio debe ser un número positivo.",
"receiving.error.invalid_observed": "Las oz por unidad deben ser un número positivo.",
"receiving.error.invalid_date": "Elige una fecha de entrega válida.",
"receiving.error.invalid_vendor": "Ese proveedor no está disponible.",
"receiving.error.invalid_sku": "Uno de los artículos no está disponible.",
"receiving.error.not_found": "No encontrado.",
"receiving.error.forbidden": "No tienes permiso para recibir.",
"receiving.error.generic": "Algo salió mal — inténtalo de nuevo.",
"dashboard.receiving.tile_label": "Recepción",
"dashboard.receiving.hint": "Registra una entrega cuando llegue un camión.",
"dashboard.receiving.cta": "Registrar entrega"
```

- [ ] **Step 4: Parity + build**
```bash
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=new Set(Object.keys(es));const m=a.filter(k=>!b.has(k));const r=Object.keys(es).filter(k=>!new Set(a).has(k));console.log(m.length||r.length?('MISS ES:'+m.join(',')+'|EXTRA ES:'+r.join(',')):'parity ok '+a.length)"
npx tsc --noEmit && npm run build
```
Expected: `parity ok …`; tsc + build clean.

- [ ] **Step 5: Commit**
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(R3): i18n EN+ES for receiving"
```

---

## Task 8: Final live smoke + delete

- [ ] **Step 1: Re-run** `npx tsx --env-file=.env.local scripts/_smoke_receiving.ts` — all PASS + "cleaned up" (confirms nothing regressed after the UI/i18n tasks).
- [ ] **Step 2: Delete + commit**
```bash
git rm -f scripts/_smoke_receiving.ts
git commit -m "chore(R3): remove throwaway receiving smoke"
```

---

## Task 9: PR

- [ ] **Step 1: Final gate** `npx tsc --noEmit && npm run build` — clean.
- [ ] **Step 2: Push + PR** (preview URL in the body):
```bash
git push -u origin claude/r3-receiving
gh pr create --title "R3: receiving (manual foundation)" --body "$(cat <<'EOF'
Receiving (spec 2026-07-01). Migration 0100 (vendor_delivery_items). New operational
lib/receiving.ts (KH+ + location-bind): recordDelivery (header + lines + per-priced-line
vendor_price_history + avg_oz_per_each running-mean refinement), loadRecentDeliveries,
loadDeliveryDetail. /operations/receiving page + ReceivingForm + dashboard tile. First
operational inventory surface; touches NO existing operator flow.

Test (preview URL): AM-prep / mid-day / Opening / closing render identical. Then from the
dashboard Receiving tile → log a delivery (vendor + date + SKU lines w/ qty, optional price,
optional oz/each) → it appears in Recent deliveries; a priced line shows as the SKU's new
cost in the admin SKU panel; an oz/each line moves the SKU's avg.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
- [ ] **Step 3: After Juan smokes + merges** — no post-deploy step (0100 is fully additive).

---

## Self-Review

**Spec coverage:** §3 schema → Task 1; §4 `recordDelivery` (header+lines+prices+avg-refinement+audit) → Task 2; §5 route → Task 3, form → Task 4, page → Task 5, tile → Task 6; §6 avg running-mean → Task 2 Step 4; §7 verification → Tasks 2/7/8. ✔

**Deviations (flagged, T0-discretion):** (1) `recordDelivery` is multi-step service-role, not an atomic RPC (spec §9 D-atomic — fast-follow if partial-failure bites). (2) `loadDeliveryDetail` is built but the page renders only the recent-list summary (no drill-in UI in R3 — the loader is a forward hook for R3b/detail view). (3) receiving loaders take `AuthContext` and re-check KH+ + location-bind themselves (defense-in-depth over the page/route gate).

**Placeholder scan:** none — all code literal. The dashboard tile placement (Task 6 Step 3) + the API error-envelope shape (Task 4) are explicitly "confirm the in-scope variable/shape when re-reading" — not placeholders, but confirm-before-authoring points.

**Type consistency:** `RecordDeliveryInput`/`DeliveryLineInput`/`ReceivingFormData`/`DeliveryView`/`DeliveryDetail` defined in Task 2 ↔ consumed by route (Task 3), form (Task 4), page (Task 5). `RECEIVE_MIN = 4` ↔ route `< 4` ↔ page `auth.level < 4` ↔ tile `level >= 4`. Numeric coercion via `num()` throughout the lib. ✔
