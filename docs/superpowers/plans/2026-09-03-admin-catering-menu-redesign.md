# Admin Catering Menu Redesign (Option 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Menu tab of `/admin/catering/menu` as one list in customer order with source badges, plain-English controls, a legend, filters, and a read-only customer preview — no schema or API change.

**Architecture:** A pure, tested view module (`lib/admin/catering/menu-view-shared.ts`) groups and filters `AdminMenuItem` rows using the order builder's own grouping helpers (`lib/portal/menu-order-shared.ts`), so admin and customer views share one rule. `MenuClient.tsx` keeps only state and the step-up write path; presentation splits into `MenuLegend`, `MenuToolbar`, `MenuSectionList`, `MenuRow`, `MenuPreview`. The existing `Toggle`, `ServesBox`, and `SizeEditor` move into `MenuRow.tsx` unchanged.

**Tech Stack:** Next.js 16 App Router (client components), React 19, Tailwind v4 tokens (`co-*`), vitest, the repo i18n (`en.json`/`es.json`, flat dotted keys; `TranslationKey = keyof typeof en`).

**Spec:** `docs/superpowers/specs/2026-09-03-admin-catering-menu-redesign-design.md`

**Ground rules for this plan**
- Branch: `feat/admin-menu-redesign` off `origin/main`. Commit per task. Never push to main; open a PR at the end.
- `npm test -- <file>` runs one vitest file. `npm run typecheck` = `tsc --noEmit`. `npx eslint <files>` for lint (warnings are tolerated, errors are not).
- Every new visible string ships in BOTH `lib/i18n/en.json` and `lib/i18n/es.json` in the same commit (house law). Keys are flat: `"admin.catering.menu.<name>": "..."`.
- `lib/admin/catering/menu.ts` is server-only. Import from it with `import type` ONLY (types erase; a value import would leak the service-role client into a client bundle and fail the build).
- Design-system floor: every control `min-h-[44px]` + `items-center`; toggles keep today's `Toggle` spelling; group label = 12px/700/`tracking-wide`/`text-co-text-muted`; sub label = 10–11px/700/`tracking-[0.12em]`/`text-co-text-dim`.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/admin/catering/menu-view-shared.ts` (create) | Pure: `groupAdminRows`, `filterAdminRows`, `sectionSummary`, `rowBadges`, `MenuFilterChip`, `MenuGroup`, `RowBadge`. Zero I/O. |
| `tests/admin-menu-view.test.ts` (create) | Unit tests for the module above. |
| `lib/i18n/en.json`, `lib/i18n/es.json` (modify) | New `admin.catering.menu.*` keys. |
| `components/admin/catering/menu/MenuRow.tsx` (create) | One row: name, badges, source line, controls, sizes disclosure. Hosts `Toggle`, `ServesBox`, `SizeEditor` (moved verbatim from `MenuClient.tsx`). |
| `components/admin/catering/menu/MenuSectionList.tsx` (create) | Packages card + one `CollapsibleSection` per group with the "N on the menu of M" header. |
| `components/admin/catering/menu/MenuToolbar.tsx` (create) | Filter chips, search box, "Preview as customer" switch. |
| `components/admin/catering/menu/MenuLegend.tsx` (create) | Legend card with remembered dismissal. |
| `components/admin/catering/menu/MenuPreview.tsx` (create) | Read-only customer rendering of the grouped rows. |
| `components/admin/catering/menu/MenuClient.tsx` (rewrite) | State (`items`, chip, query, preview, expanded, step-up) + `apiWrite` + composition. |
| `components/admin/catering/menu/MenuTabs.tsx` (modify) | Passes `packageCount` through. |
| `app/admin/catering/menu/page.tsx` (modify) | Loads active package count via `loadPackages`. |

---

### Task 1: Pure view module — grouping

**Files:**
- Create: `lib/admin/catering/menu-view-shared.ts`
- Test: `tests/admin-menu-view.test.ts`

- [ ] **Step 1: Create the branch**

```bash
cd ~/co-ops && git fetch origin && git checkout -q -b feat/admin-menu-redesign origin/main && git log --oneline -1
```

- [ ] **Step 2: Write the failing grouping tests**

Create `tests/admin-menu-view.test.ts`:

```ts
// Admin catering menu — view logic (lib/admin/catering/menu-view-shared.ts).
// The admin list groups rows EXACTLY as the customer order builder does (shared helpers in
// lib/portal/menu-order-shared.ts), so a manager sees the same "Sides" a customer sees.
import { describe, expect, it } from "vitest";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import { filterAdminRows, groupAdminRows, rowBadges, sectionSummary } from "@/lib/admin/catering/menu-view-shared";

function row(over: Partial<AdminMenuItem> & { name: string }): AdminMenuItem {
  return {
    id: over.name.toLowerCase().replace(/\s+/g, "-"),
    kind: "menu_item",
    nameEs: null,
    section: "Subs",
    menuPriceCents: 1000,
    cateringAvailable: true,
    cateringOnly: false,
    cateringPortionable: null,
    serves: null,
    seasonal: false,
    sizes: [],
    ...over,
  };
}

const CATALOG: AdminMenuItem[] = [
  row({ name: "Coke", section: "Drinks" }),
  row({ name: "24 Mixed Sodas", section: "Catering Drinks", cateringOnly: true, serves: 24 }),
  row({ name: "Deli Pickle", section: "Sides" }),
  row({ name: "Case of Mini Chips (24)", section: "Catering Sides", cateringOnly: true, serves: 24 }),
  row({ name: "Utz Original Chips", section: "Chips" }),
  row({ name: "Egg Salad", section: "Sides", kind: "item", nameEs: "Ensalada de huevo" }),
  row({ name: "Berger Cookies- Large", section: "Sweets" }),
  row({ name: "Crunchy Boi", section: "Subs", cateringPortionable: true }),
  row({ name: "Build Your Own Sub", section: "Build Your Own" }),
  row({ name: "Hidden Thing", section: "Gear", cateringAvailable: false }),
  row({ name: "No Section", section: null }),
];

describe("groupAdminRows", () => {
  it("merges Toast headings into one section per type, in customer order, mains keep their headings", () => {
    const groups = groupAdminRows(CATALOG);
    expect(groups.map((g) => g.label)).toEqual(["Drinks", "Sides", "Desserts", "Subs", "Build Your Own", "Gear", "More"]);
  });

  it("remembers which Toast sections fed a merged group", () => {
    const sides = groupAdminRows(CATALOG).find((g) => g.label === "Sides")!;
    expect(sides.rawSections).toEqual(["Sides", "Catering Sides", "Chips"]);
  });

  it("inside a section, catering-only rows come first; otherwise input order is kept", () => {
    const sides = groupAdminRows(CATALOG).find((g) => g.label === "Sides")!;
    expect(sides.rows.map((r) => r.name)).toEqual(["Case of Mini Chips (24)", "Deli Pickle", "Utz Original Chips", "Egg Salad"]);
  });

  it("drops nothing and never mutates the input", () => {
    const copy = CATALOG.map((r) => ({ ...r }));
    const total = groupAdminRows(CATALOG).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(CATALOG.length);
    expect(CATALOG).toEqual(copy);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/admin-menu-view.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin/catering/menu-view-shared'`.

