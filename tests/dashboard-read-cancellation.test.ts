/**
 * Lead ruling r3, H2 (Astra code review r1, P2): the Dashboard's optional reads are CANCELLED at the page deadline, not
 * only abandoned. The bell (`loadUnreadForUser` on `withAbortStrict(sb, signal)`), retrain (`loadMyRetrainTasks`),
 * Receiving (`loadRecentDeliveries`) and Counts (`loadCountsTileState`) each take the signal `widget()` hands them:
 *  - at the deadline the signal their queries carry is aborted;
 *  - after it, no further query reaches the client: no page two, no follow-up read (even when a response lands just as
 *    the abort does, the worst case this fake answers with).
 * A caller that passes no signal gets the plain client back, byte for byte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; signal: AbortSignal | null };
const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; signal: AbortSignal | null }>,
  /** Per table: answer at once, or hang until the query's signal aborts and THEN answer (a late response). */
  plan: {} as Record<string, { hang?: boolean; rows: (callIndex: number) => unknown[] }>,
}));

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { table, signal: null };
      state.calls.push(call);
      const index = state.calls.filter((c) => c.table === table).length - 1;
      const answer = async () => {
        const p = state.plan[table] ?? { rows: () => [] };
        if (p.hang) {
          await new Promise<void>((resolve) => {
            if (call.signal?.aborted) return resolve();
            call.signal?.addEventListener("abort", () => resolve());
          });
        }
        return { data: p.rows(index), error: null };
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "range", "limit", "returns", "is", "neq", "or"]) b[m] = () => b;
      b.abortSignal = (s: AbortSignal) => { call.signal = s; return b; };
      b.maybeSingle = () => answer().then((r) => ({ data: (r.data as unknown[])[0] ?? null, error: null }));
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
      return b;
    },
  };
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => fakeClient() }));

import { settleBy } from "@/lib/dashboard-day";
import { loadCountsTileState } from "@/lib/counts";
import { loadUnreadForUser } from "@/lib/notifications";
import { withAbortStrict } from "@/lib/pulse/abort";
import { loadRecentDeliveries } from "@/lib/receiving";
import { loadMyRetrainTasks } from "@/lib/yield-stats";
import type { AuthContext } from "@/lib/session";

const SHOP = "11111111-1111-4111-8111-111111111111";
const ME = "33333333-3333-4333-8333-333333333333";
const AGM = { user: { id: ME, name: "Ana Ruiz", role: "agm", language: "en", active: true }, session: { id: "s" }, role: "agm", level: 6, locations: [SHOP] } as unknown as AuthContext;
const NOW = new Date("2026-11-18T18:45:00.000Z");

/** Run `read` behind the page's deadline; expire it; let any late response land; report what the client saw. */
async function expire(read: (signal: AbortSignal) => Promise<unknown>) {
  const r = settleBy(read, Date.now() + 6_000, "t");
  await vi.advanceTimersByTimeAsync(5_999);
  const before = state.calls.length;
  await vi.advanceTimersByTimeAsync(1);
  const atExpiry = [...state.calls];
  await vi.advanceTimersByTimeAsync(100); // the late responses land; the reader carries on as far as it can
  return { result: await r, before, atExpiry, after: [...state.calls] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.calls = [];
  state.plan = {};
});
afterEach(() => { vi.useRealTimers(); });

describe("withAbortStrict", () => {
  it("no signal: the client itself (existing callers unchanged)", () => {
    const c = fakeClient();
    expect(withAbortStrict(c as never, undefined)).toBe(c);
  });
  it("an aborted signal: no query is built at all", () => {
    const controller = new AbortController();
    const sb = withAbortStrict(fakeClient() as never, controller.signal) as unknown as { from: (t: string) => unknown };
    sb.from("a");
    controller.abort();
    expect(() => sb.from("b")).toThrow();
    expect(state.calls.map((c) => c.table)).toEqual(["a"]);
  });
});

