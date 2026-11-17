// Item 2 fix round 1 (review r1 #2, BC-033): a REAL per-day failure through the route. Only the lease,
// the audit writer and the service client are stand-ins; runFactBuildPass is the real one, so a day
// whose replace RPC errors must reach a cron.failure row, never a silent 200.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
const fake = vi.hoisted(() => ({ replaceError: null as { message: string } | null }));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    rpc: (name: string) => {
      const answer = name === "fact_order_days_stale"
        ? { data: [{ day_location_id: "loc", day_business_date: "2026-10-01", day_fingerprint: "f".repeat(32) }], error: null }
        : { data: fake.replaceError ? null : {}, error: fake.replaceError };
      const call = { abortSignal: () => call, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(answer).then(ok, ko) };
      return call;
    },
    from: () => {
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q, abortSignal: () => q, range: async () => ({ data: [], error: null }) };
      return q;
    },
  }),
}));
import { GET } from "@/app/api/cron/fact-build/route";
import { audit } from "@/lib/audit";

const req = () => new NextRequest("https://example.test/api/cron/fact-build", { headers: { authorization: "Bearer vercel-test" } });

describe("fact-build route, real pass", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "vercel-test"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_CAPTURE_FLOOR", "2026-09-01"); });
  it("a day whose replace fails is a cron.failure row with the day named, and no database message anywhere", async () => {
    fake.replaceError = { message: "secret detail" };
    const res = await GET(req());
    const body = await res.json();
    expect(body).toMatchObject({ healthy: false, failed: 1 });
    const row = vi.mocked(audit).mock.calls[0]![0];
    expect(row).toMatchObject({ action: "cron.failure", metadata: { job: "fact-build", error: "fact_days_failed", failed: 1,
      failures: [{ location_id: "loc", business_date: "2026-10-01", error: "fact_replace_failed" }] } });
    expect(JSON.stringify(row) + JSON.stringify(body)).not.toContain("secret");
  });
  it("the same day built is a cron.success row", async () => {
    fake.replaceError = null;
    await GET(req());
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.success", metadata: { job: "fact-build", built: 1, failed: 0 } });
  });
});
