# W4c-b Surplus → LTO/Discount Action Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager turns a W4c-a perishable-surplus line into a live LTO or discount (terms + window) → CO-OPS records an `lto_events` artifact + surfaces it to staff as a directive; a stubbed Toast-push seam is wired for the future POS phase.

**Architecture:** A two-table migration (`lto_events` + `lto_event_items`), an events lib that validates + writes + calls a stubbed provider-agnostic POS push, two admin write routes (level ≥6 + Tier-A step-up), a manager action page at `/admin/catering/lto` (surplus lines → create form + manage/cancel), and a read-only staff directive section on `/lto`. Catering surplus (W4c-a) is the only source; storefront/Toast go-live is stubbed.

**Tech Stack:** Next.js 16 (App Router, server components, admin StepUpProvider), React 19, TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres (service-role writes + RLS), Tailwind v4. No unit-test framework — smoke via `tsx`.

**Model tiering:** CC (main loop) = sole reviewer + owns prod migration 0141 + all git; authors Tasks 1–3 + 6 inline. Sonnet 4.6 = Task 5 (UI). Fable 5 = Task 4 (smoke). Sonnet + Fable in parallel (disjoint files; neither commits).

**Grounding verified 2026-07-21 (confirm-before-authoring):** next migration = 0141; no LTO/promo table exists; step-up is admin-shell-only (`StepUpProvider` in `app/admin/layout.tsx`) → writes live under `/admin`; W4c-a `loadPerishableSurplus(actor,{locationId,from,to}): SurplusLine[]` is the source; admin-catering patterns to mirror — page (`app/admin/catering/fulfillment/page.tsx`: `requireSessionFromHeaders("/admin")` + level gate + `serverT`), route (`app/api/admin/catering/fulfillment/route.ts`: `requireSession`→`instanceof Response`→level→`assertStepUp("A")`→`parseJsonBody`→lib→`catch(TypedError→jsonError)`), lib (`lib/admin/catering/fulfillment.ts`: typed error + `requireLevel` + `audit`), client (`postJson`/`resolveErrorKey` from `@/components/admin/catering/shared`, `useStepUp` from `@/components/admin/StepUpProvider`), location picker via `loadPackageLocations(auth)`, hub `EDITORS` array in `app/admin/catering/page.tsx`. Money = integer cents; rates = bps (10000=100%).

---

## File Structure

- **`supabase/migrations/0141_lto_events.sql`** (create) — `lto_events` + `lto_event_items` + RLS.
- **`lib/catering/lto-pos-push.ts`** (create) — the stubbed provider-agnostic POS seam.
- **`lib/catering/lto.ts`** (create) — `createLtoEvent`, `listLtoEvents`, `cancelLtoEvent`, types, `LTO_MIN`, `LtoError`.
- **`app/api/admin/catering/lto/events/route.ts`** (create) — POST create.
- **`app/api/admin/catering/lto/events/[id]/cancel/route.ts`** (create) — POST cancel.
- **`app/admin/catering/lto/page.tsx`** (create) — manager action page (server wrapper).
- **`components/admin/catering/lto/LtoClient.tsx`** (create) — action form + manage list (client).
- **`app/admin/catering/page.tsx`** (modify) — hub card.
- **`app/lto/page.tsx`** (modify) — staff directive section (active events).
- **`lib/i18n/en.json` + `lib/i18n/es.json`** (modify) — `admin.catering.lto.*` + `lto.active_*` keys.
- **`scripts/w4c-b-lto-smoke.ts`** (create) — create/list/cancel/validation smoke.

---

## Task 1: Migration 0141 — `lto_events` + `lto_event_items` (CC)

**Files:**
- Create: `supabase/migrations/0141_lto_events.sql`

- [ ] **Step 1: Apply to prod via Supabase MCP** (name `0141_lto_events`):

