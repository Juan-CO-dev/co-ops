import { randomBytes } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { parseReceipt } from "@/lib/receipt-parse";
import { runParseReceipts } from "@/lib/parse-receipts-run";
import { PARSE_HANDOFF_MS, PARSE_ROW_RESERVE_MS, fetchShareDeadline } from "@/lib/receipt-parse-budget-shared";
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/inbound-router", () => ({ sweepInboundMessages: mocks.sweep }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceipt: vi.fn() }));
/** What the cron route hands the run: its 300 s limit less the 20 s tail. */
const RUN_MS = 280_000;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_INBOUND_SECRET", "");
  mocks.service.mockReturnValue({}); mocks.sweep.mockResolvedValue({ swept: 1, failed: 0 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("stays dormant without either configured leg", async () => {
  expect(await runParseReceipts(Date.now() + RUN_MS)).toEqual({ dormant: true });
  expect(mocks.service).not.toHaveBeenCalled();
});
it("recovers inbound content even before the parse key exists", async () => {
  vi.stubEnv("RESEND_API_KEY", randomBytes(16).toString("hex"));
  vi.stubEnv("RESEND_INBOUND_SECRET", randomBytes(16).toString("hex"));
  expect(await runParseReceipts(Date.now() + RUN_MS)).toMatchObject({ dormant: false, parsed: 0, metadata: { inbound: { swept: 1, failed: 0 } } });
  expect(mocks.sweep).toHaveBeenCalledOnce();
});


function receiptQuery(ids: string[]) {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query),
    limit: vi.fn(() => query), returns: vi.fn(async () => ({ data: ids.map(id => ({ id })), error: null })),
  };
  const client = { from: vi.fn(() => query) };
  mocks.service.mockReturnValue(client);
  return { client, query };
}

function bothLegs() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-parse");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
}

// W20/B115: a row is started only with the full 170 s (150 s model call + 20 s) still in hand.
it("fetching stops where one whole parse is still left, and only parses begun with the full reserve count", async () => {
  bothLegs();
  const started = 1_800_000_000_000;
  let now = started;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { client, query } = receiptQuery(["first", "second", "third"]);
  mocks.sweep.mockImplementation(async () => {
    now += 50_000;
    return { swept: 25, failed: 2 };
  });
  vi.mocked(parseReceipt).mockImplementation(async () => {
    now += 60_001;
    return { ok: true } as Awaited<ReturnType<typeof parseReceipt>>;
  });
  const result = await runParseReceipts(started + RUN_MS);
  // The fetch share is worked out, not typed: the run less one parse and the handoff to it.
  expect(fetchShareDeadline(started + RUN_MS)).toBe(started + RUN_MS - PARSE_ROW_RESERVE_MS - PARSE_HANDOFF_MS);
  expect(mocks.sweep).toHaveBeenCalledExactlyOnceWith(client, started + 100_000, { started: 0 });
  expect(query.limit).toHaveBeenCalledWith(10);
  expect(parseReceipt).toHaveBeenCalledExactlyOnceWith(client, "first");
  expect(result).toMatchObject({ swept: 1, parsed: 1, failed: 0,
    metadata: { swept: 1, parsed: 1, failed: 0, inbound: { swept: 25, failed: 2 } } });
});

// Review r3 (P3): fetching could use 140 s of the 280 s run while a parse needs 170 s, so a
// stretch of slow fetching read no receipt at all, sweep after sweep. This runs that stretch.
it("sustained slow fetching: every sweep still reads a receipt, and the queue drains across sweeps", async () => {
  bothLegs();
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const queue = ["oldest", "middle", "newest"];
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
    // The queue read between the two legs takes real time too.
    returns: vi.fn(async () => { now += 5_000; return { data: queue.map(id => ({ id })), error: null }; }),
  };
  mocks.service.mockReturnValue({ from: vi.fn(() => query) });
  // Fetching uses every millisecond it is given, every sweep.
  mocks.sweep.mockImplementation(async (_sb: unknown, fetchDeadline: number) => {
    now = Math.max(now, fetchDeadline);
    return { swept: 25, failed: 0 };
  });
  // Every parse is a worst case: the whole reserve.
  vi.mocked(parseReceipt).mockImplementation(async (_sb, id) => {
    now += PARSE_ROW_RESERVE_MS;
    queue.splice(queue.indexOf(id), 1);
    return { ok: true } as Awaited<ReturnType<typeof parseReceipt>>;
  });
  const parsedPerSweep: number[] = [];
  for (let sweep = 0; sweep < 3; sweep++) {
    const started = now;
    const result = await runParseReceipts(started + RUN_MS);
    parsedPerSweep.push(result.dormant ? -1 : result.parsed);
    expect(now, `sweep ${sweep + 1} ends inside its limit`).toBeLessThanOrEqual(started + RUN_MS);
    now = started + 15 * 60_000; // the next 15-minute run
  }
  expect(parsedPerSweep).toEqual([1, 1, 1]);
  expect(queue).toEqual([]);
  expect(vi.mocked(parseReceipt).mock.calls.map(call => call[1])).toEqual(["oldest", "middle", "newest"]);
});

