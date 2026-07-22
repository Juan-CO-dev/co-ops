# Catering Package Configurator (sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Real code + a migration (0144) + a gated prod seed reconcile → ships as ONE PR through the CI `build` gate. CC (main loop) authors the migration (apply via Supabase MCP), the seed, and the sensitive D20/server layers (Tasks 1–5), owns all git + is SOLE reviewer of every diff; Sonnet builds the build-page configurator + marketing cards + review rendering (Tasks 6–8); a Fable read-only smoke in Task 9. Juan merges.

**Goal:** Make catering packages (lunch boxes, 3-/6-foot subs, platters) real, configurable, priced line items in the customer order flow — the customer composes each package on the build page next to the cart; `resolveLines` prices a `packageId` line; the picks are stored structurally.

**Architecture:** New `catering_quote_item_options` table stores the customer's slot picks (whole-sub allocation). `resolveLines` gains a `packageId` branch that prices `price_cents × qty` (D20) and validates picks against the package's real slot options; `setDraftLines`/`loadDraft` persist/hydrate the options. The public package loader exposes each package's slot(s) + pick-N + eligible options. The build page gets a Packages section + a configurator (pick-1 radio / pick-N whole-sub allocator); the marketing page carries an unconfigured package via the ⑤ preselect. W4a consumption + admin (sub-project C) are out of scope.

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4 (CSS-first, `co-*` tokens), TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + deny-all RLS), the existing `lib/portal/{menu,draft}.ts` + `lib/admin/catering/packages.ts` patterns.

**Branch:** `claude/catering-package-configurator` (off `origin/main` @ f0663cd; spec committed).

**Verification model (this repo has no unit-test framework for these libs):** each CC task gates on `npx tsc --noEmit` (exit 0); UI tasks additionally on `npx next build`; a final Fable read-only smoke (tsx) proves the loader + pricing + validation against prod. No pytest/jest — do NOT invent one.

---

## File structure
- **Create** `supabase/migrations/0144_catering_quote_item_options.sql` (Task 1).
- **Create** `scripts/seed/09-platter-slot-subs.ts` (Task 2).
- **Modify** `lib/portal/menu.ts` — `loadPublicCateringPackages` slots+options + `PackageSlot`/`PackageSlotOption` types + `leadTimeHours` (Task 3).
- **Modify** `lib/portal/draft.ts` — `DraftLineInput.packageOptions`, `ResolvedLine.options`, `resolveLines` package branch, `setDraftLines` option persistence, `loadDraft` option hydration + `packages`, `DraftItem.options` (Task 4).
- **Modify** `app/api/portal/order/draft/lines/route.ts` — pass `packageOptions` (Task 5).
- **Modify** `app/api/portal/magic-link/request/route.ts` — `parsePreselect` package entry (Task 5).
- **Modify** `lib/portal/draft.ts` `createDraftFromIntake` — map a package preselect entry (Task 5).
- **Modify** `app/order/build/page.tsx` (+ inline `PackageConfigurator`) — Packages section + configurator + package cart lines (Task 6).
- **Modify** `app/order/page.tsx` (+ `components/portal/StorefrontPackages.tsx` or extend the tray) — data-driven package cards + Add-to-order carry (Task 7).
- **Modify** `app/order/review/*` + `app/order/quote/[id]/*` — render a package line's composition (Task 8).

---

## Task 1: Migration 0144 — `catering_quote_item_options` (CC)

**Files:** Create `supabase/migrations/0144_catering_quote_item_options.sql`.

