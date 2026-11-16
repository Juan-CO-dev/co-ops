// Audit W27/B225, review r3 (P2): a claimed catch-up that started nothing still consumed the day's one claim
// (0131's portal_rate_limit_hit has no release), so a later tick with ample time could not run the job.
// CC's ruling: such a run writes `cron.deferred` (never success); a later tick the same UTC day, seeing no success
// and a deferral, may take ONE retry claim (`<key>:retry1`). At most two claims per job per day.
// The REAL catch-up, receipt run and inbound sweep; an in-memory audit log and rate-limit table; a fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catchUpDailyJobs, CATCH_UP_MIN_JOB_MS } from "@/lib/daily-catchup";
import { audit } from "@/lib/audit";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { INBOUND_FETCH_WINDOW_MS, PARSE_ROW_RESERVE_MS, receiptRunMinimumMs } from "@/lib/receipt-parse-budget-shared";
import { runParseReceipts } from "@/lib/parse-receipts-run";
import { parseReceipt } from "@/lib/receipt-parse";

const mocks = vi.hoisted(() => ({ service: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceipt: vi.fn() }));
vi.mock("@/lib/inbound-fetch", () => ({ fetchInboundContent: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({ ingestInboundReceipt: vi.fn() }));
vi.mock("@/lib/catering/inbox-ingest", () => ({ finalizeCateringInbound: vi.fn() }));
vi.mock("@/lib/vault-scrub-run", () => ({ runVaultScrub: vi.fn(async () => ({ scrubbed: 0, migrationPending: false })) }));
vi.mock("@/lib/prune-sessions-run", () => ({ runPruneSessions: vi.fn(async () => ({ revoked: 0 })) }));
vi.mock("@/lib/toast-sales-pull-run", () => ({ runToastSalesPull: vi.fn() }));

const today = new Date("2026-09-12T12:00:00Z");
let clock = 0;
/** Every claim attempted, in order, and the buckets that were won (p_max 1 per bucket). */
const attempts: string[] = [];
const won = new Set<string>();
/** The audit log as the catch-up writes and reads it. */
const log: Array<{ action: string; job: string }> = [];
let fetchStarts = 0;
/** The reviewer's numbers: a 15-second claim, a 1-second inbound queue read. */
const cost = { claim: 15_000, queueRead: 1_000 };
/** Jobs already caught up today (seeded success rows). */
let doneToday: string[] = [];
/** Unparsed inbound receipts waiting (parse-key runs only), and how often the run read that queue. */
let unparsed: string[] = [];
let receiptQueueReads = 0;
/** Inbound mail due for a fetch. */
let mail: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  attempts.length = 0; won.clear(); log.length = 0; fetchStarts = 0;
  unparsed = []; receiptQueueReads = 0; mail = ["pending-mail-1"];
  cost.claim = 15_000;
  doneToday = ["prune-sessions", "toast-sales-pull"];
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  vi.mocked(audit).mockImplementation(async (e) => {
    log.push({ action: e.action, job: String((e.metadata as { job?: string } | undefined)?.job ?? "") });
  });
  const from = (table: string) => {
    let job = "";
    let action = "";
    const query = {
      select: () => query, order: () => query, limit: () => query, gte: () => query,
      in: () => query, lt: () => query, lte: () => query,
      eq: (key: string, value: string) => {
        if (key === "metadata->>job") job = value;
        if (key === "action") action = value;
        return query;
      },
      maybeSingle: async () => {
        if (table === "inbound_messages") { fetchStarts++; return { data: null, error: null }; } // "busy"
        const hit = (action === "cron.success" && doneToday.includes(job))
          || log.some(r => r.action === action && r.job === job);
        return { data: hit ? { occurred_at: "2026-09-12T11:00:00.000Z" } : null, error: null };
      },
      returns: async () => {
        clock += cost.queueRead;
        if (table === "email_receipts") { receiptQueueReads++; return { data: unparsed.map(id => ({ id })), error: null }; }
        expect(table).toBe("inbound_messages");
        return { data: mail.map(id => ({ id })), error: null };
      },
    };
    return query;
  };
  const rpc = async (_name: string, args: { p_bucket_key: string; p_max: number }) => {
    clock += cost.claim;
    attempts.push(args.p_bucket_key);
    expect(args.p_max).toBe(1);
    if (won.has(args.p_bucket_key)) return { data: false, error: null };
    won.add(args.p_bucket_key);
    return { data: true, error: null };
  };
  mocks.service.mockReturnValue({ from, rpc });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const first = "catchup:parse-receipts:2026-09-12";
const retry = `${first}:retry1`;
const receiptRows = () => log.filter(r => r.job === "parse-receipts").map(r => r.action);
const deferredMeta = () => vi.mocked(audit).mock.calls.map(([e]) => e).filter(e => e.action === "cron.deferred");

describe("a claimed catch-up that started nothing is deferred and retried once", () => {
  it("the reviewer's case (70 s left, 15 s claim, 1 s read) is admitted, starts nothing, and writes cron.deferred — not success", async () => {
    expect(receiptRunMinimumMs(false)).toBe(70_000);
    const result = await catchUpDailyJobs({ now: today, deadline: clock + 70_000 });
    expect(attempts).toEqual([first]);
    expect(fetchStarts).toBe(0);
    expect(result.skipped).toContain("parse-receipts");
    expect(result.ran).not.toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred"]);
    expect(deferredMeta()[0]).toMatchObject({
      action: "cron.deferred", resourceTable: "cron", actorId: null,
      // r4: the 15 s claim leaves 55 s, less than one fetch window, so the SAME admission rule asked after the claim
      // defers it before the runner is called.
      metadata: { job: "parse-receipts", reason: "too_little_time_after_claim", attempt: "first", remaining_ms: expect.any(Number) },
    });
  });

  it("the next tick with room takes the ONE retry claim and the work actually runs", async () => {
    await catchUpDailyJobs({ now: today, deadline: clock + 70_000 });
    clock += 600_000; // the next 10-minute tick
    cost.claim = 1_000;
    const result = await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(attempts).toEqual([first, retry]);
    expect(fetchStarts).toBe(1);
    expect(result.ran).toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred", "cron.success"]);
  });

  it("a retry that also starts nothing defers again and can never take a third claim", async () => {
    await catchUpDailyJobs({ now: today, deadline: clock + 70_000 });
    clock += 600_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 70_000 });
    expect(attempts).toEqual([first, retry]);
    expect(deferredMeta().map(e => (e.metadata as { attempt: string }).attempt)).toEqual(["first", "retry1"]);
    clock += 600_000;
    cost.claim = 1_000;
    const third = await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    // It may ask, but the retry bucket is spent: no bucket beyond the two exists and nothing runs.
    expect(new Set(attempts)).toEqual(new Set([first, retry]));
    expect(won.size).toBe(2);
    expect(fetchStarts).toBe(0);
    expect(third.ran).not.toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred", "cron.deferred"]);
  });

  it("a normal successful day takes exactly one claim, writes no deferral, and later ticks claim nothing", async () => {
    cost.claim = 1_000;
    const result = await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(result.ran).toContain("parse-receipts");
    clock += 600_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(attempts).toEqual([first]);
    expect(receiptRows()).toEqual(["cron.success"]);
  });

  it("the before-claim time check still comes first: too little time claims nothing and writes nothing", async () => {
    await catchUpDailyJobs({ now: today, deadline: clock + 69_999 });
    expect(attempts).toEqual([]);
    expect(receiptRows()).toEqual([]);
  });
});

