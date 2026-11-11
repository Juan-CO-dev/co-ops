import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resend = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: resend.send }; } }));
import { MAX_REFERENCES, sendEmail, threadingHeaders } from "@/lib/email";

const id = (n: number) => `<msg-${n}@example.test>`;
describe("lib/email threading headers (catering inbox phase 1b)", () => {
  beforeEach(() => { vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("EMAIL_FROM", "catering@example.test"); vi.stubEnv("SIM_MODE", ""); resend.send.mockResolvedValue({ data: { id: "email-1" }, error: null }); });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("existing callers are unchanged: no threading fields → no headers key, no idempotency option", async () => {
    await sendEmail({ to: "a@example.test", subject: "s", html: "<p>h</p>", text: "t" });
    expect(resend.send).toHaveBeenCalledTimes(1);
    const [payload, options] = resend.send.mock.calls[0]!;
    expect(payload).toEqual({ from: "catering@example.test", to: "a@example.test", subject: "s", html: "<p>h</p>", text: "t" });
    expect(payload).not.toHaveProperty("headers");
    expect(options).toBeUndefined();
  });
  it("passes validated In-Reply-To and References through, with the idempotency key", async () => {
    const result = await sendEmail({ to: "a@example.test", subject: "s", html: "h", text: "t", inReplyTo: id(1), references: [id(0), id(1)], idempotencyKey: "k" });
    expect(result).toEqual({ id: "email-1" });
    const [payload, options] = resend.send.mock.calls[0]!;
    expect(payload.headers).toEqual({ "In-Reply-To": id(1), References: `${id(0)} ${id(1)}` });
    expect(options).toEqual({ idempotencyKey: "k" });
  });
  it.each(["msg@example.test", "<no-at>", "<a b@example.test>", "<a@b>\r\nBcc: x@example.test", ""])("refuses a malformed In-Reply-To %j without a provider call", async bad => {
    const result = await sendEmail({ to: "a@example.test", subject: "s", html: "h", text: "t", inReplyTo: bad });
    expect(result).toEqual({ error: "invalid_threading", code: "invalid_threading" });
    expect(resend.send).not.toHaveBeenCalled();
  });
  it("refuses a malformed reference anywhere in the chain", () => {
    expect(threadingHeaders({ references: [id(1), "bad"] })).toBeNull();
    expect(threadingHeaders({ references: [id(1)] })).toEqual({ References: id(1) });
  });
  it("bounds References to the newest ids and the character budget, de-duplicated", () => {
    const many = Array.from({ length: 50 }, (_, n) => id(n));
    const kept = threadingHeaders({ references: [...many, id(49)] })!.References!.split(" ");
    expect(kept).toHaveLength(MAX_REFERENCES);
    expect(kept[0]).toBe(id(50 - MAX_REFERENCES)); expect(kept.at(-1)).toBe(id(49));
    const long = Array.from({ length: 15 }, (_, n) => `<${"x".repeat(190)}${n}@example.test>`);
    expect(threadingHeaders({ references: long })!.References!.length).toBeLessThanOrEqual(2000);
  });
  it("still never throws on a provider failure, and keeps the provider's error name as code", async () => {
    resend.send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "bad" } });
    expect(await sendEmail({ to: "a@example.test", subject: "s", html: "h", text: "t", inReplyTo: id(1) })).toEqual({ error: "bad", code: "validation_error" });
    resend.send.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await sendEmail({ to: "a@example.test", subject: "s", html: "h", text: "t" })).toEqual({ error: "socket hang up" });
  });
});
