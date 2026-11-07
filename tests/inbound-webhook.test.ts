import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn(), process: vi.fn(), verify: vi.fn(), after: vi.fn(), parse: vi.fn() }));
vi.mock("@/lib/inbound-parse", () => ({ parseFetchedInboundMessage: mocks.parse }));
vi.mock("@/lib/inbound-router", () => ({ recordInboundMessage: mocks.record, processInboundMessage: mocks.process }));
vi.mock("@/lib/webhook-verify-shared", () => ({ verifySvixSignature: mocks.verify }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "@/app/api/webhooks/resend-inbound/route";
const request = () => new NextRequest("https://app.example.test/api/webhooks/resend-inbound", { method: "POST", body: JSON.stringify({ type: "email.received", data: { email_id: "fixture-message" } }) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("RESEND_INBOUND_SECRET", randomBytes(20).toString("hex")); mocks.verify.mockReturnValue(true); });
afterEach(() => vi.unstubAllEnvs());
it("keeps dormant 503", async () => {
  vi.stubEnv("RESEND_INBOUND_SECRET", "");
  expect((await POST(request())).status).toBe(503); expect(mocks.record).not.toHaveBeenCalled();
});
it("verifies signature before ledger", async () => {
  mocks.verify.mockReturnValue(false);
  expect((await POST(request())).status).toBe(401); expect(mocks.record).not.toHaveBeenCalled();
});
it("duplicates return 200 without scheduling or ingesting a second time", async () => {
  mocks.record.mockResolvedValue({ duplicate: true });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ duplicate: true });
  expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
});
it("ledger failure returns 500 for provider retry", async () => {
  mocks.record.mockRejectedValue(new Error("inbound_ledger_failed"));
  expect((await POST(request())).status).toBe(500); expect(mocks.after).not.toHaveBeenCalled();
});
it("commits ledger before deferring content work", async () => {
  mocks.record.mockResolvedValue({ duplicate: false, id: "fixture-row" });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.record.mock.invocationCallOrder[0]).toBeLessThan(mocks.after.mock.invocationCallOrder[0]!);
  expect(mocks.process).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0]![0](); expect(mocks.process).toHaveBeenCalledWith("fixture-row");
});

it("parses the fetched receipt in after within the route budget", async () => {
  mocks.record.mockResolvedValue({ duplicate: false, id: "fixture-row" });
  mocks.process.mockResolvedValue("fetched");
  const started = Date.now();
  await POST(request());
  await mocks.after.mock.calls[0]![0]();
  expect(mocks.parse).toHaveBeenCalledWith("fixture-row", expect.any(Number));
  expect(mocks.parse.mock.calls[0]![1]).toBeGreaterThanOrEqual(started + 160_000);
});
