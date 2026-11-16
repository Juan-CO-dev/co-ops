import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";

// Audit W18/B104: receiving moves a placed PO to `invoiced`. The cutoff attention on
// /ordering, the dashboard and the mid-shift pulse must keep that vendor CLEARED; it read
// "missed cutoff, call the vendor" because its own status set left `invoiced` out.

const h = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
import { loadOrderingAttention } from "@/lib/ordering";
import { PO_AT_OR_BEYOND_CONFIRMED } from "@/lib/po-status-shared";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const actor = { user: { role: "gm", language: "en" }, locations: [SHOP] } as AuthContext;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Monday 2026-11-16, 11:00 ET: past a 10:00 cutoff.
  vi.setSystemTime(new Date("2026-11-16T16:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const tables = (status: string): Tables => ({
  vendor_cutoffs: [{ vendor_id: "v1", location_id: null, order_day: 1, cutoff_time: "10:00", active: true }],
  purchase_orders: [{ id: "po1", vendor_id: "v1", location_id: SHOP, status, created_at: "2026-11-16T14:00:00Z" }],
  vendors: [{ id: "v1", name: "Vendor One", source_kind: "vendor", active: true }],
});

it("an invoiced PO today clears the vendor's cutoff attention", async () => {
  h.db.mockReturnValue(createFakeDb(tables("invoiced")).client);
  expect(await loadOrderingAttention(actor, SHOP)).toEqual({ count: 0, vendors: [] });
});

it("a draft-only vendor past its cutoff is still flagged (control)", async () => {
  h.db.mockReturnValue(createFakeDb(tables("draft")).client);
  const out = await loadOrderingAttention(actor, SHOP);
  expect(out.count).toBe(1);
  expect(out.vendors[0]).toMatchObject({ vendorId: "v1", hasDraft: true, missed: true });
});

it("one status set means 'at or beyond confirmed', and the walk attention and the digest share it", () => {
  expect([...PO_AT_OR_BEYOND_CONFIRMED].sort()).toEqual(["confirmed", "invoiced", "placed", "received", "reconciled"]);
  for (const file of ["lib/ordering.ts", "lib/report-digests-v2-shared.ts"]) {
    const src = readFileSync(file, "utf8");
    expect(src, file).toMatch(/PO_AT_OR_BEYOND_CONFIRMED[^\n]*from "@\/lib\/po-status-shared"|import \{[^}]*PO_AT_OR_BEYOND_CONFIRMED[^}]*\} from "@\/lib\/po-status-shared"/);
    // No private copy of the set (OPEN_ORDER in the digest is a different, open-only set).
    expect(src, file).not.toMatch(/new Set\(\[[^\]]*"reconciled"/);
  }
});