describe("the other catch-up jobs share the rule", () => {
  it("toast-sales-pull: a claim that eats the start minimum defers (no pull, no success), and the next tick retries once", async () => {
    doneToday = ["prune-sessions", "parse-receipts"];
    const healthy = { businessDate: "2026-09-11", results: [], healthy: true, metadata: { job: "toast-sales-pull" } };
    vi.mocked(runToastSalesPull).mockResolvedValue(healthy as unknown as Awaited<ReturnType<typeof runToastSalesPull>>);
    const sales = "catchup:toast-sales-pull:2026-09-12";
    await catchUpDailyJobs({ now: today, deadline: clock + CATCH_UP_MIN_JOB_MS["toast-sales-pull"]! });
    expect(attempts).toEqual([sales]);
    expect(runToastSalesPull).not.toHaveBeenCalled();
    expect(log.filter(r => r.job === "toast-sales-pull").map(r => r.action)).toEqual(["cron.deferred"]);
    expect(deferredMeta()[0]!.metadata).toMatchObject({ reason: "too_little_time_after_claim", attempt: "first" });
    clock += 600_000;
    cost.claim = 1_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(attempts).toEqual([sales, `${sales}:retry1`]);
    expect(runToastSalesPull).toHaveBeenCalledOnce();
    expect(log.filter(r => r.job === "toast-sales-pull").map(r => r.action)).toEqual(["cron.deferred", "cron.success"]);
  });

  it("prune-sessions has no start minimum and is never deferred", async () => {
    doneToday = ["toast-sales-pull", "parse-receipts"];
    await catchUpDailyJobs({ now: today, deadline: clock + 1_000 });
    expect(attempts).toEqual(["catchup:prune-sessions:2026-09-12"]);
    expect(log.filter(r => r.job === "prune-sessions").map(r => r.action)).toEqual(["cron.success"]);
  });
});

