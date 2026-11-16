/**
 * Audit W17 / B100 — a pack edit must not re-price packaging that was already received.
 *
 * A count-dimension (packaging) receipt stores a level label and a quantity ("case" × 2), never
 * leaf units. The on-hand read multiplied every past line by TODAY's chain, so editing
 * "case = 500 bags" to "case = 1000 bags" doubled every case already on the shelf: on-hand jumped
 * and "used or lost since last count" showed a loss that never happened. Each receipt is now read
 * through the pack in force when it was written (D1: the past resolves as of its day), by the one
 * pure resolver, from one load of the pack history.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildCountsFixture, LOC, NOW, OTHER } from "./fixtures/counts-onhand-fixture";
import { withBackfilledVersions } from "./fixtures/shop-versions-fixture";
import { loadAllSkuPackHistory } from "@/lib/prep-consumption";
import type { OnHandCountRow } from "@/lib/counts";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
const counts = await import("@/lib/counts");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("DEPLETION_SOURCE", "capture");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); current = null; });

type Tables = Record<string, Array<Record<string, unknown>>>;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The counts fixture in the post-0259 shape: every chain is a dated global version. */
function versioned(edit: (t: Tables) => void = () => {}): Tables {
  const t = withBackfilledVersions(buildCountsFixture());
  edit(t);
  return t;
}
async function onHandRows(tables: Tables) {
  current = createFakeDb(tables);
  const view = await counts.deriveOnHand(LOC, NOW);
  return { view, bySku: new Map(view.rows.map((r) => [r.skuId, r] as const)) };
}
const bags = (m: Map<string, unknown>) => m.get("s-bags") as OnHandCountRow;

/** When the manager edited the deli-bag pack: between the 10-08 count and the 10-13 delivery. */
const EDIT = "2026-10-10T12:00:00+00:00";

/** Retire s-bags' global version at `at` and open a new one: `case` now holds `sleevesPerCase` sleeves of 50. */
function editBagsPack(t: Tables, at: string, sleevesPerCase: number, scope: string | null = null, tag = "v2") {
  if (scope === null) {
    const live = t.sku_pack_versions!.find((v) => v.sku_id === "s-bags" && v.location_id == null && v.valid_to == null)!;
    Object.assign(live, { valid_to: at, active: false });
    for (const l of t.sku_pack_levels!) if (l.version_id === live.id) l.active = false;
  }
  const vid = `pv-s-bags-${tag}`;
  t.sku_pack_versions!.push({ id: vid, sku_id: "s-bags", location_id: scope, based_on_version_id: null, active: true, valid_from: at, valid_to: null, note: null, created_at: at, created_by: null, retired_by: null });
  t.sku_pack_levels!.push(
    { id: `pl-b-case-${tag}`, sku_id: "s-bags", version_id: vid, location_id: scope, effective_from: at, label: "case", contains_qty: sleevesPerCase, contains_level_id: `pl-b-sleeve-${tag}`, contains_measure_unit: null, display_ordinal: 1, active: true },
    { id: `pl-b-sleeve-${tag}`, sku_id: "s-bags", version_id: vid, location_id: scope, effective_from: at, label: "sleeve", contains_qty: 50, contains_level_id: null, contains_measure_unit: "each", display_ordinal: 2, active: true },
  );
}
const caseReceipt = (id: string, deliveryId: string, createdAt: string, qty = 1) =>
  ({ id, delivery_id: deliveryId, vendor_item_id: "s-bags", resolved_oz: null, created_at: createdAt, received_level_label: "case", received_qty_at_level: qty });

describe("with no pack edit, resolving receipts as of their day changes nothing", () => {
  it("the on-hand view over dated versions equals the view over the same chains without versions", async () => {
    const unversioned = await onHandRows(buildCountsFixture());
    const withVersions = await onHandRows(versioned());
    expect(plain(withVersions.view)).toEqual(plain(unversioned.view));
    // Non-vacuous: the packaging rows carry real numbers.
    expect(bags(withVersions.bySku)).toMatchObject({ onHandUnits: 620, usedOrLostUnits: 1080 });
  });
});

