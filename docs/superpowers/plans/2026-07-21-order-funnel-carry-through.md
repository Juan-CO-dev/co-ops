# ⑤ Order-Funnel Carry-Through — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a REAL code feature → each task: implement → `tsc` + `next build` green → CC review of the diff → commit. Ships as one PR through the CI build gate. Model tiering: Sonnet for the storefront UI + tray (Tasks 2–3); CC (main loop) authors the server thread (Tasks 1, 4), is SOLE reviewer of every diff, and owns all git; a Fable smoke in Task 5.

**Goal:** Storefront `/order` "Add to order" selections carry through the intake + magic-link round-trip and pre-seed the `/order/build` cart; the storefront renders from the real seeded menu.

**Architecture:** A client selection tray on a now-data-driven storefront writes `{menuItemId|itemId, qty}` to `sessionStorage`; `/order/start` folds it into the `intake.preselect` payload; the magic-link `parseIntake` whitelists+validates it; `createDraftFromIntake` reuses the existing `setDraftLines` engine (D20 server price authority) to insert `catering_quote_items`; the build page (unchanged) hydrates them.

**Tech Stack:** Next 16 App Router (server components; `proxy.ts`), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase service-role, the existing `lib/portal/draft.ts` + `lib/portal/menu.ts`.

**Branch:** `claude/order-funnel-carry-through` (off `origin/main` @ 384d71c; spec committed).

---

## File structure
- **Modify** `lib/portal/draft.ts` — add `preselect` to `DraftIntake`; pre-seed in `createDraftFromIntake` (Task 1).
- **Modify** `app/api/portal/magic-link/request/route.ts` — whitelist+validate `preselect` in `parseIntake` (Task 1).
- **Create** `components/portal/storefront-images.ts` — name→image presentational map (Task 2).
- **Modify** `app/order/page.tsx` — server component; render marketing layout from the real menu; mount the tray (Task 2).
- **Create** `components/portal/StorefrontOrderTray.tsx` — client island: Add-to-order buttons + floating pill + sessionStorage hand-off (Task 3).
- **Modify** `app/order/start/start-client.tsx` — read the preselect, show a confirmation line, include it in the intake payload (Task 4).

---

## Task 1: Server thread — `preselect` on the intake → pre-seed the draft

**Files:**
- Modify: `lib/portal/draft.ts` (`DraftIntake` at :48, `createDraftFromIntake` at :205)
- Modify: `app/api/portal/magic-link/request/route.ts` (`parseIntake` at :28)