describe("review r4: after ANY claim, every job re-asks its own admission rule; a run that started nothing is deferred", () => {
  it("the reviewer's repro: fetch-only, 70 s left, a 71 s claim — zero fetches, cron.deferred (never success), and the next tick retries", async () => {
    cost.claim = 71_000;
    const result = await catchUpDailyJobs({ now: today, deadline: clock + 70_000 });
    expect(attempts).toEqual([first]);
    expect(fetchStarts).toBe(0);
    expect(result.ran).not.toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred"]);
    expect(deferredMeta()[0]!.metadata).toMatchObject({ reason: "too_little_time_after_claim", attempt: "first", remaining_ms: 0 });
    clock += 600_000; // the next tick
    cost.claim = 1_000;
    const next = await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(attempts).toEqual([first, retry]);
    expect(fetchStarts).toBe(1);
    expect(next.ran).toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred", "cron.success"]);
  });

  it("an admitted claim that leaves exactly one fetch window still runs and succeeds", async () => {
    cost.claim = 10_000 - cost.queueRead; // the claim spends the handoff minus the queue read
    const result = await catchUpDailyJobs({ now: today, deadline: clock + receiptRunMinimumMs(false) });
    expect(fetchStarts).toBe(1);
    expect(result.ran).toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.success"]);
  });

  it("backstop: the claim fits but a slow queue read leaves no fetch window — the sweep starts nothing and it is deferred", async () => {
    cost.claim = 1_000; cost.queueRead = 15_000;
    await catchUpDailyJobs({ now: today, deadline: clock + receiptRunMinimumMs(false) });
    expect(fetchStarts).toBe(0);
    expect(receiptRows()).toEqual(["cron.deferred"]);
    expect(deferredMeta()[0]!.metadata).toMatchObject({ reason: "started_nothing" });
  });

  it("parse-receipts with a parse key: a claim past the parse reserve starts no parse and no queue read, defers, and the next tick parses", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-parse");
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_INBOUND_SECRET", "");
    unparsed = ["receipt-1"];
    vi.mocked(parseReceipt).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof parseReceipt>>);
    cost.claim = receiptRunMinimumMs(true) + 1_000;
    await catchUpDailyJobs({ now: today, deadline: clock + receiptRunMinimumMs(true) });
    expect(attempts).toEqual([first]);
    expect(receiptQueueReads).toBe(0);
    expect(parseReceipt).not.toHaveBeenCalled();
    expect(receiptRows()).toEqual(["cron.deferred"]);
    clock += 600_000;
    cost.claim = 1_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(attempts).toEqual([first, retry]);
    expect(parseReceipt).toHaveBeenCalledOnce();
    expect(receiptRows()).toEqual(["cron.deferred", "cron.success"]);
  });

  it("toast-sales-pull: a claim that returns after the deadline defers it, and the next tick retries once", async () => {
    doneToday = ["prune-sessions", "parse-receipts"];
    const healthy = { businessDate: "2026-09-11", results: [], healthy: true, startedNothing: false, metadata: { job: "toast-sales-pull" } };
    vi.mocked(runToastSalesPull).mockResolvedValue(healthy as unknown as Awaited<ReturnType<typeof runToastSalesPull>>);
    const sales = "catchup:toast-sales-pull:2026-09-12";
    cost.claim = 300_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(runToastSalesPull).not.toHaveBeenCalled();
    expect(log.filter(r => r.job === "toast-sales-pull").map(r => r.action)).toEqual(["cron.deferred"]);
    clock += 600_000; cost.claim = 1_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(attempts).toEqual([sales, `${sales}:retry1`]);
    expect(log.filter(r => r.job === "toast-sales-pull").map(r => r.action)).toEqual(["cron.deferred", "cron.success"]);
  });

  it("toast-sales-pull backstop: a pull that started no capture is deferred, not a success or a failure", async () => {
    doneToday = ["prune-sessions", "parse-receipts"];
    const unstarted = { businessDate: "2026-09-11", results: [], healthy: false, startedNothing: true, metadata: { job: "toast-sales-pull" } };
    vi.mocked(runToastSalesPull).mockResolvedValue(unstarted as unknown as Awaited<ReturnType<typeof runToastSalesPull>>);
    cost.claim = 1_000;
    await catchUpDailyJobs({ now: today, deadline: clock + 280_000 });
    expect(log.filter(r => r.job === "toast-sales-pull").map(r => r.action)).toEqual(["cron.deferred"]);
    expect(deferredMeta()[0]!.metadata).toMatchObject({ reason: "started_nothing" });
  });
});

describe("review r4: the receipt run's startedNothing is computed from what ran", () => {
  it("fetch-only, deadline already past: no fetch leg ran, so it started nothing", async () => {
    const r = await runParseReceipts(clock - 1);
    expect(fetchStarts).toBe(0);
    expect(r).toMatchObject({ dormant: false, startedNothing: true });
  });

  it("fetch-only, the sweep ran and found no mail due: work done, not a deferral", async () => {
    mail = [];
    const r = await runParseReceipts(clock + INBOUND_FETCH_WINDOW_MS + 10_000);
    expect(r).toMatchObject({ startedNothing: false });
  });

  it("with a parse key and receipts waiting but no whole parse left: started nothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-parse");
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_INBOUND_SECRET", "");
    unparsed = ["receipt-1"];
    const r = await runParseReceipts(clock + PARSE_ROW_RESERVE_MS - 1);
    expect(parseReceipt).not.toHaveBeenCalled();
    expect(r).toMatchObject({ startedNothing: true });
  });
});
