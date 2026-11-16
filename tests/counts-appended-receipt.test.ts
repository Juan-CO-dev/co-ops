/**
 * Audit W17 / B185 — a receipt appended to an existing delivery AFTER a count is still a receipt
 * after that count.
 *
 * The on-hand ledger used to window receipt lines on BOTH the line's and its delivery header's
 * write instant. `addDeliveryLines` (the "continue a delivery" route) appends lines to a header
 * created earlier, so a line added after a count to a delivery started before it fell in no
 * window: it never counted as "received since the count" and on-hand under-counted by it.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildCountsFixture, LOC, NOW } from "./fixtures/counts-onhand-fixture";
import type { OnHandCountRow, OnHandWeightRow } from "@/lib/counts";

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

type Tables = ReturnType<typeof buildCountsFixture>;
async function onHand(edit: (t: Tables) => void = () => {}) {
  const t = buildCountsFixture();
  edit(t);
  current = createFakeDb(t);
  const view = await counts.deriveOnHand(LOC, NOW);
  return new Map(view.rows.map((r) => [r.skuId, r] as const));
}
const receipt = (id: string, deliveryId: string, skuId: string, createdAt: string, over: Record<string, unknown> = {}) =>
  ({ id, delivery_id: deliveryId, vendor_item_id: skuId, resolved_oz: null, created_at: createdAt, received_level_label: null, received_qty_at_level: null, ...over });

// Lettuce is anchored by the 2026-10-12T10:15Z par walk; deli bags by the 2026-10-08T13:30Z count.
const LETTUCE_ANCHOR = "2026-10-12T10:15:00.25+00:00";
const BAGS_ANCHOR = "2026-10-08T13:30:00+00:00";

it("an append to a pre-count delivery is received after the count (weight and count dimensions)", async () => {
  const base = await onHand();
  const appended = await onHand((t) => {
    // The delivery was started on 10-08 at 12:00Z — BEFORE both anchors…
    t.vendor_deliveries!.push({ id: "d-early", location_id: LOC, vendor_id: "v-a", created_at: "2026-10-08T12:00:00+00:00", delivery_date: "2026-10-08" });
    // …and more cases were added to it later, AFTER each count.
    t.vendor_delivery_items!.push(
      receipt("di-append-1", "d-early", "s-lettuce", "2026-10-13T09:00:00+00:00", { resolved_oz: 24 }),
      receipt("di-append-2", "d-early", "s-bags", "2026-10-09T15:00:00+00:00", { received_level_label: "case", received_qty_at_level: 1 }),
    );
  });

  const lettuce = (m: typeof base) => m.get("s-lettuce") as OnHandWeightRow;
  const bags = (m: typeof base) => m.get("s-bags") as OnHandCountRow;
  expect(lettuce(base)).toMatchObject({ anchorAt: LETTUCE_ANCHOR, onHandOz: 68 });
  expect(bags(base)).toMatchObject({ anchorAt: BAGS_ANCHOR, onHandUnits: 620 });

  expect(lettuce(appended).onHandOz).toBe(68 + 24);
  expect(bags(appended).onHandUnits).toBe(620 + 500); // case → 10 sleeve → 50 each

  // Nothing else on the panel moved, and the early header made no anchor stale.
  for (const [skuId, row] of base) {
    if (skuId === "s-lettuce" || skuId === "s-bags") continue;
    expect(appended.get(skuId)).toEqual(row);
  }
  expect(lettuce(appended).anchorStale).toBe(lettuce(base).anchorStale);
  expect(bags(appended).anchorStale).toBe(bags(base).anchorStale);
});

it("a line written before the count stays out of the since-count window, whatever its header", async () => {
  const base = await onHand();
  // d3's header (10-13T14:00Z) is AFTER the lettuce anchor; this line of it is dated before the anchor.
  const earlier = await onHand((t) => {
    t.vendor_delivery_items!.push(receipt("di-before", "d3", "s-lettuce", "2026-10-12T10:15:00+00:00", { resolved_oz: 999 }));
  });
  expect((earlier.get("s-lettuce") as OnHandWeightRow).onHandOz).toBe((base.get("s-lettuce") as OnHandWeightRow).onHandOz);
});

it("another shop's delivery never reaches this shop's on-hand", async () => {
  const base = await onHand();
  const other = await onHand((t) => {
    t.vendor_delivery_items!.push(receipt("di-other", "d4", "s-lettuce", "2026-10-13T09:00:00+00:00", { resolved_oz: 999 }));
  });
  expect((other.get("s-lettuce") as OnHandWeightRow).onHandOz).toBe((base.get("s-lettuce") as OnHandWeightRow).onHandOz);
});
