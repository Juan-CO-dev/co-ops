import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideCatchUp } from "@/lib/daily-catchup-shared";
import { catchUpDailyJobs } from "@/lib/daily-catchup";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { runVaultScrub } from "@/lib/vault-scrub-run";
import { runPruneSessions } from "@/lib/prune-sessions-run";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { runParseReceipts } from "@/lib/parse-receipts-run";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/vault-scrub-run", () => ({ runVaultScrub: vi.fn() }));
vi.mock("@/lib/prune-sessions-run", () => ({ runPruneSessions: vi.fn() }));
vi.mock("@/lib/toast-sales-pull-run", () => ({ runToastSalesPull: vi.fn() }));
vi.mock("@/lib/parse-receipts-run", () => ({ runParseReceipts: vi.fn() }));

const entry = { job: "prune-sessions", dueUtc: "08:30" } as const;
describe("UTC catch-up decisions", () => {
  it.each([
    ["2026-09-12T09:59:59Z", null, false],
    ["2026-09-12T10:00:00Z", null, true],
    ["2026-09-12T12:00:00Z", "2026-09-12T08:30:00Z", false],
    ["2026-09-12T12:00:00Z", "2026-09-11T08:30:00Z", true],
    ["2026-09-12T12:00:00Z", "2026-09-12T00:00:00Z", false],
    ["2026-09-12T12:00:00Z", "2026-09-11T23:59:59Z", true],
    ["2026-09-13T00:00:00Z", "2026-09-12T08:30:00Z", false],
  ])("at %s with success %s: run=%s", (now, last, run) => {
    expect(decideCatchUp(entry, new Date(now), last)).toBe(run);
  });
});

const rpc = vi.fn();
const lookup = vi.fn();
const gte = vi.fn();
const claims = new Set<string>();
const now = new Date("2026-09-12T12:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  claims.clear();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
  lookup.mockResolvedValue({ data: null, error: null });
  rpc.mockImplementation(async (_name: string, args: { p_bucket_key: string }) => {
    const won = !claims.has(args.p_bucket_key);
    claims.add(args.p_bucket_key);
    return { data: won, error: null };
  });
  const from = () => {
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      gte: (key: string, value: string) => { gte(key, value); return query; },
      maybeSingle: lookup,
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(runVaultScrub).mockResolvedValue({ scrubbed: 4, migrationPending: false });
  vi.mocked(runPruneSessions).mockResolvedValue({ revoked: 3 });
  vi.mocked(runToastSalesPull).mockResolvedValue({ businessDate: "2026-09-11", results: [], healthy: true, metadata: { capture_failures: 0,
    job: "toast-sales-pull", business_date: "2026-09-11", source: "capture", dates: [], capture_skipped: false, pars_pending_activation: false, per_location_failures: 0,
    depletion_rows: {}, depletion_failures: 0, par_rows: {}, par_run_failures: 0,
    ezcater_shadow: { processed: 0, failed: 0, deferred: false },
    elapsed_completed: 0, elapsed_failed: 0, elapsed_error: null,
  } });
  vi.mocked(runParseReceipts).mockResolvedValue({ dormant: false, swept: 0, parsed: 0, failed: 0,
    metadata: { job: "parse-receipts", swept: 0, parsed: 0, failed: 0 } });
});
afterEach(() => vi.unstubAllEnvs());

it("concurrent catch-ups share one UTC claim and emit the route's metadata plus provenance", async () => {
  await Promise.all([catchUpDailyJobs({ now }), catchUpDailyJobs({ now })]);
  expect(runPruneSessions).toHaveBeenCalledTimes(1);
  expect(runVaultScrub).toHaveBeenCalledTimes(1);
  expect(runToastSalesPull).toHaveBeenCalledExactlyOnceWith({ businessDate: "2026-09-11" });
  expect(runParseReceipts).toHaveBeenCalledTimes(1);
  expect(gte).toHaveBeenCalledWith("occurred_at", "2026-09-12T00:00:00.000Z");
  expect(rpc).toHaveBeenCalledWith("portal_rate_limit_hit", {
    p_bucket_key: "catchup:prune-sessions:2026-09-12", p_window_start: "2026-09-12T00:00:00.000Z", p_max: 1,
  });
  expect(audit).toHaveBeenCalledTimes(4);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: {
    job: "prune-sessions", revoked: 3, via: "catch-up", caller: "toast-catering-scan",
  } }));
});

it("today's successes skip all work and claims", async () => {
  lookup.mockResolvedValue({ data: { occurred_at: "2026-09-12T08:30:00Z" }, error: null });
  expect((await catchUpDailyJobs({ now })).ran).toEqual([]);
  expect(rpc).not.toHaveBeenCalled();
  expect(runVaultScrub).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

it.each(["lookup", "claim"])("%s errors fail closed to work and open to the caller", async (mode) => {
  (mode === "lookup" ? lookup : rpc).mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(catchUpDailyJobs({ now })).resolves.toMatchObject({ ran: [] });
  expect(runPruneSessions).not.toHaveBeenCalled();
  expect(runVaultScrub).not.toHaveBeenCalled();
  expect(runToastSalesPull).not.toHaveBeenCalled();
  expect(runParseReceipts).not.toHaveBeenCalled();
  expect(audit).toHaveBeenCalledTimes(3);
});

it("a failed job is audited once, consumes its attempt, and does not stop other jobs", async () => {
  vi.mocked(runToastSalesPull).mockRejectedValue(new Error("pull unavailable"));
  expect((await catchUpDailyJobs({ now })).ran).toEqual(["prune-sessions", "parse-receipts"]);
  await catchUpDailyJobs({ now });
  expect(runToastSalesPull).toHaveBeenCalledTimes(1);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: {
    job: "toast-sales-pull", business_date: "2026-09-11", via: "catch-up",
    caller: "toast-catering-scan", error: "pull unavailable",
  } }));
});

