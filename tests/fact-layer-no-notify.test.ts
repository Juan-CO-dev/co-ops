// Item 2 (plan r3 §4): the fact layer sends nothing. lib/facts/** and the fact-build route import no
// email / SMS / push / notification / digest module and no sending package, and make no outbound HTTP.
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const files = [...readdirSync("lib/facts").map((n) => `lib/facts/${n}`), "app/api/cron/fact-build/route.ts"];
const SENDER = /(notif|email|mail|sms|twilio|resend|push|digest|nodemailer|web-push|whatsapp)/i;

it("no fact module imports a sender", () => {
  expect(files.length).toBeGreaterThanOrEqual(4);
  for (const f of files) {
    const imports = [...readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(imports.filter((i) => SENDER.test(i)), f).toEqual([]);
  }
});
it("no fact module makes an outbound HTTP call", () => {
  for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\bfetch\(|axios|http\.request|https\.request/);
});
