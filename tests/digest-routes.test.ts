import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/digest-tick/route";
import { audit } from "@/lib/audit";
import { runDigestTick } from "@/lib/report-digests";
import { watchSiblings } from "@/lib/job-watch-run";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { DIGEST_TICK_WINDOW, etClock } from "@/lib/report-digests-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
vi.mock("@/lib/report-digests", () => ({ runDigestTick: vi.fn(async () => null) }));

const request = (headers: Record<string, string> = { "x-cron-secret": "pinger" }) =>
  new NextRequest("https://example.com/api/cron/digest-tick", { headers });

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CATERING_SCAN_SECRET", "pinger"); vi.stubEnv("CRON_SECRET", "vercel"); });
afterEach(() => vi.unstubAllEnvs());

describe("/api/cron/digest-tick", () => {
  it("503 when both secrets are unset, 401 on a wrong secret — before any work", async () => {
    vi.stubEnv("CATERING_SCAN_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("CATERING_SCAN_SECRET", "pinger");
    vi.stubEnv("CRON_SECRET", "vercel");
    expect((await GET(request({}))).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer nope" }))).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer pinger" }))).status).toBe(200); // back-compat: pre-Vercel-backup the pinger secret was accepted as Bearer
    expect((await GET(request({ "x-cron-secret": "vercel" }))).status).toBe(401);
    expect((await GET(request({ "x-cron-secret": "nope", authorization: "Bearer vercel" }))).status).toBe(401);
    expect(runDigestTick).toHaveBeenCalledTimes(1);
  });

  it("accepts the desktop header and Vercel bearer independently", async () => {
    expect((await GET(request())).status).toBe(200);
    expect((await GET(request({ authorization: "Bearer vercel" }))).status).toBe(200);
    vi.stubEnv("CATERING_SCAN_SECRET", "");
    expect((await GET(request({ authorization: "Bearer vercel" }))).status).toBe(200);
    expect((await GET(request())).status).toBe(401);
    expect(runDigestTick).toHaveBeenCalledTimes(3);
  });

  it("OFF still heartbeats (job-watch sees a live pinger) and then watches siblings", async () => {
    const res = await GET(request({ authorization: "Bearer vercel" }));
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

describe("overnight Vercel schedule", () => {
  it("the registry's digest-tick window is DIGEST_TICK_WINDOW, starting at 03:00 ET for the fallback", () => {
    const entry = JOBS_REGISTRY.find((j) => j.job === "digest-tick");
    expect(entry).toEqual({ job: "digest-tick", cadenceMinutes: 60, window: DIGEST_TICK_WINDOW, source: "pinger" });
    expect(DIGEST_TICK_WINDOW.startHourET).toBeLessThanOrEqual(3);
  });

  it("covers 03:00 ET in winter, summer and on both DST change days", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons).toHaveLength(5);
    expect(config.crons.filter((c) => c.path === "/api/cron/digest-tick")).toEqual([{ path: "/api/cron/digest-tick", schedule: "0 4-9 * * *" }]);
    for (const [day, expectedUtcHour] of [["2026-01-15", 8], ["2026-07-15", 7], ["2026-03-08", 7], ["2026-11-01", 8]] as const) {
      const hits = Array.from({ length: 6 }, (_, i) => i + 4).filter((hour) => {
        const instant = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
        const clock = etClock(instant);
        return clock.day === day && clock.minutes === 180;
      });
      expect(hits).toEqual([expectedUtcHour]);
    }
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
