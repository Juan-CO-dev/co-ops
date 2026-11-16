import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// W27 / B224: six cron routes wrote their cron.failure row with `void audit(...)` and answered 500 at once. On Vercel
// the instance can be frozen as soon as the response is sent, so the row could be lost — the failure never reached
// the job-health card. The failure heartbeat is now awaited before the answer (audit() is fail-open: never throws).
const boom = () => { throw new Error("job exploded"); };
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
vi.mock("@/lib/daily-catchup", () => ({ catchUpDailyJobs: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/toast-sales-pull-run", () => ({ runToastSalesPull: vi.fn(async () => boom()) }));
vi.mock("@/lib/toast/capture-intraday", () => ({ captureIntraday: vi.fn(async () => boom()) }));
vi.mock("@/lib/toast/capture-modified", () => ({ captureModified: vi.fn(async () => ({ failures: 0, results: [], skipped: false })) }));
vi.mock("@/lib/toast/labor", () => ({ laborPullEnabled: () => false, runToastLaborPull: vi.fn(async () => ({ ran: false })) }));
vi.mock("@/lib/whos-here-tick", () => ({ runWhosHereTick: vi.fn(async () => ({ ran: false })) }));
vi.mock("@/lib/catering/toast-catering-scan", () => ({ scanToastCateringForAllLocations: vi.fn(async () => boom()) }));
vi.mock("@/lib/sevenshifts/config", () => ({ sevenShiftsStatus: () => ({ reason: "ready" }) }));
vi.mock("@/lib/sevenshifts/sync", () => ({ runSevenShiftsSync: vi.fn(async () => boom()) }));
vi.mock("@/lib/parse-receipts-run", () => ({ runParseReceipts: vi.fn(async () => boom()) }));
vi.mock("@/lib/report-digests", () => ({ runDigestTick: vi.fn(async () => boom()) }));

import { audit } from "@/lib/audit";
import { GET as salesPull } from "@/app/api/cron/toast-sales-pull/route";
import { GET as salesToday } from "@/app/api/cron/toast-sales-today/route";
import { GET as cateringScan } from "@/app/api/cron/toast-catering-scan/route";
import { GET as sevenShifts } from "@/app/api/cron/sevenshifts-sync/route";
import { GET as parseReceipts } from "@/app/api/cron/parse-receipts/route";
import { GET as digestTick } from "@/app/api/cron/digest-tick/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe.each([
  ["toast-sales-pull", salesPull],
  ["toast-sales-today", salesToday],
  ["toast-catering-scan", cateringScan],
  ["sevenshifts-sync", sevenShifts],
  ["parse-receipts", parseReceipts],
  ["digest-tick", digestTick],
] as const)("%s", (_job, get) => {
  it("awaits its failure heartbeat before answering", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(audit).mockImplementation(async (input) => { if (input.action === "cron.failure") await gate; });
    let settled = false;
    const pending = get(new NextRequest("https://x.test/api/cron/job?date=2026-11-15", { headers: { authorization: "Bearer s" } }))
      .then((r) => { settled = true; return r; });
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure" }));
    expect(settled).toBe(false);
    release();
    const res = await pending;
    expect(res.status).toBe(500);
  });
});
