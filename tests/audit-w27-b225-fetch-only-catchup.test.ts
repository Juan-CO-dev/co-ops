// Audit W27/B225, review r2 (P2): a FETCH-ONLY catch-up (inbound mail on, no parse key) was admitted with exactly
// one fetch window left. The claim and the inbound queue read then ate into that window, the REAL inbound sweep
// refused to start any message, and the catch-up still recorded cron.success and spent the day's one claim.
// This composes the real catch-up, the real receipt run and the real inbound sweep; only I/O is mocked, and a
// fake clock is moved by every step that costs time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catchUpDailyJobs } from "@/lib/daily-catchup";
import { audit } from "@/lib/audit";
import { INBOUND_FETCH_WINDOW_MS, PARSE_HANDOFF_MS, receiptRunMinimumMs } from "@/lib/receipt-parse-budget-shared";

const mocks = vi.hoisted(() => ({ service: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
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
const claimed: string[] = [];
/** Messages the real sweep STARTED (processInboundMessage's first read). */
let fetchStarts = 0;
/** The reviewer's numbers: a 2-second claim, a 1-second inbound queue read. */
const cost = { lookup: 0, claim: 2_000, queueRead: 1_000 };

beforeEach(() => {
  vi.resetAllMocks();
  claimed.length = 0;
  fetchStarts = 0;
  cost.claim = 2_000;
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  const from = (table: string) => {
    let job = "";
    const query = {
      select: () => query, order: () => query, limit: () => query, gte: () => query,
      in: () => query, lt: () => query, lte: () => query,
      eq: (key: string, value: string) => { if (key === "metadata->>job") job = value; return query; },
      maybeSingle: async () => {
        if (table === "inbound_messages") { fetchStarts++; return { data: null, error: null }; } // "busy"
        if (job === "parse-receipts") { clock += cost.lookup; return { data: null, error: null }; }
        return { data: { occurred_at: "2026-09-12T10:00:00.000Z" }, error: null };
      },
      returns: async () => {
        expect(table).toBe("inbound_messages");
        clock += cost.queueRead;
        return { data: [{ id: "pending-mail-1" }], error: null };
      },
    };
    return query;
  };
  const rpc = async (_name: string, args: { p_bucket_key: string }) => {
    clock += cost.claim;
    claimed.push(args.p_bucket_key);
    return { data: true, error: null };
  };
  mocks.service.mockReturnValue({ from, rpc });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const parseClaim = "catchup:parse-receipts:2026-09-12";
const receiptHeartbeats = () => vi.mocked(audit).mock.calls.map(([e]) => e)
  .filter(e => (e.metadata as { job?: string } | undefined)?.job === "parse-receipts");

describe("fetch-only catch-up admission = the handoff + one whole fetch window", () => {
  it("is derived from the shared constants", () => {
    expect(receiptRunMinimumMs(false)).toBe(PARSE_HANDOFF_MS + INBOUND_FETCH_WINDOW_MS);
  });

  it("the reviewer's case: 60 s left, 2 s claim, 1 s queue read, mail pending — skipped, today's attempt kept", async () => {
    const result = await catchUpDailyJobs({ now: today, deadline: clock + 60_000 });
    expect(result.skipped).toContain("parse-receipts");
    expect(claimed).not.toContain(parseClaim);
    expect(fetchStarts).toBe(0);
    expect(receiptHeartbeats()).toEqual([]);
  });

  it("one millisecond under the minimum is not admitted", async () => {
    const result = await catchUpDailyJobs({ now: today, deadline: clock + receiptRunMinimumMs(false) - 1 });
    expect(result.skipped).toContain("parse-receipts");
    expect(claimed).not.toContain(parseClaim);
  });

  it("at exactly the minimum, the real sweep starts the pending message and the run records success", async () => {
    const result = await catchUpDailyJobs({ now: today, deadline: clock + receiptRunMinimumMs(false) });
    expect(claimed).toContain(parseClaim);
    expect(fetchStarts).toBe(1);
    expect(result.ran).toContain("parse-receipts");
    expect(receiptHeartbeats()[0]).toMatchObject({ action: "cron.success" });
  });

  it("an admitted run whose claim overran the handoff and so started nothing records no cron.success", async () => {
    cost.claim = PARSE_HANDOFF_MS + 5_000; // a claim far slower than the handoff allows for
    const result = await catchUpDailyJobs({ now: today, deadline: clock + receiptRunMinimumMs(false) });
    expect(claimed).toContain(parseClaim); // spent (0131's claim has no release); r3: a deferral earns ONE retry claim
    expect(fetchStarts).toBe(0);
    expect(result.skipped).toContain("parse-receipts");
    expect(result.ran).not.toContain("parse-receipts");
    expect(receiptHeartbeats().filter(e => e.action === "cron.success")).toEqual([]);
    expect(receiptHeartbeats().map(e => e.action)).toEqual(["cron.deferred"]);
  });
});