describe("each optional Dashboard read is cancelled at the deadline and issues nothing after it", () => {
  it("the bell: its one query carries the page signal, aborted at 6 s", async () => {
    state.plan = { notification_recipients: { hang: true, rows: () => [] } };
    const { result, atExpiry, after } = await expire((signal) => loadUnreadForUser(withAbortStrict(fakeClient() as never, signal), ME, { locationContext: [SHOP] }));
    expect(result).toEqual({ kind: "timed_out" });
    expect(atExpiry.map((c) => c.table)).toEqual(["notification_recipients"]);
    expect(atExpiry[0]!.signal!.aborted).toBe(true);
    expect(after).toHaveLength(atExpiry.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retrain: the recipes read is aborted; the names follow-up is never issued", async () => {
    state.plan = {
      recipe_yield_retrain_notes: { rows: () => [{ id: "n1", recipe_id: "r1", scope: "recipe", maker_id: null, outlier_user_ids: ["u-x"], created_by: "u-gm", created_at: "2026-11-18T12:00:00Z", note: null, status: "open", assigned_to: ME }] },
      recipes: { hang: true, rows: () => [{ id: "r1", name: "Chicken", name_es: null }] },
    };
    const { result, atExpiry, after } = await expire((signal) => loadMyRetrainTasks(AGM, SHOP, { signal }));
    expect(result).toEqual({ kind: "timed_out" });
    expect(atExpiry.map((c) => c.table)).toEqual(["recipe_yield_retrain_notes", "recipes"]);
    expect(atExpiry.every((c) => c.signal?.aborted)).toBe(true);
    expect(after.map((c) => c.table)).toEqual(atExpiry.map((c) => c.table)); // no "users" read after the deadline
  });

  it("Receiving: the hydration reads are aborted; no page two after the deadline", async () => {
    state.plan = {
      vendor_deliveries: { rows: () => [{ id: "d1", vendor_id: "v1", delivery_date: "2026-11-18", invoice_number: null, received_by: ME, match_state: "matched",
        delivery_status: "complete", receipt_url: null, email_receipt_id: null, created_at: "2026-11-18T12:00:00Z", purchase_order_id: null }] },
      // A full page of 500 lands as the abort does: a reader without the guard would ask for page two.
      vendors: { hang: true, rows: (n) => (n === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: `v${i}`, name: `V${i}` })) : []) },
    };
    const { result, atExpiry, after } = await expire((signal) => loadRecentDeliveries(AGM, SHOP, 20, { signal }));
    expect(result).toEqual({ kind: "timed_out" });
    expect(atExpiry.map((c) => c.table).sort()).toEqual(["users", "vendor_deliveries", "vendor_delivery_items", "vendors"]);
    expect(atExpiry.every((c) => c.signal?.aborted)).toBe(true);
    expect(after.filter((c) => c.table === "vendors")).toHaveLength(1);
    expect(after).toHaveLength(atExpiry.length);
  });

  it("Counts: the events read is aborted; no page two after the deadline", async () => {
    state.plan = { sku_count_events: { hang: true, rows: (n) => (n === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: `e${i}`, counted_at: "2026-11-17T20:00:00Z" })) : []) } };
    const { result, atExpiry, after } = await expire((signal) => loadCountsTileState(AGM, SHOP, { signal }));
    expect(result).toEqual({ kind: "timed_out" });
    expect(atExpiry.map((c) => c.table)).toEqual(["sku_count_events"]);
    expect(atExpiry[0]!.signal!.aborted).toBe(true);
    expect(after).toHaveLength(1); // neither events page two nor the lines read
  });

  it("control: the same readers with no signal read on to completion (the plain client, unchanged)", async () => {
    state.plan = { sku_count_events: { rows: (i) => (i === 0 ? Array.from({ length: 1000 }, (_, k) => ({ id: `e${k}`, counted_at: "2026-11-17T20:00:00Z" })) : []) } };
    await loadCountsTileState(AGM, SHOP);
    expect(state.calls.map((c) => c.table)).toEqual(["sku_count_events", "sku_count_events", "sku_count_lines"]);
    expect(state.calls.every((c) => c.signal === null)).toBe(true);
  });
});
