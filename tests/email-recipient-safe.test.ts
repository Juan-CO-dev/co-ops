/**
 * B5 review 3 — the email helper is recipient-safe for EVERY caller: a failed send logs a
 * recipient count (never the address), and provider error text is scrubbed of anything
 * email-shaped before it is logged or returned (callers store `error` in audit rows).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recipientTag, redactEmailAddresses } from "@/lib/email-redact";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

import { sendEmail } from "@/lib/email";

const ADDRESS = "Bea.Client+quotes@B-shop.example";
const mail = { to: ADDRESS, subject: "s", html: "<p>h</p>", text: "t" };
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "CO <noreply@example.test>");
  vi.stubEnv("SIM_MODE", "");
  send.mockReset();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  vi.unstubAllEnvs();
});
const logged = () => JSON.stringify(errorLog.mock.calls);

describe("redactEmailAddresses / recipientTag (pure)", () => {
  it("strips plain, mixed-case, plus-addressed and URL-encoded addresses", () => {
    expect(redactEmailAddresses(`to ${ADDRESS}, cc a@b.co and x%40y.org.`)).toBe("to [email], cc [email] and [email].");
    expect(redactEmailAddresses("no address here: 429 rate limited")).toBe("no address here: 429 rate limited");
  });
  it("describes recipients by count only", () => {
    expect(recipientTag(ADDRESS)).toBe("1 recipient");
    expect(recipientTag([ADDRESS, "a@b.co"])).toBe("2 recipients");
  });
});

describe("sendEmail failure paths never log or return the address", () => {
  it("a provider error quoting the address", async () => {
    send.mockResolvedValue({ data: null, error: { message: `Invalid \`to\` field: ${ADDRESS}`, name: "validation_error" } });
    const res = await sendEmail(mail);
    expect(res).toEqual({ error: "Invalid `to` field: [email]", code: "validation_error" });
    expect(logged()).not.toContain(ADDRESS);
    expect(logged().toLowerCase()).not.toContain("b-shop.example");
    expect(logged()).toContain("1 recipient");
  });
  it("a thrown error quoting the address, with several recipients", async () => {
    send.mockRejectedValue(new Error(`socket closed while sending to ${ADDRESS}`));
    const res = await sendEmail({ ...mail, to: [ADDRESS, "other@x.example"] });
    expect(res).toEqual({ error: "socket closed while sending to [email]" });
    expect(logged()).not.toMatch(/b-shop.example|other@x.example/i);
    expect(logged()).toContain("2 recipients");
  });
  it("a response with no id", async () => {
    send.mockResolvedValue({ data: {}, error: null });
    expect(await sendEmail(mail)).toEqual({ error: "send returned no id" });
    expect(logged()).not.toContain(ADDRESS);
  });
  it("success is unchanged", async () => {
    send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    expect(await sendEmail(mail)).toEqual({ id: "em_1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ADDRESS }), undefined);
  });
});
