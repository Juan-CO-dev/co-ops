import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/job-watch/route";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "mail" })), teamFrom: () => "team@example.com" }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const claims = new Set<string>();
const rpc = vi.fn(async (_name: string, args: { p_bucket_key: string }) => {
  const won = !claims.has(args.p_bucket_key);
  claims.add(args.p_bucket_key);
  return { data: won, error: null };
});
const request = (headers: Record<string, string> = { authorization: "Bearer test-cron" }) =>
  new NextRequest("https://example.com/api/cron/job-watch", { headers });

beforeEach(() => {
  vi.clearAllMocks();
  claims.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  vi.stubEnv("CRON_SECRET", "test-cron");
  vi.stubEnv("OPS_ALERT_EMAIL", "operator@example.com");
  const from = () => {
    let action = "";
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { if (key === "action") action = value; return query; },
      order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: action === "cron.success" ? { created_at: "2026-09-05T23:06:00Z" } : null, error: null }),
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("LRA-228: dormant/unauthorized requests stop before database work", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(request())).status).toBe(503);
  vi.stubEnv("CRON_SECRET", "test-cron");
  expect((await GET(request({}))).status).toBe(401);
  expect((await GET(request({ "x-cron-secret": "bad-secret" }))).status).toBe(401);
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("LRA-228: overlapping/retried runs produce one email and one failure per silent job", async () => {
  const responses = await Promise.all([GET(request()), GET(request({ "x-cron-secret": "test-cron" }))]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  await GET(request());
  expect(sendEmail).toHaveBeenCalledTimes(5);
  const failures = vi.mocked(audit).mock.calls.map(([row]) => row).filter((row) => row.action === "cron.failure");
  expect(failures).toHaveLength(5);
  expect(new Set(failures.map((row) => row.metadata.job)).size).toBe(5);
  expect(failures.every((row) => row.metadata.detector === "job-watch" && row.metadata.expected_by)).toBe(true);
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "operator@example.com", from: "team@example.com" }));
  expect(vi.mocked(sendEmail).mock.calls[0]![0].text).toContain("Última señal");
  expect(vi.mocked(audit).mock.calls.filter(([row]) => row.action === "cron.success")).toHaveLength(3);
});

it("LRA-228: an email error is recorded in that job's sole failure row and does not fail the cron", async () => {
  vi.mocked(sendEmail).mockResolvedValueOnce({ error: "transport unavailable" });
  expect((await GET(request())).status).toBe(200);
  const failures = vi.mocked(audit).mock.calls.map(([row]) => row).filter((row) => row.action === "cron.failure");
  expect(failures).toHaveLength(5);
  expect(failures[0]!.metadata.email_error).toBe("transport unavailable");
});

it("LRA-228: claim errors fail closed, sending nothing", async () => {
  rpc.mockRejectedValueOnce(new Error("claim unavailable"));
  expect((await GET(request())).status).toBe(500);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: { job: "job-watch", error: "job_watch_failed" } }));
});
