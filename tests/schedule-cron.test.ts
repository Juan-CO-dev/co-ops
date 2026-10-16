/**
 * Scheduling Phase 2, Task 19 — the Wednesday draft.
 *  - the route: the house cron secret (fail closed), the lease 'schedule-draft', the cron.success / cron.failure
 *    heartbeat with job 'schedule-draft'; vercel.json "15 10,11 * * 3"; NOT in JOBS_REGISTRY;
 *  - the run: only on an ET Wednesday at or after 6 AM (both UTC slots arrive; one acts in EDT and in EST, the other is
 *    idle or finds the week built); per ENABLED shop, NEXT week only when it has no revision (idempotent); demand
 *    unavailable → skipped, audited draft_skipped with its cause, nothing written; no_history builds; one shop's failure
 *    never stops the next; no shop enabled → nothing; a generator throw → generator_invalid, skipped, never committed.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({ fake: true })) }));

const { audit } = await import("@/lib/audit");
const { claimCronRoute } = await import("@/lib/cron-route-lease");
const { runWednesdayDraft } = await import("@/lib/scheduling/draft");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
const { JOBS_REGISTRY } = await import("@/lib/jobs-registry");
import { A, B, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NEXT = "2026-10-26";
const auditActions = () => vi.mocked(audit).mock.calls.map(([a]) => a.action);
const commits = (calls: Array<{ fn: string }>) => calls.filter((c) => c.fn === "commit_schedule_revision");

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("@/lib/scheduling/draft"); });

describe("the run (lib/scheduling/draft.ts)", () => {
  it("acts only on an ET Wednesday at or after 6 AM: EDT 10:15 UTC acts; Tuesday, and 5:59 AM ET, do nothing", async () => {
    const s = scheduleStore(shopTables());
    expect(await runWednesdayDraft({ service: s.client, now: new Date("2026-10-20T10:15:00Z") })).toEqual({ ran: false, reason: "not_wednesday_morning" });
    expect(await runWednesdayDraft({ service: s.client, now: new Date("2026-10-21T09:59:00Z") })).toEqual({ ran: false, reason: "not_wednesday_morning" });
    expect(s.calls).toEqual([]);
    const r = await runWednesdayDraft({ service: s.client, now: new Date("2026-10-21T10:15:00Z") }); // 06:15 EDT
    expect(r).toMatchObject({ ran: true, weekStart: NEXT, shops: [{ locationId: A, outcome: "built", weekStart: NEXT, demand: "no_history" }] });
    const c = commits(s.calls)[0]! as { fn: string; args: Record<string, unknown> };
    expect(c.args).toMatchObject({ p_actor: null, p_kind: "generated", p_expected_head: null, p_week_start: NEXT });
    expect((c.args.p_meta as Record<string, unknown>).actor_context).toBe("cron");
    expect(auditActions()).toContain("schedule.draft_auto");
  });

  it("the second UTC slot finds the week built (idempotent, skipped); in EST the 10:15 slot is idle and 11:15 acts", async () => {
    const s = scheduleStore(shopTables());
    await runWednesdayDraft({ service: s.client, now: new Date("2026-10-21T10:15:00Z") });
    const again = await runWednesdayDraft({ service: s.client, now: new Date("2026-10-21T11:15:00Z") });
    expect(again).toMatchObject({ ran: true, shops: [{ outcome: "skipped", reason: "already_built" }] });
    expect(commits(s.calls)).toHaveLength(1);
    const w = scheduleStore(shopTables());
    expect(await runWednesdayDraft({ service: w.client, now: new Date("2026-11-11T10:15:00Z") })).toEqual({ ran: false, reason: "not_wednesday_morning" }); // 05:15 EST
    expect(await runWednesdayDraft({ service: w.client, now: new Date("2026-11-11T11:15:00Z") })).toMatchObject({ ran: true, weekStart: "2026-11-16" }); // 06:15 EST
  });

  it("demand unavailable → that shop is skipped, audited schedule.draft_skipped with its cause, NOTHING written", async () => {
    const s = scheduleStore(shopTables(), { baseline: () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
    const r = await runWednesdayDraft({ service: s.client, now: new Date("2026-10-21T10:15:00Z") });
    expect(r).toMatchObject({ ran: true, shops: [{ locationId: A, outcome: "skipped", reason: "demand_unavailable" }] });
    expect(commits(s.calls)).toEqual([]);
    const skipped = vi.mocked(audit).mock.calls.find(([a]) => a.action === "schedule.draft_skipped")![0];
    expect(skipped.metadata).toMatchObject({ code: "demand_unavailable", cause: "rpc_error", actor_context: "cron" });
  });

  it("only ENABLED shops; one shop's failure never stops the next; no shop enabled → nothing runs", async () => {
    const t = shopTables();
    t.schedule_shop_settings!.push({ location_id: B, enabled: true, estimated_hourly_cents: null, estimated_salaried_weekly_cents: null, agm_access: "read" });
    const s = scheduleStore(t);
    const loadInputs = vi.fn(async (svc: Parameters<typeof loadSchedulingInputs>[0], a: Parameters<typeof loadSchedulingInputs>[1]) => {
      if (a.locationId === A) throw new Error("boom");
      return loadSchedulingInputs(svc, a);
    });
    const r = await runWednesdayDraft({ service: s.client, now: new Date("2026-10-21T10:15:00Z"), loadInputs });
    expect(r.ran && r.shops.map((x) => [x.locationId, x.outcome])).toEqual([[A, "skipped"], [B, "built"]]);
    const off = shopTables({ enabled: false });
    const o = scheduleStore(off);
    expect(await runWednesdayDraft({ service: o.client, now: new Date("2026-10-21T10:15:00Z") })).toEqual({ ran: false, reason: "no_shop_enabled" });
    expect(o.calls).toEqual([]);
  });

  it("a generator throw is audited schedule.generator_invalid and the shop is skipped — never committed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/scheduling/generator/build-shared", async (orig) => {
      const real = await orig<typeof import("@/lib/scheduling/generator/build-shared")>();
      const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
      return { ...real, buildWeek: () => { throw new ScheduleError("generator_invalid_output", { params: { count: 1 } }); } };
    });
    const { runWednesdayDraft: run } = await import("@/lib/scheduling/draft");
    const { audit: audit2 } = await import("@/lib/audit");
    const s = scheduleStore(shopTables());
    const r = await run({ service: s.client, now: new Date("2026-10-21T10:15:00Z") });
    expect(r).toMatchObject({ ran: true, shops: [{ outcome: "skipped", reason: "generator_invalid_output" }] });
    expect(commits(s.calls)).toEqual([]);
    expect(vi.mocked(audit2).mock.calls.map(([a]) => a.action)).toContain("schedule.generator_invalid");
    vi.doUnmock("@/lib/scheduling/generator/build-shared");
    vi.resetModules();
  });
});

describe("the route (app/api/cron/schedule-draft)", () => {
  const request = (headers: Record<string, string> = { authorization: "Bearer test-cron" }) => new NextRequest("https://example.com/api/cron/schedule-draft", { headers });
  it("vercel.json: Wednesdays 10:15 and 11:15 UTC; NOT in JOBS_REGISTRY (no email on a missed heartbeat)", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons.filter((c) => c.path === "/api/cron/schedule-draft")).toEqual([{ path: "/api/cron/schedule-draft", schedule: "15 10,11 * * 3" }]);
    expect(JOBS_REGISTRY.some((j) => (j.job as string) === "schedule-draft")).toBe(false);
  });
  it("the cron secret fails closed (503 / 401); the lease 'schedule-draft' is claimed; busy → skipped; a run writes the cron.success heartbeat", async () => {
    vi.resetModules();
    vi.doMock("@/lib/scheduling/draft", () => ({ runWednesdayDraft: vi.fn(async () => ({ ran: true, weekStart: NEXT, shops: [{ locationId: A, outcome: "built", weekStart: NEXT, revisionId: "r", demand: "ok" }] })) }));
    const { GET, runtime, maxDuration } = await import("@/app/api/cron/schedule-draft/route");
    const { claimCronRoute: claim } = await import("@/lib/cron-route-lease");
    const { audit: audit3 } = await import("@/lib/audit");
    const { runWednesdayDraft: run } = await import("@/lib/scheduling/draft");
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(120);
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("CATERING_SCAN_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "test-cron");
    expect((await GET(request({}))).status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
    vi.mocked(claim).mockResolvedValueOnce(false);
    expect(await (await GET(request())).json()).toEqual({ skipped: true, reason: "cron_route_busy" });
    expect(run).not.toHaveBeenCalled();
    const ok = await GET(request());
    expect(ok.status).toBe(200);
    expect(claim).toHaveBeenLastCalledWith("schedule-draft");
    const hb = vi.mocked(audit3).mock.calls.find(([a]) => a.action === "cron.success")![0];
    expect(hb.metadata).toMatchObject({ job: "schedule-draft", built: 1, week_start: NEXT });
    vi.mocked(run).mockRejectedValueOnce(new Error("db down"));
    expect((await GET(request())).status).toBe(500);
    expect(vi.mocked(audit3).mock.calls.some(([a]) => a.action === "cron.failure" && (a.metadata as Record<string, unknown>).job === "schedule-draft")).toBe(true);
  });
});

void claimCronRoute;
