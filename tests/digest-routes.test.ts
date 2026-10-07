import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/digest-tick/route";
import { audit } from "@/lib/audit";
import { runDigestTick } from "@/lib/report-digests";
import { watchSiblings } from "@/lib/job-watch-run";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { DIGEST_TICK_WINDOW } from "@/lib/report-digests-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
vi.mock("@/lib/report-digests", () => ({ runDigestTick: vi.fn(async () => null) }));

const request = (headers: Record<string, string> = { "x-cron-secret": "pinger" }) =>
  new NextRequest("https://example.com/api/cron/digest-tick", { headers });

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CATERING_SCAN_SECRET", "pinger"); });
afterEach(() => vi.unstubAllEnvs());

describe("/api/cron/digest-tick", () => {
  it("503 when the pinger secret is unset, 401 on a wrong secret — before any work", async () => {
    vi.stubEnv("CATERING_SCAN_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("CATERING_SCAN_SECRET", "pinger");
    expect((await GET(request({}))).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer nope" }))).status).toBe(401);
    expect(runDigestTick).not.toHaveBeenCalled();
  });

  it("OFF still heartbeats (job-watch sees a live pinger) and then watches siblings", async () => {
    const res = await GET(request({ authorization: "Bearer pinger" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "off", counts: null });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "digest-tick", mode: "off" }) }));
    expect(watchSiblings).toHaveBeenCalledWith("digest-tick");
    expect(vi.mocked(audit).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(watchSiblings).mock.invocationCallOrder[0]!);
  });

  it("a thrown tick is a cron.failure + 500, never a heartbeat", async () => {
    vi.mocked(runDigestTick).mockRejectedValueOnce(new Error("report_settings: down"));
    expect((await GET(request())).status).toBe(500);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: { job: "digest-tick", error: "report_settings: down" } }));
    expect(vi.mocked(audit).mock.calls.some(([row]) => row.action === "cron.success")).toBe(false);
    expect(watchSiblings).not.toHaveBeenCalled();
  });
});

describe("scheduling stays in one place (Hobby: no new Vercel cron)", () => {
  it("the registry's digest-tick window is DIGEST_TICK_WINDOW, starting at 03:00 ET for the fallback", () => {
    const entry = JOBS_REGISTRY.find((j) => j.job === "digest-tick");
    expect(entry).toEqual({ job: "digest-tick", cadenceMinutes: 10, window: DIGEST_TICK_WINDOW, source: "pinger" });
    expect(DIGEST_TICK_WINDOW.startHourET).toBeLessThanOrEqual(3);
  });

  it("vercel.json gains no cron", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string }> };
    expect(config.crons).toHaveLength(4);
    expect(config.crons.some((c) => c.path.includes("digest"))).toBe(false);
  });
});

describe("the closing finalize hook", () => {
  it("runs the digests in after() for a closing only, beside the sales pull, after the confirm succeeded", () => {
    const source = readFileSync("app/api/checklist/confirm/route.ts", "utf8");
    const confirm = source.indexOf("await confirmInstance(");
    const gate = source.indexOf('if (result.templateType === "closing")', confirm);
    const hook = source.indexOf("after(() => runClosingDigests(confirmed.locationId, confirmed.date))", gate);
    const close = source.indexOf("}", hook);
    expect(confirm).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(confirm);
    expect(hook).toBeGreaterThan(gate);
    expect(close).toBeLessThan(source.indexOf("return jsonOk({", gate));
    expect(source.match(/runClosingDigests\(/g)).toHaveLength(1);
  });
});
