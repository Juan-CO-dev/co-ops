/**
 * Pure Toast menus normalizer (read-track 1). CLIENT-SAFE half per the house
 * *-shared pattern — unit-tested against the checked-in fixture
 * (tests/fixtures/toast/menus-v2-sample.json). The server fetch wrapper lives
 * in lib/toast/menus.ts.
 *
 * Real Toast `GET /menus/v2/menus` contract (review finding #1, 2026-07-23 —
 * the first draft pinned an invented shape): the response is an OBJECT
 * `{ restaurantGuid, menus: [...] }`; each menu carries `menuGroups[]`; groups
 * carry `menuItems[]` and may NEST further `menuGroups[]` (walked
 * recursively). Items carry `{ guid, name, price }`.
 *
 * priceCents = Math.round(price × 100), null when absent. Duplicate guids
 * dedupe FIRST-WINS (mirrors the recipe-graph first-recipe-wins doctrine).
 * A malformed payload throws — the whole pull poisons, never partial results.
 */
import type { ToastItem } from "./matcher";

interface RawItem { guid?: unknown; name?: unknown; price?: unknown }
interface RawGroup { name?: unknown; menuItems?: unknown; menuGroups?: unknown }
interface RawMenu { name?: unknown; menuGroups?: unknown }
interface RawRoot { menus?: unknown }

export function flattenToastMenus(json: unknown): ToastItem[] {
  const root = json as RawRoot;
  if (root == null || typeof root !== "object" || !Array.isArray(root.menus)) {
    throw new Error("toast menus payload: expected an object with a menus array");
  }
  const out: ToastItem[] = [];
  const seen = new Set<string>();

  const walkGroup = (group: RawGroup, groupName: string | null): void => {
    const items = Array.isArray(group?.menuItems) ? (group.menuItems as RawItem[]) : [];
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
    // Toast groups nest (menuGroups within menuGroups) — walk subgroups too.
    const subgroups = Array.isArray(group?.menuGroups) ? (group.menuGroups as RawGroup[]) : [];
    for (const sub of subgroups) {
      const subName = typeof sub?.name === "string" ? sub.name : groupName;
      walkGroup(sub, subName);
    }
  };

  for (const menu of root.menus as RawMenu[]) {
    const groups = Array.isArray(menu?.menuGroups) ? (menu.menuGroups as RawGroup[]) : [];
    for (const group of groups) {
      const groupName = typeof group?.name === "string" ? group.name : null;
      walkGroup(group, groupName);
    }
  }
  return out;
}
