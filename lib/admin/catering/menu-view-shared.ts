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
