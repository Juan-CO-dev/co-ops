// Audit W27/B225, review r1 (P2): the daily catch-up must never spend its one claim of the day on a
// receipt run that cannot read a single receipt. This composes the REAL catch-up with the REAL
// receipt run (only I/O is mocked) and moves a fake clock through every step that costs time:
// the heartbeat lookup, the claim, the inbound fetch sweep and the queue read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catchUpDailyJobs } from "@/lib/daily-catchup";
import { audit } from "@/lib/audit";
import { parseReceipt } from "@/lib/receipt-parse";
import {
  INBOUND_FETCH_WINDOW_MS, PARSE_HANDOFF_MS, PARSE_ROW_RESERVE_MS, receiptRunMinimumMs,
} from "@/lib/receipt-parse-budget-shared";

const mocks = vi.hoisted(() => ({ sweep: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("@/lib/inbound-router", () => ({ sweepInboundMessages: mocks.sweep }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceipt: vi.fn() }));
vi.mock("@/lib/vault-scrub-run", () => ({ runVaultScrub: vi.fn(async () => ({ scrubbed: 0, migrationPending: false })) }));
vi.mock("@/lib/prune-sessions-run", () => ({ runPruneSessions: vi.fn(async () => ({ revoked: 0 })) }));
vi.mock("@/lib/toast-sales-pull-run", () => ({ runToastSalesPull: vi.fn() }));

const today = new Date("2026-09-12T12:00:00Z");
let clock = 0;
const claimed: string[] = [];
/** Time each I/O step costs on the fake clock. */
const cost = { lookup: 3_000, claim: 2_000, queueRead: 4_000, sweep: 40_000 };

beforeEach(() => {
  vi.resetAllMocks();
  claimed.length = 0;
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-parse");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  const from = (table: string) => {
    let job = "";
    let action = "";
    const query = {
      select: () => query, order: () => query, limit: () => query, gte: () => query,
      eq: (key: string, value: string) => {
        if (key === "metadata->>job") job = value;
        if (key === "action") action = value;
        return query;
      },
      // Only the receipt run is still owed today: the other catch-ups already succeeded. No run deferred
      // today (the r3 deferral lookup), so it costs nothing here and the admission boundaries stay where they were.
      maybeSingle: async () => {
        if (action === "cron.deferred") return { data: null, error: null };
        if (job === "parse-receipts") { clock += cost.lookup; return { data: null, error: null }; }
        return { data: { occurred_at: "2026-09-12T10:00:00.000Z" }, error: null };
      },
      returns: async () => {
        expect(table).toBe("email_receipts");
        clock += cost.queueRead;
        return { data: [{ id: "pending-1" }, { id: "pending-2" }], error: null };
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
  mocks.sweep.mockImplementation(async () => { clock += cost.sweep; return { swept: 3, failed: 0 }; });
  vi.mocked(parseReceipt).mockImplementation(async () => {
    clock += 60_000;
    return { ok: true } as Awaited<ReturnType<typeof parseReceipt>>;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const parseClaim = "catchup:parse-receipts:2026-09-12";
const receiptHeartbeats = () => vi.mocked(audit).mock.calls.map(([e]) => e)
  .filter(e => (e.metadata as { job?: string } | undefined)?.job === "parse-receipts");

describe("the catch-up's receipt admission comes from the shared receipt budget", () => {
  it("is one whole parse plus the handoff to it (parse key) or one fetch window (fetch only)", () => {
    expect(receiptRunMinimumMs(true)).toBe(PARSE_ROW_RESERVE_MS + PARSE_HANDOFF_MS);
    expect(receiptRunMinimumMs(false)).toBe(PARSE_HANDOFF_MS + INBOUND_FETCH_WINDOW_MS);
  });

  it("the reviewer's case: 100 s left and a 40 s inbound sweep — not admitted, today's attempt kept", async () => {
    const result = await catchUpDailyJobs({ now: today, deadline: clock + 100_000 });
    expect(result.skipped).toContain("parse-receipts");
    expect(claimed).not.toContain(parseClaim);
    expect(mocks.sweep).not.toHaveBeenCalled();
    expect(parseReceipt).not.toHaveBeenCalled();
    expect(receiptHeartbeats()).toEqual([]);
  });

  it.each([0, 1_000, 40_000, 100_000])(
    "admitted with %s ms beyond the minimum (after the lookup), a 40 s sweep still leaves a receipt parsed",
    async (extra) => {
      // The lookup runs before the admission is judged, so it is charged up front here.
      const deadline = clock + cost.lookup + receiptRunMinimumMs(true) + extra;
      const result = await catchUpDailyJobs({ now: today, deadline });
      expect(claimed).toContain(parseClaim);
      expect(result.ran).toContain("parse-receipts");
      expect(parseReceipt).toHaveBeenCalled();
      expect(receiptHeartbeats()[0]).toMatchObject({ action: "cron.success", metadata: { parsed: expect.any(Number) } });
      expect((receiptHeartbeats()[0]!.metadata as { parsed: number }).parsed).toBeGreaterThanOrEqual(1);
    },
  );

  it("never claims the day and then parses nothing: one bare parse reserve is not enough once the lookup, claim and queue read are paid", async () => {
    // The least a bare `parseFits` admission lets through: one parse reserve left after the lookup.
    const result = await catchUpDailyJobs({ now: today, deadline: clock + cost.lookup + PARSE_ROW_RESERVE_MS });
    const parsedSomething = vi.mocked(parseReceipt).mock.calls.length > 0;
    // Either it waited for the next scan with the attempt unspent, or it read at least one receipt.
    expect(claimed.includes(parseClaim) ? parsedSomething : true).toBe(true);
    expect(claimed).not.toContain(parseClaim);
    expect(result.skipped).toContain("parse-receipts");
  });

  it("one millisecond under the minimum is not admitted", async () => {
    const deadline = clock + cost.lookup + receiptRunMinimumMs(true) - 1;
    expect((await catchUpDailyJobs({ now: today, deadline })).skipped).toContain("parse-receipts");
    expect(claimed).not.toContain(parseClaim);
  });

  it("a fetch-only setup with less than the handoff and one fetch window left keeps today's attempt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const short = await catchUpDailyJobs({ now: today, deadline: clock + cost.lookup + receiptRunMinimumMs(false) - 1 });
    expect(short.skipped).toContain("parse-receipts");
    expect(claimed).not.toContain(parseClaim);
    expect(mocks.sweep).not.toHaveBeenCalled();
    const room = await catchUpDailyJobs({ now: today, deadline: clock + cost.lookup + INBOUND_FETCH_WINDOW_MS + 30_000 });
    expect(room.ran).toContain("parse-receipts");
    expect(mocks.sweep).toHaveBeenCalledOnce();
  });
});