it("dormant parsing has no claim, work, or heartbeat", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  expect((await catchUpDailyJobs({ now })).skipped).toEqual(["parse-receipts"]);
  expect(runParseReceipts).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(audit).toHaveBeenCalledTimes(3);
});

it("a thrown client and thrown failure audit cannot escape to the pinger", async () => {
  vi.mocked(getServiceRoleClient).mockImplementation(() => { throw new Error("unavailable"); });
  vi.mocked(audit).mockRejectedValue(new Error("audit unavailable"));
  await expect(catchUpDailyJobs({ now })).resolves.toMatchObject({ ran: [], skipped: expect.arrayContaining([entry.job]) });
});

it("only the catering scan catches up, after its heartbeat and before sibling checks", () => {
  const source = readFileSync("app/api/cron/toast-catering-scan/route.ts", "utf8");
  const catchup = source.indexOf("await catchUpDailyJobs()");
  expect(catchup).toBeGreaterThan(source.indexOf('action: "cron.success"'));
  expect(catchup).toBeLessThan(source.indexOf('await watchSiblings("toast-catering-scan")'));
  expect(readFileSync("app/api/cron/toast-sales-today/route.ts", "utf8")).not.toContain("catchUpDailyJobs");
});

it.each([
  ["prune-sessions", "runPruneSessions()"],
  ["toast-sales-pull", "runToastSalesPull({ businessDate, deadlineAt, signal: req.signal })"],
  ["parse-receipts", "runParseReceipts()"],
])("%s calls shared work", (job, call) => {
  expect(readFileSync(`app/api/cron/${job}/route.ts`, "utf8")).toContain(`await ${call}`);
});


it("partial capture failure cannot emit a successful catch-up heartbeat", async () => {
  const baseline = await vi.mocked(runToastSalesPull)({ businessDate: "2026-09-11" });
  vi.mocked(runToastSalesPull).mockResolvedValue({ ...baseline, healthy: false,
    metadata: { ...baseline.metadata, capture_failures: 1 },
  });
  expect((await catchUpDailyJobs({ now })).skipped).toContain("toast-sales-pull");
  const toastAudits = vi.mocked(audit).mock.calls.map(([entry]) => entry)
    .filter((entry) => entry.metadata?.job === "toast-sales-pull");
  expect(toastAudits).toHaveLength(1);
  expect(toastAudits[0]).toMatchObject({ action: "cron.failure", metadata: { capture_failures: 1 } });
});

it("capture failures do not withhold the selection catch-up success", async () => {
  const result = await vi.mocked(runToastSalesPull)({ businessDate: "2026-09-11" });
  vi.mocked(runToastSalesPull).mockClear().mockResolvedValue({ ...result, metadata: { ...result.metadata, capture_failures: 2 } });
  expect((await catchUpDailyJobs({ now })).ran).toContain("toast-sales-pull");
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "toast-sales-pull", capture_failures: 2 }) }));
  expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "toast-sales-pull" }) }));
});


it.each(["", "0", "1"])("catch-up scrubs and audits with VAULT_ENABLED=%s", async (enabled) => {
  vi.stubEnv("VAULT_ENABLED", enabled);
  await catchUpDailyJobs({ now });
  expect(runVaultScrub).toHaveBeenCalledOnce();
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: {
    job: "vault-scrub", scrubbed: 4, migrationPending: false, via: "catch-up", caller: "toast-catering-scan",
  } }));
});

it.each([false, true])("scrub failure does not stop prune (prune fails=%s)", async (pruneFails) => {
  vi.mocked(runVaultScrub).mockRejectedValue(new Error("private detail"));
  if (pruneFails) vi.mocked(runPruneSessions).mockRejectedValue(new Error("prune failed"));
  await catchUpDailyJobs({ now });
  expect(runPruneSessions).toHaveBeenCalledOnce();
  expect(runParseReceipts).toHaveBeenCalledOnce();
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: {
    job: "vault-scrub", error: "vault_scrub_failed", via: "catch-up", caller: "toast-catering-scan",
  } }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({
    action: pruneFails ? "cron.failure" : "cron.success", metadata: expect.objectContaining({ job: "prune-sessions" }),
  }));
  expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("private detail");
  await catchUpDailyJobs({ now });
  expect(runVaultScrub).toHaveBeenCalledOnce();
});

it("prune failure preserves the independent scrub success heartbeat", async () => {
  vi.mocked(runPruneSessions).mockRejectedValue(new Error("prune failed"));
  await catchUpDailyJobs({ now });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "vault-scrub", scrubbed: 4 }) }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "prune-sessions" }) }));
});
