/**
 * Nav PR 6 (plan r3, 8.6): Prep demand rows for the flagged-count tests, and a fake client that answers the Prep demand
 * page's reads (catering_prep_demand, items, item_par_levels, menu_items, catering_package_items) like PostgREST: filtered
 * by the call's `.eq()` / `.in()` / `.gte()` / `.lte()`, ordered by `.order()`, cut by `.range()` (no range = the
 * 1,000-row response cap), and an `.in()` of more than 100 ids refused as the request line (414).
 */
import { fakeSupabase, type FakeCall } from "../../helpers/fake-supabase";

export type Row = Record<string, unknown>;
export interface PrepDemandDb {
  catering_prep_demand: Row[];
  items: Row[];
  item_par_levels: Row[];
  menu_items?: Row[];
  catering_package_items?: Row[];
}

const SHOP = "shop-p";
export const PREP_SHOP = SHOP;

function answer(rows: readonly Row[], c: FakeCall): { data?: unknown; error?: unknown } {
  let out = [...rows];
  for (const o of c.ops) {
    const [k, v] = o.args as [string, unknown];
    if (o.op === "eq") out = out.filter((r) => r[k] === v);
    if (o.op === "in") {
      const list = v as unknown[];
      if (list.length > 100) return { error: { message: "414 request line too long" } };
      out = out.filter((r) => list.includes(r[k]));
    }
    if (o.op === "gte") out = out.filter((r) => String(r[k]) >= String(v));
    if (o.op === "lte") out = out.filter((r) => String(r[k]) <= String(v));
  }
  const order = c.ops.filter((o) => o.op === "order").map((o) => o.args[0] as string);
  if (order.length > 0) out.sort((a, b) => { for (const k of order) { const x = String(a[k]); const y = String(b[k]); if (x !== y) return x < y ? -1 : 1; } return 0; });
  const from = c.has("range") ? (c.arg("range", 0) as number) : 0;
  const to = c.has("range") ? (c.arg("range", 1) as number) : 999;
  return { data: out.slice(from, to + 1) };
}

export function prepDemandClient(db: PrepDemandDb) {
  return fakeSupabase((c) => {
    const rows = (db as unknown as Record<string, Row[] | undefined>)[c.table];
    if (!rows) return { data: [] };
    return answer(rows, c);
  });
}

const pad = (n: number, w = 4) => String(n).padStart(w, "0");
export const itemId = (n: number) => `00000000-0000-4000-8000-${pad(n, 12)}`;

/**
 * The small, varied shape (fewer than 1,000 rows and 100 items, so the page's pre-change single read saw all of it):
 * an item with no par, demand equal to par, under par, one item in two portions, a manual weekday override, an
 * auto-mode override (ignored), a menu item and a choice slot, two days, several leads.
 */
export function smallDb(today: string, tomorrow: string): PrepDemandDb {
  let n = 0;
  const d = (need_date: string, ref: { item_id?: string; menu_item_id?: string; choice_package_item_id?: string }, qty: number, portion: string | null = null, pipeline_id = "lead-a"): Row => ({
    id: `d-${pad(n++, 6)}`, pipeline_id, location_id: SHOP, status: "reserved", need_date,
    item_id: ref.item_id ?? null, menu_item_id: ref.menu_item_id ?? null, choice_package_item_id: ref.choice_package_item_id ?? null, portion, qty,
  });
  const [noPar, atPar, under, twoPortions, weekday, auto] = [1, 2, 3, 4, 5, 6].map(itemId) as [string, string, string, string, string, string];
  return {
    catering_prep_demand: [
      d(today, { item_id: noPar }, 2),
      d(today, { item_id: atPar }, 6, null, "lead-b"),
      d(today, { item_id: atPar }, 4),
      d(today, { item_id: under }, 3),
      d(today, { item_id: twoPortions }, 4, "half"),
      d(today, { item_id: twoPortions }, 8, "quarter", "lead-b"),
      d(today, { menu_item_id: "menu-1" }, 5),
      d(today, { choice_package_item_id: "slot-1" }, 2),
      d(tomorrow, { item_id: weekday }, 7),
      d(tomorrow, { item_id: auto }, 7),
      d(tomorrow, { item_id: under }, 12, "whole"),
      { ...d(today, { item_id: under }, 99), status: "released" },
      { ...d(today, { item_id: under }, 99), location_id: "other-shop" },
    ],
    items: [
      { id: noPar, name: "Pickles", name_es: null, default_par: null, default_par_unit: null, active: true },
      { id: atPar, name: "Ham", name_es: null, default_par: 10, default_par_unit: "ea", active: true },
      { id: under, name: "Turkey", name_es: null, default_par: 10, default_par_unit: "ea", active: true },
      { id: twoPortions, name: "Bread", name_es: null, default_par: 3, default_par_unit: "ea", active: true },
      { id: weekday, name: "Lettuce", name_es: null, default_par: 20, default_par_unit: "ea", active: true },
      { id: auto, name: "Onion", name_es: null, default_par: 20, default_par_unit: "ea", active: true },
    ],
    item_par_levels: [
      // Tomorrow's weekday: a manual override of 5 (flagged at 7); the all-days base of 50 does not decide.
      { id: "p-1", item_id: weekday, location_id: SHOP, active: true, day_of_week: null, par_value: 50, par_unit: null, par_mode: "manual" },
      { id: "p-2", item_id: weekday, location_id: SHOP, active: true, day_of_week: new Date(`${tomorrow}T12:00:00`).getDay(), par_value: 5, par_unit: null, par_mode: "manual" },
      // An auto override is ignored: the default (20) stands, so 7 is under par.
      { id: "p-3", item_id: auto, location_id: SHOP, active: true, day_of_week: null, par_value: 1, par_unit: null, par_mode: "auto" },
      { id: "p-4", item_id: under, location_id: "other-shop", active: true, day_of_week: null, par_value: 1, par_unit: null, par_mode: "manual" },
    ],
    menu_items: [{ id: "menu-1", name: "Italian sub" }],
    catering_package_items: [{ id: "slot-1", description: "Choose a sub" }],
  };
}