- [ ] **Step 1: Add `preselect` to `DraftIntake`.** In `lib/portal/draft.ts`, add one field to the interface (reuse the existing `DraftLineInput` shape — it's already `{ itemId?, menuItemId?, packageId?, portion?, quantity }`):

```ts
export interface DraftIntake {
  locationId: string;
  contactName: string;
  // …existing fields unchanged…
  fulfillmentRouted?: boolean;
  /** Optional storefront carry-through: cart lines to pre-seed the draft (v1: item+qty, whole). */
  preselect?: DraftLineInput[] | null;
}
```

- [ ] **Step 2: Pre-seed in `createDraftFromIntake`.** In `lib/portal/draft.ts`, after the quote is created and BEFORE the `return`, add a best-effort pre-seed that reuses `setDraftLines` (which already resolves refs against the server menu, inserts `catering_quote_items`, and recomputes+snapshots the charge stack). Best-effort: a stale/invalid ref must NOT fail order creation — the customer just starts from an empty cart.

```ts
  // ⑤ carry-through: pre-seed the cart from the storefront selection (best-effort — a stale/invalid
  // ref must never fail order creation). setDraftLines re-resolves + re-prices server-side (D20).
  if (intake.preselect && intake.preselect.length > 0) {
    try {
      await setDraftLines(customerId, quote.id, intake.preselect, { isDelivery: intake.isDelivery });
    } catch (e) {
      console.error("createDraftFromIntake preselect failed (draft left empty):", e);
    }
  }

  return { quoteId: quote.id, pipelineId: lead.id };
```
(`setDraftLines` is defined later in the same file — a hoisted `async function`, so it's callable here. It calls `loadOwnedDraftHeader(customerId, quote.id)`, which passes: the quote is owned by `customerId` + `status='draft'`.)

- [ ] **Step 3: Whitelist+validate `preselect` in `parseIntake`.** In `app/api/portal/magic-link/request/route.ts`, add a cap constant and a parser, and include the field in the returned object. Drop malformed entries (never reject the whole intake — enumeration/UX). Reference the same UUID regex used elsewhere (inline it):

```ts
const MAX_PRESELECT = 40; // mirrors MAX_CART_LINES; caps the anon-reachable token payload (A-H4)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePreselect(v: unknown): Array<{ menuItemId?: string; itemId?: string; quantity: number }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ menuItemId?: string; itemId?: string; quantity: number }> = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const menuItemId = typeof o.menuItemId === "string" && UUID_RE.test(o.menuItemId) ? o.menuItemId : undefined;
    const itemId = typeof o.itemId === "string" && UUID_RE.test(o.itemId) ? o.itemId : undefined;
    // exactly one ref
    if ((menuItemId === undefined) === (itemId === undefined)) continue;
    const q = o.quantity;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 99) continue;
    out.push(menuItemId ? { menuItemId, quantity: q } : { itemId, quantity: q });
    if (out.length >= MAX_PRESELECT) break;
  }
  return out.length > 0 ? out : null;
}
```
Then in `parseIntake`'s returned object add: `preselect: parsePreselect(o.preselect),`

- [ ] **Step 4: Verify.** `npx tsc --noEmit` → exit 0. `requestMagicLink` already forwards `intake` to consume, so no route-plumbing change is needed beyond `parseIntake`.

- [ ] **Step 5: CC review + commit.**
```bash
git add lib/portal/draft.ts app/api/portal/magic-link/request/route.ts
git commit -m "feat(order): pre-seed draft cart from storefront preselect (5 thread)"
```

---

## Task 2: Data-driven storefront (marketing layout, real menu)

**Files:**
- Create: `components/portal/storefront-images.ts`
- Modify: `app/order/page.tsx`

Re-read `app/order/page.tsx` (the current mockup layout to preserve) and `lib/portal/menu.ts` (`loadPublicCateringMenu(locationId)` → `CateringMenuItem[]`, and the `CateringMenuItem` shape: `{ kind: "menu_item"|"item"; id; name; section; unitPriceCents; portionable; portionPricesCents?; cateringOnly }`) before writing.

- [ ] **Step 1: Name→image presentational map.** Create `components/portal/storefront-images.ts` — move the current mockup's `T(...)`/`IMG` Toast S3 URLs into a `Record<string, string>` keyed by menu-item name (exact names from the seed: "The Teamster", "Crunchy Boi", "Hot Pants", "Marisa Tomei Eats Free", "The Frex", "Vesuvio II", "Sicky Wicky Club", "Never Been Cheddar", "Farmers Market After Dark") + a `GENERIC_SUB_IMG` fallback constant. Export `subImage(name: string): string`.

- [ ] **Step 2: Convert `/order` to a Server Component.** Remove `"use client"` isn't present (it's already a server file, but it currently exports static data). Replace the hardcoded `SUBS`/`SIDES`/`SWEETS`/`DRINKS`/`PLATTER_SIZES` arrays with a server-side load. At the top of the default export:

```ts
import { loadPublicCateringMenu } from "@/lib/portal/menu";
const CAPITOL_HILL_ID = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a"; // prices identical both shops (Juan)

export default async function OrderStorefront() {
  const menu = await loadPublicCateringMenu(CAPITOL_HILL_ID);
  const subs   = menu.filter((m) => m.kind === "menu_item" && (m.section ?? "").toLowerCase() === "subs");
  const sides  = menu.filter((m) => /(side|chip|salad)/.test((m.section ?? "").toLowerCase()) || (m.kind === "item"));
  const sweets = menu.filter((m) => /(sweet|cookie|cannoli)/.test((m.section ?? "").toLowerCase()));
  const drinks = menu.filter((m) => /(drink|soda|water|beverage)/.test((m.section ?? "").toLowerCase()));
  // …render the SAME marketing layout from these; money() helper formats cents.
}
```
Keep every static marketing section (hero, how-it-works, reviews, locations, FAQ) verbatim. Platters/lunch-boxes/big-subs stay marketing CTAs → `/order/start` (v1: no package carry-through). The subs grid + Sides/Sweets/Drinks lists render `subImage(name)` + real name/price, and each renders an Add-to-order control **from the tray island** (Task 3) — pass the menu arrays into `<StorefrontOrderTray menu={{subs, sides, sweets, drinks}} />` OR render the item cards inside the tray component. Decision: the tray owns the Add-to-order buttons + cards for orderable items, so it holds the selection state; the server page renders the surrounding marketing chrome and mounts the tray with the orderable rows.

- [ ] **Step 3: `money(cents)` helper** — add `const money = (c: number) => (c/100).toLocaleString("en-US",{style:"currency",currency:"USD"});` (mirrors the build page).

- [ ] **Step 4: Verify.** `npx tsc --noEmit` + `npm run build` green (server component must build). Screenshot the page (Playwright) — marketing layout intact, real sub names/prices, images present.

- [ ] **Step 5: CC review + commit.**
```bash
git add app/order/page.tsx components/portal/storefront-images.ts
git commit -m "feat(order): storefront renders from the real catering menu (5)"
```

---

## Task 3: Selection tray (client island)

**Files:**
- Create: `components/portal/StorefrontOrderTray.tsx`

- [ ] **Step 1: Contract.** Client component taking the orderable rows and rendering their Add-to-order cards + a floating pill:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CateringMenuItem } from "@/lib/portal/menu";