describe("a pack edit after a receipt does not re-price that receipt", () => {
  it("cases received before the edit keep the size they were received at", async () => {
    // 10-03: 2 cases received (case = 10 sleeves × 50 = 500 bags). 10-08: counted 420.
    // 10-10: the pack is edited — a case now holds 20 sleeves (1000 bags). 10-13: 4 sleeves received.
    const { bySku } = await onHandRows(versioned((t) => editBagsPack(t, EDIT, 20)));
    // Used or lost between the two counts: 500 counted + 2 × 500 received − 420 counted = 1080.
    // Through today's chain the same two cases read 2 × 1000, a false loss of 1000 bags.
    expect(bags(bySku).usedOrLostUnits).toBe(1080);
    expect(bags(bySku).onHandUnits).toBe(620); // 420 + 4 sleeves; sleeves did not change
  });

  it("a case received after the edit uses the new size", async () => {
    const { bySku } = await onHandRows(versioned((t) => {
      editBagsPack(t, EDIT, 20);
      t.vendor_delivery_items!.push(caseReceipt("di-after-edit", "d3", "2026-10-13T14:00:02+00:00"));
    }));
    expect(bags(bySku).onHandUnits).toBe(620 + 1000);
    expect(bags(bySku).usedOrLostUnits).toBe(1080);
  });

  it("a case received before the edit and after the count is NOT doubled on the shelf", async () => {
    const { bySku } = await onHandRows(versioned((t) => {
      editBagsPack(t, EDIT, 20);
      t.vendor_delivery_items!.push(caseReceipt("di-before-edit", "d2", "2026-10-09T12:00:01+00:00"));
    }));
    expect(bags(bySku).onHandUnits).toBe(620 + 500); // today's chain would say + 1000
  });

  it("this shop's own pack version prices its receipts while it is in force, and only then", async () => {
    // From 10-12 this shop receives small cases (5 sleeves = 250 bags); the global pack is unchanged.
    const shopFrom = "2026-10-12T00:00:00+00:00";
    const { bySku } = await onHandRows(versioned((t) => {
      editBagsPack(t, shopFrom, 5, LOC, "shop");
      t.vendor_delivery_items!.push(
        caseReceipt("di-shop-era", "d3", "2026-10-13T14:00:02+00:00"), // the shop's 250
        caseReceipt("di-global-era", "d2", "2026-10-09T12:00:01+00:00"), // before the shop version: the global 500
      );
    }));
    expect(bags(bySku).onHandUnits).toBe(620 + 250 + 500);
    expect(bags(bySku).usedOrLostUnits).toBe(1080); // the 10-03 cases were global-era too
  });

  it("another shop's pack version never prices this shop's receipts", async () => {
    const { bySku } = await onHandRows(versioned((t) => {
      editBagsPack(t, "2026-09-01T00:00:00+00:00", 99, OTHER, "other");
      t.vendor_delivery_items!.push(caseReceipt("di-x", "d3", "2026-10-13T14:00:02+00:00"));
    }));
    expect(bags(bySku).onHandUnits).toBe(620 + 500);
  });
});

describe("loadAllSkuPackHistory", () => {
  it("reads the global versions and this shop's, with their levels, and never another shop's", async () => {
    const t = versioned((x) => { editBagsPack(x, EDIT, 20); editBagsPack(x, EDIT, 5, LOC, "shop"); editBagsPack(x, EDIT, 99, OTHER, "other"); });
    const db = createFakeDb(t);
    current = db;
    const atShop = await loadAllSkuPackHistory(LOC);
    const bagVersions = atShop.versions.filter((v) => v.sku_id === "s-bags").map((v) => v.id).sort();
    expect(bagVersions).toEqual(["pv-s-bags-live", "pv-s-bags-shop", "pv-s-bags-v2"]);
    // Retired versions' (inactive) levels ride along: history is what this read is for.
    expect(atShop.levels.filter((l) => l.version_id === "pv-s-bags-live").map((l) => l.label).sort()).toEqual(["case", "sleeve"]);
    expect(atShop.levels.some((l) => l.version_id === "pv-s-bags-other")).toBe(false);
    expect(atShop.levels.every((l) => l.version_id != null)).toBe(true);
    // Two reads, no id list, whatever the catalog size.
    expect(db.log.map((q) => q.table).sort()).toEqual(["sku_pack_levels", "sku_pack_versions"]);

    current = createFakeDb(t);
    const global = await loadAllSkuPackHistory(null);
    expect(global.versions.filter((v) => v.sku_id === "s-bags").map((v) => v.id).sort()).toEqual(["pv-s-bags-live", "pv-s-bags-v2"]);
  });
});
