# Admin Catering-Menu Manager (sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use `- [ ]`. Real code, **NO migration** (uses existing `items`/`menu_items` catering flags + `item_sizes` from migration 0143). Ships as ONE PR through the CI `build` gate. CC (main loop) authors the sensitive GM+/Tier-A write layers (Tasks 1–4), owns all git + is SOLE reviewer; Sonnet builds the extended `MenuClient` + i18n (Task 5); a Fable smoke in Task 6. Juan merges.

**Goal:** Turn the items-only `/admin/catering/menu` editor into the full catering-menu manager — manage `menu_items` (subs/resale) availability + a subs "portions" toggle, and fully manage per-item catering **sizes** (add/edit/deactivate).

**Architecture:** Extend `lib/admin/catering/menu.ts` to be kind-aware (`item` | `menu_item`) for both load + flag writes (+ `catering_portionable` for subs); add `lib/admin/catering/item-sizes.ts` for `item_sizes` CRUD (append-only, service-role, GM+, Tier-A). Extend the PATCH route with `kind`; add three size routes. Extend `MenuClient` with a menu_items list + an inline size editor. No new tables.

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4 (`co-*` tokens), TS strict + `noUncheckedIndexedAccess`, Supabase (service-role; `item_sizes` deny-all RLS — service-role is the authority), the admin two-tier step-up (`assertStepUp`), i18n (`serverT`/`useTranslation`, `en.json`/`es.json`).

**Branch:** `claude/catering-menu-admin` (off `origin/main` @ da347a2; spec committed).

**Verification model (no unit-test framework for these libs):** each CC task gates on `npx tsc --noEmit` (exit 0); the UI task additionally on `npx next build`; a final Fable smoke (tsx). GM+ (`MENU_ADMIN_MIN = 7`) + Tier-A step-up on every write, mirroring the existing route.

---

## File structure
- **Modify** `lib/admin/catering/menu.ts` — `AdminSize` + widened `AdminMenuItem`, `loadAdminCateringMenu`, kind-aware `setCateringFlags` (Task 1).
- **Create** `lib/admin/catering/item-sizes.ts` — `addItemSize`/`updateItemSize`/`deactivateItemSize` (Task 2).
- **Modify** `app/api/admin/catering/menu/[id]/route.ts` — `kind` + `cateringPortionable` (Task 3).
- **Create** `app/api/admin/catering/menu/[id]/sizes/route.ts` — POST add size (Task 3).
- **Create** `app/api/admin/catering/item-sizes/[sizeId]/route.ts` — PATCH/DELETE size (Task 3).
- **Modify** `app/admin/catering/menu/page.tsx` — call `loadAdminCateringMenu` (Task 4).
- **Modify** `components/admin/catering/menu/MenuClient.tsx` — menu_items list + portionable toggle + inline size editor + packages link (Task 5).
- **Modify** `lib/i18n/en.json` + `lib/i18n/es.json` — new keys (Task 5).

---

## Task 1: `lib/admin/catering/menu.ts` — kind-aware load + flags (CC)

Re-read the current file first (`AdminMenuItem`, `loadAdminMenuItems`, `setCateringFlags`, `MENU_ADMIN_MIN = 7`, `AdminCateringMenuError`, `requireLevel`).

