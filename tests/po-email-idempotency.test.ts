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
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerSendOutcome } from "@/lib/provider-send-outcome-shared";
import { PO_EMAIL_RETRY_WINDOW_MS, poOrderIdempotencyKey } from "@/lib/po-email-shared";

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
    beginEmailAttempt: async () => ({ fresh: false }), clearEmailAttempt: async () => {},
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

/**
 * Fix round 1 — Resend keeps an idempotency key for 24 hours only. The FIRST attempt for a confirmation is recorded
 * durably BEFORE the send (0325 email_attempt_key / email_attempt_at); a retry of the same confirmation past the safe
 * window is refused (409 send_window_expired) instead of reaching the vendor a second time. Real beginEmailAttempt /
 * clearEmailAttempt bodies run against an in-memory purchase_orders row; time is advanced with fake timers.
 */
type Row = { email_attempt_key: string | null; email_attempt_at: string | null };
function windowSetup(results: SendResult[], opts: { row?: Row; readError?: { code: string; message: string } } = {}) {
  const row: Row = opts.row ?? { email_attempt_key: null, email_attempt_at: null };
  const sb = {
    from(table: string) {
      if (table !== "purchase_orders") throw new Error(`unexpected table ${table}`);
      const filters: Array<[string, unknown]> = [];
      let payload: Partial<Row> | null = null;
      const matches = () => filters.every(([c, v]) => c === "id" ? v === "po-1" : (row as Record<string, unknown>)[c] === v);
      const q = {
        select: () => q,
        update: (p: Partial<Row>) => { payload = p; return q; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        maybeSingle: async () => opts.readError ? { data: null, error: opts.readError } : { data: { ...row }, error: null },
        then: (ok: (r: { error: null }) => unknown) => { if (payload && matches()) Object.assign(row, payload); return Promise.resolve({ error: null }).then(ok); },
      };
      return q;
    },
  };
  const helpers = ["beginEmailAttempt", "clearEmailAttempt"].map(fnText).join(";\n");
  const sends: Array<Record<string, unknown>> = [];
  const sendEmail = vi.fn(async (input: Record<string, unknown>) => { sends.push(input); return results.shift()!; });
  const recordPlacement = vi.fn(async (_a: unknown, _p: string, _i: unknown, transmit: () => Promise<{ providerMessageId: string }>) => { await transmit(); });
  const ctx = {
    poId: "po-1", locationId: "shop", displayCode: "CH-20261115-BALDOR", vendorName: "Baldor", locationName: "Shop",
    locationAddress: null, receiptEmail: "orders@shop.example.test", confirmedAt: "2026-11-15T14:00:00.000Z",
    lines: [{ skuId: "s", name: "Eggs", itemNumber: null, qty: 2, unitLabel: "cs", priceCents: null, guidePos: null, guideSection: null }],
    recipients: ["rep@vendor.example.test"],
  };
  const deps: Record<string, unknown> = {
    loadPoEmailContext: async () => ctx, emailOrderingAvailable: () => true, PurchaseOrderError,
    orderSubject: () => "Order", renderBodies: () => ({ textBody: "t", htmlBody: "<p>h</p>" }),
    recordPlacement, sendEmail, audit: vi.fn(async () => {}), providerSendOutcome, poOrderIdempotencyKey,
    markEmailSendUncertain: vi.fn(async () => {}), getServiceRoleClient: () => sb, PO_EMAIL_RETRY_WINDOW_MS,
    process: { env: { EMAIL_FROM: "ops@real.example.test" } }, console: { error: () => {} },
  };
  const send = new Function(...Object.keys(deps), `${helpers};\n${fnText("sendOrderEmail")}; return sendOrderEmail;`)(...Object.values(deps)) as
    (actor: unknown, poId: string) => Promise<{ providerMessageId: string }>;
  return { run: () => send({ user: { id: "kh", role: "key_holder" } }, "po-1"), row, sends, sendEmail };
}
const KEY = "po-order/po-1/2026-11-15T14:00:00.000Z";
const T0 = Date.parse("2026-11-15T14:05:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("W19/B108 fix round 1: no automatic retry past Resend's 24 h key retention", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("the safe window is shorter than Resend's 24 h retention", () => {
    expect(PO_EMAIL_RETRY_WINDOW_MS).toBeLessThan(24 * HOUR);
    expect(PO_EMAIL_RETRY_WINDOW_MS).toBeGreaterThan(HOUR);
  });

  it("records the first attempt BEFORE sending (key + time), so a crash mid-send still leaves the record", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    let seenAtSend: Row | null = null;
    const f = windowSetup([]);
    f.sendEmail.mockImplementationOnce(async () => { seenAtSend = { ...f.row }; return { id: "re_1" }; });
    await f.run();
    expect(seenAtSend).toEqual({ email_attempt_key: KEY, email_attempt_at: new Date(T0).toISOString() });
  });

  it("an unclear send, retried 2 days later, is REFUSED (409 send_window_expired) and nothing is sent again", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = windowSetup([{ error: "Internal server error", code: "internal_server_error" }, { id: "re_dup" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
    vi.setSystemTime(T0 + 48 * HOUR);
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "send_window_expired" });
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.row.email_attempt_at).toBe(new Date(T0).toISOString()); // the FIRST attempt stays the anchor
  });

  it("an unclear send, retried inside the window, still retries with the same key (dedup by Resend)", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = windowSetup([{ error: "socket hang up" }, { id: "re_first" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
    vi.setSystemTime(T0 + 2 * HOUR);
    await expect(f.run()).resolves.toEqual({ providerMessageId: "re_first" });
    expect(f.sends.map(s => s.idempotencyKey)).toEqual([KEY, KEY]);
    expect(f.row.email_attempt_at).toBe(new Date(T0).toISOString());
  });

  it("the window is measured from the FIRST attempt, not the latest one", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = windowSetup([{ error: "socket hang up" }, { error: "socket hang up" }, { id: "re_x" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
    vi.setSystemTime(T0 + 20 * HOUR);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
    vi.setSystemTime(T0 + 25 * HOUR);
    await expect(f.run()).rejects.toMatchObject({ code: "send_window_expired" });
    expect(f.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("a DEFINITE rejection (nothing went out) clears the fresh record, so a send days later is allowed", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = windowSetup([{ error: "Invalid to", code: "validation_error" }, { id: "re_ok" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_failed" });
    expect(f.row).toEqual({ email_attempt_key: null, email_attempt_at: null });
    vi.setSystemTime(T0 + 48 * HOUR);
    await expect(f.run()).resolves.toEqual({ providerMessageId: "re_ok" });
  });

  it("a definite rejection AFTER an unclear attempt keeps the unclear attempt's record", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = windowSetup([{ error: "socket hang up" }, { error: "Invalid to", code: "validation_error" }]);
    await expect(f.run()).rejects.toMatchObject({ code: "send_uncertain" });
    vi.setSystemTime(T0 + HOUR);
    await expect(f.run()).rejects.toMatchObject({ code: "send_failed" });
    expect(f.row).toEqual({ email_attempt_key: KEY, email_attempt_at: new Date(T0).toISOString() });
  });

  it("a record from an EARLIER confirmation (different key) is replaced, not treated as expired", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = windowSetup([{ id: "re_new" }], { row: { email_attempt_key: "po-order/po-1/2026-11-10T09:00:00.000Z", email_attempt_at: "2026-11-10T09:01:00.000Z" } });
    await expect(f.run()).resolves.toEqual({ providerMessageId: "re_new" });
    expect(f.row.email_attempt_key).toBe(KEY);
  });

  it("before 0325 (no columns) the send still goes, key-only (the window guard needs 0325)", async () => {
    const f = windowSetup([{ id: "re_pre" }], { readError: { code: "42703", message: "column does not exist" } });
    await expect(f.run()).resolves.toEqual({ providerMessageId: "re_pre" });
  });

  it("any other read error refuses before sending (503 attempt_not_recorded)", async () => {
    const f = windowSetup([{ id: "never" }], { readError: { code: "08006", message: "connection failure" } });
    await expect(f.run()).rejects.toMatchObject({ status: 503, code: "attempt_not_recorded" });
    expect(f.sendEmail).not.toHaveBeenCalled();
  });

  it("the new messages exist in en + es, and the old 'no duplicate' promises are time-qualified", async () => {
    const en = (await import("@/lib/i18n/en.json")).default as Record<string, string>;
    const es = (await import("@/lib/i18n/es.json")).default as Record<string, string>;
    for (const k of ["ordering.po.error.send_window_expired", "ordering.po.error.attempt_not_recorded"]) {
      expect(en[k]).toBeTruthy(); expect(es[k]).toBeTruthy();
    }
    for (const k of ["ordering.po.error.send_uncertain", "ordering.po.send_unconfirmed.confirmed"]) {
      expect(en[k]).toMatch(/23 hours/); expect(es[k]).toMatch(/23 horas/);
    }
  });
});