```sql
-- Migration 0141_lto_events
-- W4c-b: the LTO/discount action artifact a manager creates from surplus. Append-only friendly
-- (cancel = status flip). Module #17 (LTO Performance) later reads lto_events. RLS: read location-
-- scoped (staff directive) or all-locations >=7; no user writes (service-role only via lib/catering/lto.ts).

CREATE TABLE public.lto_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       uuid NOT NULL REFERENCES public.locations(id),
  kind              text NOT NULL CHECK (kind IN ('lto','discount')),
  name              text NOT NULL,
  discount_bps      integer CHECK (discount_bps IS NULL OR (discount_bps > 0 AND discount_bps <= 10000)),
  promo_price_cents integer CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  pos_push_status   text NOT NULL DEFAULT 'not_pushed' CHECK (pos_push_status IN ('not_pushed','pushed','failed')),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES public.users(id),
  CONSTRAINT lto_events_window CHECK (ends_on >= starts_on),
  CONSTRAINT lto_events_discount_needs_bps CHECK (kind <> 'discount' OR discount_bps IS NOT NULL)
);

CREATE TABLE public.lto_event_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.lto_events(id) ON DELETE CASCADE,
  item_id            uuid REFERENCES public.items(id),
  menu_item_id       uuid REFERENCES public.menu_items(id),
  name_snapshot      text NOT NULL,
  qty                numeric NOT NULL,
  source_pipeline_id uuid,
  CONSTRAINT lto_event_items_one_ref CHECK (num_nonnulls(item_id, menu_item_id) = 1)
);

CREATE INDEX lto_events_location_status_idx ON public.lto_events (location_id, status);
CREATE INDEX lto_event_items_event_idx ON public.lto_event_items (event_id);

ALTER TABLE public.lto_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lto_event_items ENABLE ROW LEVEL SECURITY;

-- lto_events: read location-scoped or all-locations >=7; no user writes.
CREATE POLICY lto_events_read ON public.lto_events FOR SELECT
  USING (location_id = ANY (current_user_locations()) OR current_user_role_level() >= 7);
CREATE POLICY lto_events_no_user_insert ON public.lto_events FOR INSERT WITH CHECK (false);
CREATE POLICY lto_events_no_user_update ON public.lto_events FOR UPDATE USING (false);
CREATE POLICY lto_events_no_user_delete ON public.lto_events FOR DELETE USING (false);

-- lto_event_items: read for staff (>=5, defense-in-depth; reads go through service-role lib); no user writes.
CREATE POLICY lto_event_items_read ON public.lto_event_items FOR SELECT
  USING (current_user_role_level() >= 5);
CREATE POLICY lto_event_items_no_user_insert ON public.lto_event_items FOR INSERT WITH CHECK (false);
CREATE POLICY lto_event_items_no_user_update ON public.lto_event_items FOR UPDATE USING (false);
CREATE POLICY lto_event_items_no_user_delete ON public.lto_event_items FOR DELETE USING (false);
```

- [ ] **Step 2: Verify** via `execute_sql`:
```sql
select table_name, count(*) cols from information_schema.columns
where table_schema='public' and table_name in ('lto_events','lto_event_items') group by table_name;
select tablename, count(*) policies from pg_policies where schemaname='public' and tablename in ('lto_events','lto_event_items') group by tablename;
```
Expected: `lto_events` 14 cols / 4 policies; `lto_event_items` 6 cols / 4 policies.

- [ ] **Step 3: Write the repo file** `supabase/migrations/0141_lto_events.sql` — a provenance header + the exact SQL above:
```sql
-- Migration 0141_lto_events
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Canonical reference: lib/catering/lto.ts + lib/catering/lto-pos-push.ts.
```
(followed by a blank line + the full CREATE/ALTER/POLICY block from Step 1, minus the Step-1 top comment which is replaced by this provenance header).

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0141_lto_events.sql
git commit -m "feat(w4c-b): migration 0141 — lto_events + lto_event_items"
```

---

## Task 2: LTO lib + stubbed POS seam (CC)

**Files:**
- Create: `lib/catering/lto-pos-push.ts`
- Create: `lib/catering/lto.ts`

Reference: `lib/admin/catering/fulfillment.ts` (typed error + `requireLevel` + `audit` + `getServiceRoleClient`).

- [ ] **Step 1: Write the stubbed POS seam**

Create `lib/catering/lto-pos-push.ts`:

```ts
/**
 * Provider-agnostic POS push for LTO/discount events. STUB until the Toast-integration phase —
 * logs and returns not_pushed. Swapping this one function to a real Toast client is the entire
 * "go live at the register" step (mirrors the Portal-3 payment-provider seam pattern).
 */
export interface PosPushResult {
  status: "not_pushed" | "pushed" | "failed";
  reason?: string;
}