- [ ] **Step 1: Add `AdminSize` + widen `AdminMenuItem`.** Replace the `AdminMenuItem` interface with:
```ts
export interface AdminSize {
  id: string;
  label: string;
  priceCents: number;
  serves: number | null;
  displayOrder: number;
  active: boolean;
}
export interface AdminMenuItem {
  id: string;
  kind: "item" | "menu_item";
  name: string;
  nameEs: string | null;
  section: string | null;
  menuPriceCents: number | null;
  cateringAvailable: boolean;
  cateringOnly: boolean;
  cateringPortionable: boolean | null; // subs only; null for items
  sizes: AdminSize[];                   // items only; [] for subs
}
```
- [ ] **Step 2: Add `loadAdminCateringMenu`** (items + subs + item sizes). Add below `loadAdminMenuItems` (leave `loadAdminMenuItems` in place for now; Task 4 removes it):
```ts
export async function loadAdminCateringMenu(actor: AuthContext): Promise<AdminMenuItem[]> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const [{ data: itemRows, error: iErr }, { data: subRows, error: sErr }] = await Promise.all([
    sb.from("items").select("id, name, name_es, section, menu_price, catering_available, catering_only")
      .eq("active", true).is("location_id", null)
      .order("section", { ascending: true, nullsFirst: false }).order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_available: boolean; catering_only: boolean }>>(),
    sb.from("menu_items").select("id, name, name_es, section, menu_price, catering_available, catering_only, catering_portionable")
      .eq("active", true)
      .order("section", { ascending: true, nullsFirst: false }).order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_available: boolean; catering_only: boolean; catering_portionable: boolean }>>(),
  ]);
  if (iErr) throw new Error(`loadAdminCateringMenu items: ${iErr.message}`);
  if (sErr) throw new Error(`loadAdminCateringMenu menu_items: ${sErr.message}`);

  const itemIds = (itemRows ?? []).map((r) => r.id);
  const sizesByItem = new Map<string, AdminSize[]>();
  if (itemIds.length > 0) {
    const { data: szRows, error: szErr } = await sb.from("item_sizes")
      .select("id, item_id, label, price_cents, serves, display_order, active")
      .in("item_id", itemIds).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; item_id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>>();
    if (szErr) throw new Error(`loadAdminCateringMenu sizes: ${szErr.message}`);
    for (const s of szRows ?? []) {
      const arr = sizesByItem.get(s.item_id) ?? [];
      arr.push({ id: s.id, label: s.label, priceCents: s.price_cents, serves: s.serves == null ? null : Number(s.serves), displayOrder: s.display_order, active: s.active });
      sizesByItem.set(s.item_id, arr);
    }
  }
  const toCents = (v: number | string | null) => (v != null ? Math.round(Number(v) * 100) : null);
  const items: AdminMenuItem[] = (itemRows ?? []).map((r) => ({
    id: r.id, kind: "item", name: r.name, nameEs: r.name_es, section: r.section,
    menuPriceCents: toCents(r.menu_price), cateringAvailable: r.catering_available, cateringOnly: r.catering_only,
    cateringPortionable: null, sizes: sizesByItem.get(r.id) ?? [],
  }));
  const subs: AdminMenuItem[] = (subRows ?? []).map((r) => ({
    id: r.id, kind: "menu_item", name: r.name, nameEs: r.name_es, section: r.section,
    menuPriceCents: toCents(r.menu_price), cateringAvailable: r.catering_available, cateringOnly: r.catering_only,
    cateringPortionable: r.catering_portionable, sizes: [],
  }));
  return [...items, ...subs];
}
```
- [ ] **Step 3: Make `setCateringFlags` kind-aware** (+ `cateringPortionable` for subs). Replace the existing `setCateringFlags` with:
```ts
export async function setCateringFlags(
  actor: AuthContext,
  kind: "item" | "menu_item",
  id: string,
  changes: { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean },
): Promise<{ cateringAvailable: boolean; cateringOnly: boolean; cateringPortionable: boolean | null }> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const table = kind === "menu_item" ? "menu_items" : "items";
  const cols = kind === "menu_item" ? "catering_available, catering_only, catering_portionable" : "catering_available, catering_only";
  const { data: cur, error: lErr } = await sb.from(table).select(cols)
    .eq("id", id).maybeSingle<{ catering_available: boolean; catering_only: boolean; catering_portionable?: boolean }>();
  if (lErr) throw new Error(`setCateringFlags load: ${lErr.message}`);
  if (!cur) throw new AdminCateringMenuError(404, "not_found", "Not found");

  let available = changes.cateringAvailable ?? cur.catering_available;
  let only = changes.cateringOnly ?? cur.catering_only;
  if (only) available = true;      // catering-only implies available
  if (!available) only = false;    // dropping availability drops only

  const update: Record<string, unknown> = { catering_available: available, catering_only: only, updated_by: actor.user.id, updated_at: new Date().toISOString() };
  let portionable: boolean | null = kind === "menu_item" ? (cur.catering_portionable ?? false) : null;
  if (kind === "menu_item" && changes.cateringPortionable !== undefined) {
    portionable = changes.cateringPortionable;
    update.catering_portionable = portionable;
  }

  const { error, count } = await sb.from(table).update(update, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`setCateringFlags update: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Not found");

  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.menu.set_flags",
    resourceTable: table, resourceId: id,
    metadata: { kind, catering_available: available, catering_only: only, ...(kind === "menu_item" ? { catering_portionable: portionable } : {}) },
    ipAddress: null, userAgent: null,
  });
  return { cateringAvailable: available, cateringOnly: only, cateringPortionable: portionable };
}
```
- [ ] **Step 4: `tsc` clean; commit.** (The existing PATCH route still calls `setCateringFlags(ctx, id, changes)` — 2 args — so tsc will FAIL until Task 3 updates the route. To keep this task green, Task 1 + Task 3's route change to the flags call **ship in one commit**: do Task 3 Step 1 (route `kind`) now, then commit. Alternatively verify tsc after Task 3. Simplest: run `tsc` after Task 3; commit Task 1 + Task 3-route together.) Once tsc is 0:
```bash
git add lib/admin/catering/menu.ts app/api/admin/catering/menu/[id]/route.ts
git commit -m "feat(catering): kind-aware admin catering-menu load + flags (items + subs + portions)"
```

---

## Task 2: `lib/admin/catering/item-sizes.ts` — size CRUD (CC)

**Files:** Create `lib/admin/catering/item-sizes.ts`. Re-read `lib/admin/catering/packages.ts` (normalize helpers, reactivate-or-reject, append-only, audit) + the `item_sizes` columns (migration 0143: `item_id, label, price_cents, serves, display_order, active, created_by, updated_by, updated_at`, `unique(item_id,label)`, deny-all RLS → service-role authority).

- [ ] **Step 1: Author the CRUD.**
```ts
/**
 * Admin item_sizes CRUD (sub-project C). SERVER-ONLY, service-role (item_sizes is deny-all RLS →
 * the lib is the authority). GM+ (MENU_ADMIN_MIN), append-only (deactivate, never DELETE — a live
 * draft's catering_quote_item_options / resolveLines tolerates a retired size). Audit every write.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { AdminCateringMenuError, MENU_ADMIN_MIN, type AdminSize } from "@/lib/admin/catering/menu";

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminCateringMenuError(403, "forbidden", "Insufficient role level");
}
function normLabel(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new AdminCateringMenuError(400, "invalid_size", "Size label is required");
  return s;
}
function normPrice(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new AdminCateringMenuError(400, "invalid_size", "Price must be a non-negative integer (cents)");
  return v;
}
function normServes(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new AdminCateringMenuError(400, "invalid_size", "Serves must be a positive number or blank");
  return v;
}

export async function addItemSize(actor: AuthContext, itemId: string, input: { label: unknown; priceCents: unknown; serves: unknown }): Promise<AdminSize> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const label = normLabel(input.label);
  const priceCents = normPrice(input.priceCents);
  const serves = normServes(input.serves);
  const sb = getServiceRoleClient();

  const { data: item, error: itErr } = await sb.from("items").select("id").eq("id", itemId).is("location_id", null).eq("active", true).maybeSingle<{ id: string }>();
  if (itErr) throw new Error(`addItemSize item: ${itErr.message}`);
  if (!item) throw new AdminCateringMenuError(404, "not_found", "Item not found");

  // unique(item_id,label): active dup → reject; inactive dup → reactivate + overwrite.
  const { data: existing } = await sb.from("item_sizes").select("id, active").eq("item_id", itemId).eq("label", label).maybeSingle<{ id: string; active: boolean }>();
  if (existing) {
    if (existing.active) throw new AdminCateringMenuError(409, "size_exists", "A size with that label already exists");
    const { data: reac, error: rErr } = await sb.from("item_sizes")
      .update({ active: true, price_cents: priceCents, serves, updated_by: actor.user.id, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("id, label, price_cents, serves, display_order, active").single<{ id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>();
    if (rErr) throw new Error(`addItemSize reactivate: ${rErr.message}`);
    void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.create", resourceTable: "item_sizes", resourceId: reac.id, metadata: { item_id: itemId, label, price_cents: priceCents, reactivated: true }, ipAddress: null, userAgent: null });
    return { id: reac.id, label: reac.label, priceCents: reac.price_cents, serves: reac.serves == null ? null : Number(reac.serves), displayOrder: reac.display_order, active: reac.active };
  }

  const { data: maxRow } = await sb.from("item_sizes").select("display_order").eq("item_id", itemId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const displayOrder = (maxRow?.display_order ?? -1) + 1;
  const { data: ins, error: iErr } = await sb.from("item_sizes")
    .insert({ item_id: itemId, label, price_cents: priceCents, serves, display_order: displayOrder, active: true, created_by: actor.user.id })
    .select("id, label, price_cents, serves, display_order, active").single<{ id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>();
  if (iErr) throw new Error(`addItemSize insert: ${iErr.message}`);
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.create", resourceTable: "item_sizes", resourceId: ins.id, metadata: { item_id: itemId, label, price_cents: priceCents }, ipAddress: null, userAgent: null });
  return { id: ins.id, label: ins.label, priceCents: ins.price_cents, serves: ins.serves == null ? null : Number(ins.serves), displayOrder: ins.display_order, active: ins.active };
}

export async function updateItemSize(actor: AuthContext, sizeId: string, changes: { label?: unknown; priceCents?: unknown; serves?: unknown }): Promise<AdminSize> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const { data: cur, error: lErr } = await sb.from("item_sizes").select("id, item_id, label").eq("id", sizeId).maybeSingle<{ id: string; item_id: string; label: string }>();
  if (lErr) throw new Error(`updateItemSize load: ${lErr.message}`);
  if (!cur) throw new AdminCateringMenuError(404, "not_found", "Size not found");

  const update: Record<string, unknown> = {};
  if ("label" in changes) {
    const label = normLabel(changes.label);
    if (label !== cur.label) {
      const { data: collide } = await sb.from("item_sizes").select("id").eq("item_id", cur.item_id).eq("label", label).eq("active", true).neq("id", sizeId).maybeSingle<{ id: string }>();
      if (collide) throw new AdminCateringMenuError(409, "size_exists", "A size with that label already exists");
      update.label = label;
    }
  }
  if ("priceCents" in changes) update.price_cents = normPrice(changes.priceCents);
  if ("serves" in changes) update.serves = normServes(changes.serves);
  if (Object.keys(update).length === 0) throw new AdminCateringMenuError(400, "invalid_size", "Nothing to update");
  update.updated_by = actor.user.id; update.updated_at = new Date().toISOString();

  const { data: upd, error, count } = await sb.from("item_sizes").update(update, { count: "exact" }).eq("id", sizeId)
    .select("id, label, price_cents, serves, display_order, active").single<{ id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>();
  if (error) throw new Error(`updateItemSize update: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Size not found");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.update", resourceTable: "item_sizes", resourceId: sizeId, metadata: { fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at") }, ipAddress: null, userAgent: null });
  return { id: upd.id, label: upd.label, priceCents: upd.price_cents, serves: upd.serves == null ? null : Number(upd.serves), displayOrder: upd.display_order, active: upd.active };
}

export async function deactivateItemSize(actor: AuthContext, sizeId: string): Promise<void> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("item_sizes").update({ active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" }).eq("id", sizeId).eq("active", true);
  if (error) throw new Error(`deactivateItemSize: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Size not found or already removed");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.deactivate", resourceTable: "item_sizes", resourceId: sizeId, metadata: {}, ipAddress: null, userAgent: null });
}
```
- [ ] **Step 2: `tsc` clean; commit.**
```bash
git add lib/admin/catering/item-sizes.ts
git commit -m "feat(catering): admin item_sizes CRUD (add/update/deactivate, append-only)"
```

---

## Task 3: Routes — kind flags + size POST/PATCH/DELETE (CC)

**Files:** Modify `app/api/admin/catering/menu/[id]/route.ts`; create `app/api/admin/catering/menu/[id]/sizes/route.ts` + `app/api/admin/catering/item-sizes/[sizeId]/route.ts`. Re-read the existing PATCH route (`requireSession`, `assertStepUp(ctx,"A")`, `jsonError`/`jsonOk`/`parseJsonBody`, `MENU_ADMIN_MIN`).

- [ ] **Step 1: Extend the flags PATCH route** — `kind` (required) + `cateringPortionable`. Replace the body-parsing + call:
```ts
  const b = parsed as Record<string, unknown>;
  const kind = b.kind === "menu_item" ? "menu_item" : b.kind === "item" ? "item" : null;
  if (!kind) return jsonError(400, "invalid_payload", { field: "kind" });
  const changes: { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean } = {};
  if ("cateringAvailable" in b) { if (typeof b.cateringAvailable !== "boolean") return jsonError(400, "invalid_payload", { field: "cateringAvailable" }); changes.cateringAvailable = b.cateringAvailable; }
  if ("cateringOnly" in b) { if (typeof b.cateringOnly !== "boolean") return jsonError(400, "invalid_payload", { field: "cateringOnly" }); changes.cateringOnly = b.cateringOnly; }
  if ("cateringPortionable" in b) { if (typeof b.cateringPortionable !== "boolean") return jsonError(400, "invalid_payload", { field: "cateringPortionable" }); changes.cateringPortionable = b.cateringPortionable; }
  if (Object.keys(changes).length === 0) return jsonError(400, "invalid_payload", { message: "No flags to set" });

  try {
    const result = await setCateringFlags(ctx, kind, id, changes);
    return jsonOk({ cateringAvailable: result.cateringAvailable, cateringOnly: result.cateringOnly, cateringPortionable: result.cateringPortionable });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
```
(This is the commit that pairs with Task 1 — commit them together so tsc stays green.)

- [ ] **Step 2: Create the add-size route** `app/api/admin/catering/menu/[id]/sizes/route.ts`:
```ts
// POST a new catering size to item [id] (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AdminCateringMenuError, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { addItemSize } from "@/lib/admin/catering/item-sizes";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/menu/${id}/sizes`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MENU_ADMIN_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  const b = parsed as Record<string, unknown>;
  try {
    const size = await addItemSize(ctx, id, { label: b.label, priceCents: b.priceCents, serves: b.serves ?? null });
    return jsonOk({ size });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: Create the edit/deactivate route** `app/api/admin/catering/item-sizes/[sizeId]/route.ts`:
```ts
// PATCH (edit) / DELETE (deactivate) a catering size (GM+ >= 7, Tier A step-up).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AdminCateringMenuError, MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { updateItemSize, deactivateItemSize } from "@/lib/admin/catering/item-sizes";

async function gate(req: NextRequest, sizeId: string) {
  const ctx = await requireSession(req, `/api/admin/catering/item-sizes/${sizeId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MENU_ADMIN_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);
  return ctx;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sizeId: string }> }) {
  const { sizeId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await gate(req, sizeId);
  if (ctx instanceof Response) return ctx;
  const b = parsed as Record<string, unknown>;
  const changes: { label?: unknown; priceCents?: unknown; serves?: unknown } = {};
  if ("label" in b) changes.label = b.label;
  if ("priceCents" in b) changes.priceCents = b.priceCents;
  if ("serves" in b) changes.serves = b.serves;
  try {
    const size = await updateItemSize(ctx, sizeId, changes);
    return jsonOk({ size });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sizeId: string }> }) {
  const { sizeId } = await params;
  const ctx = await gate(req, sizeId);
  if (ctx instanceof Response) return ctx;
  try {
    await deactivateItemSize(ctx, sizeId);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringMenuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```
- [ ] **Step 4: `tsc` clean; commit** (routes only — the flags route was committed with Task 1).
```bash
git add app/api/admin/catering/menu/[id]/sizes/route.ts app/api/admin/catering/item-sizes/[sizeId]/route.ts
git commit -m "feat(catering): admin size routes (add/edit/deactivate item_sizes)"
```

---

## Task 4: Page loader (CC)

**Files:** Modify `app/admin/catering/menu/page.tsx`.

- [ ] **Step 1: Switch to `loadAdminCateringMenu`.** Change the import `loadAdminMenuItems` → `loadAdminCateringMenu` and the call `const items = await loadAdminMenuItems(auth);` → `const items = await loadAdminCateringMenu(auth);`. Then remove the now-unused `loadAdminMenuItems` export from `lib/admin/catering/menu.ts` (it has no other callers — grep `loadAdminMenuItems` to confirm before deleting).
- [ ] **Step 2: `tsc` clean; commit.**
```bash
git add app/admin/catering/menu/page.tsx lib/admin/catering/menu.ts
git commit -m "feat(catering): admin menu page loads items + subs + sizes"
```

---

## Task 5: `MenuClient` extension + i18n (Sonnet)

**Files:** Modify `components/admin/catering/menu/MenuClient.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`.

**Context Sonnet needs (provide verbatim):** the client receives `items: AdminMenuItem[]` where each is `{ id, kind: "item"|"menu_item", name, nameEs, section, menuPriceCents, cateringAvailable, cateringOnly, cateringPortionable: boolean|null, sizes: Array<{ id, label, priceCents, serves: number|null, displayOrder, active }> }` (kind `item` → `cateringPortionable` is null + may have `sizes`; kind `menu_item` → `sizes` is []). Writes use the existing **Tier-A step-up retry** pattern already in this file (`PasswordModal`; on `step_up_required`/`step_up_stale`, open the modal + retry the pending action). Follow the existing `Toggle` component + `co-*` tokens + `co-card` + the money helper + `useTranslation`.

- [ ] **Step 1: Flags PATCH now carries `kind`.** Change `apply(id, changes)` → `apply(id, kind, changes)` and send `body: JSON.stringify({ kind, ...changes })`. Split the rendered list into two grouped sections: **Menu items** (`kind==="item"`) and **À la carte subs & sides** (`kind==="menu_item"`), each grouped by `section` (reuse the existing group-by-section logic per list). An `item` row keeps available/only toggles; a `menu_item` row gets available/only **and** a **portions** toggle (`cateringPortionable`, calls `apply(id, "menu_item", { cateringPortionable: !it.cateringPortionable })`). On `ok`, patch local state from the returned `{ cateringAvailable, cateringOnly, cateringPortionable }`.
- [ ] **Step 2: Inline size editor** (items only). Each `item` row gets an expand toggle ("Sizes (N)") that opens a panel listing its `sizes` (label + `money(priceCents)` + `serves ?? "—"`), each with **Edit** (inline fields: label / price in dollars→cents / serves) → `PATCH /api/admin/catering/item-sizes/${sizeId}` `{ label, priceCents, serves }`, and **Remove** → `DELETE /api/admin/catering/item-sizes/${sizeId}` (drops the row from local state on ok). An **"+ Add size"** row (label / price / serves) → `POST /api/admin/catering/menu/${itemId}/sizes` `{ label, priceCents, serves }` (append the returned `size` to local state on ok). All size writes go through the SAME step-up-retry wrapper as the flag toggles (a `step_up_required`/`step_up_stale` code re-opens `PasswordModal` and retries the pending size action). Price inputs are in **dollars** in the UI; convert to integer cents before sending (`Math.round(dollars * 100)`). Errors map to `admin.catering.menu.error.*` (add `size_exists`, `invalid_size`).
- [ ] **Step 3: Packages link.** A small `co-card` link to `/admin/catering/packages` ("Edit catering packages →").
- [ ] **Step 4: i18n.** Add keys to `en.json` + `es.json` under `admin.catering.menu.*`: `menu_items_heading`, `items_heading`, `portionable`, `sizes` ("Sizes"), `add_size`, `size_label`, `size_price`, `size_serves`, `size_save`, `size_remove`, `size_edit`, `error.size_exists`, `error.invalid_size`, plus the packages link `edit_packages`. Spanish operational/tú-form. (The client's `KNOWN` error set + `errKey` must include `size_exists`, `invalid_size`.)
- [ ] **Step 5:** `npx tsc --noEmit` exit 0 AND `npx next build` succeeds. Commit `feat(catering): admin menu manager UI — subs, portions, inline size editor`. (CC reviews: kind carried on every flag write; size price converted to cents client-side; step-up retry wraps every write; append-only remove = DELETE→deactivate.)

---

## Task 6: Smoke + PR (Fable + CC)

- [ ] **Step 1: Fable smoke** (`scripts/smoke-menu-admin.ts`, tsx, deleted after — NOT committed): build a fake GM `AuthContext` (level 7 — reuse a real seed user id / role, or the pattern from other admin smokes) and:
  - `loadAdminCateringMenu(actor)` returns both kinds — assert at least one `kind:"item"` with `sizes.length>0` (Tuna) and one `kind:"menu_item"` with `cateringPortionable` a boolean.
  - `setCateringFlags(actor, "menu_item", <a sub id>, { cateringOnly: true })` → returns `cateringAvailable:true` (only⇒available); flip it back (`{ cateringOnly:false, cateringAvailable:true }`) to leave prod unchanged.
  - `addItemSize(actor, <tuna id>, { label:"__smoke__", priceCents:999, serves:1 })` → then `updateItemSize` price → then `deactivateItemSize` (cleans up the throwaway). Assert `size_exists` on a duplicate active label.
  Run `npx tsx --env-file=.env.local scripts/smoke-menu-admin.ts` → ALL PASS; delete the file.
- [ ] **Step 2: Manual smoke (preview, Juan):** at `/admin/catering/menu` — toggle a sub off/on; toggle a sub's portions; expand Tuna → edit a size price → add a size → remove it; relabel "½ pint" → "6 oz"; confirm `/order` reflects it. (Tier-A step-up prompts on first write.)
- [ ] **Step 3: Push; open PR to main; CI `build` green; hold for "merge #NNN".**

---

## Self-review (against the spec)
- **Coverage:** menu_items management + portions toggle (T1 lib + T3 route + T5 UI), item_sizes CRUD (T2 lib + T3 routes + T5 UI), page loader (T4), packages link (T5), i18n (T5), smoke (T6). No migration / no reconcile (per spec — pre-config already matches Toast; 6oz relabel is Juan-in-editor). Packages editing correctly absent (W1b).
- **Placeholder scan:** concrete lib + route code for CC tasks; a precise component + payload + i18n contract for the Sonnet task (mirrors A/B plans). No TBD.
- **Type consistency:** `AdminSize {id,label,priceCents,serves,displayOrder,active}` + widened `AdminMenuItem` (T1) are what item-sizes.ts returns (T2), what the routes pass (T3), what the loader provides (T4), what MenuClient consumes (T5). `setCateringFlags(actor, kind, id, changes)` signature matches the route call (T3). Size route payloads (`{label, priceCents, serves}`) match `addItemSize`/`updateItemSize`.
- **Auth:** GM+ (`MENU_ADMIN_MIN=7`) + `assertStepUp(ctx,"A")` on every write; `only⇒available` server-enforced; deactivate-not-delete for sizes.
- **tsc-green ordering:** Task 1 (lib flags signature change) commits together with Task 3 Step 1 (route call) so the 2-arg→3-arg change never leaves tsc red; noted in both tasks.
- **Confirm-before-authoring:** each CC task re-reads the exact current menu.ts / route / item_sizes columns / packages.ts conventions before authoring.
