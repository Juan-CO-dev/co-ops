# W4c-b — Surplus → LTO/Discount Action Engine (design)

**Date:** 2026-07-21
**Status:** approved (Juan), ready for implementation plan
**Part of:** the catering↔inventory reserve/deplete moat. W4c is the cancellation flip-side (surplus): **W4c-a (shipped, #154) = the surplus SIGNAL**; **W4c-b (this) = the ACTION engine** — a manager turns surplus into a live LTO or discount.
**Backlog ref:** field-note ④ (over-prep redistribution → LTO/discount). See `project_coops_catering_wiring_ideas_backlog.md`.

---

## Goal

A manager takes a W4c-a perishable-surplus line and turns it into an **LTO** or a **discount** by setting terms (which items, discount/price, window). CO-OPS records it as an operational `lto_events` artifact and surfaces it to staff as a **directive** ("Today's LTO: Italian sub −30% — feature it"). A **stubbed Toast-push seam** is wired now and swapped for real POS integration in the future Toast phase. This is the artifact **Module #17 (LTO Performance)** will later *measure*.

## Non-goals

- **No real storefront / Toast go-live.** CO-OPS does not own the customer regular storefront (Toast/the POS does — "be the brain, not the muscles"). The POS push is a **stub** until the Toast-integration phase. The stub is a provider-agnostic seam (same pattern as the Portal-3 payment-provider seam).
- **No LTO performance tracking** (units sold, food-cost %, ratings) — that is Module #17. W4c-b only *creates* the LTO/discount artifact Module #17 will consume.
- **No staff-meal / donate dispositions.** Staff meals are already free and part of every shift, so "route surplus to staff meal" changes nothing; donate isn't a v1 need. The two terms-bearing actions are **LTO** and **discount** only. Surplus that isn't acted on simply remains surfaced (advisory).
- **No general / manual surplus source in v1.** The only input is W4c-a's catering perishable surplus (`loadPerishableSurplus`). General over-prep surplus is deferred with its (not-yet-built) signal.

---

## Grounding (verified against live code + DB, 2026-07-21)

- **No LTO/promotion/discount artifact exists.** `app/lto/page.tsx` = a Module #17 placeholder + (from W4c-a) a perishable-surplus feed. "discount" in the code is only the catering *bundle implied-discount* (a pricing-math concept in `lib/admin/catering/package-pricing.ts`), not an applied promo. `items.menu_price` is a single hand-entered price (food-cost %). No sale-price / coupon / markdown mechanism.
- **No live regular customer storefront in CO-OPS.** `app/order/*` = the *catering* self-serve flow; `/ordering` = a Module #7 (staff inventory ordering) placeholder; `/lto` = staff-internal. Regular menu + sales live in Toast. → an LTO "goes live" via a future Toast push (stubbed) or as an internal staff directive, not a CO-OPS-rendered storefront.
- **W4c-a entry point:** `lib/catering/surplus.ts` `loadPerishableSurplus(actor, {locationId, from, to}): Promise<SurplusLine[]>` — prep-grain (item/menu_item/choice) surplus lines, each with `refKind, refId, name, portion, qty, needDate, daysOut, pipelineId`. This is W4c-b's input.
- **Step-up is an admin-shell feature.** `StepUpProvider` is rendered by `app/admin/layout.tsx` (+ admin sub-pages); `assertStepUp` reads `ctx.session.stepUpUnlocked`. `/lto` is top-level (no step-up). → manager **write** actions (create/cancel, which need Tier-A step-up) must live under `/admin`. The catering admin family (`/admin/catering/{packages,pricing,rate-rules,capacity,fulfillment,prep-demand}`) is the pattern to mirror. The staff **read** directive can stay on `/lto` (no step-up).
- **Admin-catering lib/route pattern** (mirror `lib/admin/catering/fulfillment.ts` + its route): a typed error class + `requireLevel(actor,min)` + `audit({actorId,actorRole,action,resourceTable,resourceId,metadata,ipAddress,userAgent})`; route = `requireSession(req,path)` → `instanceof Response` guard → `ROLES[...].level < MIN → jsonError(403,"forbidden")` → `assertStepUp(ctx,"A")` → `parseJsonBody` → validate → lib → `try/catch(TypedError→jsonError)`.
- **Money is integer cents; rates are bps** (10000 = 100%) across the codebase (`pricing-derivation.ts`, `catering_payments`). W4c-b follows: `discount_bps` (e.g. 3000 = 30% off), `promo_price_cents`.
- **Next migration = 0141.** Append-only philosophy: cancel = status flip + `cancelled_at/by`, never delete; add `_no_user_delete USING(false)` + split insert/update RLS.

---

## Architecture

Five pieces: a two-table migration, an events lib, a stubbed POS seam, two admin write routes, and the surfaces (admin action page + staff directive on `/lto` + hub card).

### Component 1 — Migration 0141 (`lto_events` + `lto_event_items`)

```sql
CREATE TABLE public.lto_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      uuid NOT NULL REFERENCES public.locations(id),
  kind             text NOT NULL CHECK (kind IN ('lto','discount')),
  name             text NOT NULL,
  discount_bps     integer CHECK (discount_bps IS NULL OR (discount_bps > 0 AND discount_bps <= 10000)),
  promo_price_cents integer CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  pos_push_status  text NOT NULL DEFAULT 'not_pushed' CHECK (pos_push_status IN ('not_pushed','pushed','failed')),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users(id),
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES public.users(id),
  CONSTRAINT lto_events_window CHECK (ends_on >= starts_on),
  -- a discount MUST carry a percent; an lto may carry price OR percent OR neither
  CONSTRAINT lto_events_discount_needs_bps CHECK (kind <> 'discount' OR discount_bps IS NOT NULL)
);

CREATE TABLE public.lto_event_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES public.lto_events(id) ON DELETE CASCADE,
  item_id          uuid REFERENCES public.items(id),
  menu_item_id     uuid REFERENCES public.menu_items(id),
  name_snapshot    text NOT NULL,
  qty              numeric NOT NULL,
  source_pipeline_id uuid,   -- the cancelled catering lead the surplus came from (attribution; no FK: leads are mutable)
  CONSTRAINT lto_event_items_one_ref CHECK (num_nonnulls(item_id, menu_item_id) = 1)
);
```

RLS: read level ≥5 (staff directive is broadly visible); **no user insert/update/delete** (service-role only — writes go through the gated lib). `lto_event_items` same. `ON DELETE CASCADE` is for referential hygiene only (rows are never user-deleted; a cancelled event keeps its items).

### Component 2 — `lib/catering/lto.ts` (server-only, service-role + gated)

```ts
export const LTO_MIN = 6;                       // catering_mgr+ (mirrors SURPLUS_READ_MIN)
export class LtoError extends Error { constructor(public status: number, public code: string, message?: string) { super(message ?? code); } }

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
  startsOn: string;   // YYYY-MM-DD
  endsOn: string;     // YYYY-MM-DD
  note: string | null;
  items: LtoEventItemInput[];
}
export interface LtoEventView {
  id: string; locationId: string; kind: LtoKind; name: string;
  discountBps: number | null; promoPriceCents: number | null;
  startsOn: string; endsOn: string; status: "active" | "cancelled" | "expired";
  posPushStatus: "not_pushed" | "pushed" | "failed"; note: string | null;
  items: { name: string; qty: number }[];
}

/** Create an LTO/discount from surplus. ≥LTO_MIN + Tier-A step-up (enforced at the route). */
export async function createLtoEvent(actor: AuthContext, input: CreateLtoEventInput): Promise<{ id: string }>;
/** List LTO/discount events for a location (activeOnly for the staff directive). */
export async function listLtoEvents(actor: AuthContext, args: { locationId: string; activeOnly: boolean }): Promise<LtoEventView[]>;
/** Cancel an event (status → cancelled). ≥LTO_MIN + step-up. */
export async function cancelLtoEvent(actor: AuthContext, id: string): Promise<void>;
```

**`createLtoEvent` validation:** `kind ∈ {lto,discount}`; `name` non-empty; `discount === "discount"` requires `discountBps` in `(0,10000]`; `lto` allows `discountBps` and/or `promoPriceCents` or neither; `promoPriceCents ≥ 0` when set; `startsOn ≤ endsOn`; `items` non-empty, each with exactly one ref + `qty > 0`. Location must exist + be active. Insert `lto_events` (status `active`) + `lto_event_items`, then call `pushLtoToPos` and store the returned `pos_push_status`. Audit `lto.event.create`.

**`listLtoEvents`:** reads events + their items; `activeOnly` filters `status='active'` AND `ends_on >= today` (advisory expiry — no cron; a past-window active event is treated as inactive in the read, and MAY be lazily flipped to `expired` on read or left as-is — keep it simple: filter in the read, don't mutate). Ordered by `starts_on`.

**`cancelLtoEvent`:** status→`cancelled` + `cancelled_at/by`, only when currently `active` (0 rows → `LtoError(404)`). Audit `lto.event.cancel`.

### Component 3 — `lib/catering/lto-pos-push.ts` — the stubbed seam

```ts
export interface PosPushResult { status: "not_pushed" | "pushed" | "failed"; reason?: string }
/**
 * Provider-agnostic POS push. STUB until the Toast-integration phase — logs + returns not_pushed.
 * Swapping this one function to a real Toast client is the entire "go live at the register" step.
 */
export async function pushLtoToPos(event: { id: string; kind: LtoKind; locationId: string }): Promise<PosPushResult> {
  return { status: "not_pushed", reason: "toast_integration_pending" };
}
```

### Component 4 — Write routes (under `/admin`, step-up available)

- `POST /api/admin/catering/lto/events` — create. `requireSession` → level ≥ `LTO_MIN` → `assertStepUp("A")` → `parseJsonBody` → validate shape → `createLtoEvent` → `jsonOk({id})`; `catch(LtoError → jsonError)`.
- `POST /api/admin/catering/lto/events/[id]/cancel` — cancel. Same gate; `cancelLtoEvent`.

### Component 5 — Surfaces

- **`/admin/catering/lto`** (new, gate ≥6, `StepUpProvider`) — the **manager action page**. Loads `loadPerishableSurplus` (W4c-a) for the selected location + `listLtoEvents(activeOnly:false)`. Each surplus line gets a **"Run as LTO / Discount"** affordance → a form (kind toggle, name, discount % *or* promo price, window start/end, pre-filled item + qty from the surplus line) → POST create (Tier-A step-up). Below, a **manage list** of this location's events with a **cancel** affordance. Mirrors the FulfillmentClient/PrepDemandClient patterns (location picker, `postJson`, `useStepUp`).
- **Hub card** on `app/admin/catering/page.tsx` — a new `{id:"lto", href:"/admin/catering/lto", minLevel:6}` editor card.
- **`/lto`** (staff directive, read-only) — extend the page W4c-a built: add an **"Active LTOs & discounts"** section from `listLtoEvents(activeOnly:true)` across the actor's locations (the directive: name, kind, terms, window, items). Keep the W4c-a surplus feed + Module #17 placeholder. No step-up (read-only).
- i18n: `admin.catering.lto.*` + `lto.active_*` keys (EN/ES).

### Data flow

W4c-a surplus (read) → manager picks a line on `/admin/catering/lto` → create form → `POST /api/admin/catering/lto/events` (≥6 + step-up) → `createLtoEvent` writes `lto_events` + `lto_event_items` + calls `pushLtoToPos` (stub → `not_pushed`) → the event shows in the manage list AND as a staff directive on `/lto`. Cancel flips status. Module #17 later reads `lto_events` for performance.

---

## Error handling & edge cases

- **Surplus is derive-on-read (not a stored row):** the create action **snapshots** the surplus item name + qty + `source_pipeline_id` into `lto_event_items` at creation. If the underlying surplus later changes (re-confirm, etc.), the LTO record is unaffected — it's an independent artifact.
- **Validation failures** → `LtoError(400, ...)` → `jsonError` (discount without bps, bad window, empty items, bad ref count). The DB CHECK constraints are the backstop; the lib validates first for clean messages.
- **Cancel on a non-active event** → `LtoError(404)` (0 rows updated — the silent-UPDATE lesson).
- **POS push stub never throws** — returns `not_pushed`; `createLtoEvent` records it and proceeds. A future real push that fails records `failed` without rolling back the event (the event exists in CO-OPS regardless of POS state).
- **Advisory expiry:** no cron; `listLtoEvents(activeOnly)` treats `ends_on < today` as not-active in the read. (A future Module #17 or a pg_cron sweep can flip `status='expired'`; not needed now.)
- **Dormant-safe:** with 0 surplus, the action page shows the empty surplus state + "no active events"; `/lto` directive shows its empty state.

## Testing

- **`scripts/w4c-b-lto-smoke.ts`** (Fable): create an LTO from a synthetic surplus item (real location + item) → assert the `lto_events` row (`status='active'`, `pos_push_status='not_pushed'`) + `lto_event_items` rows; `listLtoEvents(activeOnly:true)` returns it; a `discount` with null `discountBps` is **rejected**; a bad window is rejected; `cancelLtoEvent` flips status and `listLtoEvents(activeOnly:true)` no longer returns it. Zero residue.
- **Build gate** + tsc EXIT 0. Recurring-bug-class review (CC).

## Model-tiered build (same loop)

- **CC (main loop):** migration 0141 (apply to prod, verify, commit) + `lib/catering/lto.ts` + `lib/catering/lto-pos-push.ts` (stub) + the two admin routes. Sole reviewer; owns migration + git.
- **Sonnet 4.6:** `/admin/catering/lto` action page + form + manage list, the hub card, the `/lto` active-events directive section, EN/ES i18n.
- **Fable 5:** `scripts/w4c-b-lto-smoke.ts`.

Sonnet + Fable dispatched in parallel (disjoint files; neither commits). CC serializes commits + runs the smoke.

---

## Open items / deferred

- **Real Toast push** — swap `pushLtoToPos` for a Toast client in the POS-integration phase. The seam + `pos_push_status` are ready.
- **Module #17 (LTO Performance)** — reads `lto_events` to report units sold / food-cost % / ratings. Separate module; W4c-b provides its source artifact.
- **General / manual surplus source** — a second input beyond catering surplus.
- **`expired` auto-flip** (pg_cron sweep) — advisory read-time filter suffices for now.