export async function pushLtoToPos(event: {
  id: string;
  kind: "lto" | "discount";
  locationId: string;
}): Promise<PosPushResult> {
  // Toast integration pending — no-op seam. Intentionally never throws.
  void event;
  return { status: "not_pushed", reason: "toast_integration_pending" };
}
```

- [ ] **Step 2: Write the events lib**

Create `lib/catering/lto.ts`:

```ts
/**
 * W4c-b LTO/discount action engine — SERVER-ONLY, service-role. A manager turns W4c-a perishable
 * surplus into a live LTO or discount (an lto_events artifact + a stubbed POS push). Module #17
 * later reads lto_events for performance. Gated ≥ LTO_MIN + Tier-A step-up (enforced at the route).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { pushLtoToPos } from "@/lib/catering/lto-pos-push";

export const LTO_MIN = 6; // catering_mgr+ (mirrors SURPLUS_READ_MIN)

export class LtoError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "LtoError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new LtoError(403, "forbidden", "Insufficient role level");
}

export type LtoKind = "lto" | "discount";

export interface LtoEventItemInput {
  itemId: string | null;
  menuItemId: string | null;
  nameSnapshot: string;
  qty: number;
  sourcePipelineId: string | null;
}
export interface CreateLtoEventInput {
  locationId: string;
  kind: LtoKind;
  name: string;
  discountBps: number | null;
  promoPriceCents: number | null;
  startsOn: string;
  endsOn: string;
  note: string | null;
  items: LtoEventItemInput[];
}
export interface LtoEventView {
  id: string;
  locationId: string;
  kind: LtoKind;
  name: string;
  discountBps: number | null;
  promoPriceCents: number | null;
  startsOn: string;
  endsOn: string;
  status: "active" | "cancelled" | "expired";
  posPushStatus: "not_pushed" | "pushed" | "failed";
  note: string | null;
  items: { name: string; qty: number }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Create an LTO/discount from surplus. ≥ LTO_MIN + Tier-A step-up (route). */
export async function createLtoEvent(actor: AuthContext, input: CreateLtoEventInput): Promise<{ id: string }> {
  requireLevel(actor, LTO_MIN);

  if (input.kind !== "lto" && input.kind !== "discount") throw new LtoError(400, "invalid_kind");
  const name = (input.name ?? "").trim();
  if (!name) throw new LtoError(400, "invalid_name", "A name is required");
  if (!DATE_RE.test(input.startsOn) || !DATE_RE.test(input.endsOn)) throw new LtoError(400, "invalid_window", "Valid dates required");
  if (input.endsOn < input.startsOn) throw new LtoError(400, "invalid_window", "End date must be on/after start date");

  const discountBps = input.discountBps;
  if (discountBps != null && (!Number.isInteger(discountBps) || discountBps <= 0 || discountBps > 10000)) {
    throw new LtoError(400, "invalid_discount", "Discount must be 1–10000 bps");
  }
  const promoPriceCents = input.promoPriceCents;
  if (promoPriceCents != null && (!Number.isInteger(promoPriceCents) || promoPriceCents < 0)) {
    throw new LtoError(400, "invalid_price", "Promo price must be a non-negative integer (cents)");
  }
  if (input.kind === "discount" && discountBps == null) {
    throw new LtoError(400, "discount_needs_bps", "A discount requires a percent");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) throw new LtoError(400, "no_items", "At least one item is required");
  for (const it of input.items) {
    const refs = (it.itemId ? 1 : 0) + (it.menuItemId ? 1 : 0);
    if (refs !== 1) throw new LtoError(400, "invalid_item_ref", "Each item needs exactly one ref");
    if (!(it.qty > 0)) throw new LtoError(400, "invalid_item_qty", "Item qty must be > 0");
    if (!it.nameSnapshot || !it.nameSnapshot.trim()) throw new LtoError(400, "invalid_item_name", "Item name required");
  }

  const sb = getServiceRoleClient();
  const { data: loc, error: locErr } = await sb
    .from("locations").select("id").eq("id", input.locationId).eq("active", true).maybeSingle<{ id: string }>();
  if (locErr) throw new Error(`createLtoEvent location: ${locErr.message}`);
  if (!loc) throw new LtoError(404, "location_not_found", "Location not found or inactive");

  const { data: ev, error: evErr } = await sb
    .from("lto_events")
    .insert({
      location_id: input.locationId, kind: input.kind, name,
      discount_bps: discountBps ?? null, promo_price_cents: promoPriceCents ?? null,
      starts_on: input.startsOn, ends_on: input.endsOn, status: "active",
      note: input.note?.trim() || null, created_by: actor.user.id,
    })
    .select("id").single<{ id: string }>();
  if (evErr) throw new Error(`createLtoEvent event: ${evErr.message}`);

  const itemRows = input.items.map((it) => ({
    event_id: ev.id, item_id: it.itemId, menu_item_id: it.menuItemId,
    name_snapshot: it.nameSnapshot.trim(), qty: it.qty, source_pipeline_id: it.sourcePipelineId,
  }));
  const { error: itErr } = await sb.from("lto_event_items").insert(itemRows);
  if (itErr) throw new Error(`createLtoEvent items: ${itErr.message}`);

  // Stubbed provider-agnostic POS push (never throws). Record the disposition.
  const push = await pushLtoToPos({ id: ev.id, kind: input.kind, locationId: input.locationId });
  if (push.status !== "not_pushed") {
    await sb.from("lto_events").update({ pos_push_status: push.status }).eq("id", ev.id);
  }

  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "lto.event.create",
    resourceTable: "lto_events", resourceId: ev.id,
    metadata: { kind: input.kind, location_id: input.locationId, items: input.items.length, discount_bps: discountBps ?? null, promo_price_cents: promoPriceCents ?? null, pos_push_status: push.status },
    ipAddress: null, userAgent: null,
  });
  return { id: ev.id };
}

