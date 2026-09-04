# Toast Catering Scan (Catering Inbox A1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A catering order that rings through Toast (register, Toast online ordering, Pete's app) becomes a pipeline lead at `confirmed` within ten minutes of being placed, assigned to the catering manager; a voided order goes to `lost`; an ezCater order's Toast ring never becomes a second lead.

**Architecture:** A pure extractor turns the raw `ordersBulk` payload into order-level summaries and classifies each one (catering · ezCater ring · not catering) from two live signals — the dining option name against the location's catering dining options (the existing `toast_ingest_exclusions` rows of kind `dining_option`) and Toast's own `source = "Catering Online Ordering"`. A scan core keeps a per-order ledger (`toast_catering_orders`, migration 0192), creates or moves leads through the shared system-intake helpers (extracted from the ezCater processor), and a secured cron route runs the scan for today and yesterday. Toast order webhooks are partner-only, so an external pinger on the CO desktop calls the route every ten minutes in business hours with a dedicated, low-blast secret.

**Tech Stack:** Next.js 16 route, Supabase service-role client, vitest (pure spine), Toast `GET /orders/v2/ordersBulk` + `/config/v2/diningOptions` via the existing `toastGet`.

**Spec:** `docs/superpowers/specs/2026-09-01-catering-inbox-design.md` § Amendment A1.2 + A1.3 (Juan-approved 2026-09-04; pinger = external, no new spend).

**Ground truth (probed live 2026-09-04, keys only):** every real order carries `guid, businessDate (int yyyymmdd), openedDate, modifiedDate, promisedDate (ISO), voided, source, numberOfGuests, diningOption{guid}, externalId, thirdPartyProviderInfo, deliveryInfo{address1,address2,city,state,zipCode,notes,…}, checks[{guid, voided, customer{firstName,lastName,phone,email}, totalAmount (dollars, number), tabName, selections[{displayName, quantity, price, voided, item{guid}|null, selectionType}]}]`. Capitol Hill's catering module shows `source: "Catering Online Ordering"`. Live catering dining options: the two global exclusion rows `dining_option: "Ezcater"` and `dining_option: "App Catering Delivery"`. Toast dining options are bare `{guid}` on the order; names resolve via `fetchDiningOptionNames` (`lib/toast/config.ts`).

**Ground rules**
- Branch `feat/toast-catering-scan` off `origin/main`. Commit per task with the two attribution lines. PR at the end; never push to main.
- Laws: ledger-first (every order the scan classifies gets a `toast_catering_orders` row before any lead write); append-only pipeline events; `confirmed` for a Toast catering order is legitimate — it is paid at placement (spec A1.2); `lost` on void via `canTransition`; closed audit vocabulary (`catering.pipeline.create`/`.stage_move` with `actor_context: "toast_catering_scan"`, `cron.success`/`cron.failure` with `job: "toast-catering-scan"`); no operator actor anywhere on this path; every migration applied via MCP also lands as a file in the PR — **apply 0192 on Juan's word, not before**.
- Idempotency is by `order_guid`: a re-scan of an already-ledgered, unchanged order does nothing; a changed `modifiedDate` refreshes the ledger row; a newly-voided order moves the lead to `lost` once.
- `external_ref` on `catering_pipeline` is shared with ezCater (unique partial index): Toast leads use `external_ref = "toast:" + orderGuid`.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/catering/machine-notes-shared.ts` (create) | Pure: generic marked machine-notes block (`wrapMachineNotes`, `mergeMachineNotes`); ezCater's helpers become thin wrappers. |
| `lib/toast/catering-orders-shared.ts` (create) | Pure: `extractToastOrders(json)`, `classifyToastOrder(...)`, `toastLeadFields(...)`, `toastOrderNotes(...)`. |
| `tests/toast-catering-orders.test.ts` (create) | Pins extraction, classification, lead mapping, idempotency helpers. |
| `supabase/migrations/0192_toast_catering_orders.sql` (create) | Ledger table + deny-all user RLS. |
| `lib/catering/system-intake.ts` (create) | Server-only: `resolveCateringManager`, `systemMoveStage`, `SystemMoveOutcome` — moved out of `ezcater-intake.ts`, shared by both tributaries. |
| `lib/catering/ezcater-intake.ts` (modify) | Imports the shared helpers; behavior unchanged. |
| `lib/catering/toast-catering-scan.ts` (create) | Server-only scan core. |
| `app/api/cron/toast-catering-scan/route.ts` (create) | Secured GET; dates; heartbeat audit. |
| `docs/superpowers/specs/2026-09-01-catering-inbox-design.md` | Untouched. |

---

### Task 1: Generic machine-notes block (refactor, pure)

**Files:** Create `lib/catering/machine-notes-shared.ts`; modify `lib/ezcater/lifecycle-shared.ts`; test `tests/ezcater-lifecycle.test.ts` (must keep passing unchanged).

- [ ] **Step 1: Branch** — `cd ~/co-ops && git fetch origin && git checkout -q -b feat/toast-catering-scan origin/main`.
- [ ] **Step 2: Create `lib/catering/machine-notes-shared.ts`:**

```ts
/**
 * Machine-written notes block — pure. A system tributary (ezCater webhook, Toast catering scan)
 * writes its order context into `catering_pipeline.notes` inside a marked block so a later
 * refresh replaces ONLY that block and every character a human typed survives.
 */
export function machineNotesMarkers(source: string): { begin: string; end: string } {
  return { begin: `--- ${source} (auto) ---`, end: `--- end ${source} ---` };
}

