/**
 * W19/B108 — an UNCLEAR send must never turn a retry into a second vendor order. sendOrderEmail passes a
 * per-confirmation Resend idempotency key, classifies the provider answer (a definite rejection is send_failed;
 * an uncertain one is send_uncertain; same key + different body is send_conflict), and on an unclear outcome marks
 * the PO "email unconfirmed" (owner decision W19-1 a + note: back to confirmed with a safe retry AND marked
 * unconfirmed until the vendor confirms). Exercised on the real sendOrderEmail body (transpiled) with a mocked
 * sendEmail — NOTHING here can reach a provider.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { providerSendOutcome } from "@/lib/email-outcome-shared";
import { poOrderIdempotencyKey } from "@/lib/po-email-shared";

const source = readFileSync("lib/po-email.ts", "utf8");
const ast = ts.createSourceFile("po-email.ts", source, ts.ScriptTarget.Latest, true);
function fnText(name: string): string {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
}
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}
type SendResult = { id: string } | { error: string; code?: string };

function setup(results: SendResult[], confirmedAt = "2026-11-15T14:00:00.000Z") {
  const sends: Array<Record<string, unknown>> = [];
  const sendEmail = vi.fn(async (input: Record<string, unknown>) => { sends.push(input); return results.shift()!; });
  const reverted: string[] = [];
  // The real recordPlacement contract: flip, run the transmit callback, revert the claim when it throws.
  const recordPlacement = vi.fn(async (_a: unknown, poId: string, _i: unknown, transmit: () => Promise<{ providerMessageId: string }>) => {
    try { await transmit(); } catch (err) { reverted.push(poId); throw err; }
  });
  const marks: Array<Record<string, unknown>> = [];
  const markEmailSendUncertain = vi.fn(async (_actor: unknown, ctx: { poId: string }, code: string) => { marks.push({ poId: ctx.poId, code }); });
  const audit = vi.fn(async () => {});
  const ctx = {
    poId: "po-1", locationId: "shop", displayCode: "CH-20261115-BALDOR", vendorName: "Baldor", locationName: "Shop",
    locationAddress: null, receiptEmail: "orders@shop.example.test", confirmedAt,
    lines: [{ skuId: "s", name: "Eggs", itemNumber: null, qty: 2, unitLabel: "cs", priceCents: null, guidePos: null, guideSection: null }],
    recipients: ["rep@vendor.example.test"],
  };
  const deps: Record<string, unknown> = {
    loadPoEmailContext: async () => ctx, emailOrderingAvailable: () => true, PurchaseOrderError,
    orderSubject: () => "Order", renderBodies: () => ({ textBody: "t", htmlBody: "<p>h</p>" }),
    recordPlacement, sendEmail, audit, providerSendOutcome, poOrderIdempotencyKey, markEmailSendUncertain,
    process: { env: { EMAIL_FROM: "ops@real.example.test" } },
  };
  const send = new Function(...Object.keys(deps), `${fnText("sendOrderEmail")}; return sendOrderEmail;`)(...Object.values(deps)) as
    (actor: unknown, poId: string) => Promise<{ providerMessageId: string }>;
  const actor = { user: { id: "kh", role: "key_holder" } };
  return { run: () => send(actor, "po-1"), sends, reverted, marks, sendEmail };
}

describe("W19/B108 the vendor order email is idempotent per confirmation", () => {
  it("passes a per-confirmation idempotency key", async () => {
    const f = setup([{ id: "re_1" }]);
    await expect(f.run()).resolves.toEqual({ providerMessageId: "re_1" });
    expect(f.sends[0]!.idempotencyKey).toBe("po-order/po-1/2026-11-15T14:00:00.000Z");
    expect(f.marks).toEqual([]);
  });

  it("a re-confirmed PO (new confirmed_at) gets a new key, so a corrected order is not suppressed", () => {
    expect(poOrderIdempotencyKey("po-1", "2026-11-15T14:00:00.000Z")).not.toBe(poOrderIdempotencyKey("po-1", "2026-11-15T15:30:00.000Z"));
    expect(poOrderIdempotencyKey("po-1", "2026-11-15T14:00:00.000Z").length).toBeLessThanOrEqual(256);
  });

  it("an uncertain provider error is send_uncertain (not send_failed), reverts to confirmed and marks the PO unconfirmed", async () => {
    const f = setup([{ error: "Unable to fetch data", code: "application_error" }]);
    await expect(f.run()).rejects.toMatchObject({ status: 502, code: "send_uncertain" });
    expect(f.reverted).toEqual(["po-1"]);
    expect(f.marks).toEqual([{ poId: "po-1", code: "send_uncertain" }]);
  });

  it("a network error with no provider code is uncertain too", async () => {
    const f = setup([{ error: "socket hang up" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
  });

  it("the retry after an uncertain send reuses the SAME key (Resend returns the first message, no duplicate)", async () => {
    const f = setup([{ error: "Internal server error", code: "internal_server_error" }, { id: "re_first" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
    await expect(f.run()).resolves.toEqual({ providerMessageId: "re_first" });
    expect(f.sends.map(s => s.idempotencyKey)).toEqual(["po-order/po-1/2026-11-15T14:00:00.000Z", "po-order/po-1/2026-11-15T14:00:00.000Z"]);
  });

  it("a definite rejection stays send_failed and leaves no unconfirmed mark", async () => {
    const f = setup([{ error: "Invalid to", code: "validation_error" }]);
    await expect(f.run()).rejects.toMatchObject({ status: 502, code: "send_failed" });
    expect(f.marks).toEqual([]);
  });

  it("same key, different body is send_conflict (409) and marks the PO unconfirmed", async () => {
    const f = setup([{ error: "mismatch", code: "invalid_idempotent_request" }]);
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "send_conflict" });
    expect(f.marks).toEqual([{ poId: "po-1", code: "send_conflict" }]);
  });
});

describe("W19/B108 wiring", () => {
  it("catering keeps one classifier: inboxDeliveryOutcome is the shared one", async () => {
    const shared = await import("@/lib/catering/inbox-delivery-shared");
    expect(shared.inboxDeliveryOutcome).toBe(providerSendOutcome);
  });

  it("po.email_send_uncertain is a registered, non-destructive audit action", async () => {
    const { NON_DESTRUCTIVE_ACTIONS } = await import("@/lib/audit-actions");
    expect((NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("po.email_send_uncertain")).toBe(true);
  });

  it("the panel reads the mark (tolerant before 0325) and shows it until the vendor confirms", () => {
    const po = readFileSync("lib/purchase-orders.ts", "utf8");
    expect(po).toContain('.select("email_send_uncertain_at")');
    const panel = readFileSync("components/ordering/PoPanel.tsx", "utf8");
    expect(panel).toMatch(/detail\.emailSendUncertainAt && !detail\.ack/);
  });
});