/** List LTO/discount events for a location. activeOnly = the staff directive (active + not past-window). */
export async function listLtoEvents(actor: AuthContext, args: { locationId: string; activeOnly: boolean }): Promise<LtoEventView[]> {
  requireLevel(actor, LTO_MIN >= 5 ? 5 : LTO_MIN); // read is broadly visible (>=5); directive for staff
  const sb = getServiceRoleClient();
  let q = sb
    .from("lto_events")
    .select("id, location_id, kind, name, discount_bps, promo_price_cents, starts_on, ends_on, status, pos_push_status, note")
    .eq("location_id", args.locationId)
    .order("starts_on", { ascending: false });
  if (args.activeOnly) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    q = q.eq("status", "active").gte("ends_on", today);
  }
  const { data: events, error } = await q.returns<Array<{ id: string; location_id: string; kind: LtoKind; name: string; discount_bps: number | null; promo_price_cents: number | null; starts_on: string; ends_on: string; status: "active" | "cancelled" | "expired"; pos_push_status: "not_pushed" | "pushed" | "failed"; note: string | null }>>();
  if (error) throw new Error(`listLtoEvents: ${error.message}`);
  const evs = events ?? [];
  if (evs.length === 0) return [];

  const ids = evs.map((e) => e.id);
  const { data: items, error: itErr } = await sb
    .from("lto_event_items").select("event_id, name_snapshot, qty").in("event_id", ids)
    .returns<Array<{ event_id: string; name_snapshot: string; qty: number | string }>>();
  if (itErr) throw new Error(`listLtoEvents items: ${itErr.message}`);
  const byEvent = new Map<string, { name: string; qty: number }[]>();
  for (const it of items ?? []) {
    const arr = byEvent.get(it.event_id) ?? [];
    arr.push({ name: it.name_snapshot, qty: typeof it.qty === "string" ? Number(it.qty) : it.qty });
    byEvent.set(it.event_id, arr);
  }
  return evs.map((e) => ({
    id: e.id, locationId: e.location_id, kind: e.kind, name: e.name,
    discountBps: e.discount_bps, promoPriceCents: e.promo_price_cents,
    startsOn: e.starts_on, endsOn: e.ends_on, status: e.status, posPushStatus: e.pos_push_status,
    note: e.note, items: byEvent.get(e.id) ?? [],
  }));
}