- [ ] **Step 1: Confirm 0144 is next** — Supabase MCP `list_migrations`; tail is `0143_item_sizes`. (Confirmed at plan time.)
- [ ] **Step 2: Apply via Supabase MCP `apply_migration`** (name `0144_catering_quote_item_options`). Deny-all split RLS mirroring `catering_package_slot_options` (0136) + `item_sizes` (0143) — never `FOR ALL`. `ON DELETE CASCADE` is load-bearing (setDraftLines hard-deletes the parent lines then re-inserts):
```sql
-- Migration 0144_catering_quote_item_options
-- Applied via Supabase MCP apply_migration on 2026-07-22.
-- Canonical reference: docs/superpowers/specs/2026-07-22-catering-package-configurator-design.md
--
-- Sub-project B: the customer's per-slot picks for a package cart line (whole-sub allocation).
-- ON DELETE CASCADE so the delete-then-reinsert cart replace in setDraftLines stays clean.
-- Deny-all config table (service-role/lib authority) — mirrors catering_package_slot_options.
create table public.catering_quote_item_options (
  id uuid primary key default gen_random_uuid(),
  quote_item_id uuid not null references public.catering_quote_items(id) on delete cascade,
  package_item_id uuid not null references public.catering_package_items(id),
  item_id uuid references public.items(id),
  menu_item_id uuid references public.menu_items(id),
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint catering_quote_item_options_one_ref check ((item_id is null) <> (menu_item_id is null))
);
create index catering_quote_item_options_quote_item_idx on public.catering_quote_item_options(quote_item_id);
alter table public.catering_quote_item_options enable row level security;
create policy catering_quote_item_options_no_user_insert on public.catering_quote_item_options for insert with check (false);
create policy catering_quote_item_options_no_user_update on public.catering_quote_item_options for update using (false);
create policy catering_quote_item_options_no_user_delete on public.catering_quote_item_options for delete using (false);
```
- [ ] **Step 3: Verify on prod** — MCP `execute_sql`:
  `select count(*) from catering_quote_item_options;` → 0; and confirm the FK is `ON DELETE CASCADE`:
  `select confdeltype from pg_constraint where conname like 'catering_quote_item_options_quote_item%' and contype='f';` → `c` (cascade).
- [ ] **Step 4: Write the repo file** `supabase/migrations/0144_catering_quote_item_options.sql` (exact SQL above with the provenance header) + commit.
```bash
git add supabase/migrations/0144_catering_quote_item_options.sql
git commit -m "feat(catering): migration 0144 — catering_quote_item_options"
```

---

## Task 2: Seed reconcile `09-platter-slot-subs.ts` (CC, gated on prod)

**Files:** Create `scripts/seed/09-platter-slot-subs.ts`. Re-read `scripts/seed/08-catering-sizes.ts` first for the exact idempotent + `SEED_DRY` + `pathToFileURL` + audit pattern.

The four piece-platters' choice line currently has `quantity` = **pieces** (8/16/32/48) and a `description` like "Choose your sub (×8)". Reconcile to **whole subs** = pieces/2 (halves default): 8→4, 16→8, 32→16, 48→24. Update the choice line's `quantity` + `description`. Match platters by `label_en IN ('8 pc platter','16 pc platter','32 pc platter','48 pc platter')` (both locations). Leave 3-/6-footers + lunch boxes untouched.

