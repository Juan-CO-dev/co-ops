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
    const raw = it.section ? it.section.trim() : "";
    if (raw && !g.rawSections.includes(raw)) g.rawSections.push(raw);
    g.rows.push(it);
    map.set(label, g);
  }
  return orderSections(
    Array.from(map.entries()).map(([label, g]) => ({ label, rawSections: g.rawSections, rows: orderWithinSection(g.rows) })),
  );
}

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
