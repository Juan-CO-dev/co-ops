// Catering refunds B1.3 "Sweep": the 15-minute authenticated cron. OFF and no-epoch are INERT BEFORE THE LEASE;
// recovering / live / draining take the lease, run one bounded GET-only sweep, write the heartbeat, watch siblings.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, maxDuration } from "@/app/api/cron/catering-refund-sweep/route";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { watchSiblings } from "@/lib/job-watch-run";
import { loadRefundEpoch, runRefundSweep, type RefundSweepResult } from "@/lib/catering/refund-reconcile";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({ synthetic: "client" })) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
vi.mock("@/lib/catering/refund-reconcile", () => ({ loadRefundEpoch: vi.fn(), runRefundSweep: vi.fn() }));

const SWEPT: RefundSweepResult = {
  epochState: "live", ran: true, seeded: 0, passes: 4, applied: 2, incomplete: 1, held: 0, deferred: 1, cleanups: 1,
  housekeeping: { released: 0 }, left: 3,
};
const epoch = (state: string, extra: Partial<{ callerOk: boolean; installed: boolean }> = {}) =>
  ({ state, epochId: state === "none" || state === "sealed" ? null : "00000000-0000-4000-8000-000000000001", callerOk: true, installed: true, ...extra });
const req = (auth = "Bearer vercel-test") => new NextRequest("https://example.test/api/cron/catering-refund-sweep", { headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "vercel-test");
  vi.stubEnv("CATERING_SCAN_SECRET", "");
  vi.stubEnv("CATERING_REFUNDS", "1");
  vi.mocked(loadRefundEpoch).mockResolvedValue(epoch("live") as Awaited<ReturnType<typeof loadRefundEpoch>>);
  vi.mocked(runRefundSweep).mockResolvedValue(SWEPT);
});
afterEach(() => vi.unstubAllEnvs());

function nothingTouched() {
  expect(getServiceRoleClient).not.toHaveBeenCalled();
  expect(loadRefundEpoch).not.toHaveBeenCalled();
  expect(claimCronRoute).not.toHaveBeenCalled();
  expect(runRefundSweep).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
  expect(watchSiblings).not.toHaveBeenCalled();
}

