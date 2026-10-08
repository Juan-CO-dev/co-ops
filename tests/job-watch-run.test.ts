import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runJobWatch, watchSiblings } from "@/lib/job-watch-run";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "mail" })), teamFrom: () => "team@example.com" }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const jobs: string[] = [];
const rpc = vi.fn(async () => ({ data: true, error: null }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOAST_ORDER_CAPTURE", "");
  vi.stubEnv("TOAST_FIXTURES", "0");
  jobs.length = 0;
  const from = () => {
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { if (key === "metadata->>job") jobs.push(value); return query; },
      order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});

it("skips self before any lookup, including the watcher itself", async () => {
  const result = await runJobWatch({ self: "job-watch", now: new Date("2026-09-10T12:00:00Z") });
  expect(result).toEqual({ alerted: 7, checked: 7 });
  expect(jobs).not.toContain("job-watch");
  expect(new Set(jobs).size).toBe(7);
});

it("siblings can detect a silent job-watch and retain the ET claim key", async () => {
  await runJobWatch({ self: "toast-sales-today", now: new Date("2026-09-11T01:00:00Z") });
  expect(jobs).not.toContain("toast-sales-today");
  expect(rpc).toHaveBeenCalledWith("portal_rate_limit_hit", {
    p_bucket_key: "job-watch:job-watch:2026-09-10",
    p_window_start: "2026-09-10T04:00:00.000Z", p_max: 1,
  });
});

it("watchSiblings swallows a thrown lookup", async () => {
  vi.mocked(getServiceRoleClient).mockImplementation(() => { throw new Error("lookup unavailable"); });
  await expect(watchSiblings("toast-catering-scan")).resolves.toBeUndefined();
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(["toast-catering-scan", "toast-sales-today", "toast-sales-pull", "prune-sessions", "parse-receipts", "digest-tick"])(
  "%s awaits its heartbeat before watching siblings", (job) => {
    const source = readFileSync(`app/api/cron/${job}/route.ts`, "utf8");
    const heartbeat = source.indexOf("await audit(");
    const success = source.indexOf('"cron.success"', heartbeat);
    const end = source.indexOf("});", success);
    const watch = source.indexOf(`await watchSiblings("${job}")`);
    expect(heartbeat).toBeGreaterThan(0);
    expect(success).toBeGreaterThan(heartbeat);
    expect(watch).toBeGreaterThan(end);
    expect(watch).toBeLessThan(source.indexOf("return jsonOk", end));
  },
);

afterEach(() => vi.unstubAllEnvs());

it("watches capture independently only while its kill switch is enabled", async () => {
  await runJobWatch({ self: "job-watch", now: new Date("2026-09-10T12:00:00Z") });
  expect(jobs).not.toContain("toast-order-capture");
  vi.stubEnv("TOAST_ORDER_CAPTURE", "1");
  await runJobWatch({ self: "job-watch", now: new Date("2026-09-10T12:00:00Z") });
  expect(jobs).toContain("toast-order-capture");
  expect(rpc).toHaveBeenCalledWith("portal_rate_limit_hit", expect.objectContaining({ p_bucket_key: "job-watch:toast-order-capture:2026-09-10" }));
});
