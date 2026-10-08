import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseAfterSettledClose, runWhosHereTick } from "@/lib/whos-here-tick";
import { runAutoLinks } from "@/lib/toast/employee-links";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/employee-links", () => ({ runAutoLinks: vi.fn(async () => ({ linked: 1, skipped: 0 })) }));

const order: string[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: { ok: true, closed: false }, error: null };
const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
  order.push(`${name}:${String(args.p_day)}:${String(args.p_settled)}`);
  const p = Promise.resolve(rpcResult);
  return Object.assign(p, { abortSignal: () => p });
});
beforeEach(() => {
  vi.clearAllMocks(); order.length = 0; rpcResult = { data: { ok: true, closed: false }, error: null };
  vi.stubEnv("TOAST_CLIENT_ID", ""); vi.stubEnv("TOAST_CLIENT_SECRET", ""); vi.stubEnv("TOAST_FIXTURES", "1");
  vi.mocked(runAutoLinks).mockImplementation(async () => { order.push("autolink"); return { linked: 1, skipped: 0 }; });
  vi.mocked(getServiceRoleClient).mockReturnValue({
    rpc,
    from() {
      const q = { select: () => q, eq: () => q, abortSignal: () => q, returns: async () => ({ data: [{ id: "loc-1", toast_restaurant_guid: "r-1" }], error: null }) };
      return q;
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.unstubAllEnvs());

describe("who's-here tick (r1)", () => {
  it("P2-8: WHOS_HERE off = no database call at all (the flag is the off switch)", async () => {
    expect(await runWhosHereTick({ deadlineMs: 5_000, autolink: true })).toEqual({ ran: false, results: [] });
    await releaseAfterSettledClose("loc-1", "2026-10-08");
    expect(getServiceRoleClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("P1-5: the tick reconciles today + yesterday UNSETTLED (a fresh confirm waits); the confirm route's call is settled", async () => {
    vi.stubEnv("WHOS_HERE", "1");
    await runWhosHereTick({ deadlineMs: 5_000, autolink: false, now: new Date("2026-10-08T16:00:00Z") });
    expect(order).toEqual(["reconcile_shop_closed:2026-10-08:false", "reconcile_shop_closed:2026-10-07:false"]);
    order.length = 0;
    await releaseAfterSettledClose("loc-1", "2026-10-08");
    expect(order).toEqual(["reconcile_shop_closed:2026-10-08:true"]);
  });
  it("P1-4: a busy shop/day is a skip, not a failure; an RPC error is a fixed code and never throws", async () => {
    vi.stubEnv("WHOS_HERE", "1");
    rpcResult = { data: { ok: false, skipped: "busy" }, error: null };
    const busy = await runWhosHereTick({ deadlineMs: 5_000, autolink: false });
    expect(busy.results.every((r) => r.ok === false && (r.detail as { skipped: string }).skipped === "busy")).toBe(true);
    rpcResult = { data: null, error: { message: "canceling statement due to statement timeout" } };
    const failed = await runWhosHereTick({ deadlineMs: 5_000, autolink: false });
    expect(failed.results.map((r) => r.error)).toEqual(["whos_here_shop_closed_failed", "whos_here_shop_closed_failed"]);
    expect(JSON.stringify(failed)).not.toContain("canceling statement");
    await expect(releaseAfterSettledClose("loc-1", "2026-10-08")).resolves.toBeUndefined();
  });
  it("P2-6: auto-linking is its own step AFTER the shop-close reconcile, with the step's signal; failures are fail-soft", async () => {
    vi.stubEnv("WHOS_HERE", "1");
    const res = await runWhosHereTick({ deadlineMs: 5_000, autolink: true });
    expect(order.at(-1)).toBe("autolink");
    const args = vi.mocked(runAutoLinks).mock.calls[0]![1];
    expect(args.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(args.rawEmployees)).toContain("emp-ana");
    expect(res.results.find((r) => r.step === "autolink")).toMatchObject({ ok: true });
    vi.mocked(runAutoLinks).mockRejectedValueOnce(new Error("toast_autolink_failed"));
    const soft = await runWhosHereTick({ deadlineMs: 5_000, autolink: true });
    expect(soft.results.find((r) => r.step === "autolink")).toMatchObject({ ok: false, error: "toast_autolink_failed" });
  });
  it("P2-6: the labor pull no longer links anything (its budget is labor's alone)", () => {
    const labor = readFileSync("lib/toast/labor.ts", "utf8");
    expect(labor).not.toMatch(/runAutoLinks|employee-links|WHOS_HERE/);
    const route = readFileSync("app/api/cron/toast-sales-today/route.ts", "utf8");
    expect(route.indexOf("runToastLaborPull([today]")).toBeLessThan(route.indexOf("runWhosHereTick({"));
    expect(route).toMatch(/whosHereBudgetMs = Math\.min\(15_000/);
  });
  it("P1-5: the confirm route releases only after a SUCCESSFUL closing confirm", () => {
    const route = readFileSync("app/api/checklist/confirm/route.ts", "utf8");
    const success = route.indexOf("const result = await confirmInstance(");
    const call = route.indexOf("after(() => releaseAfterSettledClose(confirmed.locationId, confirmed.date))");
    expect(call).toBeGreaterThan(success);
    expect(route.slice(success, call)).toContain(`if (result.templateType === "closing") {`);
  });
});
