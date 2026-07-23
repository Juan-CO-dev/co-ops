/**
 * Pure Toast menus normalizer (read-track 1). CLIENT-SAFE half per the house
 * *-shared pattern — unit-tested against the checked-in fixture
 * (tests/fixtures/toast/menus-v2-sample.json). The server fetch wrapper lives
 * in lib/toast/menus.ts.
 *
 * Walk: menus[] → groups[] → items[{guid, name, price}] → flat ToastItem list.
 * priceCents = Math.round(price × 100), null when absent. Duplicate guids
 * dedupe FIRST-WINS (mirrors the recipe-graph first-recipe-wins doctrine).
 * A malformed payload throws — the whole pull poisons, never partial results.
 */
import type { ToastItem } from "./matcher";

interface RawItem { guid?: unknown; name?: unknown; price?: unknown }
interface RawGroup { name?: unknown; items?: unknown }
interface RawMenu { name?: unknown; groups?: unknown }

export function flattenToastMenus(json: unknown): ToastItem[] {
  if (!Array.isArray(json)) throw new Error("toast menus payload: expected an array of menus");
  const out: ToastItem[] = [];
  const seen = new Set<string>();
  for (const menu of json as RawMenu[]) {
    const groups = Array.isArray(menu?.groups) ? (menu.groups as RawGroup[]) : [];
    for (const group of groups) {
      const groupName = typeof group?.name === "string" ? group.name : null;
      const items = Array.isArray(group?.items) ? (group.items as RawItem[]) : [];
      for (const item of items) {
        if (typeof item?.guid !== "string" || item.guid.length === 0) {
          throw new Error("toast menus payload: item without guid");
        }
        if (typeof item?.name !== "string" || item.name.length === 0) {
          throw new Error(`toast menus payload: item ${item.guid} without name`);
        }
        if (seen.has(item.guid)) continue; // first-wins
        seen.add(item.guid);
        const price = typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null;
        out.push({
          itemGuid: item.guid,
          name: item.name,
          priceCents: price != null ? Math.round(price * 100) : null,
          groupName,
        });
      }
    }
  }
  return out;
}