- [ ] **Step 1: Author the seed** — for each active piece-platter package (both locations), find its active `slot_type='choice'` line; compute `subs = pieces/2` where `pieces` is parsed from the platter label's leading number; set `quantity = subs` and `description = 'Choose your subs (×' || subs || ')'`. Idempotent (skip when already = subs). Audit `catering.kb.packages.line_item_update` per changed row with `metadata { package: label, pieces, subs, phase: "package_configurator_b" }`. Report platters not found (never fabricate). `pathToFileURL` guard.
```ts
/**
 * Sub-project B — reconcile platter choice slots from PIECES to WHOLE SUBS (halves default).
 * 8pc→4, 16pc→8, 32pc→16, 48pc→24. 3-/6-footers + lunch boxes untouched.
 * Run: SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/09-platter-slot-subs.ts  (dry)
 *      npx tsx --env-file=.env.local scripts/seed/09-platter-slot-subs.ts              (prod)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";
const PLATTERS = ["8 pc platter", "16 pc platter", "32 pc platter", "48 pc platter"];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");
  let updated = 0, unchanged = 0;
  const missing: string[] = [];
  for (const label of PLATTERS) {
    const pieces = Number(label.split(" ")[0]);      // "8 pc platter" → 8
    const subs = pieces / 2;                          // halves default
    const { data: pkgs } = await sb.from("catering_packages").select("id, label_en").eq("label_en", label).eq("active", true)
      .returns<Array<{ id: string; label_en: string }>>();
    if (!pkgs || pkgs.length === 0) { missing.push(label); continue; }
    for (const p of pkgs) {
      const { data: line } = await sb.from("catering_package_items").select("id, quantity, description")
        .eq("package_id", p.id).eq("slot_type", "choice").eq("active", true)
        .maybeSingle<{ id: string; quantity: number | string; description: string | null }>();
      if (!line) { missing.push(`${label} (choice line)`); continue; }
      const desc = `Choose your subs (×${subs})`;
      if (Number(line.quantity) === subs && line.description === desc) { unchanged++; continue; }
      updated++;
      if (!DRY) {
        const { error } = await sb.from("catering_package_items").update({ quantity: subs, description: desc }).eq("id", line.id);
        if (error) throw new Error(`update ${label}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "catering.kb.packages.line_item_update", resourceTable: "catering_package_items", resourceId: line.id, metadata: { package: label, pieces, subs, phase: "package_configurator_b" }, ipAddress: null, userAgent: null });
      }
    }
  }
  console.log(`\nPlatter slots: ${updated} updated, ${unchanged} unchanged.`);
  if (missing.length) { console.log("NOT found (skipped):"); for (const m of missing) console.log(`  - ${m}`); }
  console.log("Reconcile done.");
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```
- [ ] **Step 2: Dry-run** `SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/09-platter-slot-subs.ts` → expect 8 updated (4 platters × 2 locations), 0 missing. Present to Juan (GATE).
- [ ] **Step 3: (gate) Run on prod** after Juan's OK; read-back SQL: the four piece-platters' choice line `quantity` = 4/8/16/24 at both locations.
- [ ] **Step 4: Commit.**
```bash
git add scripts/seed/09-platter-slot-subs.ts
git commit -m "seed(catering): reconcile platter choice slots to whole-sub counts"
```

---

## Task 3: `loadPublicCateringPackages` slots + options (CC)

**Files:** Modify `lib/portal/menu.ts` (`loadPublicCateringPackages`, ~:131-187). Re-read it + `lib/admin/catering/packages.ts` `hydratePackages` (:259-289) for the options-load pattern to mirror. Re-read `lib/catering/menu.ts` `CateringPackage`/`PackageLine` types.

- [ ] **Step 1: Extend the types** in `lib/catering/menu.ts` (where `CateringPackage`/`PackageLine` live). Add above `CateringPackage`:
```ts
export interface PackageSlotOption { kind: "item" | "menu_item"; refId: string; name: string }
export interface PackageSlot { packageItemId: string; label: string; pickN: number; options: PackageSlotOption[] }
```
Add to `CateringPackage`:
```ts
  leadTimeHours: number | null;   // advisory
  slots: PackageSlot[];           // choice slots with their eligible options (sub-project B)
