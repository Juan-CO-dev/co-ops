import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEmail } from "../lib/sim-email";
import { sendEmail, type SendEmailInput } from "../lib/email";

const input: SendEmailInput = { to: "customer-a@sim.invalid", subject: "Synthetic link", text: "Synthetic only", html: '<a href="http://localhost:3100/order/verify?token=synthetic&amp;x=1">Sign in</a><a HREF=\'/order\'>Home</a><a href=/order/start>Start</a>' };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sim-email-"));
  vi.stubEnv("SIM_MODE", "1"); vi.stubEnv("SIM_EMAIL_CAPTURE_DIR", dir);
  vi.stubEnv("RESEND_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });

describe("private sim email capture", () => {
  it.each([["", ""], ["", "dir"], ["1", ""]])("requires BOTH controls (%s, %s)", async (mode, capture) => {
    vi.stubEnv("SIM_MODE", mode); vi.stubEnv("SIM_EMAIL_CAPTURE_DIR", capture ? dir : "");
    expect(await captureEmail(input)).toEqual({ error: "sim_capture_disabled" });
    expect(await sendEmail(input)).toEqual({ error: "RESEND_API_KEY is not set" });
    expect(await readdir(dir)).toEqual([]);
  });
  it("captures through sendEmail with the unchanged result shape and every href", async () => {
    const result = await sendEmail(input);
    expect(result).toEqual({ id: expect.stringMatching(/^sim-[a-f0-9]{8}$/) });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d+-[a-f0-9]{8}\.json$/);
    expect(JSON.parse(await readFile(join(dir, files[0]!), "utf8"))).toEqual({ ...input, links: ["http://localhost:3100/order/verify?token=synthetic&x=1", "/order", "/order/start"] });
  });
  it.each(["foreign@sim.invalid", ["customer-a@sim.invalid", "foreign@sim.invalid"], []])("refuses the whole foreign/empty recipient set (%s)", async to => {
    expect(await sendEmail({ ...input, to })).toEqual({ error: "sim_recipient_refused" });
    expect(await readdir(dir)).toEqual([]);
  });
  it("allows both synthetic recipients and preserves concurrent identical messages", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => captureEmail({ ...input, to: ["customer-a@sim.invalid", "customer-b@sim.invalid"] })));
    expect(results.every(result => "id" in result)).toBe(true);
    expect(await readdir(dir)).toHaveLength(8);
  });
  it("never throws or exposes private paths on an IO failure", async () => {
    const file = join(dir, "not-a-directory"); await writeFile(file, "synthetic");
    vi.stubEnv("SIM_EMAIL_CAPTURE_DIR", file);
    expect(await sendEmail(input)).toEqual({ error: "sim_capture_failed" });
  });
});
