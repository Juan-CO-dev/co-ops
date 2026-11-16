/**
 * W23/B127 — linkCateringOrders linked every ezCater order, cancelled ones included, so a cancelled
 * order inflated the customer's history and spend. Cancelled orders (status /cancel|reject|fail/,
 * lead Lost, or a pending loss notification) are now skipped, and links made earlier are marked
 * voided through 0330 customer_orders_sync_ezcater_cancelled (never deleted). Before 0330 / 0312
 * the sync reports null and nothing else changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no real client"); } }));
const audit = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));
vi.mock("@/lib/audit", () => ({ audit }));

import { linkCateringOrders } from "@/lib/customers/customers";
import { isEzcaterOrderCancelled } from "@/lib/ezcater/lifecycle-shared";

type Row = Record<string, unknown>;
const contact = (email: string) => ({ contact: { name: "Pat", email, phone: null } });
let tables: Record<string, Row[]>;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let syncResult: { data: unknown; error: { code: string; message: string } | null };

function client() {
  return {
    from(table: string) {
      let ids: string[] | null = null;
      let from = 0, to = 999;
      const q = {
        select: () => q, order: () => q,
        in: (_c: string, v: string[]) => { ids = v; return q; },
        range: (a: number, b: number) => { from = a; to = b; return q; },
        then: (res: (v: unknown) => unknown) => {
          let rows = tables[table] ?? [];
          if (ids) rows = rows.filter((r) => ids!.includes(String(r.id)));
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(res);
        },
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "customer_orders_sync_ezcater_cancelled") return syncResult;
      const rows = (args.p_rows as unknown[]) ?? [];
      return { data: { linked: rows.length, skipped: 0 }, error: null };
    },
  };
}
const actor = { userId: "u-owner", role: "owner", level: 9, locations: [] } as never;
const meta = { ipAddress: null, userAgent: null } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CUSTOMER_PROFILES", "1");
  rpcCalls = [];
  syncResult = { data: { voided: 2, restored: 0 }, error: null };
  tables = {
    catering_orders: [],
    catering_pipeline: [{ id: "lead-lost", stage: "lost" }, { id: "lead-ok", stage: "confirmed" }],
    ezcater_orders: [
      { id: "o-cancel", location_id: "s", event_date: "2026-11-20", total_cents: 50000, status: "CANCELLED", pending_event_key: null, lead_id: null, ezcater_order_contacts: contact("a@corp.com") },
      { id: "o-lost", location_id: "s", event_date: "2026-11-20", total_cents: 100, status: "accepted", pending_event_key: null, lead_id: "lead-lost", ezcater_order_contacts: contact("b@corp.com") },
      { id: "o-pending", location_id: "s", event_date: "2026-11-20", total_cents: 100, status: "accepted", pending_event_key: "cancelled", lead_id: null, ezcater_order_contacts: contact("c@corp.com") },
      { id: "o-live", location_id: "s", event_date: "2026-11-20", total_cents: 7000, status: "accepted", pending_event_key: null, lead_id: "lead-ok", ezcater_order_contacts: contact("d@corp.com") },
    ],
  };
});

describe("W23/B127 cancelled ezCater orders are not customer orders", () => {
  it("links only the live order and voids earlier links to cancelled ones", async () => {
    const result = await linkCateringOrders(actor, meta, { client: client() as never });
    const link = rpcCalls.filter((c) => c.fn === "customer_link_catering");
    const linkedIds = link.flatMap((c) => (c.args.p_rows as Array<{ order_id: string }>).map((r) => r.order_id));
    expect(linkedIds).toEqual(["o-live"]);
    expect(rpcCalls.filter((c) => c.fn === "customer_orders_sync_ezcater_cancelled")).toHaveLength(1);
    expect(result).toMatchObject({ linked: 1, cancelledSkipped: 3, voided: 2, restored: 0 });
    const auditRow = audit.mock.calls.find(([a]) => (a as { action: string }).action === "customer.catering_link")?.[0] as { metadata: Record<string, unknown> };
    expect(auditRow.metadata).toMatchObject({ cancelled_skipped: 3, voided: 2, restored: 0 });
  });

  it("before 0330 / 0312 the void sync is reported as null and the link still runs", async () => {
    syncResult = { data: null, error: { code: "42883", message: "function does not exist" } };
    expect(await linkCateringOrders(actor, meta, { client: client() as never })).toMatchObject({ linked: 1, voided: null, restored: null });
    syncResult = { data: null, error: { code: "42703", message: "column voided_at does not exist" } };
    expect(await linkCateringOrders(actor, meta, { client: client() as never })).toMatchObject({ voided: null });
  });
});

describe("isEzcaterOrderCancelled", () => {
  it.each([
    [{ status: "CANCELLED", leadStage: null, pendingEventKey: null }, true],
    [{ status: "rejected_by_caterer", leadStage: null, pendingEventKey: null }, true],
    [{ status: "accepted", leadStage: "lost", pendingEventKey: null }, true],
    [{ status: "accepted", leadStage: null, pendingEventKey: "failed" }, true],
    [{ status: "accepted", leadStage: "confirmed", pendingEventKey: "accepted" }, false],
    [{ status: null, leadStage: null, pendingEventKey: null }, false],
  ])("%j -> %s", (input, expected) => expect(isEzcaterOrderCancelled(input)).toBe(expected));
});