```
- [ ] **Step 2: Extend `loadPublicCateringPackages`** in `lib/portal/menu.ts`:
  - Add `lead_time_hours` to the packages `.select(...)`.
  - After the `catering_package_items` load, load the active slot options for the **choice** lines and resolve their names (mirror `hydratePackages`), building `slotsByPackage: Map<string, PackageSlot[]>`:
```ts
  // Choice slots + eligible options (sub-project B). Mirrors lib/admin/catering/packages.ts hydratePackages.
  const choiceLines = pkgItems.filter((r) => r.slot_type === "choice");
  const slotsByPackage = new Map<string, PackageSlot[]>();
  if (choiceLines.length > 0) {
    const lineIds = choiceLines.map((r) => r.id);
    const { data: optRows, error: oErr } = await sb.from("catering_package_slot_options")
      .select("id, package_item_id, item_id, menu_item_id, display_order")
      .in("package_item_id", lineIds).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; package_item_id: string; item_id: string | null; menu_item_id: string | null; display_order: number }>>();
    if (oErr) throw new Error(`loadPublicCateringPackages options: ${oErr.message}`);
    // resolve option names via the itemMap/menuMap already built for the fixed-line expansion,
    // extended to cover any option refs not already resolved:
    const optItemIds = [...new Set((optRows ?? []).map((o) => o.item_id).filter((v): v is string => v != null))];
    const optMenuIds = [...new Set((optRows ?? []).map((o) => o.menu_item_id).filter((v): v is string => v != null))];
    if (optItemIds.length) { const { data } = await sb.from("items").select("id, name").in("id", optItemIds).returns<Array<{ id: string; name: string }>>(); for (const x of data ?? []) itemMap.set(x.id, { name: x.name, priceCents: itemMap.get(x.id)?.priceCents ?? 0 }); }
    if (optMenuIds.length) { const { data } = await sb.from("menu_items").select("id, name").in("id", optMenuIds).returns<Array<{ id: string; name: string }>>(); for (const x of data ?? []) menuMap.set(x.id, { name: x.name, priceCents: menuMap.get(x.id)?.priceCents ?? 0 }); }
    const optionsByLine = new Map<string, PackageSlotOption[]>();
    for (const o of optRows ?? []) {
      const kind = o.menu_item_id ? ("menu_item" as const) : ("item" as const);
      const refId = (o.menu_item_id ?? o.item_id)!;
      const name = kind === "menu_item" ? menuMap.get(refId)?.name ?? "Item" : itemMap.get(refId)?.name ?? "Item";
      const arr = optionsByLine.get(o.package_item_id) ?? []; arr.push({ kind, refId, name }); optionsByLine.set(o.package_item_id, arr);
    }
    for (const line of choiceLines) {
      const arr = slotsByPackage.get(line.package_id) ?? [];
      arr.push({ packageItemId: line.id, label: (line.description && line.description.trim()) || "Choose", pickN: Number(line.quantity), options: optionsByLine.get(line.id) ?? [] });
      slotsByPackage.set(line.package_id, arr);
    }
  }
```
  - **Note:** the current `.select` on `catering_package_items` in this loader must include `id, slot_type, quantity, description` (add whatever's missing — it currently selects `package_id, item_id, menu_item_id, description, quantity`; add `id, slot_type`).
  - In the final `packages.map(...)`, add `leadTimeHours: p.lead_time_hours` and `slots: slotsByPackage.get(p.id) ?? []`. (The `p` row type + select must include `lead_time_hours`.)
- [ ] **Step 3: `tsc` clean; commit.**
```bash
git add lib/portal/menu.ts lib/catering/menu.ts
git commit -m "feat(catering): public package loader exposes slots + eligible options"
```

---

## Task 4: `resolveLines` package branch + draft plumbing (CC — D20)

**Files:** Modify `lib/portal/draft.ts`. Re-read `DraftLineInput` (:73-80), `DraftItem` (:82-94), `resolveLines` (:356-391), `setDraftLines` delete/insert (:438-448) + its return (:454-457), `loadDraft` select/map/return (:300-328).

- [ ] **Step 1: Extend the types.**
  - `DraftLineInput` add: `packageOptions?: Array<{ packageItemId: string; itemId?: string | null; menuItemId?: string | null; quantity: number }>;`
  - `DraftItem` add: `options: Array<{ packageItemId: string; itemId: string | null; menuItemId: string | null; quantity: number }>;`
  - `ResolvedLine` (:349-353) add: `options: Array<{ packageItemId: string; itemId: string | null; menuItemId: string | null; quantity: number }>;`
- [ ] **Step 2: Import the package loader** at the top of `resolveLines`-adjacent code: `loadPublicCateringPackages` is already exported from `lib/portal/menu.ts` (this file already imports `loadPublicCateringMenu` + `loadPublicPricingContext` from it — add `loadPublicCateringPackages`).
- [ ] **Step 3: `resolveLines` — load packages once + add the package branch.** After `const byKey = new Map(...)` (:360), add:
```ts
  const hasPackages = lines.some((l) => l.packageId != null && l.packageId !== "");
  const packages = hasPackages ? await loadPublicCateringPackages(locationId) : [];
  const pkgById = new Map(packages.map((p) => [p.id, p] as const));
