import { randomBytes } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
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
afterEach(() => vi.unstubAllEnvs());
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