/** Cancel an active event (status → cancelled). ≥ LTO_MIN + step-up (route). */
export async function cancelLtoEvent(actor: AuthContext, id: string): Promise<void> {
  requireLevel(actor, LTO_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("lto_events")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: actor.user.id })
    .eq("id", id).eq("status", "active").select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`cancelLtoEvent: ${error.message}`);
  if (!data) throw new LtoError(404, "not_found", "Active event not found");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "lto.event.cancel", resourceTable: "lto_events", resourceId: id, metadata: {}, ipAddress: null, userAgent: null });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/co-ops && npx tsc --noEmit; echo "TSC EXIT $?"` → EXIT 0.

- [ ] **Step 4: Commit**
```bash
git add lib/catering/lto-pos-push.ts lib/catering/lto.ts
git commit -m "feat(w4c-b): LTO events lib + stubbed provider-agnostic POS seam"
```

---

## Task 3: Admin write routes (CC)

**Files:**
- Create: `app/api/admin/catering/lto/events/route.ts`
- Create: `app/api/admin/catering/lto/events/[id]/cancel/route.ts`

Reference: `app/api/admin/catering/fulfillment/route.ts` (the exact gate order).

- [ ] **Step 1: Create route**

Create `app/api/admin/catering/lto/events/route.ts`:

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createLtoEvent, LtoError, LTO_MIN, type CreateLtoEventInput, type LtoEventItemInput } from "@/lib/catering/lto";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/lto/events");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < LTO_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || (b.kind !== "lto" && b.kind !== "discount") || typeof b.name !== "string" || typeof b.startsOn !== "string" || typeof b.endsOn !== "string") {
    return jsonError(400, "invalid_payload", { message: "locationId, kind, name, startsOn, endsOn required" });
  }
  if (!Array.isArray(b.items)) return jsonError(400, "invalid_payload", { message: "items[] required" });
  const items: LtoEventItemInput[] = (b.items as unknown[]).map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      menuItemId: typeof o.menuItemId === "string" ? o.menuItemId : null,
      nameSnapshot: typeof o.nameSnapshot === "string" ? o.nameSnapshot : "",
      qty: typeof o.qty === "number" ? o.qty : Number(o.qty),
      sourcePipelineId: typeof o.sourcePipelineId === "string" ? o.sourcePipelineId : null,
    };
  });
  const input: CreateLtoEventInput = {
    locationId: b.locationId,
    kind: b.kind,
    name: b.name,
    discountBps: typeof b.discountBps === "number" ? b.discountBps : null,
    promoPriceCents: typeof b.promoPriceCents === "number" ? b.promoPriceCents : null,
    startsOn: b.startsOn,
    endsOn: b.endsOn,
    note: typeof b.note === "string" ? b.note : null,
    items,
  };
  try {
    const { id } = await createLtoEvent(ctx, input);
    return jsonOk({ id });
  } catch (e) {
    if (e instanceof LtoError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 2: Cancel route**

Create `app/api/admin/catering/lto/events/[id]/cancel/route.ts`:

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { cancelLtoEvent, LtoError, LTO_MIN } from "@/lib/catering/lto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/catering/lto/events/${id}/cancel`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < LTO_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  try {
    await cancelLtoEvent(ctx, id);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof LtoError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/co-ops && npx tsc --noEmit; echo "TSC EXIT $?"` → EXIT 0. Confirm both routes register (they compile).

- [ ] **Step 4: Commit**
```bash
git add app/api/admin/catering/lto/
git commit -m "feat(w4c-b): admin create + cancel LTO routes (>=6 + Tier-A step-up)"
```

---

## Task 4: LTO smoke — `scripts/w4c-b-lto-smoke.ts` (Fable)

**Files:**
- Create: `scripts/w4c-b-lto-smoke.ts`

Run: `npx tsx --env-file=.env.local scripts/w4c-b-lto-smoke.ts`. Calls the lib directly (not the HTTP routes). Uses a real active location + a real ≥6 actor + a real active item; asserts create/list/validation/cancel; deletes what it created (zero residue).

- [ ] **Step 1: Write the smoke**

Create `scripts/w4c-b-lto-smoke.ts`:

```ts
/**
 * W4c-b LTO smoke — create/list/validation/cancel against lib/catering/lto.ts.
 * Run: npx tsx --env-file=.env.local scripts/w4c-b-lto-smoke.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createLtoEvent, listLtoEvents, cancelLtoEvent, LtoError } from "@/lib/catering/lto";
import { getRoleLevel, type RoleCode } from "@/lib/roles";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!loc) { console.log("SKIP: no active location."); return; }
  const { data: u } = await sb.from("users").select("id, role").order("id").limit(50).returns<Array<{ id: string; role: string }>>();
  const admin = (u ?? []).find((x) => getRoleLevel(x.role as RoleCode) >= 6);
  if (!admin) { console.log("SKIP: no level>=6 user."); return; }
  const actor = { user: { id: admin.id, role: admin.role } } as unknown as Parameters<typeof createLtoEvent>[0];
  const { data: item } = await sb.from("items").select("id, name").eq("active", true).limit(1).maybeSingle<{ id: string; name: string }>();
  if (!item) { console.log("SKIP: no active item."); return; }

  const start = ymd(new Date());
  const end = ymd(new Date(Date.now() + 2 * 86_400_000));
  const createdEventIds: string[] = [];

  try {
    // (a) create an LTO with a discount
    const { id } = await createLtoEvent(actor, {
      locationId: loc.id, kind: "lto", name: "w4c-smoke LTO", discountBps: 3000, promoPriceCents: null,
      startsOn: start, endsOn: end, note: "smoke",
      items: [{ itemId: item.id, menuItemId: null, nameSnapshot: item.name, qty: 10, sourcePipelineId: null }],
    });
    createdEventIds.push(id);
    assert(!!id, "createLtoEvent returns an id");

    // (b) list active includes it
    let active = await listLtoEvents(actor, { locationId: loc.id, activeOnly: true });
    assert(active.some((e) => e.id === id && e.items.length === 1 && e.posPushStatus === "not_pushed"), "active list includes the new LTO with items + not_pushed");

    // (c) validation: a discount with null discountBps is rejected
    let rejected = false;
    try {
      await createLtoEvent(actor, { locationId: loc.id, kind: "discount", name: "bad", discountBps: null, promoPriceCents: null, startsOn: start, endsOn: end, note: null, items: [{ itemId: item.id, menuItemId: null, nameSnapshot: item.name, qty: 1, sourcePipelineId: null }] });
    } catch (e) { rejected = e instanceof LtoError && e.code === "discount_needs_bps"; }
    assert(rejected, "discount without bps is rejected (discount_needs_bps)");

    // (d) validation: bad window rejected
    let badWindow = false;
    try {
      await createLtoEvent(actor, { locationId: loc.id, kind: "lto", name: "bad win", discountBps: null, promoPriceCents: null, startsOn: end, endsOn: start, note: null, items: [{ itemId: item.id, menuItemId: null, nameSnapshot: item.name, qty: 1, sourcePipelineId: null }] });
    } catch (e) { badWindow = e instanceof LtoError && e.code === "invalid_window"; }
    assert(badWindow, "end-before-start window is rejected (invalid_window)");

    // (e) cancel flips status; active list no longer returns it
    await cancelLtoEvent(actor, id);
    active = await listLtoEvents(actor, { locationId: loc.id, activeOnly: true });
    assert(!active.some((e) => e.id === id), "cancelled LTO drops out of the active list");

    // (f) cancel again → 404
    let cancel404 = false;
    try { await cancelLtoEvent(actor, id); } catch (e) { cancel404 = e instanceof LtoError && e.status === 404; }
    assert(cancel404, "cancelling an already-cancelled event → 404");

    console.log("\nW4c-b LTO smoke: ALL PASS");
  } finally {
    if (createdEventIds.length) {
      await sb.from("lto_event_items").delete().in("event_id", createdEventIds);
      await sb.from("lto_events").delete().in("id", createdEventIds);
    }
    console.log("cleanup done");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Note: the rejected create calls (c) + (d) never insert (validation throws before the DB write), so only `createdEventIds` (the one successful LTO) needs cleanup. If a rejected call DID somehow insert, the `finally` won't catch it — but validation precedes every insert, so this is safe.

- [ ] **Step 2: Run**

Run: `cd ~/co-ops && npx tsx --env-file=.env.local scripts/w4c-b-lto-smoke.ts`
Expected: `✓` lines then `W4c-b LTO smoke: ALL PASS` + `cleanup done` (or a clean `SKIP`).

If an insert fails on a NOT NULL column, add it to the seed and re-run; do not weaken an assertion. If a genuine assertion fails, STOP and report.

- [ ] **Step 3: Commit** (CC runs the smoke itself first)
```bash
git add scripts/w4c-b-lto-smoke.ts
git commit -m "test(w4c-b): LTO lib smoke — create/list/validation/cancel"
```

---

## Task 5: LTO surfaces — admin action page + directive + hub card (Sonnet)

**Files:**
- Create: `app/admin/catering/lto/page.tsx`
- Create: `components/admin/catering/lto/LtoClient.tsx`
- Modify: `app/admin/catering/page.tsx`
- Modify: `app/lto/page.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

Reference patterns (read first): `app/admin/catering/fulfillment/page.tsx` (server wrapper: `requireSessionFromHeaders("/admin")` + level gate + `serverT` + passes props), `components/admin/catering/fulfillment/FulfillmentClient.tsx` (client: `useTranslation`, `useStepUp` → `requestStepUp("A")`, `postJson(url, body, "POST")` + `resolveErrorKey` from `@/components/admin/catering/shared`, location picker), `app/admin/catering/prep-demand/page.tsx` (`loadPackageLocations` + `?location=` param + `todayYmd`/`addDays`), `app/admin/catering/page.tsx` EDITORS array, and `app/lto/page.tsx` (the W4c-a surplus page you'll extend).

- [ ] **Step 1: Server wrapper `app/admin/catering/lto/page.tsx`**

Gate `level >= LTO_MIN` (import from `@/lib/catering/lto`), `redirect("/dashboard")` if below. Resolve active location from `?location=` (else first) via `loadPackageLocations(auth)`. Load `loadPerishableSurplus(auth, {locationId, from: todayYmd(), to: addDays(today,14)})` (from `@/lib/catering/surplus`) and `listLtoEvents(auth, {locationId, activeOnly:false})`. Render an `<h1>`/subtitle (i18n `admin.catering.lto.title`/`subtitle`) + `<LtoClient surplus={surplus} events={events} locations={locations} locationId={locationId} actorLevel={level} />`. Copy `todayYmd`/`addDays` helpers locally (same as prep-demand page).

- [ ] **Step 2: Client `components/admin/catering/lto/LtoClient.tsx`**

`"use client"`. Props: `surplus: SurplusLine[]` (from `@/lib/catering/surplus`), `events: LtoEventView[]` (from `@/lib/catering/lto`), `locations: PackageLocationOption[]`, `locationId: string | null`, `actorLevel: number`. Uses `useTranslation`, `useRouter`, `useStepUp`, `postJson`/`resolveErrorKey`.
- **Location picker** (like FulfillmentClient) → `router.push('/admin/catering/lto?location=<id>')`.
- **Surplus → action:** list each perishable `surplus` line; each has a **"Run as LTO / Discount"** button that opens an inline form pre-filled from the line: `kind` toggle (lto/discount), `name` (default e.g. `"{line.name} special"`), a discount **percent** input (→ `discountBps = Math.round(pct*100)`), an optional promo **price** input for lto (dollars → `promoPriceCents = Math.round(dollars*100)`), `startsOn`/`endsOn` date inputs (default today / today+2), optional note. The item is derived from the surplus line: `items: [{ itemId: line.refKind==="item"?line.refId:null, menuItemId: line.refKind==="menu_item"?line.refId:null, nameSnapshot: line.name, qty: line.qty, sourcePipelineId: line.pipelineId }]`. (Choice-kind surplus lines can't be an LTO item ref — hide the action or disable it for `refKind==="choice"`.) On submit: `requestStepUp("A")` → `postJson("/api/admin/catering/lto/events", body, "POST")` → on ok `router.refresh()`; on error show `t(resolveErrorKey(result.code))`.
- **Manage list:** render `events` (the location's LTOs/discounts) with name, kind, terms (discount % / promo price), window, items, `status`, and a **Cancel** button (active only) → `requestStepUp("A")` → `postJson("/api/admin/catering/lto/events/"+id+"/cancel", {}, "POST")` → `router.refresh()`.
- Empty states: no surplus → i18n `admin.catering.lto.no_surplus`; no events → `admin.catering.lto.no_events`.

- [ ] **Step 3: Hub card** — in `app/admin/catering/page.tsx` EDITORS add `{ id: "lto", i18nKey: "admin.catering.hub.lto" as TranslationKey, href: "/admin/catering/lto", minLevel: 6 }`.

- [ ] **Step 4: `/lto` staff directive** — in `app/lto/page.tsx`, for `level >= SURPLUS_READ_MIN` (already loaded there), also load active events across the actor's locations: `listLtoEvents(auth, {locationId: loc.id, activeOnly:true})` per `loadPackageLocations` location, flatten. Add an **"Active LTOs & discounts"** section (i18n `lto.active_title`) ABOVE or beside the surplus feed, each row: name, kind, terms, window, items, location. Empty → `lto.active_empty`. Keep the W4c-a surplus section + Module #17 placeholder. (Import `listLtoEvents` from `@/lib/catering/lto`.)

- [ ] **Step 5: i18n** — add to BOTH `lib/i18n/en.json` + `lib/i18n/es.json` (ES operational tú-form; flat dotted; escape inner quotes):
  - `admin.catering.hub.lto`: "LTO & discounts" / "LTO y descuentos"
  - `admin.catering.lto.title`: "Surplus → LTO / discount" / "Excedente → LTO / descuento"
  - `admin.catering.lto.subtitle`: "Turn surplus into a featured LTO or a discount." / "Convierte el excedente en un LTO destacado o un descuento."
  - `admin.catering.lto.run_action`: "Run as LTO / discount" / "Lanzar como LTO / descuento"
  - `admin.catering.lto.kind_lto`: "LTO" / "LTO"
  - `admin.catering.lto.kind_discount`: "Discount" / "Descuento"
  - `admin.catering.lto.name`: "Name" / "Nombre"
  - `admin.catering.lto.percent_off`: "Percent off" / "Porcentaje de descuento"
  - `admin.catering.lto.promo_price`: "Featured price (optional)" / "Precio destacado (opcional)"
  - `admin.catering.lto.starts`: "Starts" / "Empieza"
  - `admin.catering.lto.ends`: "Ends" / "Termina"
  - `admin.catering.lto.note`: "Note (optional)" / "Nota (opcional)"
  - `admin.catering.lto.create`: "Create" / "Crear"
  - `admin.catering.lto.cancel_event`: "Cancel" / "Cancelar"
  - `admin.catering.lto.no_surplus`: "No perishable surplus to act on." / "Sin excedente perecedero para gestionar."
  - `admin.catering.lto.no_events`: "No LTOs or discounts yet." / "Aún no hay LTOs ni descuentos."
  - `admin.catering.lto.manage_title`: "LTOs & discounts" / "LTOs y descuentos"
  - `lto.active_title`: "Active LTOs & discounts" / "LTOs y descuentos activos"
  - `lto.active_empty`: "No active LTOs or discounts right now." / "Sin LTOs ni descuentos activos ahora."

- [ ] **Step 6: Typecheck + build**

Run: `cd ~/co-ops && npx tsc --noEmit 2>&1 | tail -12 ; echo "TSC EXIT ${PIPESTATUS[0]}"` → EXIT 0.
Run: `cd ~/co-ops && npm run build 2>&1 | tail -15` → success; `/admin/catering/lto` + `/lto` compile (dynamic); both i18n JSON parse.

- [ ] **Step 7: Report to CC (do NOT commit)** — files changed, tsc/build tails, confirm choice-kind surplus lines don't offer an invalid item ref, and that `/lto` keeps the W4c-a surplus feed + Module #17 placeholder.

---

## Task 6: Gates, review, PR (CC)

- [ ] **Step 1: CC reviews Sonnet's diff** — recurring-bug-class focus: create form maps percent→bps + dollars→cents correctly, choice-kind lines can't submit an invalid ref, step-up requested before both create AND cancel, `router.refresh()` after mutations, hub card `id`/`minLevel`, `/lto` keeps W4c-a content, i18n JSON valid, no `useSearchParams` without Suspense.

- [ ] **Step 2: Full gates**
```bash
cd ~/co-ops && npx tsc --noEmit; echo "TSC EXIT $?"
cd ~/co-ops && npm run build 2>&1 | tail -8
```
Expected: TSC EXIT 0; build success.

- [ ] **Step 3: Commit Sonnet's work + push**
```bash
git add app/admin/catering/lto/ components/admin/catering/lto/ app/admin/catering/page.tsx app/lto/page.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(w4c-b): LTO surfaces — admin action page + /lto directive + hub card"
git push -u origin claude/w4c-b-lto-action
```

- [ ] **Step 4: Open the PR**
```bash
gh pr create --title "feat(w4c-b): surplus → LTO/discount action engine" --body "$(cat <<'EOF'
## W4c-b — Surplus → LTO/Discount Action Engine

The "muscles" half of the surplus loop (W4c-a shipped the signal). A manager turns W4c-a perishable surplus into a live **LTO** or **discount**; CO-OPS records an `lto_events` artifact + surfaces a staff directive; the Toast go-live is a **stubbed provider-agnostic seam** (CO-OPS doesn't own the storefront — brain not muscles). Module #17 (LTO Performance) later measures the artifact.

### What shipped
- **Migration 0141** — `lto_events` + `lto_event_items` (append-only; cancel = status flip; RLS read location-scoped, no user writes).
- **`lib/catering/lto.ts`** — `createLtoEvent` (validates terms, snapshots surplus items, calls the POS stub), `listLtoEvents` (active = the directive), `cancelLtoEvent`. `LTO_MIN=6`.
- **`lib/catering/lto-pos-push.ts`** — the stubbed Toast seam (`not_pushed` / `toast_integration_pending`); one-function swap when the POS phase lands.
- **Routes** — `POST /api/admin/catering/lto/events` + `/[id]/cancel` (≥6 + Tier-A step-up).
- **Surfaces** — `/admin/catering/lto` (surplus → create form + manage/cancel), a staff directive on `/lto`, a hub card.
- **Smoke** — create/list/validation/cancel (all pass, zero residue).

### Scope (v1)
- Kinds = **LTO + discount** only (staff meals are already free; not a disposition).
- Source = **catering surplus (W4c-a)** only.
- **No real storefront/Toast push** (stubbed), **no Module #17 performance** (W4c-b only creates the artifact).

### Dormant until data
Advisory; with 0 catering surplus the action page + directive render empty. Activates as cancelled-catering surplus accrues.

### Human smoke suggested
With surplus present (level-6+ user): `/admin/catering/lto` → Run as LTO/discount → step-up → create; see it on `/lto` as an active directive; cancel it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Watch CI to green**
```bash
gh pr checks --watch
```
Report PR number + state to Juan; do NOT merge (Juan reviews + merges).

---

## Notes for the implementer

- **CC owns migration 0141 + all commits + the smoke run.** Sonnet reports, does not commit. Fable's smoke is run by CC before committing.
- **`noUncheckedIndexedAccess`:** guard array/Map access; the smoke's `.find`, the route's `items.map`, and the lib's Map gets need care.
- **Step-up lives under `/admin`** — the write routes are `/api/admin/...` and the action page is `/admin/catering/lto` (StepUpProvider present via the admin layout). Never put the create/cancel action on `/lto` (no step-up there).
- **Percent↔bps / dollars↔cents:** the UI converts (percent×100→bps, dollars×100→cents); the lib + DB store bps + cents. Keep the boundary at the form.
- **Advisory + dormant:** every surface renders a clean empty state at 0 data.