describe("catering-refund-sweep cron", () => {
  it("missing cron secret: the house 503 cron_disabled, and a wrong secret the house 401 unauthorized, before anything", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const disabled = await GET(req());
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toMatchObject({ error: "cron_disabled" });
    vi.stubEnv("CRON_SECRET", "vercel-test");
    const wrong = await GET(req("Bearer wrong"));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: "unauthorized" });
    const none = await GET(new NextRequest("https://example.test/api/cron/catering-refund-sweep"));
    expect(none.status).toBe(401);
    nothingTouched();
  });

  it.each([undefined, "", "0", "true", " 1"])("sweep route OFF (%s) = zero service-client calls: skipped before client, lease or heartbeat", async (value) => {
    vi.stubEnv("CATERING_REFUNDS", value ?? "");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "catering_refunds_off" });
    nothingTouched();
  });

  it.each(["none", "sealed"])("no-epoch (%s) = no lease and no heartbeat: 200 refunds_no_epoch", async (state) => {
    vi.mocked(loadRefundEpoch).mockResolvedValueOnce(epoch(state) as Awaited<ReturnType<typeof loadRefundEpoch>>);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: true, reason: "refunds_no_epoch" });
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runRefundSweep).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(watchSiblings).not.toHaveBeenCalled();
  });

  it.each([{ installed: false, callerOk: false }, { installed: true, callerOk: false }])(
    "schema missing or caller not admitted (%j): a NAMED, operator-visible failure (503 refunds_unavailable + cron.failure), no lease, no sweep", async (extra) => {
      vi.mocked(loadRefundEpoch).mockResolvedValueOnce(epoch("live", extra) as Awaited<ReturnType<typeof loadRefundEpoch>>);
      const res = await GET(req());
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "refunds_unavailable" });
      expect(claimCronRoute).not.toHaveBeenCalled();
      expect(runRefundSweep).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledTimes(1);
      expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure", metadata: { job: "catering-refund-sweep", error: "refunds_unavailable" } });
    });

  it.each(["recovering", "live", "draining"])("%s: the lease, one bounded sweep, a counts-only cron.success, then watchSiblings", async (state) => {
    vi.mocked(loadRefundEpoch).mockResolvedValueOnce(epoch(state) as Awaited<ReturnType<typeof loadRefundEpoch>>);
    vi.mocked(runRefundSweep).mockResolvedValueOnce({ ...SWEPT, epochState: state });
    const before = Date.now();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(claimCronRoute).toHaveBeenCalledWith("catering-refund-sweep");
    const [client, opts] = vi.mocked(runRefundSweep).mock.calls[0]!;
    expect(client).toEqual({ synthetic: "client" });
    expect(opts.deadlineMs).toBeGreaterThanOrEqual(before + 105_000);
    expect(opts.deadlineMs).toBeLessThanOrEqual(Date.now() + 105_000);
    expect(vi.mocked(audit).mock.calls).toHaveLength(1);
    const row = vi.mocked(audit).mock.calls[0]![0];
    expect(row).toMatchObject({ action: "cron.success", resourceTable: "cron", resourceId: null, actorId: null });
    expect(row.metadata).toEqual({
      job: "catering-refund-sweep", epoch_state: state, seeded: 0, passes: 4, applied: 2, incomplete: 1, held: 0,
      deferred: 1, cleanups: 1, left: 3,
    });
    expect(watchSiblings).toHaveBeenCalledWith("catering-refund-sweep");
    // The heartbeat is awaited BEFORE the watch.
    expect(vi.mocked(audit).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(watchSiblings).mock.invocationCallOrder[0]!);
  });

  it("lease held = skip: no sweep, no heartbeat", async () => {
    vi.mocked(claimCronRoute).mockResolvedValueOnce(false);
    expect(await (await GET(req())).json()).toMatchObject({ skipped: true, reason: "cron_route_busy" });
    expect(runRefundSweep).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(watchSiblings).not.toHaveBeenCalled();
  });

  it("the epoch closed between the check and the sweep (ran: false): no heartbeat", async () => {
    vi.mocked(runRefundSweep).mockResolvedValueOnce({ ...SWEPT, ran: false, epochState: "none", passes: 0 });
    expect(await (await GET(req())).json()).toEqual({ skipped: true, reason: "refunds_no_epoch" });
    expect(audit).not.toHaveBeenCalled();
  });

  it.each(["sweep", "epoch", "lease"])("a %s error = cron.failure with a fixed code + 500 carrying no detail", async (where) => {
    const boom = new Error("relation secret_table does not exist");
    if (where === "sweep") vi.mocked(runRefundSweep).mockRejectedValueOnce(boom);
    if (where === "epoch") vi.mocked(loadRefundEpoch).mockRejectedValueOnce(boom);
    if (where === "lease") vi.mocked(claimCronRoute).mockRejectedValueOnce(boom);
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
    expect(vi.mocked(audit).mock.calls).toHaveLength(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure", metadata: { job: "catering-refund-sweep", error: "refund_sweep_failed" } });
    expect(watchSiblings).not.toHaveBeenCalled();
  });

  it("maxDuration is 120, under the 330 s lease; scheduled every 15 minutes; registered all day at a 15-minute cadence", () => {
    expect(maxDuration).toBe(120);
    expect(maxDuration).toBeLessThan(330);
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons.filter((c) => c.path === "/api/cron/catering-refund-sweep")).toEqual([{ path: "/api/cron/catering-refund-sweep", schedule: "*/15 * * * *" }]);
    expect(JOBS_REGISTRY.find((j) => j.job === "catering-refund-sweep")).toEqual({
      job: "catering-refund-sweep", cadenceMinutes: 15, window: { startHourET: 0, endHourET: 24 }, source: "vercel",
    });
  });

  it("the route never imports createRefund (neither the route nor lib/catering/refund-reconcile.ts names it)", () => {
    const route = readFileSync("app/api/cron/catering-refund-sweep/route.ts", "utf8");
    const reconcile = readFileSync("lib/catering/refund-reconcile.ts", "utf8");
    expect(route).not.toContain("createRefund");
    expect(reconcile).not.toContain("createRefund");
    expect(route).not.toMatch(/@\/lib\/catering\/refunds"|@\/lib\/stripe\/client/);
    // Order of the gates, by source position: switch < client < epoch < lease < sweep < heartbeat < watch.
    const at = (s: string) => { const i = route.indexOf(s); expect(i, s).toBeGreaterThan(0); return i; };
    const order = ["cateringRefundsOn(process.env)", "getServiceRoleClient()", "loadRefundEpoch(sb)", 'claimCronRoute("catering-refund-sweep")',
      "runRefundSweep(sb", '"cron.success"', 'watchSiblings("catering-refund-sweep")'].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