export function wrapMachineNotes(source: string, block: string): string {
  const m = machineNotesMarkers(source);
  return `${m.begin}\n${block.trim()}\n${m.end}`;
}

/** Replace this source's marked block inside existing notes (human text before/after is kept);
 *  if absent, append after the human text. Never drops a character a human wrote. */
export function mergeMachineNotes(source: string, existing: string | null | undefined, block: string): string {
  const m = machineNotesMarkers(source);
  const wrapped = wrapMachineNotes(source, block);
  const cur = existing ?? "";
  const start = cur.indexOf(m.begin);
  const end = cur.indexOf(m.end);
  if (start >= 0 && end > start) {
    const before = cur.slice(0, start).replace(/\s+$/, "");
    const after = cur.slice(end + m.end.length).replace(/^\s+/, "");
    return [before, wrapped, after].filter((s) => s.length > 0).join("\n\n");
  }
  const human = cur.trim();
  return human ? `${human}\n\n${wrapped}` : wrapped;
}
```

- [ ] **Step 3: Make the ezCater helpers wrappers** in `lib/ezcater/lifecycle-shared.ts` — replace the bodies of `wrapEzcaterNotes`/`mergeEzcaterNotes` with `wrapMachineNotes("ezCater order", block)` / `mergeMachineNotes("ezCater order", existing, block)`; keep `EZCATER_NOTES_BEGIN`/`END` exported as `machineNotesMarkers("ezCater order").begin/.end` (the existing tests assert the literal marker text `--- ezCater order (auto) ---` / `--- end ezCater ---` — **`end` must stay `--- end ezCater ---`**, so pass the source as `"ezCater order"` for begin and special-case: `machineNotesMarkers` takes an optional second argument `endLabel` defaulting to `source`; ezCater calls `machineNotesMarkers("ezCater order", "ezCater")`). Adjust `wrapMachineNotes`/`mergeMachineNotes` to accept the same optional `endLabel` and thread it through.
- [ ] **Step 4: Verify** — `npm test -- tests/ezcater-lifecycle.test.ts` (16 pass, unchanged assertions), `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add lib/catering/machine-notes-shared.ts lib/ezcater/lifecycle-shared.ts && git commit -m "refactor(catering): generic machine-notes block shared by system tributaries"`.

---

### Task 2: Pure Toast order extractor, classifier, lead mapping

**Files:** Create `lib/toast/catering-orders-shared.ts`; test `tests/toast-catering-orders.test.ts`.

- [ ] **Step 1: Write the failing tests** — create `tests/toast-catering-orders.test.ts`:

```ts
// Toast catering scan — pure half (lib/toast/catering-orders-shared.ts). Shapes pinned from a
// LIVE ordersBulk probe 2026-09-04 (keys only): promisedDate/modifiedDate ISO, businessDate int
// yyyymmdd, checks[].customer{firstName,lastName,phone,email}, checks[].totalAmount in dollars,
// deliveryInfo address fields, source strings like "Catering Online Ordering".
import { describe, expect, it } from "vitest";
import { classifyToastOrder, extractToastOrders, toastLeadFields, toastOrderNotes } from "@/lib/toast/catering-orders-shared";

const CATERING_DO = "do-catering";
const EZ_DO = "do-ezcater";
const NAMES = new Map([[CATERING_DO, "App Catering Delivery"], [EZ_DO, "Ezcater"], ["do-dine", "Dine In"]]);
const CATERING_SET = ["App Catering Delivery", "Ezcater"];

function order(over: Record<string, unknown> = {}) {
  return {
    guid: "o-1", businessDate: 20260904, openedDate: "2026-09-04T15:02:11.000+0000", modifiedDate: "2026-09-04T15:05:00.000+0000",
    promisedDate: "2026-09-12T16:30:00.000+0000", voided: false, source: "Online", numberOfGuests: 1,
    diningOption: { guid: "do-dine" }, externalId: null, thirdPartyProviderInfo: null,
    deliveryInfo: { address1: "1600 Pennsylvania Ave NW", address2: null, city: "Washington", state: "DC", zipCode: "20500", notes: "side door" },
    checks: [{ guid: "c-1", voided: false, totalAmount: 312.5, tabName: null,
      customer: { firstName: "Ada", lastName: "Lovelace", phone: "2025550100", email: "ada@example.com" },
      selections: [
        { displayName: "48 pc platter", quantity: 1, price: 330, voided: false, item: { guid: "i-1" }, selectionType: "NONE" },
        { displayName: "All vegetarian", quantity: 1, price: 0, voided: false, item: null, selectionType: "SPECIAL_REQUEST" },
        { displayName: "Dozen Waters", quantity: 2, price: 24, voided: true, item: { guid: "i-2" }, selectionType: "NONE" },
      ] }],
    ...over,
  };
}

