import { randomBytes } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { parseReceipt } from "@/lib/receipt-parse";
import { runParseReceipts } from "@/lib/parse-receipts-run";
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/inbound-router", () => ({ sweepInboundMessages: mocks.sweep }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceipt: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_INBOUND_SECRET", "");
  mocks.service.mockReturnValue({}); mocks.sweep.mockResolvedValue({ swept: 1, failed: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("stays dormant without either configured leg", async () => {
  expect(await runParseReceipts()).toEqual({ dormant: true });
  expect(mocks.service).not.toHaveBeenCalled();
});
it("recovers inbound content even before the parse key exists", async () => {
  vi.stubEnv("RESEND_API_KEY", randomBytes(16).toString("hex"));
  vi.stubEnv("RESEND_INBOUND_SECRET", randomBytes(16).toString("hex"));
  expect(await runParseReceipts()).toMatchObject({ dormant: false, parsed: 0, metadata: { inbound: { swept: 1, failed: 0 } } });
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

it("gives fetch work 140 seconds and counts only parses begun with the full reserve", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-parse");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  const started = 1_800_000_000_000;
  let now = started;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { client, query } = receiptQuery(["first", "second", "third"]);
  mocks.sweep.mockImplementation(async () => {
    now += 140_000;
    return { swept: 25, failed: 2 };
  });
  vi.mocked(parseReceipt).mockImplementation(async () => {
    now += 60_001;
    return { ok: true } as Awaited<ReturnType<typeof parseReceipt>>;
  });
  const result = await runParseReceipts();
  expect(mocks.sweep).toHaveBeenCalledExactlyOnceWith(client, started + 140_000);
  expect(query.limit).toHaveBeenCalledWith(10);
  expect(parseReceipt).toHaveBeenCalledExactlyOnceWith(client, "first");
  expect(result).toMatchObject({ swept: 1, parsed: 1, failed: 0,
    metadata: { swept: 1, parsed: 1, failed: 0, inbound: { swept: 25, failed: 2 } } });
});

it.each([[200_000, 1], [200_001, 0]])("parse reserve boundary at %s ms begins %s rows", async (elapsed, expected) => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-parse");
  vi.stubEnv("RESEND_API_KEY", "test-fetch");
  vi.stubEnv("RESEND_INBOUND_SECRET", "test-inbound");
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  receiptQuery(["first"]);
  mocks.sweep.mockImplementation(async () => {
    now += elapsed;
    return { swept: 1, failed: 0 };
  });
  vi.mocked(parseReceipt).mockResolvedValue({ ok: false } as Awaited<ReturnType<typeof parseReceipt>>);
  const result = await runParseReceipts();
  expect(parseReceipt).toHaveBeenCalledTimes(expected);
  expect(result).toMatchObject({ swept: expected, parsed: 0, failed: expected,
    metadata: { swept: expected, parsed: 0, failed: expected } });
});
