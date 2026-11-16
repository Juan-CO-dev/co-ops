/**
 * tests/notifications-unread-bounded.test.ts — audit W26 / B030.
 *
 * `loadUnreadForUser` used to read EVERY unread in-app recipient row, then send every notification
 * id in `.in("id", …)`. Past ~210 unread the GET request line passed 8 KB and the dashboard's
 * notification widget broke (Owner / MoO get one row per under-par item at both shops). The read is
 * now ONE service-role embedded query whose URL is constant whatever the unread count: the embed
 * names its FK, the order is the embedded `created_at` desc, the limit is sent, and the location
 * filter is applied on the embedded table while keeping shop-wide (location_id NULL) rows.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadUnreadForUser } from "@/lib/notifications";

type Call = { table: string; method: string; args: unknown[] };

const USER = "user-1";
const LOC_A = "11111111-1111-4111-8111-111111111111";

function seedRows(n: number) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const notifId = `n-${String(i).padStart(4, "0")}`;
    // created_at strictly decreasing with i → the fake returns created_at-desc order.
    const createdAt = new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString();
    rows.push({
      id: `r-${String(i).padStart(4, "0")}`,
      notification_id: notifId,
      user_id: USER,
      delivery_method: "in_app",
      delivery_status: "pending",
      read_at: null,
      acknowledged_at: null,
      notifications: {
        id: notifId,
        type: "under_par_alert",
        priority: "urgent",
        title: `t${i}`,
        body: null,
        data: {},
        related_table: null,
        related_id: null,
        location_id: i % 3 === 0 ? null : LOC_A,
        created_at: createdAt,
      },
    });
  }
  return rows;
}

function fakeClient(rows: ReturnType<typeof seedRows>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push({ table, method: "from", args: [table] });
      let limit = Infinity;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "neq", "in", "or", "order"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return builder;
        };
      }
      builder.limit = (n: number) => {
        calls.push({ table, method: "limit", args: [n] });
        limit = n;
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) => {
        // The old code's step 2 reads `notifications` directly; give it the embedded rows so the
        // red run fails on the request shape, not on a crash.
        const data =
          table === "notifications"
            ? rows.map((r) => r.notifications).slice(0, limit)
            : rows.slice(0, limit);
        resolve({ data, error: null });
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("B030 — loadUnreadForUser is one bounded embedded read", () => {
  it("never puts ids in the URL and sends one request to notification_recipients", async () => {
    const { client, calls } = fakeClient(seedRows(500));
    await loadUnreadForUser(client, USER, { locationContext: [LOC_A] });

    // (a) no `.in("id", …)` call
    expect(calls.filter((c) => c.method === "in")).toEqual([]);
    // (b) exactly one request, to notification_recipients
    const froms = calls.filter((c) => c.method === "from");
    expect(froms.map((c) => c.table)).toEqual(["notification_recipients"]);
    // the embed names its FK
    const select = calls.find((c) => c.method === "select");
    expect(String(select?.args[0])).toContain(
      "notifications!notification_recipients_notification_id_fkey!inner(",
    );
  });

  it("sends limit(50) and orders by the embedded created_at desc, then notification id desc", async () => {
    const { client, calls } = fakeClient(seedRows(500));
    await loadUnreadForUser(client, USER);

    // (c)
    expect(calls.filter((c) => c.method === "limit").map((c) => c.args[0])).toEqual([50]);
    const orders = calls.filter((c) => c.method === "order");
    // Equal timestamps sort the same every time: created_at desc, then the notification id desc (fix round 3).
    expect(orders).toHaveLength(2);
    expect(orders[0]?.args[0]).toBe("notifications(created_at)");
    expect(orders[0]?.args[1]).toMatchObject({ ascending: false });
    expect(orders[1]?.args[0]).toBe("notification_id");
    expect(orders[1]?.args[1]).toMatchObject({ ascending: false });
    // no location context → no location filter
    expect(calls.filter((c) => c.method === "or")).toEqual([]);
    // the recipient filters are kept
    const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["user_id", USER]);
    expect(eqs).toContainEqual(["delivery_method", "in_app"]);
    expect(calls.filter((c) => c.method === "is").map((c) => c.args)).toContainEqual(["read_at", null]);
    expect(calls.filter((c) => c.method === "neq").map((c) => c.args)).toContainEqual([
      "delivery_status",
      "disabled",
    ]);
  });

  it("filters locations on the embedded table and keeps shop-wide rows", async () => {
    const { client, calls } = fakeClient(seedRows(500));
    await loadUnreadForUser(client, USER, { locationContext: [LOC_A] });

    // (d)
    const ors = calls.filter((c) => c.method === "or");
    expect(ors).toHaveLength(1);
    expect(String(ors[0]?.args[0])).toContain(`location_id.eq.${LOC_A}`);
    expect(String(ors[0]?.args[0])).toContain("location_id.is.null");
    expect(ors[0]?.args[1]).toEqual({ referencedTable: "notifications" });
  });

  it("returns pairs in the read's created_at-desc order", async () => {
    const { client } = fakeClient(seedRows(500));
    const out = await loadUnreadForUser(client, USER, { limit: 20 });

    // (e)
    expect(out).toHaveLength(20);
    expect(out.map((p) => p.recipient.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `r-${String(i).padStart(4, "0")}`),
    );
    for (const p of out) expect(p.notification.id).toBe(p.recipient.notificationId);
    const times = out.map((p) => p.notification.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("throws with the same message prefix on error", async () => {
    const client = {
      from() {
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "is", "neq", "in", "or", "order", "limit"]) b[m] = () => b;
        b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "boom" } });
        return b;
      },
    } as unknown as SupabaseClient;
    await expect(loadUnreadForUser(client, USER)).rejects.toThrow(/^loadUnreadForUser: .*boom/);
  });
});
