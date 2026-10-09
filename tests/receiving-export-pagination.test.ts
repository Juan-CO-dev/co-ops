import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadDeliveriesForExport } from "@/lib/receiving";
import type { AuthContext } from "@/lib/session";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const actor = { user: { id: "reader", role: "key_holder" }, role: "key_holder", level: 4, locations: ["shop"] } as AuthContext;
type Row = Record<string, string | null>;
type Read = { table: string; from: number; to: number; ids?: string[]; lower?: string; upper?: string; orders: string[] };
let reads: Read[];
function database(count: number, fail?: { table: string; from: number }) {
  const headers: Row[] = Array.from({ length: count }, (_, n) => ({
    id: `delivery-${n}`, vendor_id: `vendor-${n}`, received_by: `user-${n}`, purchase_order_id: `po-${n}`,
    delivery_date: "2026-10-01", location_id: "shop", created_at: "2026-10-01T12:00:00Z",
    invoice_number: null, match_state: "unmatched", delivery_status: "received", receipt_url: null, email_receipt_id: null,
  }));
  const all: Record<string, Row[]> = {
    vendor_deliveries: [...Array.from({ length: 1100 }, (_, n) => ({ ...headers[0], id: `old-${n}`, delivery_date: "2026-09-01" })), ...headers],
    vendors: headers.map((h) => ({ id: h.vendor_id!, name: h.vendor_id! })),
    users: headers.map((h) => ({ id: h.received_by!, name: h.received_by! })),
    purchase_orders: headers.map((h) => ({ id: h.purchase_order_id!, display_code: h.purchase_order_id! })),
    vendor_delivery_items: headers.flatMap((h) => Array.from({ length: 11 }, (_, n) => ({ id: `${h.id}-line-${n}`, delivery_id: h.id! }))),
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: (table: string) => {
    let rows = all[table] ?? [];
    const read: Read = { table, from: 0, to: 999, orders: [] };
    const q = {
      select: () => q,
      eq: (column: string, value: string) => { rows = rows.filter((r) => r[column] === value); return q; },
      gte: (column: string, value: string) => { read.lower = value; rows = rows.filter((r) => r[column]! >= value); return q; },
      lte: (column: string, value: string) => { read.upper = value; rows = rows.filter((r) => r[column]! <= value); return q; },
      in: (column: string, ids: string[]) => { read.ids = ids; rows = rows.filter((r) => ids.includes(r[column]!)); return q; },
      order: (column: string) => { read.orders.push(column); return q; },
      limit: (n: number) => { read.to = n - 1; return q; },
      range: (from: number, to: number) => { read.from = from; read.to = to; return q; },
      returns: async () => {
        reads.push(read);
        if (fail?.table === table && fail.from === read.from) return { data: null, error: { message: "injected read failure" } };
        return { data: rows.slice(read.from, read.to + 1), error: null };
      },
    };
    return q;
  } } as unknown as ReturnType<typeof getServiceRoleClient>);
}
beforeEach(() => { vi.clearAllMocks(); reads = []; });
const range = { from: "2026-10-01", to: "2026-10-08" };

describe("receiving export history completeness (BC-006, BC-010, BC-032)", () => {
  it("filters dates in SQL and pages >1,000 parents and child lines with bounded ID filters", async () => {
    database(1001);
    const result = await loadDeliveriesForExport(actor, "shop", range);
    expect(result).toHaveLength(1001);
    expect(result.every((r) => r.lineCount === 11)).toBe(true);
    expect(result.at(-1)).toMatchObject({ vendorName: "vendor-1000", receivedByName: "user-1000", purchaseOrderCode: "po-1000" });
    const parents = reads.filter((r) => r.table === "vendor_deliveries");
    expect(parents.map((r) => r.from)).toEqual([0, 500, 1000]);
    expect(parents.every((r) => r.lower === range.from && r.upper === range.to && r.orders.includes("id"))).toBe(true);
    expect(reads.filter((r) => r.ids).every((r) => r.ids!.length <= 100)).toBe(true);
    expect(reads.some((r) => r.table === "vendor_delivery_items" && r.from === 1000)).toBe(true);
  });
  for (const [table, from] of [["vendor_deliveries", 500], ["vendor_delivery_items", 500], ["vendors", 0], ["users", 0], ["purchase_orders", 0]] as const) {
    it(`rejects ${table} page ${from} failures instead of returning partial/zero counts`, async () => {
      database(501, { table, from });
      await expect(loadDeliveriesForExport(actor, "shop", range)).rejects.toThrow("injected read failure");
    });
  }
  it("keeps export's role and location checks", async () => {
    database(1);
    await expect(loadDeliveriesForExport(actor, "other", range)).rejects.toMatchObject({ status: 404 });
    await expect(loadDeliveriesForExport({ ...actor, user: { ...actor.user, role: "employee" }, role: "employee", level: 3 }, "shop", range)).rejects.toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });
  it("routes receiving export to the date-scoped loader", () => {
    const source = readFileSync("lib/report-export.ts", "utf8");
    expect(source).toContain("loadDeliveriesForExport(auth, locationId!, range)");
    expect(source).not.toContain("RECEIVING_EXPORT_LIMIT");
  });
});
