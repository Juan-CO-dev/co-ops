import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// W27 / B223: the nightly pull's work budget used to equal the platform limit (maxDuration), so a run that used its
// whole budget left no time for the route's own heartbeat and sibling watch — killed with no cron.success row.
const runToastSalesPull = vi.fn(async (_opts: { deadlineAt: number }) => ({ results: [], metadata: { job: "toast-sales-pull" }, healthy: true }));
vi.mock("@/lib/toast-sales-pull-run", () => ({ runToastSalesPull: (o: { deadlineAt: number }) => runToastSalesPull(o) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));

import { GET, maxDuration } from "@/app/api/cron/toast-sales-pull/route";

beforeEach(() => { vi.stubEnv("CRON_SECRET", "s"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("toast-sales-pull route deadline", () => {
  it("the nightly pull's deadline leaves a tail for the heartbeat", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const res = await GET(new NextRequest("https://x.test/api/cron/toast-sales-pull?date=2026-11-15", { headers: { authorization: "Bearer s" } }));
    expect(res.status).toBe(200);
    const { deadlineAt } = runToastSalesPull.mock.calls[0]![0];
    expect(deadlineAt).toBeLessThanOrEqual(now + maxDuration * 1000 - 15_000);
    expect(deadlineAt).toBeGreaterThan(now + 200_000);
  });
});