describe("extractToastOrders", () => {
  it("lifts the order-level fields the pipeline needs; dollars become cents; voided lines are kept but flagged", () => {
    const [o] = extractToastOrders([order()]);
    expect(o).toMatchObject({
      guid: "o-1", businessDate: "2026-09-04", promisedAt: "2026-09-12T16:30:00.000+0000", modifiedAt: "2026-09-04T15:05:00.000+0000",
      voided: false, source: "Online", diningOptionGuid: "do-dine", headcount: 1, totalCents: 31250, thirdParty: false,
      customer: { name: "Ada Lovelace", phone: "2025550100", email: "ada@example.com" },
      deliveryAddress: "1600 Pennsylvania Ave NW, Washington, DC 20500 — side door",
    });
    expect(o!.items).toEqual([
      { name: "48 pc platter", quantity: 1, priceCents: 33000, voided: false },
      { name: "Dozen Waters", quantity: 2, priceCents: 2400, voided: true },
    ]);
    expect(o!.specialRequests).toEqual(["All vegetarian"]);
  });
  it("tolerates missing optionals and a non-array payload poisons", () => {
    const [o] = extractToastOrders([order({ promisedDate: null, numberOfGuests: null, deliveryInfo: null, checks: [{ guid: "c", voided: false, totalAmount: 10, customer: null, selections: [] }] })]);
    expect(o).toMatchObject({ promisedAt: null, headcount: null, deliveryAddress: null, customer: null, totalCents: 1000, items: [] });
    expect(() => extractToastOrders({} as unknown)).toThrow();
  });
  it("skips an order with no guid rather than poisoning the whole page", () => {
    expect(extractToastOrders([order({ guid: null }), order({ guid: "o-2" })]).map((o) => o.guid)).toEqual(["o-2"]);
  });
});