- [ ] **Step 4: Write the module (grouping only for now)**

Create `lib/admin/catering/menu-view-shared.ts`:

```ts
/**
 * Admin catering menu — VIEW logic, pure (zero I/O, client-safe).
 *
 * Juan (2026-09-03): the admin screen's functions were right, its labels and grouping were
 * wrong — "3 sides sections… not properly labeled so you know exactly what you're changing".
 * This module makes the admin list read the way the customer order builder reads, by using the
 * builder's own grouping helpers, and it answers "what is this row?" before a toggle is touched.
 *
 * Type-only import from the server module: `AdminMenuItem` erases at build; this file must never
 * import a value from lib/admin/catering/menu.ts (service-role client behind it).
 */
import type { AdminMenuItem } from "./menu";
import { orderSections, orderWithinSection, sectionLabel } from "@/lib/portal/menu-order-shared";

export interface MenuGroup {
  /** Portal heading — "Drinks" | "Sides" | "Desserts" | a main-course Toast heading | "More". */
  label: string;
  /** The raw Toast sections that fed this group, in first-seen order (shown as "Toast: …"). */
  rawSections: string[];
  rows: AdminMenuItem[];
}

/** Group rows exactly as the order builder does: sectionLabel → customer order → catering-only first. */
export function groupAdminRows(items: readonly AdminMenuItem[]): MenuGroup[] {
  const map = new Map<string, { rawSections: string[]; rows: AdminMenuItem[] }>();
  for (const it of items) {
    const label = sectionLabel(it.section);
    const g = map.get(label) ?? { rawSections: [], rows: [] };
    const raw = it.section && it.section.trim() ? it.section : "";
    if (raw && !g.rawSections.includes(raw)) g.rawSections.push(raw);
    g.rows.push(it);
    map.set(label, g);
  }
  return orderSections(
    Array.from(map.entries()).map(([label, g]) => ({ label, rawSections: g.rawSections, rows: orderWithinSection(g.rows) })),
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/admin-menu-view.test.ts`
Expected: PASS (4 tests). If `filterAdminRows`/`rowBadges`/`sectionSummary` imports fail at runtime before their `describe` blocks exist, that is expected only in Task 2 — at this step the file imports names that do not exist yet, so **temporarily** keep only `groupAdminRows` in the import line, and add the others back in Task 2.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/catering/menu-view-shared.ts tests/admin-menu-view.test.ts
git commit -m "feat(admin-menu): pure grouping in customer order (shared with the builder)"
```

---

### Task 2: Pure view module — filters, summary, badges

**Files:**
- Modify: `lib/admin/catering/menu-view-shared.ts`
- Test: `tests/admin-menu-view.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/admin-menu-view.test.ts` (and restore the full import line: `filterAdminRows, groupAdminRows, rowBadges, sectionSummary`):

```ts
describe("filterAdminRows", () => {
  it("chips", () => {
    const names = (chip: Parameters<typeof filterAdminRows>[1]["chip"]) => filterAdminRows(CATALOG, { chip, query: "" }).map((r) => r.name);
    expect(names("all")).toHaveLength(CATALOG.length);
    expect(names("hidden")).toEqual(["Hidden Thing"]);
    expect(names("on_menu")).not.toContain("Hidden Thing");
    expect(names("on_menu")).toHaveLength(CATALOG.length - 1);
    expect(names("toast")).not.toContain("Egg Salad");
    expect(names("catering")).toEqual(["Egg Salad"]);
  });

  it("search matches name and Spanish name, case-insensitive, trimmed", () => {
    expect(filterAdminRows(CATALOG, { chip: "all", query: "  coke " }).map((r) => r.name)).toEqual(["Coke"]);
    expect(filterAdminRows(CATALOG, { chip: "all", query: "ENSALADA" }).map((r) => r.name)).toEqual(["Egg Salad"]);
    expect(filterAdminRows(CATALOG, { chip: "all", query: "zzz" })).toEqual([]);
  });

  it("chip and search combine", () => {
    expect(filterAdminRows(CATALOG, { chip: "hidden", query: "coke" })).toEqual([]);
    expect(filterAdminRows(CATALOG, { chip: "on_menu", query: "chips" }).map((r) => r.name)).toEqual(["Case of Mini Chips (24)", "Utz Original Chips"]);
  });

  it("empty groups disappear after filtering", () => {
    const groups = groupAdminRows(filterAdminRows(CATALOG, { chip: "all", query: "coke" }));
    expect(groups.map((g) => g.label)).toEqual(["Drinks"]);
  });
});

describe("sectionSummary", () => {
  it("counts rows customers can order against the total", () => {
    const gear = groupAdminRows(CATALOG).find((g) => g.label === "Gear")!;
    expect(sectionSummary(gear.rows)).toEqual({ on: 0, total: 1 });
    const sides = groupAdminRows(CATALOG).find((g) => g.label === "Sides")!;
    expect(sectionSummary(sides.rows)).toEqual({ on: 4, total: 4 });
  });
});