it("a fetch leg that never comes back still leaves parsing its share", async () => {
  bothLegs();
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  const started = Date.now();
  const { client } = receiptQuery(["first"]);
  mocks.sweep.mockImplementation(() => new Promise(() => {})); // hung: storage or the provider never answers
  vi.mocked(parseReceipt).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof parseReceipt>>);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const run = runParseReceipts(started + RUN_MS);
  await vi.advanceTimersByTimeAsync(fetchShareDeadline(started + RUN_MS) - started - 1);
  expect(parseReceipt).not.toHaveBeenCalled(); // fetching keeps its whole share
  await vi.advanceTimersByTimeAsync(1);
  expect(parseReceipt).toHaveBeenCalledExactlyOnceWith(client, "first"); // and not a millisecond of parsing's
  await expect(run).resolves.toMatchObject({ swept: 1, parsed: 1, failed: 0,
    metadata: { inbound: { swept: 0, failed: 0, overran: true } } });
  expect(errors).toHaveBeenCalledWith(expect.stringContaining("overran its share"));
});

it("a fetch leg that fails after its share is logged; it cannot fail the parses that went ahead", async () => {
  bothLegs();
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  const started = Date.now();
  receiptQuery(["first"]);
  mocks.sweep.mockImplementation(() => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("inbound_sweep_failed")), 200_000);
  }));
  vi.mocked(parseReceipt).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof parseReceipt>>);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const run = runParseReceipts(started + RUN_MS);
  await vi.advanceTimersByTimeAsync(100_000);
  await expect(run).resolves.toMatchObject({ parsed: 1 });
  await vi.advanceTimersByTimeAsync(100_000); // the late failure lands; an unhandled rejection would fail this file
  expect(errors).toHaveBeenCalledWith(expect.stringContaining("failed after its share"), "inbound_sweep_failed");
});

it("a fetch leg that fails inside its share still fails the run, as before", async () => {
  bothLegs();
  receiptQuery(["first"]);
  mocks.sweep.mockRejectedValue(new Error("inbound_sweep_failed"));
  await expect(runParseReceipts(Date.now() + RUN_MS)).rejects.toThrow("inbound_sweep_failed");
  expect(parseReceipt).not.toHaveBeenCalled();
});

it("with room for one parse and no more, the parse is kept and fetching waits for the next run", async () => {
  bothLegs();
  const now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { client } = receiptQuery(["first"]);
  vi.mocked(parseReceipt).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof parseReceipt>>);
  const result = await runParseReceipts(now + PARSE_ROW_RESERVE_MS + 1_000);
  expect(mocks.sweep).not.toHaveBeenCalled();
  expect(parseReceipt).toHaveBeenCalledExactlyOnceWith(client, "first");
  expect(result).toMatchObject({ parsed: 1, metadata: { inbound: { swept: 0, failed: 0 } } });
});

it("with no parse key there is no parse to keep time for: fetching gets the whole run", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  const client = {};
  mocks.service.mockReturnValue(client);
  const deadline = Date.now() + RUN_MS;
  await runParseReceipts(deadline);
  expect(mocks.sweep).toHaveBeenCalledExactlyOnceWith(client, deadline, { started: 0 });
});

it.each([[110_000, 1], [110_001, 0]])("parse admission boundary: with %s ms of the run gone, %s rows begin", async (elapsed, expected) => {
  bothLegs();
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  receiptQuery(["first"]);
  mocks.sweep.mockImplementation(async () => {
    now += elapsed;
    return { swept: 1, failed: 0 };
  });
  vi.mocked(parseReceipt).mockResolvedValue({ ok: false } as Awaited<ReturnType<typeof parseReceipt>>);
  const result = await runParseReceipts(now + RUN_MS);
  expect(parseReceipt).toHaveBeenCalledTimes(expected);
  expect(result).toMatchObject({ swept: expected, parsed: 0, failed: expected,
    metadata: { swept: expected, parsed: 0, failed: expected } });
});