describe("classifyToastOrder", () => {
  it("dining option in the catering set → catering; 'Ezcater' → ezcater ring; else not_catering", () => {
    const [dine] = extractToastOrders([order()]);
    const [cat] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    const [ez] = extractToastOrders([order({ diningOption: { guid: EZ_DO } })]);
    expect(classifyToastOrder(dine!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("not_catering");
    expect(classifyToastOrder(cat!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("catering");
    expect(classifyToastOrder(ez!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("ezcater");
  });
  it("Toast's own catering module is catering regardless of dining option; a third-party ezCater ring is ezcater", () => {
    const [mod] = extractToastOrders([order({ source: "Catering Online Ordering" })]);
    expect(classifyToastOrder(mod!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("catering");
    const [tp] = extractToastOrders([order({ source: "API", thirdPartyProviderInfo: { provider: "ezCater" } })]);
    expect(classifyToastOrder(tp!, { diningOptionNames: NAMES, cateringDiningOptions: CATERING_SET })).toBe("ezcater");
  });
  it("matches dining option names case- and whitespace-insensitively", () => {
    const [cat] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    expect(classifyToastOrder(cat!, { diningOptionNames: new Map([[CATERING_DO, "  app catering delivery "]]), cateringDiningOptions: ["App Catering Delivery"] })).toBe("catering");
  });
});

describe("toastLeadFields / toastOrderNotes", () => {
  it("maps to the lead shape: promised date in ET, HH:MM window, customer contact, address, cents", () => {
    const [o] = extractToastOrders([order({ diningOption: { guid: CATERING_DO } })]);
    const f = toastLeadFields(o!, { diningOptionName: "App Catering Delivery" });
    expect(f).toMatchObject({
      contact_name: "Ada Lovelace", contact_phone: "2025550100", event_date: "2026-09-12", time_window: "12:30",
      headcount: 1, estimated_revenue_cents: 31250, delivery_address: "1600 Pennsylvania Ave NW, Washington, DC 20500 — side door",
      is_delivery: true, lead_source: "toast_catering", stage: "confirmed", external_ref: "toast:o-1",
    });
    expect(f.notes).toContain("--- Toast order (auto) ---");
    expect(f.notes).toContain("48 pc platter");
    expect(f.notes).toContain("All vegetarian");
  });
  it("falls back to the business date and a generic name when the order has no promise or customer", () => {
    const [o] = extractToastOrders([order({ promisedDate: null, deliveryInfo: null, checks: [{ guid: "c", voided: false, totalAmount: 10, customer: null, selections: [] }] })]);
    const f = toastLeadFields(o!, { diningOptionName: null });
    expect(f.event_date).toBe("2026-09-04");
    expect(f.time_window).toBeNull();
    expect(f.contact_name).toBe("Toast order o-1");
    expect(f.is_delivery).toBe(false);
  });
  it("notes block lists items, voided lines marked, special requests, source and dining option", () => {
    const [o] = extractToastOrders([order({ source: "Catering Online Ordering" })]);
    const n = toastOrderNotes(o!, "App Catering Delivery");
    expect(n).toMatch(/Toast order o-1 .*Catering Online Ordering/);
    expect(n).toContain("• 1× 48 pc platter");
    expect(n).toContain("• 2× Dozen Waters (voided)");
    expect(n).toContain('Special request: "All vegetarian"');
  });
});
```

- [ ] **Step 2: Run** — `npm test -- tests/toast-catering-orders.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `lib/toast/catering-orders-shared.ts`:**

```ts
/**
 * Toast catering orders — PURE half (client-safe): lift order-level fields from the raw
 * `ordersBulk` payload, classify catering vs ezCater ring vs not, map to a pipeline lead.
 * Shapes pinned from a live probe 2026-09-04 (see tests). Money: Toast amounts are dollars.
 */
import { wrapMachineNotes } from "@/lib/catering/machine-notes-shared";

export interface ToastOrderItem { name: string; quantity: number; priceCents: number | null; voided: boolean }
export interface ToastOrderSummary {
  guid: string;
  businessDate: string;           // YYYY-MM-DD
  openedAt: string | null;
  modifiedAt: string | null;
  promisedAt: string | null;      // ISO as Toast sends it
  voided: boolean;
  source: string | null;
  diningOptionGuid: string | null;
  headcount: number | null;
  totalCents: number;             // sum of non-voided checks' totalAmount
  thirdParty: boolean;            // thirdPartyProviderInfo present
  customer: { name: string; phone: string | null; email: string | null } | null;
  deliveryAddress: string | null;
  items: ToastOrderItem[];
  specialRequests: string[];
}

const dollarsToCents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

function businessDateYmd(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "";
}

function address(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const line = [str(o.address1), str(o.address2)].filter(Boolean).join(" ");
  const cityState = [str(o.city), str(o.state)].filter(Boolean).join(", ");
  const tail = [cityState, str(o.zipCode)].filter(Boolean).join(" ");
  const base = [line, tail].filter(Boolean).join(", ");
  const notes = str(o.notes);
  if (!base) return null;
  return notes ? `${base} — ${notes}` : base;
}

export function extractToastOrders(json: unknown): ToastOrderSummary[] {
  if (!Array.isArray(json)) throw new Error("toast orders payload: expected an array of orders");
  const out: ToastOrderSummary[] = [];
  for (const raw of json as Array<Record<string, unknown>>) {
    const guid = str(raw?.guid);
    if (!guid) continue; // an order without a guid cannot be ledgered; skip, never poison the page
    const checks = Array.isArray(raw.checks) ? (raw.checks as Array<Record<string, unknown>>) : [];
    let totalCents = 0;
    let customer: ToastOrderSummary["customer"] = null;
    const items: ToastOrderItem[] = [];
    const specialRequests: string[] = [];
    for (const c of checks) {
      const checkVoided = c.voided === true;
      if (!checkVoided) totalCents += dollarsToCents(c.totalAmount) ?? 0;
      const cust = c.customer as Record<string, unknown> | null | undefined;
      if (!customer && cust && typeof cust === "object") {
        const name = [str(cust.firstName), str(cust.lastName)].filter(Boolean).join(" ");
        if (name) customer = { name, phone: str(cust.phone), email: str(cust.email) };
      }
      for (const s of (Array.isArray(c.selections) ? c.selections : []) as Array<Record<string, unknown>>) {
        const name = str(s.displayName) ?? "(unnamed)";
        const hasItem = !!(s.item && typeof s.item === "object" && str((s.item as Record<string, unknown>).guid));
        if (!hasItem) { if (s.selectionType === "SPECIAL_REQUEST" && str(s.displayName)) specialRequests.push(name); continue; }
        const quantity = typeof s.quantity === "number" && Number.isFinite(s.quantity) ? s.quantity : 1;
        items.push({ name, quantity, priceCents: dollarsToCents(s.price), voided: checkVoided || s.voided === true || raw.voided === true });
      }
    }
    out.push({
      guid,
      businessDate: businessDateYmd(raw.businessDate),
      openedAt: str(raw.openedDate),
      modifiedAt: str(raw.modifiedDate),
      promisedAt: str(raw.promisedDate),
      voided: raw.voided === true,
      source: str(raw.source),
      diningOptionGuid: str((raw.diningOption as Record<string, unknown> | null | undefined)?.guid),
      headcount: typeof raw.numberOfGuests === "number" && raw.numberOfGuests > 0 ? raw.numberOfGuests : null,
      totalCents,
      thirdParty: !!raw.thirdPartyProviderInfo && typeof raw.thirdPartyProviderInfo === "object",
      customer,
      deliveryAddress: address(raw.deliveryInfo),
      items,
      specialRequests,
    });
  }
  return out;
}

export type ToastOrderClass = "catering" | "ezcater" | "not_catering";
const norm = (s: string) => s.trim().toLowerCase();
export const TOAST_CATERING_SOURCE = "catering online ordering";

/** Two signals: the dining option NAME in the location's catering set, or Toast's own catering module.
 *  "Ezcater" (dining option) or a third-party provider ring is the ezCater tributary's order, never a second lead. */
export function classifyToastOrder(o: ToastOrderSummary, ctx: { diningOptionNames: ReadonlyMap<string, string>; cateringDiningOptions: readonly string[] }): ToastOrderClass {
  const name = o.diningOptionGuid ? ctx.diningOptionNames.get(o.diningOptionGuid) ?? null : null;
  if (o.thirdParty || (name && norm(name) === "ezcater")) return "ezcater";
  if (name && ctx.cateringDiningOptions.some((c) => norm(c) === norm(name))) return "catering";
  if (o.source && norm(o.source) === TOAST_CATERING_SOURCE) return "catering";
  return "not_catering";
}

/** ISO → ET calendar date + HH:MM (24h), pure via Intl. */
function etParts(iso: string): { date: string; time: string } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}

export function toastOrderNotes(o: ToastOrderSummary, diningOptionName: string | null): string {
  const lines = o.items.map((it) => `• ${it.quantity}× ${it.name}${it.voided ? " (voided)" : ""}`);
  const total = `$${(o.totalCents / 100).toFixed(2)}`;
  const head = `Toast order ${o.guid} — ${[o.source, diningOptionName].filter(Boolean).join(" · ") || "order"} — auto-created from the catering scan.`;
  const promised = o.promisedAt ? `Promised: ${o.promisedAt}` : "Promised: n/a";
  const specials = o.specialRequests.map((s) => `Special request: "${s}"`);
  return [head, `${promised} · Total: ${total}`, ...lines, ...specials].join("\n");
}

export interface ToastLeadFields {
  contact_name: string; contact_phone: string | null; company: null;
  event_date: string; time_window: string | null; headcount: number | null;
  estimated_revenue_cents: number; delivery_address: string | null; is_delivery: boolean;
  stage: "confirmed"; lead_source: "toast_catering"; external_ref: string; notes: string;
}

export function toastLeadFields(o: ToastOrderSummary, ctx: { diningOptionName: string | null }): ToastLeadFields {
  const promised = o.promisedAt ? etParts(o.promisedAt) : null;
  return {
    contact_name: o.customer?.name ?? `Toast order ${o.guid}`,
    contact_phone: o.customer?.phone ?? null,
    company: null,
    event_date: promised?.date ?? o.businessDate,
    time_window: promised?.time ?? null,
    headcount: o.headcount,
    estimated_revenue_cents: o.totalCents,
    delivery_address: o.deliveryAddress,
    is_delivery: o.deliveryAddress != null,
    stage: "confirmed",
    lead_source: "toast_catering",
    external_ref: `toast:${o.guid}`,
    notes: wrapMachineNotes("Toast order", toastOrderNotes(o, ctx.diningOptionName)),
  };
}
```

(`time_window` expectation in the test: `16:30Z` on 2026-09-12 = 12:30 ET (EDT). The `en-GB` 24h format yields `12:30`.)

- [ ] **Step 4: Run** → PASS (9 tests). `npm run typecheck`, `npx eslint lib/toast/catering-orders-shared.ts tests/toast-catering-orders.test.ts`.
- [ ] **Step 5: Commit** — `feat(toast): pure catering-order extractor, classifier, lead mapping`.

---

### Task 3: Migration 0192 — `toast_catering_orders` ledger (file only)

**Files:** Create `supabase/migrations/0192_toast_catering_orders.sql`.

- [ ] **Step 1: Write the file:**

```sql
-- Migration 0192_toast_catering_orders
-- AUTHORED 2026-09-04. NOT YET APPLIED — GATE (JUAN).
--
-- 0192: toast_catering_orders — the Toast catering scan's per-order ledger (catering inbox A1.2).
--
-- One row per Toast order the scan CLASSIFIED (catering · ezcater ring · voided later), keyed
-- on the Toast order guid. Ledger-first: the row lands before any lead write. The scan is
-- idempotent on (order_guid, toast_modified_at): unchanged orders are no-ops. System-only
-- (service role): no user reads/writes — mirrors ezcater_events (0149).

create table public.toast_catering_orders (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations(id),
  order_guid         text not null unique,
  business_date      date not null,
  source             text,
  dining_option      text,
  classification     text not null check (classification in ('catering','ezcater')),
  voided             boolean not null default false,
  promised_at        timestamptz,
  toast_modified_at  timestamptz,
  customer_name      text,
  customer_phone     text,
  headcount          integer,
  total_cents        integer not null default 0,
  items              jsonb not null default '[]'::jsonb,
  lead_id            uuid references public.catering_pipeline(id),
  processing_result  text not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);
create index toast_catering_orders_loc_date_ix on public.toast_catering_orders (location_id, business_date desc);
create index toast_catering_orders_lead_ix on public.toast_catering_orders (lead_id) where lead_id is not null;

alter table public.toast_catering_orders enable row level security;
create policy toast_catering_orders_no_user_select on public.toast_catering_orders for select using (false);
create policy toast_catering_orders_no_user_insert on public.toast_catering_orders for insert with check (false);
create policy toast_catering_orders_no_user_update on public.toast_catering_orders for update using (false);
create policy toast_catering_orders_no_user_delete on public.toast_catering_orders for delete using (false);

-- Verify after apply:
--   select count(*) from pg_policies where tablename = 'toast_catering_orders';  -- 4
```

- [ ] **Step 2: Commit** — `feat(db): 0192 toast_catering_orders ledger (file only; apply on Juan's word)`.

---

### Task 4: Shared system-intake helpers (extract from ezCater)

**Files:** Create `lib/catering/system-intake.ts`; modify `lib/catering/ezcater-intake.ts`.

- [ ] **Step 1:** Create `lib/catering/system-intake.ts` (server-only) and MOVE — do not copy — `resolveCateringManager`, `systemMoveStage`, the `SystemMoveOutcome` type and the `ExistingLead` type (`{ id: string; stage: PipelineStage }`) out of `lib/catering/ezcater-intake.ts` into it, exported, with one change: `systemMoveStage` takes an extra `actorContext: string` parameter and writes it into the audit metadata (`actor_context: actorContext`) instead of the literal `"ezcater_webhook"`. Header comment:

```ts
/**
 * System intake helpers shared by the machine tributaries (ezCater webhook, Toast catering scan).
 * SERVER-ONLY, service-role, NO operator actor. `systemMoveStage` mirrors moveStage's guarded UPDATE +
 * append-only event + audit; it does NOT touch prep demand (machine-created leads carry no quote until
 * 2c-b). FOLLOW-UP: fold into a shared applyStageMove with lib/catering/pipeline.ts once 2c-b lands.
 */
```

- [ ] **Step 2:** In `ezcater-intake.ts` import them (`import { resolveCateringManager, systemMoveStage, type ExistingLead, type SystemMoveOutcome } from "@/lib/catering/system-intake";`) and pass `"ezcater_webhook"` at the `systemMoveStage` call site. Nothing else changes.
- [ ] **Step 3: Verify** — `npm run typecheck`, `npx eslint lib/catering/system-intake.ts lib/catering/ezcater-intake.ts`, `npm test -- tests/ezcater-lifecycle.test.ts`.
- [ ] **Step 4: Commit** — `refactor(catering): shared system-intake helpers (resolver + system stage move)`.

---

### Task 5: Scan core

**Files:** Create `lib/catering/toast-catering-scan.ts`.

Check first: `grep -n "export async function loadActiveExclusions\|^async function loadActiveExclusions" lib/catering/toast-sales.ts` — if it is NOT exported, add `export` to it (it is an actor-less core; exporting it changes nothing else).

- [ ] **Step 1: Create the file:**

```ts
/**
 * Toast catering scan — SERVER-ONLY core (catering inbox A1.2). No operator actor.
 *
 * For each Toast-connected location and each business date asked for: pull `ordersBulk`, lift
 * order summaries (pure), classify against the location's catering dining options (the
 * `toast_ingest_exclusions` rows of kind dining_option) and Toast's own catering source, then:
 *   catering, unseen   → ledger row + lead at `confirmed` (paid at placement — spec A1.2),
 *                        assigned to the catering manager; external_ref "toast:<guid>".
 *   catering, seen     → refresh the ledger row when toast_modified_at changed; if the order is
 *                        now VOIDED and the lead is open → system move to `lost`.
 *   ezcater ring       → ledger row only (`attributed_to_ezcater`); the ezCater webhook owns it.
 *   not catering       → nothing.
 * Ledger-first; never throws per order (each order's outcome is its processing_result); a
 * per-location Toast/API failure is reported in the result, never thrown across locations.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { toastGet, ToastApiError } from "@/lib/toast/client";
import { toastBusinessDate } from "@/lib/toast/orders";
import { fetchDiningOptionNames } from "@/lib/toast/config";
import { loadActiveExclusions } from "@/lib/catering/toast-sales";
import { classifyToastOrder, extractToastOrders, toastLeadFields, toastOrderNotes, type ToastOrderSummary } from "@/lib/toast/catering-orders-shared";
import { mergeMachineNotes } from "@/lib/catering/machine-notes-shared";
import { resolveCateringManager, systemMoveStage, type ExistingLead } from "@/lib/catering/system-intake";
import { isPipelineStage } from "@/lib/catering/pipeline";
import { canTransition } from "@/lib/catering/pipeline-shared";

const PAGE_SIZE = 100;
const ACTOR_CONTEXT = "toast_catering_scan";

export interface ScanLocationResult { locationId: string; ok: boolean; error?: string; seen: number; catering: number; ezcater: number; createdLeads: number; lostLeads: number; refreshed: number }

async function fetchOrders(restaurantGuid: string, ymd: string): Promise<ToastOrderSummary[]> {
  const bd = toastBusinessDate(ymd);
  const all: ToastOrderSummary[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const json = await toastGet<unknown>(`/orders/v2/ordersBulk?businessDate=${bd}&page=${page}&pageSize=${PAGE_SIZE}`, restaurantGuid);
    const rawCount = Array.isArray(json) ? json.length : -1;
    try { all.push(...extractToastOrders(json)); }
    catch (err) { throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad orders payload"); }
    if (rawCount < PAGE_SIZE) break;
  }
  return all;
}

type LedgerRow = { id: string; voided: boolean; toast_modified_at: string | null; lead_id: string | null; classification: string };

async function scanLocation(locationId: string, restaurantGuid: string, dates: string[]): Promise<ScanLocationResult> {
  const sb = getServiceRoleClient();
  const res: ScanLocationResult = { locationId, ok: true, seen: 0, catering: 0, ezcater: 0, createdLeads: 0, lostLeads: 0, refreshed: 0 };
  const names = await fetchDiningOptionNames(restaurantGuid);
  const exclusions = (await loadActiveExclusions()).filter((e) => e.kind === "dining_option" && (e.locationId == null || e.locationId === locationId));
  const cateringDiningOptions = exclusions.map((e) => e.value);
  const assignee = await resolveCateringManager(sb, locationId);

  for (const ymd of dates) {
    const orders = await fetchOrders(restaurantGuid, ymd);
    for (const o of orders) {
      res.seen += 1;
      const cls = classifyToastOrder(o, { diningOptionNames: names, cateringDiningOptions });
      if (cls === "not_catering") continue;
      const diningOptionName = o.diningOptionGuid ? names.get(o.diningOptionGuid) ?? null : null;
      const { data: existing, error: exErr } = await sb.from("toast_catering_orders")
        .select("id, voided, toast_modified_at, lead_id, classification").eq("order_guid", o.guid).maybeSingle<LedgerRow>();
      if (exErr) continue; // next run retries; nothing written
      const base = {
        location_id: locationId, order_guid: o.guid, business_date: o.businessDate, source: o.source, dining_option: diningOptionName,
        classification: cls, voided: o.voided, promised_at: o.promisedAt, toast_modified_at: o.modifiedAt,
        customer_name: o.customer?.name ?? null, customer_phone: o.customer?.phone ?? null, headcount: o.headcount,
        total_cents: o.totalCents, items: o.items, last_seen_at: new Date().toISOString(),
      };

      if (cls === "ezcater") {
        res.ezcater += 1;
        if (!existing) await sb.from("toast_catering_orders").insert({ ...base, processing_result: "attributed_to_ezcater" });
        else await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at, voided: o.voided, toast_modified_at: o.modifiedAt }).eq("id", existing.id);
        continue;
      }

      res.catering += 1;
      if (!existing) {
        // Ledger first, then the lead. A voided-at-first-sight order is ledgered, never a lead.
        const { data: ledger, error: lErr } = await sb.from("toast_catering_orders")
          .insert({ ...base, processing_result: o.voided ? "voided_before_seen" : "pending_lead" }).select("id").maybeSingle<{ id: string }>();
        if (lErr || !ledger || o.voided) continue;
        const fields = toastLeadFields(o, { diningOptionName });
        const { data: lead, error: insErr } = await sb.from("catering_pipeline")
          .insert({ ...fields, location_id: locationId, assigned_to: assignee, created_by: null }).select("id").maybeSingle<{ id: string }>();
        if (insErr || !lead) {
          await sb.from("toast_catering_orders").update({ processing_result: insErr?.code === "23505" ? "duplicate_external_ref" : "error:lead_insert" }).eq("id", ledger.id);
          continue;
        }
        const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: null, to_stage: "confirmed", note: `Toast catering order ${o.guid} (scan)`, actor_id: null });
        void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: lead.id,
          metadata: { actor_context: ACTOR_CONTEXT, lead_source: "toast_catering", external_ref: fields.external_ref, location_id: locationId, stage: "confirmed", assigned_to: assignee, source: o.source, dining_option: diningOptionName }, ipAddress: null, userAgent: null });
        await sb.from("toast_catering_orders").update({ lead_id: lead.id, processing_result: evErr ? "created_lead_no_trail" : "created_lead" }).eq("id", ledger.id);
        res.createdLeads += 1;
        continue;
      }

      // Seen before. Unchanged → nothing. Changed → refresh ledger (+ lead fields); newly voided → lost.
      const changed = (existing.toast_modified_at ?? null) !== (o.modifiedAt ?? null) || existing.voided !== o.voided;
      if (!changed) { await sb.from("toast_catering_orders").update({ last_seen_at: base.last_seen_at }).eq("id", existing.id); continue; }
      await sb.from("toast_catering_orders").update({ ...base, processing_result: existing.lead_id ? "refreshed" : "refreshed_no_lead" }).eq("id", existing.id);
      res.refreshed += 1;
      if (!existing.lead_id) continue;
      const { data: leadRow } = await sb.from("catering_pipeline").select("id, stage, notes").eq("id", existing.lead_id).maybeSingle<{ id: string; stage: string; notes: string | null }>();
      if (!leadRow || !isPipelineStage(leadRow.stage)) continue;
      const lead: ExistingLead = { id: leadRow.id, stage: leadRow.stage };
      if (o.voided && !existing.voided) {
        if (canTransition(lead.stage, "lost")) {
          const outcome = await systemMoveStage(sb, lead, "lost", `Toast order ${o.guid} voided (scan)`, ACTOR_CONTEXT);
          await sb.from("toast_catering_orders").update({ processing_result: outcome === "moved" ? "voided_lead_lost" : `voided_${outcome}` }).eq("id", existing.id);
          if (outcome === "moved") res.lostLeads += 1;
        } else {
          await sb.from("toast_catering_orders").update({ processing_result: "voided_illegal_transition" }).eq("id", existing.id);
        }
        continue;
      }
      // Fields refresh in place; human notes preserved through the marked block.
      const fields = toastLeadFields(o, { diningOptionName });
      await sb.from("catering_pipeline").update({
        headcount: fields.headcount, event_date: fields.event_date, time_window: fields.time_window,
        estimated_revenue_cents: fields.estimated_revenue_cents, delivery_address: fields.delivery_address,
        notes: mergeMachineNotes("Toast order", leadRow.notes, toastOrderNotes(o, diningOptionName)), updated_at: new Date().toISOString(),
      }).eq("id", lead.id);
      await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note: `Toast order ${o.guid} modified (scan)`, actor_id: null });
      void audit({ actorId: null, actorRole: null, action: "catering.pipeline.edit", resourceTable: "catering_pipeline", resourceId: lead.id,
        metadata: { actor_context: ACTOR_CONTEXT, reason: "toast_order_modified", fields: ["headcount", "event_date", "time_window", "estimated_revenue_cents", "delivery_address", "notes"] }, ipAddress: null, userAgent: null });
    }
  }
  return res;
}

/** Every Toast-connected active location, the given business dates (YYYY-MM-DD). Per-location failures are reported, never thrown. */
export async function scanToastCateringForAllLocations(dates: string[]): Promise<ScanLocationResult[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid").eq("active", true)
    .not("toast_restaurant_guid", "is", null).returns<Array<{ id: string; toast_restaurant_guid: string }>>();
  if (error) throw new Error(`toast-catering-scan locations: ${error.message}`);
  const out: ScanLocationResult[] = [];
  for (const loc of data ?? []) {
    try { out.push(await scanLocation(loc.id, loc.toast_restaurant_guid, dates)); }
    catch (e) { out.push({ locationId: loc.id, ok: false, error: e instanceof Error ? e.message : String(e), seen: 0, catering: 0, ezcater: 0, createdLeads: 0, lostLeads: 0, refreshed: 0 }); }
  }
  return out;
}
```

Notes for the implementer: `catering_pipeline` may not have every column `toastLeadFields` emits — verify with `select column_name from information_schema.columns where table_name='catering_pipeline'` (the live list is: id, customer_id, contact_name, company, event_date, headcount, stage, lead_source, location_id, notes, follow_up_date, created_by, created_at, updated_at, estimated_revenue_cents, contact_phone, delivery_address, time_window, event_type, dietary_notes, event_name, dropoff_door, geo_lat, geo_lng, fulfillment_routed, assigned_to, external_ref). `is_delivery` is NOT a column — drop it from the insert (keep it on the pure type for the notes/tests, but spread only known columns: destructure `const { is_delivery: _isDelivery, ...cols } = fields;`). `lead_source` must be a value accepted by `lib/catering/intake-shared.ts`'s registry (`toast_catering` is).

- [ ] **Step 2: Verify** — `npm run typecheck`, `npx eslint lib/catering/toast-catering-scan.ts`.
- [ ] **Step 3: Commit** — `feat(catering): Toast catering scan core — ledger-first, leads born confirmed, void → lost`.

---

### Task 6: Cron route + dedicated secret

**Files:** Create `app/api/cron/toast-catering-scan/route.ts`.

- [ ] **Step 1: Create the route** (mirror `toast-sales-pull` exactly for auth shape, but with its OWN secret so the pinger machine never holds `CRON_SECRET`):

```ts
// GET Toast catering scan (catering inbox A1.2). Toast order webhooks are partner-only, so an
// external pinger (CO desktop Task Scheduler) calls this every 10 minutes in business hours.
// Auth: x-cron-secret header (or Authorization: Bearer) must equal env CATERING_SCAN_SECRET —
// a DEDICATED, low-blast secret (it can only trigger an idempotent scan), so it may live on the
// pinger machine without exposing CRON_SECRET. 503 no-op when unset (dormant-safe).
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { scanToastCateringForAllLocations } from "@/lib/catering/toast-catering-scan";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

export const runtime = "nodejs";

function truncateErr(e: unknown): string { const m = e instanceof Error ? e.message : String(e); return m.length > 500 ? `${m.slice(0, 500)}…` : m; }
function secretOk(req: NextRequest): boolean {
  const secret = process.env.CATERING_SCAN_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!process.env.CATERING_SCAN_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  const today = etCalendarDate(new Date().toISOString());
  const param = req.nextUrl.searchParams.get("date");
  if (param && !/^\d{4}-\d{2}-\d{2}$/.test(param)) return jsonError(400, "invalid_date");
  const dates = param ? [param] : [today, etYmdMinusDays(today, 1)];
  try {
    const results = await scanToastCateringForAllLocations(dates);
    const sum = (k: "seen" | "catering" | "ezcater" | "createdLeads" | "lostLeads" | "refreshed") => results.reduce((n, r) => n + r[k], 0);
    void audit({ actorId: null, actorRole: null, action: "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: "toast-catering-scan", dates, seen: sum("seen"), catering: sum("catering"), ezcater: sum("ezcater"), created_leads: sum("createdLeads"), lost_leads: sum("lostLeads"), refreshed: sum("refreshed"), per_location_failures: results.filter((r) => !r.ok).length },
      ipAddress: null, userAgent: null });
    return jsonOk({ dates, results });
  } catch (e) {
    void audit({ actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null, metadata: { job: "toast-catering-scan", dates, error: truncateErr(e) }, ipAddress: null, userAgent: null });
    return jsonError(500, "scan_failed");
  }
}
```

Check `jsonOk`/`jsonError` signatures in `lib/api-helpers.ts` match the sales route's usage (copy that route's import line). `proxy.ts` already exempts `/api/cron/*`.

- [ ] **Step 2: Local secret** — append `CATERING_SCAN_SECRET=<64 hex chars from node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">` to `.env.local` (do NOT print it in any report).
- [ ] **Step 3: Verify** — `npm run typecheck`, `npx eslint app/api/cron/toast-catering-scan/route.ts`, full `npm test`.
- [ ] **Step 4: Commit** — `feat(cron): toast-catering-scan route with a dedicated pinger secret`.

---

### Task 7: PR + operations

- [ ] **Step 1:** Push and open the PR (`gh pr create`) titled `feat(catering): Toast catering scan — leads born confirmed from Toast catering orders (A1.2)`; body: what/laws/verification, "Migration 0192 file included — apply on Juan's word before merge", "External pinger on the CO desktop calls the route every 10 min 06:00–22:00 ET with the dedicated secret".
- [ ] **Step 2 (CC, on Juan's word):** apply 0192 via MCP; verify 4 policies; merge.
- [ ] **Step 3 (Juan):** add `CATERING_SCAN_SECRET` to Vercel Production (CC delivers the value as a file, never chat); redeploy.
- [ ] **Step 4 (CC):** first manual run `curl -H "x-cron-secret: …" https://co-ops-ashy.vercel.app/api/cron/toast-catering-scan` → inspect `toast_catering_orders` + the new leads; then install the desktop Task Scheduler task `CO_CateringScan` (every 10 min, 06:00–22:00 ET, `curl -sS -H "x-cron-secret: %SECRET%" <url>`), copying the secret machine-to-machine over ssh.
- [ ] **Step 5:** Record in memory + CHIEF: first real Toast catering lead, and the ezCater-ring attribution seen in the ledger.

---

## Self-review
- Spec A1.2 coverage: classification (dining option set + Toast catering source) → Task 2; born confirmed, promised date as event date, void → lost, ezCater ring never a second lead → Tasks 2 + 5; poll driver = external pinger with a dedicated secret → Tasks 6–7; A1.3 assignment → Task 4/5.
- Placeholders: none — the only values withheld are secrets, by rule.
- Type consistency: `ToastOrderSummary`/`ToastLeadFields`/`ToastOrderClass` defined in Task 2 and consumed by name in Task 5; `systemMoveStage(sb, lead, toStage, note, actorContext)` signature from Task 4 used in Task 5; `ScanLocationResult` fields summed in Task 6.
