import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/webhooks/meta-leads/route";

const mocks = vi.hoisted(() => ({ record: vi.fn(), process: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/meta-leads/worker", () => ({ recordMetaLead: mocks.record, processMetaLead: mocks.process }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
const secret = "test-meta-secret-only";
const url = "https://example.test/api/webhooks/meta-leads";
function payload(ids = ["101"]) {
  return { object: "page", entry: [{ id: "22", changes: ids.map(leadgen_id => ({ field: "leadgen", value: {
    leadgen_id, page_id: "22", form_id: "33", created_time: 1_800_000_000,
  } })) }] };
}
function signed(body: string, signatureBody = body) {
  return new NextRequest(url, { method: "POST", body, headers: {
    "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(Buffer.from(signatureBody)).digest("hex")}`,
  } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("META_LEADS_APP_SECRET", secret);
  vi.stubEnv("META_LEADS_VERIFY_TOKEN", "test-verifier");
  vi.stubEnv("META_LEADS_ENABLED", "1");
  mocks.record.mockResolvedValue(true);
  mocks.process.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Meta verification", () => {
  it("returns the exact challenge without touching persistence", async () => {
    const response = await GET(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=test-verifier&hub.challenge=001234`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("001234");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it.each([
    "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123",
    "hub.mode=subscribe&hub.verify_token=test-verifier&hub.challenge=script",
    "hub.mode=unsubscribe&hub.verify_token=test-verifier&hub.challenge=123",
    "hub.mode=subscribe&hub.verify_token=test-verifier",
  ])("refuses invalid verification: %s", async query => {
    expect((await GET(new NextRequest(`${url}?${query}`))).status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

it("rejects forged signatures before any ledger call or deferred work", async () => {
  const response = await POST(signed(JSON.stringify(payload()), "forged"));
  expect(response.status).toBe(401);
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});
it("authenticates original UTF-8 bytes and whitespace, not reserialized JSON", async () => {
  const body = ` \n${JSON.stringify({ ...payload(), unknown: "José 🥪" }, null, 2)}\n`;
  expect((await POST(signed(body, JSON.stringify(JSON.parse(body))))).status).toBe(401);
  expect(mocks.record).not.toHaveBeenCalled();
  expect((await POST(signed(body))).status).toBe(200);
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ leadgenId: "101", pageId: "22", formId: "33", createdAt: "2027-01-15T08:00:00.000Z" }, true);
});
it("records switch-off deliveries but never schedules creation", async () => {
  vi.stubEnv("META_LEADS_ENABLED", "0");
  expect((await POST(signed(JSON.stringify(payload())))).status).toBe(200);
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ leadgenId: "101" }), false);
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.process).not.toHaveBeenCalled();
});
it("acknowledges duplicate leadgen_id without scheduling a second application", async () => {
  mocks.record.mockResolvedValue(false);
  const response = await POST(signed(JSON.stringify(payload())));
  expect(await response.json()).toEqual({ recorded: 0, duplicate: true });
  expect(mocks.after).not.toHaveBeenCalled();
});
it("runs new deliveries only through after", async () => {
  expect((await POST(signed(JSON.stringify(payload(["101", "102"]))))).status).toBe(200);
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledOnce();
  await mocks.after.mock.calls[0]![0]();
  expect(mocks.process.mock.calls).toEqual([["101"], ["102"]]);
});
it("asks provider to retry a partially persisted batch", async () => {
  mocks.record.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("storage failure"));
  const response = await POST(signed(JSON.stringify(payload(["101", "102"]))));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: "ledger_failed" });
  expect(mocks.after).not.toHaveBeenCalled();
});
it("ignores unrelated notification fields and unknown metadata", async () => {
  const body = payload();
  body.entry[0]!.changes.unshift({ field: "feed", value: { leadgen_id: "999", page_id: "22", form_id: "33", created_time: 1_800_000_000 } });
  expect((await POST(signed(JSON.stringify({ ...body, unknown_key: "ignored" })))).status).toBe(200);
  expect(mocks.record).toHaveBeenCalledOnce();
  expect(mocks.record.mock.calls[0]![0].leadgenId).toBe("101");
});
it("bounds streamed bytes before persistence even without content length", async () => {
  expect((await POST(signed(" ".repeat(262145)))).status).toBe(413);
  expect(mocks.record).not.toHaveBeenCalled();
});
it("does not log thrown worker errors containing credentials", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.process.mockRejectedValueOnce(new Error("Bearer test-page-token"));
  await POST(signed(JSON.stringify(payload(["101", "102"]))));
  await mocks.after.mock.calls[0]![0]();
  expect(JSON.stringify(log.mock.calls)).not.toContain("test-page-token");
  expect(mocks.process).toHaveBeenCalledWith("102");
});
