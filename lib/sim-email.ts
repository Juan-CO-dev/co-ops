import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SendEmailInput, SendEmailResult } from "./email";

/** Private, synthetic delivery only. Never return filesystem details or message contents. */
export async function captureEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const dir = process.env.SIM_EMAIL_CAPTURE_DIR;
    if (!process.env.SIM_MODE || !dir) return { error: "sim_capture_disabled" };
    const recipients = Array.isArray(input.to) ? input.to : [input.to];
    if (!recipients.length || recipients.some(to => !["customer-a@sim.invalid", "customer-b@sim.invalid"].includes(to))) {
      return { error: "sim_recipient_refused" };
    }
    const links = Array.from(input.html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi), match =>
      (match[1] ?? match[2] ?? match[3] ?? "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'"));
    const message = JSON.stringify({ to: input.to, subject: input.subject, text: input.text, html: input.html, links });
    const sha8 = createHash("sha256").update(message).update(randomUUID()).digest("hex").slice(0, 8);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, `${Date.now()}-${sha8}.json`), message, { flag: "wx", mode: 0o600 });
    return { id: `sim-${sha8}` };
  } catch {
    return { error: "sim_capture_failed" };
  }
}