describe("rowBadges", () => {
  it("names the source, then the flags, in a fixed order", () => {
    expect(rowBadges(row({ name: "a" }))).toEqual(["toast_item"]);
    expect(rowBadges(row({ name: "b", kind: "item" }))).toEqual(["catering_item"]);
    expect(rowBadges(row({ name: "c", cateringOnly: true }))).toEqual(["toast_item", "catering_only"]);
    expect(rowBadges(row({ name: "d", kind: "item", cateringOnly: true, seasonal: true, cateringAvailable: false }))).toEqual([
      "catering_item",
      "catering_only",
      "seasonal",
      "hidden",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test -- tests/admin-menu-view.test.ts`
Expected: FAIL — `filterAdminRows is not a function` (and the others).

- [ ] **Step 3: Implement filters, summary, badges**

Append to `lib/admin/catering/menu-view-shared.ts`:

```ts
export type MenuFilterChip = "all" | "on_menu" | "hidden" | "toast" | "catering";

/** Chip predicate + case-insensitive substring search over name and Spanish name. Pure. */
export function filterAdminRows(items: readonly AdminMenuItem[], f: { chip: MenuFilterChip; query: string }): AdminMenuItem[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((it) => {
    if (f.chip === "on_menu" && !it.cateringAvailable) return false;
    if (f.chip === "hidden" && it.cateringAvailable) return false;
    if (f.chip === "toast" && it.kind !== "menu_item") return false;
    if (f.chip === "catering" && it.kind !== "item") return false;
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || (it.nameEs ?? "").toLowerCase().includes(q);
  });
}

/** "N on the menu of M" for a section header. */
export function sectionSummary(rows: readonly AdminMenuItem[]): { on: number; total: number } {
  return { on: rows.reduce((n, r) => n + (r.cateringAvailable ? 1 : 0), 0), total: rows.length };
}

export type RowBadge = "toast_item" | "catering_item" | "catering_only" | "seasonal" | "hidden";

/** What a row IS, in a fixed reading order: source → catering-only → seasonal → hidden. */
export function rowBadges(it: AdminMenuItem): RowBadge[] {
  const out: RowBadge[] = [it.kind === "menu_item" ? "toast_item" : "catering_item"];
  if (it.cateringOnly) out.push("catering_only");
  if (it.seasonal) out.push("seasonal");
  if (!it.cateringAvailable) out.push("hidden");
  return out;
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `npm test -- tests/admin-menu-view.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/admin/catering/menu-view-shared.ts tests/admin-menu-view.test.ts
git commit -m "feat(admin-menu): pure filters, section summary, row badges"
```

---

### Task 3: i18n keys (English + Spanish)

**Files:**
- Modify: `lib/i18n/en.json` (insert after the line `"admin.catering.menu.section_available": "{n} available",` — line ~3603)
- Modify: `lib/i18n/es.json` (insert after `"admin.catering.menu.section_available": "{n} disponibles",` — line ~3603)

- [ ] **Step 1: Add the English keys**

Insert after the `section_available` line in `lib/i18n/en.json` (keep the trailing comma discipline of the surrounding lines):

```json
  "admin.catering.menu.legend_title": "How this list works",
  "admin.catering.menu.legend_body": "Toast items come from the store menu and are named in Toast. Catering items exist only here — tubs, cases, waters — and get their sizes and prices here. Rows appear to customers under the same headings you see below, in the same order.",
  "admin.catering.menu.legend_dismiss": "Got it",
  "admin.catering.menu.chip_all": "All",
  "admin.catering.menu.chip_on_menu": "On menu",
  "admin.catering.menu.chip_hidden": "Hidden",
  "admin.catering.menu.chip_toast": "Toast items",
  "admin.catering.menu.chip_catering": "Catering items",
  "admin.catering.menu.chips_aria": "Filter the catering menu",
  "admin.catering.menu.search_placeholder": "Search items…",
  "admin.catering.menu.search_aria": "Search catering menu items",
  "admin.catering.menu.preview_toggle": "Preview as customer",
  "admin.catering.menu.preview_hint": "Read-only. Shows only what customers can order, in the order they see it.",
  "admin.catering.menu.preview_empty": "Nothing is on the catering menu yet.",
  "admin.catering.menu.preview_from": "from {price}",
  "admin.catering.menu.preview_feeds": "feeds {n}",
  "admin.catering.menu.badge_toast_item": "Toast item",
  "admin.catering.menu.badge_catering_item": "Catering item",
  "admin.catering.menu.badge_catering_only": "Catering only",
  "admin.catering.menu.badge_seasonal": "Seasonal",
  "admin.catering.menu.badge_hidden": "Hidden from customers",
  "admin.catering.menu.source_line": "Toast: {section}",
  "admin.catering.menu.label_on_menu": "On catering menu",
  "admin.catering.menu.hint_on_menu": "Customers can order this for catering. Off hides it from the order builder.",
  "admin.catering.menu.label_catering_only": "Catering only",
  "admin.catering.menu.hint_catering_only": "Sold only through catering, not on the store menu. Turning this on also turns on \"On catering menu\".",
  "admin.catering.menu.label_portion": "Sold by portion",
  "admin.catering.menu.hint_portion": "Customers may order a quarter, half, or whole.",
  "admin.catering.menu.label_feeds": "Feeds",
  "admin.catering.menu.label_feeds_suffix": "people",
  "admin.catering.menu.hint_feeds": "People covered by one unit. A 24-bag case feeds 24. Blank = 1.",
  "admin.catering.menu.hint_sizes": "Catering sizes with their own price and feeds count (pint, 32 oz, case).",
  "admin.catering.menu.section_summary": "{on} on the menu of {total}",
  "admin.catering.menu.section_drinks": "Drinks",
  "admin.catering.menu.section_sides": "Sides",
  "admin.catering.menu.section_desserts": "Desserts",
  "admin.catering.menu.section_more": "More",
  "admin.catering.menu.packages_title": "Packages",
  "admin.catering.menu.packages_body": "Packages are built on their own page. Customers see them first.",
  "admin.catering.menu.packages_count": "{n} active",
  "admin.catering.menu.packages_link": "Open packages →",
  "admin.catering.menu.no_results": "No items match this filter.",
```

- [ ] **Step 2: Add the Spanish keys**

Insert after the `section_available` line in `lib/i18n/es.json`:

```json
  "admin.catering.menu.legend_title": "Cómo funciona esta lista",
  "admin.catering.menu.legend_body": "Los artículos de Toast vienen del menú de la tienda y se nombran en Toast. Los artículos de catering existen solo aquí — envases, cajas, aguas — y aquí reciben sus tamaños y precios. Los clientes ven las filas bajo los mismos encabezados que ves abajo, en el mismo orden.",
  "admin.catering.menu.legend_dismiss": "Entendido",
  "admin.catering.menu.chip_all": "Todos",
  "admin.catering.menu.chip_on_menu": "En el menú",
  "admin.catering.menu.chip_hidden": "Ocultos",
  "admin.catering.menu.chip_toast": "Artículos de Toast",
  "admin.catering.menu.chip_catering": "Artículos de catering",
  "admin.catering.menu.chips_aria": "Filtrar el menú de catering",
  "admin.catering.menu.search_placeholder": "Buscar artículos…",
  "admin.catering.menu.search_aria": "Buscar artículos del menú de catering",
  "admin.catering.menu.preview_toggle": "Ver como cliente",
  "admin.catering.menu.preview_hint": "Solo lectura. Muestra solo lo que los clientes pueden pedir, en el orden en que lo ven.",
  "admin.catering.menu.preview_empty": "Todavía no hay nada en el menú de catering.",
  "admin.catering.menu.preview_from": "desde {price}",
  "admin.catering.menu.preview_feeds": "rinde {n}",
  "admin.catering.menu.badge_toast_item": "Artículo de Toast",
  "admin.catering.menu.badge_catering_item": "Artículo de catering",
  "admin.catering.menu.badge_catering_only": "Solo catering",
  "admin.catering.menu.badge_seasonal": "De temporada",
  "admin.catering.menu.badge_hidden": "Oculto para clientes",
  "admin.catering.menu.source_line": "Toast: {section}",
  "admin.catering.menu.label_on_menu": "En el menú de catering",
  "admin.catering.menu.hint_on_menu": "Los clientes pueden pedirlo para catering. Apagado lo oculta del armador de pedidos.",
  "admin.catering.menu.label_catering_only": "Solo catering",
  "admin.catering.menu.hint_catering_only": "Se vende solo por catering, no en el menú de la tienda. Encenderlo también enciende \"En el menú de catering\".",
  "admin.catering.menu.label_portion": "Por porción",
  "admin.catering.menu.hint_portion": "Los clientes pueden pedir un cuarto, mitad o entero.",
  "admin.catering.menu.label_feeds": "Rinde",
  "admin.catering.menu.label_feeds_suffix": "personas",
  "admin.catering.menu.hint_feeds": "Personas que cubre una unidad. Una caja de 24 bolsas rinde 24. Vacío = 1.",
  "admin.catering.menu.hint_sizes": "Tamaños de catering con su propio precio y rendimiento (pinta, 32 oz, caja).",
  "admin.catering.menu.section_summary": "{on} en el menú de {total}",
  "admin.catering.menu.section_drinks": "Bebidas",
  "admin.catering.menu.section_sides": "Acompañamientos",
  "admin.catering.menu.section_desserts": "Postres",
  "admin.catering.menu.section_more": "Más",
  "admin.catering.menu.packages_title": "Paquetes",
  "admin.catering.menu.packages_body": "Los paquetes se arman en su propia página. Los clientes los ven primero.",
  "admin.catering.menu.packages_count": "{n} activos",
  "admin.catering.menu.packages_link": "Abrir paquetes →",
  "admin.catering.menu.no_results": "Ningún artículo coincide con este filtro.",
```

- [ ] **Step 3: Verify the JSON parses and typecheck still passes**

Run: `node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('lib/i18n/es.json','utf8')); console.log('json ok')" && npm run typecheck`
Expected: `json ok`, then no `tsc` errors.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "i18n(admin-menu): plain-English controls, badges, legend, preview, chips (en+es)"
```

---

### Task 4: `MenuRow.tsx` — the row, with `Toggle`/`ServesBox`/`SizeEditor` moved in

**Files:**
- Create: `components/admin/catering/menu/MenuRow.tsx`

Behavior is unchanged for every control; only the words and the arrangement change. `Toggle`, `ServesBox`, `SizeEditor` are copied verbatim from `MenuClient.tsx` (they are deleted from there in Task 8).

- [ ] **Step 1: Create `MenuRow.tsx`**

```tsx
"use client";

/**
 * MenuRow — one catering-menu row: name, badges (what this row IS), the Toast section it came
 * from, plain-English controls, and the sizes disclosure for registry items. Hosts Toggle /
 * ServesBox / SizeEditor (moved verbatim from MenuClient). Behavior of every control is unchanged;
 * the words and the arrangement are the redesign (Juan, 2026-09-03).
 */

import { useState } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import type { AdminMenuItem, AdminSize } from "@/lib/admin/catering/menu";
import { rowBadges, type RowBadge } from "@/lib/admin/catering/menu-view-shared";

export type FlagChanges = { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean; serves?: number | null };
export type SizeInput = { label: string; priceCents: number; serves: number | null };
export type T = (k: TranslationKey, params?: Record<string, string | number>) => string;

const BADGE_KEY: Record<RowBadge, TranslationKey> = {
  toast_item: "admin.catering.menu.badge_toast_item",
  catering_item: "admin.catering.menu.badge_catering_item",
  catering_only: "admin.catering.menu.badge_catering_only",
  seasonal: "admin.catering.menu.badge_seasonal",
  hidden: "admin.catering.menu.badge_hidden",
};
const BADGE_CLS: Record<RowBadge, string> = {
  toast_item: "bg-co-surface-inset text-co-text-muted",
  catering_item: "bg-co-gold/20 text-co-text",
  catering_only: "bg-co-gold/20 text-co-text",
  seasonal: "bg-co-surface-inset text-co-text-muted",
  hidden: "bg-co-warning-surface text-co-warning-text",
};

export function MenuRow({ item, canWrite, language, money, t, expanded, onToggleExpand, onFlags, onAddSize, onEditSize, onRemoveSize }: {
  item: AdminMenuItem;
  canWrite: boolean;
  language: string;
  money: (c: number | null) => string;
  t: T;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onFlags: (it: AdminMenuItem, changes: FlagChanges) => void;
  onAddSize: (itemId: string, input: SizeInput) => void;
  onEditSize: (itemId: string, sizeId: string, input: SizeInput) => void;
  onRemoveSize: (itemId: string, sizeId: string) => void;
}) {
  const badges = rowBadges(item);
  const hidden = !item.cateringAvailable;
  return (
    <li className={`co-card p-3 ${hidden ? "opacity-70" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-co-text">{language === "es" ? item.nameEs ?? item.name : item.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {badges.map((b) => (
              <span key={b} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${BADGE_CLS[b]}`}>{t(BADGE_KEY[b])}</span>
            ))}
            <span className="text-xs text-co-text-dim">{money(item.menuPriceCents)}</span>
          </span>
          {item.section && item.section.trim() && (
            <span className="mt-0.5 block text-[11px] text-co-text-dim">{t("admin.catering.menu.source_line", { section: item.section })}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          <ServesBox it={item} canWrite={canWrite} onSave={(x, v) => onFlags(x, { serves: v })} t={t} />
          {item.kind === "item" && (
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              title={t("admin.catering.menu.hint_sizes")}
              aria-expanded={expanded}
              className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text"
            >
              {t("admin.catering.menu.sizes")} ({item.sizes.length}){expanded ? " ▾" : " ▸"}
            </button>
          )}
          <Toggle label={t("admin.catering.menu.label_on_menu")} hint={t("admin.catering.menu.hint_on_menu")} on={item.cateringAvailable} disabled={!canWrite} onClick={() => onFlags(item, { cateringAvailable: !item.cateringAvailable })} />
          <Toggle label={t("admin.catering.menu.label_catering_only")} hint={t("admin.catering.menu.hint_catering_only")} on={item.cateringOnly} disabled={!canWrite} onClick={() => onFlags(item, { cateringOnly: !item.cateringOnly })} />
          {item.kind === "menu_item" && (
            <Toggle label={t("admin.catering.menu.label_portion")} hint={t("admin.catering.menu.hint_portion")} on={item.cateringPortionable === true} disabled={!canWrite} onClick={() => onFlags(item, { cateringPortionable: !(item.cateringPortionable === true) })} />
          )}
        </span>
      </div>
      {item.kind === "item" && expanded && (
        <SizeEditor item={item} canWrite={canWrite} t={t} money={money} onAdd={onAddSize} onEdit={onEditSize} onRemove={onRemoveSize} />
      )}
    </li>
  );
}

function ServesBox({ it, canWrite, onSave, t }: { it: AdminMenuItem; canWrite: boolean; onSave: (it: AdminMenuItem, serves: number | null) => void; t: T }) {
  const [draft, setDraft] = useState(it.serves != null ? String(it.serves) : "");
  const dirty = draft !== (it.serves != null ? String(it.serves) : "");
  const save = () => {
    const v = draft.trim() === "" ? null : Number(draft);
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
    onSave(it, v);
  };
  return (
    <label className="flex items-center gap-1 text-xs text-co-text-dim" title={t("admin.catering.menu.hint_feeds")}>
      {t("admin.catering.menu.label_feeds")}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (dirty) save(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal"
        placeholder="1"
        disabled={!canWrite}
        aria-label={t("admin.catering.menu.hint_feeds")}
        className="min-h-[44px] w-12 rounded-md border border-co-border-2 bg-co-surface px-1.5 py-0.5 text-xs font-bold text-co-text"
      />
      {t("admin.catering.menu.label_feeds_suffix")}
    </label>
  );
}

function Toggle({ label, hint, on, disabled, onClick }: { label: string; hint: string; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={hint}
      className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
        on ? "border-co-gold bg-co-surface-2 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
      }`}
    >
      {label}
    </button>
  );
}

/** Inline catering-size editor for a sized item: list + edit + remove + add. Prices in dollars → cents. (Moved verbatim from MenuClient.) */
function SizeEditor({ item, canWrite, t, money, onAdd, onEdit, onRemove }: {
  item: AdminMenuItem;
  canWrite: boolean;
  t: T;
  money: (c: number | null) => string;
  onAdd: (itemId: string, input: SizeInput) => void;
  onEdit: (itemId: string, sizeId: string, input: SizeInput) => void;
  onRemove: (itemId: string, sizeId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eServes, setEServes] = useState("");
  const [aLabel, setALabel] = useState("");
  const [aPrice, setAPrice] = useState("");
  const [aServes, setAServes] = useState("");

  const toCents = (dollars: string) => Math.round(parseFloat(dollars) * 100);
  const parseServes = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : null; };
  const validPrice = (dollars: string) => { const c = toCents(dollars); return Number.isFinite(c) && c >= 0; };

  const startEdit = (s: AdminSize) => { setEditing(s.id); setELabel(s.label); setEPrice((s.priceCents / 100).toFixed(2)); setEServes(s.serves != null ? String(s.serves) : ""); };
  const saveEdit = (sizeId: string) => { if (!eLabel.trim() || !validPrice(ePrice)) return; onEdit(item.id, sizeId, { label: eLabel.trim(), priceCents: toCents(ePrice), serves: parseServes(eServes) }); setEditing(null); };
  const add = () => { if (!aLabel.trim() || !validPrice(aPrice)) return; onAdd(item.id, { label: aLabel.trim(), priceCents: toCents(aPrice), serves: parseServes(aServes) }); setALabel(""); setAPrice(""); setAServes(""); };

  const inputCls = "min-h-[44px] rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text";
  const btnCls = "inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text disabled:opacity-50";

  return (
    <div className="mt-2 rounded-xl border border-co-border/60 bg-co-bg/40 p-3">
      <ul className="flex flex-col gap-1.5">
        {item.sizes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
            {editing === s.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label={t("admin.catering.menu.size_label")} value={eLabel} onChange={(e) => setELabel(e.target.value)} placeholder={t("admin.catering.menu.size_label")} className={`${inputCls} w-28`} />
                <input aria-label={t("admin.catering.menu.size_price")} value={ePrice} onChange={(e) => setEPrice(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_price")} className={`${inputCls} w-20`} />
                <input aria-label={t("admin.catering.menu.size_serves")} value={eServes} onChange={(e) => setEServes(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_serves")} className={`${inputCls} w-16`} />
                <button type="button" onClick={() => saveEdit(s.id)} className={btnCls}>{t("admin.catering.menu.size_save")}</button>
                <button type="button" onClick={() => setEditing(null)} className={btnCls}>{t("admin.catering.menu.size_cancel")}</button>
              </div>
            ) : (
              <>
                <span className="text-sm text-co-text">{s.label} · {money(s.priceCents)}{s.serves != null ? ` · ${t("admin.catering.menu.preview_feeds", { n: s.serves })}` : ""}</span>
                {canWrite && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => startEdit(s)} className={btnCls}>{t("admin.catering.menu.size_edit")}</button>
                    <button type="button" onClick={() => onRemove(item.id, s.id)} className={btnCls}>{t("admin.catering.menu.size_remove")}</button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-co-border/50 pt-2">
          <input aria-label={t("admin.catering.menu.size_label")} value={aLabel} onChange={(e) => setALabel(e.target.value)} placeholder={t("admin.catering.menu.size_label")} className={`${inputCls} w-28`} />
          <input aria-label={t("admin.catering.menu.size_price")} value={aPrice} onChange={(e) => setAPrice(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_price")} className={`${inputCls} w-20`} />
          <input aria-label={t("admin.catering.menu.size_serves")} value={aServes} onChange={(e) => setAServes(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_serves")} className={`${inputCls} w-16`} />
          <button type="button" onClick={add} className={btnCls}>+ {t("admin.catering.menu.add_size")}</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint the new file**

Run: `npm run typecheck && npx eslint components/admin/catering/menu/MenuRow.tsx`
Expected: no errors (the file is not yet imported anywhere; that is fine).

- [ ] **Step 3: Commit**

```bash
git add components/admin/catering/menu/MenuRow.tsx
git commit -m "feat(admin-menu): MenuRow with badges, source line, plain-English controls"
```

---

### Task 5: `MenuSectionList.tsx` — packages card + grouped sections

**Files:**
- Create: `components/admin/catering/menu/MenuSectionList.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

/**
 * MenuSectionList — the Packages card first (customers see packages first), then one
 * CollapsibleSection per group in CUSTOMER order (grouping computed by the caller via
 * groupAdminRows). Header = translated group label + "N on the menu of M" (D5) + the raw Toast
 * sections that fed the group. Sections with ≤ 6 rows default open (existing rule).
 */

import type { ReactNode } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import { sectionSummary, type MenuGroup } from "@/lib/admin/catering/menu-view-shared";
import type { T } from "./MenuRow";

/** Merged labels are code-owned words → translated; Toast headings are tenant data → verbatim. */
export function groupTitle(label: string, t: T): string {
  const key: Record<string, TranslationKey> = {
    Drinks: "admin.catering.menu.section_drinks",
    Sides: "admin.catering.menu.section_sides",
    Desserts: "admin.catering.menu.section_desserts",
    More: "admin.catering.menu.section_more",
  };
  const k = key[label];
  return k ? t(k) : label;
}

export function MenuSectionList({ groups, packageCount, t, renderRow }: {
  groups: MenuGroup[];
  packageCount: number;
  t: T;
  renderRow: (item: AdminMenuItem) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="co-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-co-text">{t("admin.catering.menu.packages_title")}</span>
          <span className="block text-xs text-co-text-muted">{t("admin.catering.menu.packages_body")}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-co-text-muted">{t("admin.catering.menu.packages_count", { n: packageCount })}</span>
          <a href="/admin/catering/packages" className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold text-co-text transition hover:text-co-cta-text">
            {t("admin.catering.menu.packages_link")}
          </a>
        </span>
      </div>

      {groups.length === 0 && <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.no_results")}</p>}

      {groups.map((g) => {
        const s = sectionSummary(g.rows);
        const id = `menu-section-${g.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        return (
          <CollapsibleSection
            key={g.label}
            idBase={id}
            title={groupTitle(g.label, t)}
            count={t("admin.catering.menu.section_summary", { on: s.on, total: s.total })}
            defaultOpen={g.rows.length <= 6}
            badge={
              g.rawSections.length > 0 && (g.rawSections.length > 1 || g.rawSections[0] !== g.label) ? (
                <span className="text-[11px] text-co-text-dim">{t("admin.catering.menu.source_line", { section: g.rawSections.join(" · ") })}</span>
              ) : null
            }
          >
            <ul className="flex flex-col gap-1.5">{g.rows.map((it) => renderRow(it))}</ul>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/admin/catering/menu/MenuSectionList.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/catering/menu/MenuSectionList.tsx
git commit -m "feat(admin-menu): MenuSectionList — packages card + grouped sections with summaries"
```

---

### Task 6: `MenuToolbar.tsx` + `MenuLegend.tsx`

**Files:**
- Create: `components/admin/catering/menu/MenuToolbar.tsx`
- Create: `components/admin/catering/menu/MenuLegend.tsx`

- [ ] **Step 1: Create the toolbar**

```tsx
"use client";

/** MenuToolbar — filter chips (single select) + search + "Preview as customer" switch. Pure client state, owned by MenuClient. */

import type { TranslationKey } from "@/lib/i18n/types";
import type { MenuFilterChip } from "@/lib/admin/catering/menu-view-shared";
import type { T } from "./MenuRow";

const CHIPS: Array<{ id: MenuFilterChip; key: TranslationKey }> = [
  { id: "all", key: "admin.catering.menu.chip_all" },
  { id: "on_menu", key: "admin.catering.menu.chip_on_menu" },
  { id: "hidden", key: "admin.catering.menu.chip_hidden" },
  { id: "toast", key: "admin.catering.menu.chip_toast" },
  { id: "catering", key: "admin.catering.menu.chip_catering" },
];

export function MenuToolbar({ chip, onChip, query, onQuery, preview, onPreview, t }: {
  chip: MenuFilterChip;
  onChip: (c: MenuFilterChip) => void;
  query: string;
  onQuery: (q: string) => void;
  preview: boolean;
  onPreview: (v: boolean) => void;
  t: T;
}) {
  const chipCls = (on: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold transition ${
      on ? "border-co-gold bg-co-surface-2 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div role="group" aria-label={t("admin.catering.menu.chips_aria")} className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => onChip(c.id)} className={chipCls(chip === c.id)}>
            {t(c.key)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("admin.catering.menu.search_placeholder")}
          aria-label={t("admin.catering.menu.search_aria")}
          className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text lg:w-56"
        />
        <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 text-xs font-bold text-co-text" title={t("admin.catering.menu.preview_hint")}>
          <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} className="h-5 w-5 accent-co-gold" />
          {t("admin.catering.menu.preview_toggle")}
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the legend**

```tsx
"use client";

/**
 * MenuLegend — two sentences that explain the two sources. Open by default; dismissal is a
 * per-browser convenience remembered in localStorage (wrapped in try/catch — storage may be
 * unavailable, in which case the card simply renders open).
 */

import { useEffect, useState } from "react";

import type { T } from "./MenuRow";

const KEY = "co.admin.menu.legend.v1";

export function MenuLegend({ t }: { t: T }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "dismissed") setDismissed(true);
    } catch {
      /* storage unavailable → stay open */
    }
  }, []);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(KEY, "dismissed"); } catch { /* ignore */ }
  };
  return (
    <div className="co-card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("admin.catering.menu.legend_title")}</span>
        <span className="mt-1 block text-sm text-co-text">{t("admin.catering.menu.legend_body")}</span>
      </span>
      <button type="button" onClick={dismiss} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold text-co-text-dim transition hover:text-co-text">
        {t("admin.catering.menu.legend_dismiss")}
      </button>
    </div>
  );
}
```

Note: `useEffect` + `setState` is used ONLY to read storage after hydration (a synchronous read during render would mismatch the server HTML). ESLint's `react-hooks/set-state-in-effect` may warn; that is acceptable here and mirrors existing hydration-safe reads in the repo. If it reports an **error** instead, replace the effect with `useSyncExternalStore` reading the key with a `() => false` server snapshot.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/admin/catering/menu/MenuToolbar.tsx components/admin/catering/menu/MenuLegend.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin/catering/menu/MenuToolbar.tsx components/admin/catering/menu/MenuLegend.tsx
git commit -m "feat(admin-menu): toolbar (chips, search, preview switch) + legend card"
```

---

### Task 7: `MenuPreview.tsx` — read-only customer rendering

**Files:**
- Create: `components/admin/catering/menu/MenuPreview.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

/**
 * MenuPreview — "what does a customer see under this heading?" The SAME grouped rows as the
 * editor, read-only, showing only rows customers can order, with price ("from" for sized rows),
 * feeds, and the catering-only tag. No cart, no pricing rules — a labeling aid, not the builder.
 */

import type { AdminMenuItem } from "@/lib/admin/catering/menu";
import type { MenuGroup } from "@/lib/admin/catering/menu-view-shared";
import { groupTitle } from "./MenuSectionList";
import type { T } from "./MenuRow";

export function MenuPreview({ groups, language, money, t }: {
  groups: MenuGroup[];
  language: string;
  money: (c: number | null) => string;
  t: T;
}) {
  const visible = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.cateringAvailable) }))
    .filter((g) => g.rows.length > 0);
  if (visible.length === 0) return <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.preview_empty")}</p>;

  const priceOf = (it: AdminMenuItem) => {
    if (it.kind === "item" && it.sizes.length > 0) {
      const min = Math.min(...it.sizes.map((s) => s.priceCents));
      return t("admin.catering.menu.preview_from", { price: money(min) });
    }
    return money(it.menuPriceCents);
  };

  return (
    <div className="flex flex-col gap-6" aria-label={t("admin.catering.menu.preview_toggle")}>
      <p className="text-xs text-co-text-muted">{t("admin.catering.menu.preview_hint")}</p>
      {visible.map((g) => (
        <section key={g.label}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{groupTitle(g.label, t)}</h2>
          <ul className="flex flex-col divide-y divide-co-border/60 overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
            {g.rows.map((it) => (
              <li key={`${it.kind}:${it.id}`} className="flex items-center justify-between gap-4 p-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-extrabold text-co-text">{language === "es" ? it.nameEs ?? it.name : it.name}</span>
                    {it.cateringOnly && <span className="rounded-full bg-co-gold/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">{t("admin.catering.menu.badge_catering_only")}</span>}
                  </span>
                  {it.serves != null && <span className="text-[11px] text-co-text-dim">{t("admin.catering.menu.preview_feeds", { n: it.serves })}</span>}
                </span>
                <span className="shrink-0 text-sm font-bold text-co-cta-text">{priceOf(it)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/admin/catering/menu/MenuPreview.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/catering/menu/MenuPreview.tsx
git commit -m "feat(admin-menu): read-only customer preview"
```

---

### Task 8: Rewrite `MenuClient.tsx` and wire `packageCount`

**Files:**
- Rewrite: `components/admin/catering/menu/MenuClient.tsx`
- Modify: `components/admin/catering/menu/MenuTabs.tsx`
- Modify: `app/admin/catering/menu/page.tsx`

- [ ] **Step 1: Replace `MenuClient.tsx` with state + write path + composition**

Overwrite the file with:

```tsx
"use client";

/**
 * MenuClient — GM+ catering-menu manager. Owns STATE and the ONE WRITE PATH (`apiWrite`, Tier-A
 * step-up retry via PasswordModal) and composes the presentation: legend → toolbar → either the
 * grouped editor (MenuSectionList + MenuRow) or the read-only customer preview (MenuPreview).
 * Grouping/filtering is pure (lib/admin/catering/menu-view-shared.ts) and shared with the order
 * builder, so admin and customer can never disagree about what "Sides" is.
 * catering_only implies available (server-enforced; the UI reflects the returned state).
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { AdminMenuItem, AdminSize } from "@/lib/admin/catering/menu";
import { filterAdminRows, groupAdminRows, type MenuFilterChip } from "@/lib/admin/catering/menu-view-shared";
import { MenuLegend } from "./MenuLegend";
import { MenuToolbar } from "./MenuToolbar";
import { MenuSectionList } from "./MenuSectionList";
import { MenuPreview } from "./MenuPreview";
import { MenuRow, type FlagChanges, type SizeInput } from "./MenuRow";

const KNOWN = new Set(["forbidden", "not_found", "invalid_payload", "invalid_size", "invalid_serves", "size_exists", "step_up_required", "step_up_stale", "generic"]);
function errKey(code: string): TranslationKey {
  return (KNOWN.has(code) ? `admin.catering.menu.error.${code}` : "admin.catering.menu.error.generic") as TranslationKey;
}

export function MenuClient({ items: initial, canWrite, packageCount }: { items: AdminMenuItem[]; canWrite: boolean; packageCount: number }) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<AdminMenuItem[]>(initial);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chip, setChip] = useState<MenuFilterChip>("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);

  const money = useCallback(
    (c: number | null) => (c != null ? new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(c / 100) : "—"),
    [language],
  );

  // One write path for every action (flags + sizes). On a step-up challenge, stash the retry + open
  // the modal; on confirm it re-runs. onOk gets the parsed JSON body to patch local state.
  const apiWrite = useCallback(async (url: string, method: string, body: unknown, onOk: (data: Record<string, unknown>) => void) => {
    setErrorKey(null);
    let res: Response;
    try {
      res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
    } catch {
      setErrorKey("admin.catering.menu.error.generic");
      return;
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      onOk(data);
      setStepUpOpen(false);
      pendingRef.current = null;
      return;
    }
    const b = (await res.json().catch(() => ({}))) as { code?: string };
    if (b.code === "step_up_required" || b.code === "step_up_stale") {
      pendingRef.current = () => apiWrite(url, method, body, onOk);
      setStepUpOpen(true);
      return;
    }
    setErrorKey(errKey(b.code ?? "generic"));
  }, []);

  const setFlags = useCallback((it: AdminMenuItem, changes: FlagChanges) =>
    apiWrite(`/api/admin/catering/menu/${it.id}`, "PATCH", { kind: it.kind, ...changes }, (data) => {
      const d = data as { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean | null };
      setItems((prev) => prev.map((x) => (x.id === it.id && x.kind === it.kind
        ? { ...x, cateringAvailable: d.cateringAvailable ?? x.cateringAvailable, cateringOnly: d.cateringOnly ?? x.cateringOnly, cateringPortionable: d.cateringPortionable ?? x.cateringPortionable, serves: "serves" in changes ? (changes.serves ?? null) : x.serves }
        : x)));
    }), [apiWrite]);

  const addSize = useCallback((itemId: string, input: SizeInput) =>
    apiWrite(`/api/admin/catering/menu/${itemId}/sizes`, "POST", input, (data) => {
      const s = (data as { size?: AdminSize }).size;
      if (!s) return;
      setItems((prev) => prev.map((x) => (x.id === itemId && x.kind === "item" ? { ...x, sizes: [...x.sizes, s] } : x)));
    }), [apiWrite]);

  const editSize = useCallback((itemId: string, sizeId: string, input: SizeInput) =>
    apiWrite(`/api/admin/catering/item-sizes/${sizeId}`, "PATCH", input, (data) => {
      const s = (data as { size?: AdminSize }).size;
      if (!s) return;
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, sizes: x.sizes.map((z) => (z.id === sizeId ? s : z)) } : x)));
    }), [apiWrite]);

  const removeSize = useCallback((itemId: string, sizeId: string) =>
    apiWrite(`/api/admin/catering/item-sizes/${sizeId}`, "DELETE", undefined, () => {
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, sizes: x.sizes.filter((z) => z.id !== sizeId) } : x)));
    }), [apiWrite]);

  const toggleExpand = useCallback((id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const groups = useMemo(() => groupAdminRows(filterAdminRows(items, { chip, query })), [items, chip, query]);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {errorKey && <p className="text-sm font-semibold text-co-cta-text">{t(errorKey)}</p>}
      <MenuLegend t={t} />
      <MenuToolbar chip={chip} onChip={setChip} query={query} onQuery={setQuery} preview={preview} onPreview={setPreview} t={t} />
      {items.length === 0 ? (
        <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.empty")}</p>
      ) : preview ? (
        <MenuPreview groups={groups} language={language} money={money} t={t} />
      ) : (
        <MenuSectionList
          groups={groups}
          packageCount={packageCount}
          t={t}
          renderRow={(it) => (
            <MenuRow
              key={`${it.kind}:${it.id}`}
              item={it}
              canWrite={canWrite}
              language={language}
              money={money}
              t={t}
              expanded={expanded.has(it.id)}
              onToggleExpand={toggleExpand}
              onFlags={setFlags}
              onAddSize={addSize}
              onEditSize={editSize}
              onRemoveSize={removeSize}
            />
          )}
        />
      )}
      <PasswordModal open={stepUpOpen} onConfirm={async () => { if (pendingRef.current) await pendingRef.current(); }} onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }} />
    </div>
  );
}
```

- [ ] **Step 2: Thread `packageCount` through `MenuTabs.tsx`**

In `components/admin/catering/menu/MenuTabs.tsx`, change the props type and the two usages:

```tsx
export function MenuTabs({ items, toastState, ezcaterState, canWrite, packageCount }: {
  items: AdminMenuItem[];
  toastState: ToastMapState;
  ezcaterState: EzcaterAdminState;
  canWrite: boolean;
  packageCount: number;
}) {
```

and

```tsx
      {tab === "menu" ? <MenuClient items={items} canWrite={canWrite} packageCount={packageCount} /> : <ToastTab state={toastState} ezcater={ezcaterState} canWrite={canWrite} />}
```

- [ ] **Step 3: Load the active package count in `app/admin/catering/menu/page.tsx`**

Add the import and extend the `Promise.all`:

```tsx
import { loadPackages } from "@/lib/admin/catering/packages";
```

```tsx
  const [items, toastState, ezcaterState, packages] = await Promise.all([
    loadAdminCateringMenu(auth),
    loadToastMapState(auth),
    loadEzcaterAdminState(auth),
    loadPackages(auth),
  ]);
  const packageCount = packages.filter((p) => p.active).length;
```

and pass it:

```tsx
      <MenuTabs items={items} toastState={toastState} ezcaterState={ezcaterState} canWrite={level >= MENU_ADMIN_MIN} packageCount={packageCount} />
```

`loadPackages` requires `PACKAGE_READ_MIN`; the page already gates at `MENU_ADMIN_MIN` (7), which is at or above it — confirm with `grep -n "PACKAGE_READ_MIN =" lib/admin/catering/packages.ts` before committing (expected ≤ 7).

- [ ] **Step 4: Remove the now-unused i18n keys? — NO.** Leave `items_heading`, `menu_items_heading`, `available`, `only`, `portionable`, `serves`, `serves_hint`, `section_count`, `section_available`, `edit_packages` in place (other surfaces or tests may reference them; unused keys are harmless).

- [ ] **Step 5: Typecheck, lint, full tests**

Run: `npm run typecheck && npx eslint components/admin/catering/menu app/admin/catering/menu/page.tsx && npm test`
Expected: typecheck clean; eslint no errors; vitest all green (2247 + 11 new = 2258).

- [ ] **Step 6: Commit**

```bash
git add components/admin/catering/menu/MenuClient.tsx components/admin/catering/menu/MenuTabs.tsx app/admin/catering/menu/page.tsx
git commit -m "feat(admin-menu): one list in customer order, badges, filters, legend, customer preview"
```

---

### Task 9: Screenshot pass, PR

**Files:** none (verification)

- [ ] **Step 1: Run the app locally on a spare port and open the admin menu**

```bash
cd ~/co-ops && npm run dev -- --port 3002
```

Sign in as a GM+ user in the browser (staff login at `http://localhost:3002/`), open `http://localhost:3002/admin/catering/menu`. Do NOT use port 3000 on this machine (a stale client loops `GET /?next=/messages` against it).

- [ ] **Step 2: Verify visually at laptop width (≥ 1024px)**

Check, and screenshot each:
1. Legend card on top; "Got it" hides it; reload keeps it hidden.
2. Chips: "Hidden" shows only dimmed rows with the "Hidden from customers" badge; "Catering items" shows only registry items (Egg Salad, Tuna Salad, Onion Dip, Antipasto Pasta, Chix Salad…); search "chips" narrows to the Chips rows and the case rows under one **Sides** heading.
3. Section order: Packages card → Drinks → Sides → Desserts → Subs → Build Your Own → Gear. Header reads "Sides · N on the menu of M" with "Toast: Sides · Catering Sides · Chips".
4. Inside Sides: catering-only rows first (Case of Assorted Chips, Case of Mini Chips, Caesar Salad, House Greek Salad), singles under.
5. A row: badges "Toast item" / "Catering item", "Catering only" where set, and "Toast: <section>" line; controls read "On catering menu", "Catering only", "Sold by portion" (subs only), "Feeds [ ] people", "Sizes (n)".
6. Flip one toggle → step-up modal → confirm → row updates; flip it back.
7. Preview switch on: read-only list, hidden rows gone, prices, "feeds N", catering-only tags; off restores the editor.

- [ ] **Step 3: Verify at phone width (< 640px)**

Chips wrap; search full-width; row stacks name-and-badges above controls; every control ≥ 44px tall; sections collapse/expand by tapping the whole header.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/admin-menu-redesign
gh pr create --title "feat(admin): catering menu — one list in customer order, badges, plain-English controls, legend, customer preview" --body-file - <<'EOF'
## What
Implements `docs/superpowers/specs/2026-09-03-admin-catering-menu-redesign-design.md` (option 3, Juan-approved 2026-09-03).

- **One list, customer order** via the order builder's own grouping (`lib/portal/menu-order-shared.ts`): Packages card → Drinks → Sides → Desserts → Subs → … Catering-only rows first inside each section. "3 sides sections" is gone by construction.
- **Every row says what it is**: `Toast item` / `Catering item`, `Catering only`, `Seasonal`, `Hidden from customers`, plus "Toast: <section>".
- **Plain-English controls** with hover hints: On catering menu · Catering only · Sold by portion · Feeds N people · Sizes.
- **Filter chips + search**, **legend card** (dismiss remembered per browser), **Preview as customer** (same rows, read-only).
- No API, loader, or schema change. `MenuClient.tsx` split into Legend / Toolbar / SectionList / Row / Preview; pure view logic in `lib/admin/catering/menu-view-shared.ts` (+11 tests). en + es strings.

## Verification
Screenshots at laptop and phone widths (attached below). Full vitest suite green; typecheck clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Attach the screenshots from Steps 2–3 to the PR description (drag into the GitHub PR body, or `gh pr comment <n> --body-file`). Juan merges on his word.

---

## Self-review (done while writing)

- **Spec coverage:** §1 structure → Tasks 5/8 · §2 row → Task 4 · §3 controls, chips, search → Tasks 4/6 · §4 legend → Task 6 · §5 preview → Task 7 · §6 files → all tasks · §7 error handling → unchanged `apiWrite` in Task 8, legend try/catch in Task 6 · §8 tests → Tasks 1–2 + Task 9 screenshots · §9 out of scope respected (Toast tab, packages page, pricing untouched).
- **Placeholders:** none; every step has code or an exact command.
- **Type consistency:** `T`, `FlagChanges`, `SizeInput` are defined once in `MenuRow.tsx` and imported by `MenuSectionList`, `MenuToolbar`, `MenuLegend`, `MenuPreview`, `MenuClient`. `MenuGroup`, `MenuFilterChip`, `RowBadge` come from `menu-view-shared.ts`. `groupTitle` is exported from `MenuSectionList.tsx` and reused by `MenuPreview.tsx`.