```
  Add `options: []` to EVERY existing return in `resolveLines` (the sized-item, plain-item, and sub returns — 3 sites). Then, BEFORE the final `throw` (:389), insert the package branch:
```ts
    const packageId = l.packageId ?? null;
    if (packageId != null && packageId !== "") {
      const pkg = pkgById.get(packageId);
      if (!pkg) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown package`);
      const slotByItemId = new Map(pkg.slots.map((s) => [s.packageItemId, s] as const));
      const perSlotTotal = new Map<string, number>();
      const options = (l.packageOptions ?? []).map((o) => {
        const slot = slotByItemId.get(o.packageItemId);
        if (!slot) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown package slot`);
        const refKind: "item" | "menu_item" = o.menuItemId ? "menu_item" : "item";
        const refId = (o.menuItemId ?? o.itemId ?? "");
        if (!slot.options.some((opt) => opt.kind === refKind && opt.refId === refId)) {
          throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: not an eligible option`);
        }
        const q = Number(o.quantity);
        if (!Number.isInteger(q) || q <= 0 || q > MAX_LINE_QTY) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: invalid option quantity`);
        perSlotTotal.set(o.packageItemId, (perSlotTotal.get(o.packageItemId) ?? 0) + q);
        return { packageItemId: o.packageItemId, itemId: refKind === "item" ? refId : null, menuItemId: refKind === "menu_item" ? refId : null, quantity: q };
      });
      for (const slot of pkg.slots) {  // over-pick guard; under-pick allowed (advisory completeness)
        if ((perSlotTotal.get(slot.packageItemId) ?? 0) > slot.pickN) {
          throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: too many picks for “${slot.label}”`);
        }
      }
      const unitPriceCents = pkg.priceCents;
      return { itemId: null, menuItemId: null, packageId, sizeId: null, portion: null, description: pkg.labelEn, quantity, unitPriceCents, lineTotalCents: lineTotalCents(quantity, unitPriceCents), options, displayOrder: i };
    }
```
- [ ] **Step 4: `setDraftLines` — persist options.** Change the insert (:442-447) to capture ids, then insert options:
```ts
    const { data: insertedRows, error: insErr } = await sb.from("catering_quote_items").insert(resolved.map((l) => ({
      quote_id: quoteId, item_id: l.itemId, menu_item_id: l.menuItemId, package_id: l.packageId, size_id: l.sizeId,
      portion: l.portion, description: l.description, quantity: l.quantity,
      unit_price_cents: l.unitPriceCents, line_total_cents: l.lineTotalCents, display_order: l.displayOrder, created_by: null,
    }))).select("id, display_order");
    if (insErr) throw new Error(`setDraftLines insert: ${insErr.message}`);
    const idByOrder = new Map((insertedRows ?? []).map((r) => [r.display_order as number, r.id as string] as const));
    const optionRows = resolved.flatMap((l) => l.options.map((o) => ({
      quote_item_id: idByOrder.get(l.displayOrder)!, package_item_id: o.packageItemId,
      item_id: o.itemId, menu_item_id: o.menuItemId, quantity: o.quantity, created_by: null,
    })));
    if (optionRows.length > 0) {
      const { error: optErr } = await sb.from("catering_quote_item_options").insert(optionRows);
      if (optErr) throw new Error(`setDraftLines options insert: ${optErr.message}`);
    }
```
  Add `options: l.options` to the returned `items` map (:456).
- [ ] **Step 5: `loadDraft` — hydrate options + expose packages.** Add `loadPublicCateringPackages(row.location_id)` to the `Promise.all` (:300) so the return can carry `packages`. After `itemRows` load, batch-load the options for package lines:
```ts
  const packageLineIds = (itemRows ?? []).filter((r) => r.package_id).map((r) => r.id);
  const optionsByLine = new Map<string, Array<{ packageItemId: string; itemId: string | null; menuItemId: string | null; quantity: number }>>();
  if (packageLineIds.length > 0) {
    const { data: optRows, error: oErr } = await sb.from("catering_quote_item_options")
      .select("quote_item_id, package_item_id, item_id, menu_item_id, quantity")
      .in("quote_item_id", packageLineIds)
      .returns<Array<{ quote_item_id: string; package_item_id: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }>>();
    if (oErr) throw new Error(`loadDraft options: ${oErr.message}`);
    for (const o of optRows ?? []) {
      const arr = optionsByLine.get(o.quote_item_id) ?? [];
      arr.push({ packageItemId: o.package_item_id, itemId: o.item_id, menuItemId: o.menu_item_id, quantity: Number(o.quantity) });
      optionsByLine.set(o.quote_item_id, arr);
    }
  }
```
  Add `options: optionsByLine.get(r.id) ?? []` to the `DraftItem` map (:312-317). Add `packages` to the return object (:319-328): `packages,` (the resolved `loadPublicCateringPackages` result from the Promise.all).
- [ ] **Step 6: `createDraftFromIntake` maps a package preselect entry.** Find where `preselect` is mapped to `DraftLineInput[]` (grep `preselect` in draft.ts). Ensure a `{ packageId, quantity }` entry maps to `{ packageId, quantity }` (no options — unconfigured). If the existing map only handles item/menuItem, add the packageId branch.
- [ ] **Step 7: `tsc` clean; commit.**
```bash
git add lib/portal/draft.ts
git commit -m "feat(catering): resolveLines prices+validates a package line; persist/hydrate picks (D20)"
```

---

## Task 5: Routes — lines `packageOptions` + `parsePreselect` package entry (CC)

**Files:** Modify `app/api/portal/order/draft/lines/route.ts` (the line map, :37-45) and `app/api/portal/magic-link/request/route.ts` (`parsePreselect`, :33-50).

- [ ] **Step 1: lines route — pass `packageOptions` (shape-only; resolveLines re-validates).** In the `.map(...)` that builds `DraftLineInput`, add:
```ts
      packageId: typeof o.packageId === "string" ? o.packageId : null,
      packageOptions: Array.isArray(o.packageOptions)
        ? o.packageOptions.flatMap((raw) => {
            const p = (raw ?? {}) as Record<string, unknown>;
            if (typeof p.packageItemId !== "string") return [];
            return [{
              packageItemId: p.packageItemId,
              itemId: typeof p.itemId === "string" ? p.itemId : null,
              menuItemId: typeof p.menuItemId === "string" ? p.menuItemId : null,
              quantity: Number(p.quantity),
            }];
          })
        : undefined,
```
- [ ] **Step 2: `parsePreselect` — accept a package entry.** Widen the return type to `Array<{ menuItemId?: string; itemId?: string; sizeId?: string; packageId?: string; quantity: number }>`; in the loop:
```ts
    const packageId = typeof o.packageId === "string" && UUID_RE.test(o.packageId) ? o.packageId : undefined;
    // exactly one reference of the three
    if ([menuItemId, itemId, packageId].filter((v) => v !== undefined).length !== 1) continue;
```
  Replace the exactly-one item/menuItem check (`if ((menuItemId === undefined) === (itemId === undefined)) continue;`) with the three-way check above. Then push:
```ts
    out.push(
      packageId ? { packageId, quantity: q }
      : menuItemId ? { menuItemId, quantity: q }
      : { itemId, quantity: q, ...(sizeId ? { sizeId } : {}) },
    );
```
- [ ] **Step 3: `tsc` clean; commit.**
```bash
git add app/api/portal/order/draft/lines/route.ts app/api/portal/magic-link/request/route.ts
git commit -m "feat(catering): thread packageOptions + package preselect through the routes"
```

---

## Task 6: Build-page Packages section + `PackageConfigurator` (Sonnet)

**Files:** Modify `app/order/build/page.tsx` (+ an inline `PackageConfigurator` component, sibling of `CustomizeModal`).

**Context Sonnet needs (provide verbatim):** the build page drives everything from `draft` (a `DraftLoad`) which now carries `packages: CateringPackage[]` (each with `slots: Array<{ packageItemId, label, pickN, options: Array<{ kind, refId, name }> }>`, `priceCents`, `pricingMode`, `minHeadcount`, `leadTimeHours`) and `items[].options`. Cart persistence (D20) POSTs references only; a package line's payload = `{ packageId, quantity, packageOptions: Array<{ packageItemId, itemId?, menuItemId?, quantity }> }`. The build page cart is `Record<string, Line>`; **package entries key by a per-instance local id** (`crypto.randomUUID()` in the browser) so two differently-composed platters are two lines. `money(cents)` exists. Follow the existing `CustomizeModal`/`PortionSelector` styling + `co-*` tokens.

- [ ] **Step 1:** Extend the local `DraftLoad`/`DraftItem`/`Line` shapes to carry `packages` + package fields; add a **Packages section** to the menu column: for each `draft.packages`, a row (name, "from $X" = `money(priceCents)`, an advisory line "min N guests · Nh notice" from `minHeadcount`/`leadTimeHours`) with a **"Choose / Build →"** button that opens `PackageConfigurator`.
- [ ] **Step 2:** Build `PackageConfigurator` (modal, mirror `CustomizeModal` shell). For each slot:
  - `pickN === 1` → a **radio** list of `slot.options` (choose one).
  - `pickN > 1` → a **whole-sub allocator**: `[−] n [+]` per option with a running total "**{sum} of {pickN} subs**" (✓ when `sum === pickN`); show a "served as {pickN×2} pieces" info line (pieces = subs×2, halves). Never allow the per-slot sum to exceed `pickN`.
  - A package **quantity** stepper (default: `pricingMode === "per_head"` → `draft.lead?.headcount ?? 1`, else 1).
  - **Add** enabled only when every slot is complete (`sum === pickN`); on Add, write a cart entry keyed by a fresh `crypto.randomUUID()` with `{ packageId, quantity, packageOptions }` where each pick becomes `{ packageItemId, menuItemId|itemId (per option.kind), quantity }`. Editing an existing package line re-opens the configurator seeded from its current `packageOptions` and updates in place (same key).
- [ ] **Step 3:** Package **cart line** rendering: the package name + a picks summary built from its `packageOptions` (resolve names from the slot options: "Teamster ×2, Crunchy Boi ×1"), qty stepper, `money(priceCents × qty)`; a "Configure" link re-opens the modal. An **unconfigured** package line (carried from marketing → `packageOptions` empty) shows a "Choose your subs →" prompt.
- [ ] **Step 4:** `linesPayload` (the debounced POST body) includes package lines as `{ packageId, quantity, packageOptions }`. Hydration: a persisted package `DraftItem` (has `packageId` + `options`) becomes a cart entry keyed by its `r.id`, with `packageOptions` from `item.options`. Coverage: a package counts toward "mains" by `(sum of its packageOptions quantity) × qty`.
- [ ] **Step 5:** `npx tsc --noEmit` exit 0 AND `npx next build` succeeds. Commit `feat(catering): build-page Packages section + configurator`. (CC reviews the diff: D20 — payload carries references only; no client price; per-instance keying; over-pick impossible in UI.)

---

## Task 7: Marketing package cards + Add-to-order carry (Sonnet)

**Files:** Modify `app/order/page.tsx` (+ a small client component, e.g. `components/portal/StorefrontPackages.tsx`, since `page.tsx` is a Server Component and the carry needs `sessionStorage`).

**Context:** `app/order/page.tsx` already loads the menu + renders `StorefrontOrderTray` (a client island that writes `co_order_preselect` sessionStorage). Add a package load + a client package section that carries `{ packageId, quantity: 1 }` into the SAME preselect array. The preselect now accepts a package entry (Task 5). Keep the existing marketing visual style (the static `PLATTER_SIZES`/`BIG_SUBS` blocks can be replaced by data-driven cards OR kept visually with real ids wired in — prefer data-driven cards for real ids + prices).

- [ ] **Step 1:** In `app/order/page.tsx`, `await loadPublicCateringPackages(CAPITOL_HILL_ID)` (graceful `try/catch` → `[]`, like the menu). Pass to a new `StorefrontPackages` client component. Render package cards (name, `money(priceCents)`, min-headcount/lead advisory) grouped sensibly (platters / big subs / lunch boxes by label or `pricingMode`); each card has **"Add to order"** that appends `{ packageId, quantity: 1 }` to the `co_order_preselect` array in sessionStorage (read-modify-write; mirror `StorefrontOrderTray`'s write) and shows a confirmation (e.g. a floating pill or an added state). No configurator here.
- [ ] **Step 2:** `npx tsc --noEmit` + `npx next build` green. Commit `feat(catering): marketing package cards carry an unconfigured package to the order flow`. (CC reviews: carry writes references only; the build page configures.)

---

## Task 8: Review / quote package-line rendering (Sonnet)

**Files:** Modify the review surface (`app/order/review/*`) + the shared quote view (`app/order/quote/[id]/*`). Grep for where `DraftItem`/quote lines are rendered.

- [ ] **Step 1:** Where a quote/draft line list is rendered, a line with `packageId` (or `options.length > 0`) shows the package `description` + a composition summary from its `options` (resolve option names — the review surface already has the menu/packages, or resolve from `options` refs; if names aren't available, show "N subs"). Price + qty unchanged (server-authoritative). Read-only; no pricing logic.
- [ ] **Step 2:** `npx tsc --noEmit` + `npx next build` green. Commit `feat(catering): render a package line's composition on review + quote`. (CC reviews.)

---

## Task 9: Smoke + PR (Fable + CC)

- [ ] **Step 1: Fable read-only smoke** (`scripts/smoke-package-configurator.ts`, tsx, deleted after — NOT committed):
  - `loadPublicCateringPackages(CAP_HILL)` returns "Light Lunch" (a slot with `pickN === 1`, 15 options, `priceCents === 1200`) and "8 pc platter" (a slot with `pickN === 4` after the Task-2 reconcile, 5 options, `priceCents === 6000`).
  - A `setDraftLines`-backed `resolveLines` proof would create a draft (skip if it must write; prefer read-only). Instead, unit-check the validation shape by asserting the loader’s slot options exist and `pickN` is right; assert the migration table exists (`select count(*) from catering_quote_item_options` = 0).
  - `CAP_HILL = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a"`. Print `ALL PASS` / `N FAIL`; `process.exit(fails?1:0)`.
  Run: `npx tsx --env-file=.env.local scripts/smoke-package-configurator.ts` → ALL PASS. Delete the file.
- [ ] **Step 2: Manual smoke (preview, Juan)** — marketing "Add to order" on a package → build page shows it unconfigured → configure a lunch box (pick 1 sub) + an 8pc platter (allocate 4 subs) → both price correctly (Light Lunch $12, 8pc $60) → survive to review with the right composition + subtotal.
- [ ] **Step 3: Push the branch; open PR to main; CI `build` green; hold for "merge #NNN".**

---

## Self-review (against the spec)
- **Coverage:** migration (T1), seed reconcile pieces→subs (T2), loader slots+options (T3), `resolveLines` package branch + `packageOptions`/`options` + `setDraftLines` + `loadDraft` + `packages` (T4), routes `packageOptions` + `parsePreselect` package entry + `createDraftFromIntake` map (T4 S6 + T5), build-page Packages + configurator + cart line (T6), marketing carry (T7), review/quote render (T8), smoke (T9). W4a + admin correctly ABSENT (deferred).
- **Placeholder scan:** concrete SQL, seed code, loader code, resolveLines/setDraftLines/loadDraft edits, route edits; UI tasks give component contracts + exact payload/hydration shapes (Sonnet writes JSX) — matches the sub-project-A plan's UI-task convention.
- **Type consistency:** `PackageSlot { packageItemId, label, pickN, options }` + `PackageSlotOption { kind, refId, name }` (T3) are what `resolveLines` reads (`slot.options.some(opt => opt.kind===… && opt.refId===…)`, `slot.pickN`, `slot.packageItemId`) (T4) and what the configurator consumes (T6). `DraftLineInput.packageOptions` / `ResolvedLine.options` / `DraftItem.options` all use `{ packageItemId, itemId, menuItemId, quantity }`. `catering_quote_item_options` columns (`quote_item_id, package_item_id, item_id, menu_item_id, quantity`) match every read/write. Preselect package entry `{ packageId, quantity }` matches `DraftLineInput.packageId`.
- **RLS:** deny-all split (mirrors `catering_package_slot_options` + `item_sizes`), never `FOR ALL`; `ON DELETE CASCADE` justified by the setDraftLines delete-then-reinsert.
- **Confirm-before-authoring:** each CC task re-reads the exact current shapes (loader options pattern, resolveLines/setDraftLines/loadDraft, the RLS templates) and confirms 0144 is next before applying.