const PRESELECT_KEY = "co_order_preselect";
type Pick = { kind: "menu_item" | "item"; id: string; name: string; qty: number };

export function StorefrontOrderTray({ groups }: { groups: { label: string; items: CateringMenuItem[] }[] }) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const keyOf = (m: CateringMenuItem) => `${m.kind}:${m.id}`;
  const add = (m: CateringMenuItem) => setPicks((p) => {
    const k = keyOf(m); const prev = p[k];
    return { ...p, [k]: prev ? { ...prev, qty: prev.qty + 1 } : { kind: m.kind, id: m.id, name: m.name, qty: 1 } };
  });
  const dec = (k: string) => setPicks((p) => {
    const prev = p[k]; if (!prev) return p;
    const copy = { ...p }; if (prev.qty <= 1) delete copy[k]; else copy[k] = { ...prev, qty: prev.qty - 1 }; return copy;
  });
  const count = Object.values(picks).reduce((s, x) => s + x.qty, 0);
  const start = () => {
    const preselect = Object.values(picks).map((x) => x.kind === "menu_item" ? { menuItemId: x.id, quantity: x.qty } : { itemId: x.id, quantity: x.qty });
    try { window.sessionStorage.setItem(PRESELECT_KEY, JSON.stringify(preselect)); } catch { /* private mode — proceed without carry-through */ }
    router.push("/order/start");
  };
  // render item cards (name, price, "Add to order" → add(m); if picked, show qty +/−) + a fixed bottom-center
  // pill: `{count} item{s} · Start your order →` (always visible; empty count still routes to /order/start).
}
```

- [ ] **Step 2: Render** each group's items as cards (Add-to-order button; when qty>0 show a −/qty/+ stepper), and the floating pill (fixed bottom-center, `z-40`, safe-area padding). No prices in the pill math — item + qty only. Reuse the mockup's card styling (brand tokens: `bg-co-text text-co-cta` CTA, gold accents).

- [ ] **Step 3: Wire into the storefront** — Task 2's page mounts `<StorefrontOrderTray groups={[{label:"The ones people ask for by name", items: subs}, {label:"Sides", items: sides}, {label:"Sweets", items: sweets}, {label:"Drinks", items: drinks}]} />` in place of the static subs grid + Sides/Sweets/Drinks lists.

- [ ] **Step 4: Verify.** `tsc` + build green. Playwright: tap Add on two subs → pill shows "3 items" (after a +), tray steppers work, "Start your order" navigates to `/order/start` and sessionStorage `co_order_preselect` holds the refs.

- [ ] **Step 5: CC review + commit.**
```bash
git add components/portal/StorefrontOrderTray.tsx app/order/page.tsx
git commit -m "feat(order): storefront selection tray → sessionStorage carry-through (5)"
```

---

## Task 4: Intake reads the preselect + includes it in the payload

**Files:**
- Modify: `app/order/start/start-client.tsx`

Re-read `start-client.tsx` — the new-client submit builds an `intake: {...}` object and POSTs to `/api/portal/magic-link/request` (two call sites per the grep at ~:521 and ~:553).

- [ ] **Step 1: Read the preselect on mount** (client). Add near the top of the component:

```tsx
const [preselect, setPreselect] = useState<Array<{ menuItemId?: string; itemId?: string; quantity: number }>>([]);
useEffect(() => {
  try {
    const raw = window.sessionStorage.getItem("co_order_preselect");
    if (raw) { setPreselect(JSON.parse(raw)); window.sessionStorage.removeItem("co_order_preselect"); }
  } catch { /* ignore */ }
}, []);
```

- [ ] **Step 2: Confirmation line** — where the intake form renders, if `preselect.length > 0` show a small note: `{preselect.reduce((s,p)=>s+p.quantity,0)} item(s) from the menu will be added to your order.` (translation key `order.start.preselect_note` in `en.json`/`es.json`).

- [ ] **Step 3: Include in BOTH magic-link POST bodies.** In each `intake: { … }` object add `preselect,` (the field name matches `parseIntake`'s `parsePreselect(o.preselect)`).

- [ ] **Step 4: Verify.** `tsc` + build green.

- [ ] **Step 5: CC review + commit.**
```bash
git add app/order/start/start-client.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(order): intake carries storefront preselect into the draft (5)"
```

---

## Task 5: End-to-end smoke + PR

- [ ] **Step 1: Fable smoke** (`tsx` script, deleted after): create a customer, call `createDraftFromIntake(customerId, { …minimal intake…, preselect: [{ menuItemId: <a real sub id> , quantity: 2 }] })`, then assert `loadDraft(customerId, quoteId).items` has 1 line, qty 2, `unitPriceCents` = the sub's server whole price, and `stack.subtotalCents` = 2× that. Also assert a bogus `preselect: [{ menuItemId: "<random uuid>", quantity: 1 }]` leaves the draft empty (best-effort catch) and the quote still exists. Clean up the created rows.
- [ ] **Step 2: Manual smoke on the PR preview** (Juan): `/order` → Add two subs → Start your order → intake → magic link → `/order/build` shows the two subs pre-seeded with the correct server-priced subtotal; empty-tray path still lands on an empty draft.
- [ ] **Step 3: Open PR** to main; ensure the CI `build` gate is green; hold for Juan's "merge #NNN".

---

## Self-review (against the spec)
- **Spec coverage:** A data-driven storefront (Task 2), B selection tray (Task 3), C pre-seed thread — `DraftIntake.preselect` + `createDraftFromIntake` (Task 1) + `parseIntake` whitelist (Task 1) + intake include (Task 4). Images map (Task 2). Build page unchanged (noted). Security: server re-resolves via `setDraftLines`/`resolveLines` (Task 1). v1 boundaries (packages = marketing CTAs, portions on build page, no image column) respected.
- **Placeholder scan:** none — concrete code + exact ids/keys (`co_order_preselect`, `CAPITOL_HILL_ID`, `MAX_PRESELECT=40`, qty 1–99).
- **Type consistency:** `preselect: DraftLineInput[]` on `DraftIntake`; `parsePreselect` emits `{menuItemId|itemId, quantity}` (assignable to `DraftLineInput`); the tray writes the same shape to `co_order_preselect`; `start-client` reads + forwards it verbatim; `setDraftLines(customerId, quoteId, DraftLineInput[], {isDelivery})` consumes it. `CateringMenuItem` fields (`kind`,`id`,`name`,`section`,`unitPriceCents`,`portionable`,`portionPricesCents`) used consistently in Tasks 2–3.
- **Known confirm-before-authoring at build time:** re-read `start-client.tsx` for the exact two POST call sites + intake object shape; confirm `loadPublicCateringMenu` is exported from `lib/portal/menu.ts` (vs re-exported); confirm `setDraftLines` is declared with `async function` (hoisted) so Task 1 Step 2 can call it before its definition — if it's a `const` arrow, move the pre-seed after its definition or hoist.
