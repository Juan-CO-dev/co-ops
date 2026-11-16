// Audit W27/B225, review r5 (P2): the receipt run treated `inbound.overran` as proof that work started. But the
// inbound sweep can overrun while it is still awaiting its INITIAL queue SELECT, before any message fetch begins —
// and the catch-up then wrote cron.success, so later ticks skipped the job with mail still pending.
// The rule (final, every runner): `startedNothing` comes ONLY from counters of units that actually began (fetches
// begun, parses begun, shop-day captures begun). overran / timedOut / deferred never imply work.
// The REAL catch-up, receipt run and inbound sweep; in-memory audit log and claims; fake timers drive the clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catchUpDailyJobs } from "@/lib/daily-catchup";
import { audit } from "@/lib/audit";
import { runParseReceipts } from "@/lib/parse-receipts-run";
import { parseReceipt } from "@/lib/receipt-parse";
import { PARSE_ROW_RESERVE_MS } from "@/lib/receipt-parse-budget-shared";

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
const won = new Set<string>();
const attempts: string[] = [];
const log: Array<{ action: string; job: string }> = [];
let fetchStarts = 0;
/** When true the inbound queue SELECT never resolves (the reviewer's stalled read). */
let stallInboundSelect = false;
/** When true a message fetch, once begun, never finishes. */
let hangFetch = false;
let unparsed: string[] = [];
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  won.clear(); attempts.length = 0; log.length = 0; fetchStarts = 0; stallInboundSelect = false; hangFetch = false; unparsed = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  vi.mocked(audit).mockImplementation(async (e) => {
    log.push({ action: e.action, job: String((e.metadata as { job?: string } | undefined)?.job ?? "") });
  });
  const from = (table: string) => {
    let job = ""; let action = "";
    const query = {
      select: () => query, order: () => query, limit: () => query, gte: () => query,
      in: () => query, lt: () => query, lte: () => query,
      eq: (key: string, value: string) => {
        if (key === "metadata->>job") job = value;
        if (key === "action") action = value;
        return query;
      },
      maybeSingle: async () => {
        if (table === "inbound_messages") { fetchStarts++; return hangFetch ? new Promise(() => {}) : { data: null, error: null }; }
        const hit = (action === "cron.success" && ["prune-sessions", "toast-sales-pull"].includes(job))
          || log.some(r => r.action === action && r.job === job);
        return { data: hit ? { occurred_at: "2026-09-12T11:00:00.000Z" } : null, error: null };
      },
      returns: () => {
        if (table === "email_receipts") return Promise.resolve({ data: unparsed.map(id => ({ id })), error: null });
        if (stallInboundSelect) return new Promise(() => {}); // never resolves
        advance(1_000);
        return Promise.resolve({ data: [{ id: "pending-mail-1" }], error: null });
      },
    };
    return query;
  };
  const rpc = async (_name: string, args: { p_bucket_key: string }) => {
    advance(1_000);
    attempts.push(args.p_bucket_key);
    if (won.has(args.p_bucket_key)) return { data: false, error: null };
    won.add(args.p_bucket_key);
    return { data: true, error: null };
  };
  mocks.service.mockReturnValue({ from, rpc });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function settle<T>(p: Promise<T>, ms: number): Promise<T> {
  let done = false; let value!: T;
  void p.then(v => { done = true; value = v; });
  for (let i = 0; i < ms / 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(1_000);
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toBe(true);
  return value;
}
const receiptRows = () => log.filter(r => r.job === "parse-receipts").map(r => r.action);

describe("the reviewer's stalled inbound SELECT (fetch-only, 70 s left)", () => {
  it("zero fetches -> cron.deferred (never success) -> the next tick takes the retry claim and fetches", async () => {
    stallInboundSelect = true;
    const first = await settle(catchUpDailyJobs({ now: today, deadline: Date.now() + 70_000 }), 80_000);
    expect(fetchStarts).toBe(0);
    expect(first.ran).not.toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred"]);
    expect(vi.mocked(audit).mock.calls.map(([e]) => e).find(e => e.action === "cron.deferred")?.metadata)
      .toMatchObject({ job: "parse-receipts", reason: "started_nothing", attempt: "first" });

    advance(600_000); // the next tick; the queue read answers now
    stallInboundSelect = false;
    const second = await settle(catchUpDailyJobs({ now: today, deadline: Date.now() + 200_000 }), 10_000);
    expect(attempts).toEqual(["catchup:parse-receipts:2026-09-12", "catchup:parse-receipts:2026-09-12:retry1"]);
    expect(fetchStarts).toBe(1);
    expect(second.ran).toContain("parse-receipts");
    expect(receiptRows()).toEqual(["cron.deferred", "cron.success"]);
  });
});

describe("runParseReceipts: a timeout before the first unit is startedNothing", () => {
  it("fetch leg times out in its queue read with no fetch begun -> startedNothing (overran is not work)", async () => {
    stallInboundSelect = true;
    const result = await settle(runParseReceipts(Date.now() + 70_000), 80_000);
    expect(result).toMatchObject({ dormant: false, startedNothing: true, metadata: { inbound: { overran: true } } });
    expect(fetchStarts).toBe(0);
  });

  it("with a parse key: fetch overran with nothing begun and the receipt queue empty -> still startedNothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    stallInboundSelect = true;
    const result = await settle(runParseReceipts(Date.now() + PARSE_ROW_RESERVE_MS + 200_000), 400_000);
    expect(result).toMatchObject({ startedNothing: true, parsed: 0 });
  });

  it("parse leg: no whole parse fits before the deadline, receipts waiting -> startedNothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("RESEND_API_KEY", "");
    unparsed = ["r1"];
    const result = await runParseReceipts(Date.now() + PARSE_ROW_RESERVE_MS - 1);
    expect(result).toMatchObject({ startedNothing: true, swept: 0 });
    expect(parseReceipt).not.toHaveBeenCalled();
  });

  it("a fetch that BEGAN before the leg overran counts as work started", async () => {
    hangFetch = true; // the queue read answers; the message fetch itself hangs past the share
    const result = await settle(runParseReceipts(Date.now() + 70_000), 80_000);
    expect(fetchStarts).toBe(1);
    expect(result).toMatchObject({ startedNothing: false, metadata: { inbound: { overran: true } } });
  });
});
