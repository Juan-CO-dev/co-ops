/**
 * Unit spine — RESEND AN EXPIRED QUOTE WITH A NEW EXPIRY (owner request, Juan 2026-11-15:
 * "expired quotes should be able to be resent, not remade").
 *
 * Until now the only way back from an expired offer was a revise: a new row, a new id, the
 * payments carried across — for a quote in which nothing had changed. `resendExpiredQuote`
 * (lib/catering/quotes.ts) gives the SAME quote a new expiry and sends it again.
 *
 * What is pinned here:
 *   - IT IS THE SAME QUOTE. Same id, same lines, same payments; no row is inserted anywhere,
 *     nothing is superseded, the ONLY write is one update of the quote row.
 *   - ONLY AN EXPIRED OPEN OFFER. `sent` or `submitted`, past its `expires_at` (the shared
 *     clock rule). Not expired → `not_expired`. Accepted / declined / draft / hand-marked
 *     expired → `invalid_status`. A superseded revision → `not_current`.
 *   - SEND'S PERMISSION, EXACTLY. `QUOTE_RESEND_MIN` IS `QUOTE_WRITE_MIN`, bound to the quote's
 *     shop; the route takes Send's Tier B step-up.
 *   - THE WRITE IS A COMPARE-AND-SET on the row as read: a revise, a status change or another
 *     resend landing under it matches nothing — 409, no email, no audit row.
 *   - AFTERWARDS payability and the staff accept follow the NEW expiry.
 *   - A PAYMENT THAT LANDED AFTER THE OLD EXPIRY STAYS FLAGGED: its row is untouched and the
 *     resend names it (`latePaymentIds`, `late_payment_ids` on the audit row).
 *   - ONE EMAIL PATH: the message is the one Send sends, through the same mailer call.
 *
 * `resendExpiredQuote` reaches for the service client itself, so that import is replaced with
 * tests/payments-fake-client.ts; `audit` and THE MAILER ARE MOCKED — nothing is sent, there
 * is no database and no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

const { session, stepUp } = vi.hoisted(() => ({
  session: { ctx: null as unknown },
  stepUp: { result: { ok: true } as { ok: true } | { ok: false; code: string } },
}));
let db: PaymentsFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "email_1" })), teamFrom: () => "Team <team@example.com>" }));
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return { ...actual, stripeCredentialsFor: vi.fn(() => null), retireCheckoutSession: vi.fn(async () => "expired") };
});
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, requireSession: async () => session.ctx };
});
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => stepUp.result }));

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import {
  CateringQuoteError,
  QUOTE_RESEND_MAX_DAYS,
  QUOTE_RESEND_MIN,
  QUOTE_WRITE_MIN,
  resendExpiredQuote,
  sendQuote,
  setQuoteStatus,
} from "@/lib/catering/quotes";
import { quoteExpiryInstantForEtDate } from "@/lib/catering/quotes-shared";
import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";
import { isKnownAuditAction } from "@/lib/audit-actions";
import { quotePayability } from "@/lib/portal/payability-shared";
import { isCateringStepUpPath, isStepUpSurface, type AuthContext } from "@/lib/session";
import { POST as resendRoute } from "@/app/api/catering/quotes/[id]/resend/route";

const auditMock = vi.mocked(audit);
const sendEmailMock = vi.mocked(sendEmail);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const OTHER_LOCATION = "b0000000-0000-4000-8000-000000000002";
const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";

/** "Now" for every lib call: 2026-11-15 17:00 UTC (noon ET). */
const NOW = Date.parse("2026-11-15T17:00:00.000Z");
/** The offer lapsed two weeks ago. */
const OLD_EXPIRY = "2026-11-01T03:59:59.000Z";
/** Good through Nov 30 (ET): the last second of that day. */
const NEW_EXPIRY = "2026-12-01T04:59:59.000Z";

const actor = (role: string, locations: string[] = [LOCATION], id = "u-" + role) =>
  ({ user: { id, role }, locations }) as unknown as AuthContext;
const cateringMgr = actor("catering_mgr");
const gm = actor("gm");
const shiftLead = actor("shift_lead");
const gmElsewhere = actor("gm", [OTHER_LOCATION], "u-gm-b");

function quote(over: Row = {}): Row {
  return {
    id: QUOTE,
    root_id: null,
    version: 1,
    pipeline_id: null,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    status: "sent",
    origin: "staff",
    event_date: "2026-12-20",
    headcount: 30,
    subtotal_cents: 100000,
    total_cents: 100000,
    deposit_cents: 20000,
    expires_at: OLD_EXPIRY,
    created_at: "2026-10-18T00:00:00.000Z",
    sent_at: "2026-10-18T01:00:00.000Z",
    sent_by: "u-original-sender",
    superseded_at: null,
    ...over,
  };
}

function payment(over: Row = {}): Row {
  return {
    id: DEPOSIT,
    quote_id: QUOTE,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 20000,
    status: "paid",
    provider: "stripe",
    provider_ref: "pi_1",
    provider_session_id: null,
    paid_at: "2026-10-25T00:00:00.000Z", // inside the old window
    settlement_cleanup_at: "2026-10-25T00:00:01.000Z",
    ...over,
  };
}

const LINES: Row[] = [
  { id: "i0000000-0000-4000-8000-000000000001", quote_id: QUOTE, description: "Sub tray", quantity: 4, unit_price_cents: 20000, line_total_cents: 80000, display_order: 0 },
  { id: "i0000000-0000-4000-8000-000000000002", quote_id: QUOTE, description: "Chips", quantity: 40, unit_price_cents: 500, line_total_cents: 20000, display_order: 1 },
];

const quoteRow = () => db.tables.catering_quotes!.find((q) => q.id === QUOTE)!;
const snapshot = (table: string) => JSON.parse(JSON.stringify(db.tables[table] ?? [])) as Row[];
const writes = () => db.ops.filter((o) => o.kind === "update" || o.kind === "insert");
const auditOf = (action: string) => auditMock.mock.calls.map((c) => c[0]).filter((a) => a.action === action);

async function refusal(p: Promise<unknown>): Promise<CateringQuoteError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CateringQuoteError) return e;
    throw e;
  }
  throw new Error("expected a CateringQuoteError, but the call succeeded");
}

function seed(quoteOver: Row = {}, payments: Row[] = []) {
  db = paymentsFake({
    catering_quotes: [quote(quoteOver)],
    catering_quote_items: LINES.map((l) => ({ ...l })),
    catering_payments: payments,
    catering_customers: [{ id: CUSTOMER, name: "Pat", email: "pat@example.com", primary_location_id: LOCATION }],
    users: [
      { id: cateringMgr.user.id, role: "catering_mgr", active: true },
      { id: gm.user.id, role: "gm", active: true },
    ],
    user_locations: [
      { user_id: cateringMgr.user.id, location_id: LOCATION, active: true },
      { user_id: gm.user.id, location_id: LOCATION, active: true },
    ],
    locations: [{ id: LOCATION, code: "EM" }],
  });
}

beforeEach(() => {
  auditMock.mockClear();
  sendEmailMock.mockClear();
  sendEmailMock.mockImplementation(async () => ({ id: "email_1" }));
  stepUp.result = { ok: true };
  session.ctx = cateringMgr;
  seed();
});

describe("resend an expired quote — it is the SAME quote with a new expiry", () => {
  it("extends the expiry, keeps the id, the lines and the payments, inserts nothing, and emails the customer once", async () => {
    seed({}, [payment()]);
    const linesBefore = snapshot("catering_quote_items");
    const paymentsBefore = snapshot("catering_payments");

    const out = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);

    expect(out).toMatchObject({
      expiresAt: NEW_EXPIRY,
      previousExpiresAt: OLD_EXPIRY,
      emailed: true,
      emailOutcome: "sent",
      recipient: "pat@example.com",
      latePaymentIds: [],
    });
    // The same row — there is still exactly one quote, and it is still this id, still live.
    expect(db.tables.catering_quotes).toHaveLength(1);
    expect(quoteRow()).toMatchObject({
      id: QUOTE,
      status: "sent",
      version: 1,
      root_id: null,
      superseded_at: null,
      expires_at: NEW_EXPIRY,
      total_cents: 100000,
      deposit_cents: 20000,
      // A quote the team had sent is sent AGAIN: by this person, now.
      sent_at: new Date(NOW).toISOString(),
      sent_by: cateringMgr.user.id,
    });
    // Same lines, same payments — byte for byte.
    expect(snapshot("catering_quote_items")).toEqual(linesBefore);
    expect(snapshot("catering_payments")).toEqual(paymentsBefore);
    // ONE write in the whole call: the quote row. No insert anywhere (no revision, no intent).
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "catering_quotes", kind: "update", matched: 1 });
    expect(Object.keys(writes()[0]!.payload as Row).sort()).toEqual(["expires_at", "sent_at", "sent_by"]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("is audited as `catering.quote.resend` — a registered, DESTRUCTIVE action — with the old and the new expiry", async () => {
    await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);

    expect(isKnownAuditAction("catering.quote.resend")).toBe(true);
    expect(DESTRUCTIVE_ACTIONS).toContain("catering.quote.resend");
    const rows = auditOf("catering.quote.resend");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: cateringMgr.user.id,
      actorRole: "catering_mgr",
      resourceTable: "catering_quotes",
      resourceId: QUOTE,
      metadata: {
        status: "sent",
        previous_expires_at: OLD_EXPIRY,
        expires_at: NEW_EXPIRY,
        late_payment_ids: [],
        emailed: true,
        email_outcome: "sent",
        total_cents: 100000,
      },
    });
    // It is not ALSO recorded as a Send: one act, one row.
    expect(auditOf("catering.quote.send")).toEqual([]);
  });

  it("a self-serve SUBMITTED order that expired is resent too — and stays `submitted`, never stamped as sent by the team", async () => {
    seed({ status: "submitted", origin: "self_serve", sent_at: null, sent_by: null });

    const out = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);

    expect(out.expiresAt).toBe(NEW_EXPIRY);
    expect(quoteRow()).toMatchObject({ id: QUOTE, status: "submitted", expires_at: NEW_EXPIRY, sent_at: null, sent_by: null });
    expect(Object.keys(writes()[0]!.payload as Row)).toEqual(["expires_at"]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(auditOf("catering.quote.resend")[0]!.metadata).toMatchObject({ status: "submitted" });
  });

  it("uses the ONE quote email: the same message, to the same address, that Send sends", async () => {
    await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);
    const resent = sendEmailMock.mock.calls[0]![0];

    seed({ expires_at: "2099-01-01T00:00:00.000Z" }); // an open quote, for Send
    sendEmailMock.mockClear();
    await sendQuote(cateringMgr, QUOTE);
    const sent = sendEmailMock.mock.calls[0]![0];

    expect(resent).toEqual(sent);
    expect(resent).toMatchObject({ to: "pat@example.com", subject: "Your catering quote from Compliments Only" });
  });

  it("a quote with no customer, or a mailer failure, still gets its new expiry — and says what happened to the email", async () => {
    seed({ customer_id: null });
    const none = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);
    expect(none).toMatchObject({ emailed: false, emailOutcome: "no_customer" });
    expect(quoteRow().expires_at).toBe(NEW_EXPIRY);
    expect(sendEmailMock).not.toHaveBeenCalled();

    seed();
    sendEmailMock.mockImplementationOnce(async () => ({ error: "smtp down" }) as never);
    const failed = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);
    expect(failed).toMatchObject({ emailed: false, emailOutcome: "send_failed" });
    expect(quoteRow().expires_at).toBe(NEW_EXPIRY);
    expect(auditOf("catering.quote.resend").at(-1)!.metadata).toMatchObject({ email_outcome: "send_failed" });
  });
});

describe("resend an expired quote — payability and the accept follow the NEW expiry", () => {
  const payable = () => {
    const q = quoteRow();
    return quotePayability({ status: String(q.status), supersededAt: (q.superseded_at as string | null) ?? null, expiresAt: (q.expires_at as string | null) ?? null }, NOW);
  };

  it("an expired quote is not payable; resent, it is — until the new date, and not after it", async () => {
    expect(payable()).toEqual({ payable: false, reason: "expired" });

    await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);

    expect(payable()).toEqual({ payable: true });
    const q = quoteRow();
    const after = quotePayability({ status: String(q.status), supersededAt: null, expiresAt: q.expires_at as string }, Date.parse(NEW_EXPIRY) + 1000);
    expect(after).toEqual({ payable: false, reason: "expired" });
  });

  it("the staff accept is refused on the expired quote and goes through once it is resent", async () => {
    // A resend dated from the real clock: `setQuoteStatus` reads the real clock too.
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    seed({ expires_at: "2020-01-01T00:00:00.000Z" });

    expect((await refusal(setQuoteStatus(cateringMgr, QUOTE, "accepted"))).code).toBe("quote_expired");

    await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: soon });
    await setQuoteStatus(cateringMgr, QUOTE, "accepted");

    expect(quoteRow()).toMatchObject({ id: QUOTE, status: "accepted", expires_at: soon });
  });
});

describe("resend an expired quote — only an EXPIRED open offer", () => {
  const untouched = () => {
    expect(writes()).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(auditOf("catering.quote.resend")).toEqual([]);
  };

  it("a quote that has NOT expired is refused 409 `not_expired`: nothing written, nothing emailed", async () => {
    seed({ expires_at: "2026-11-20T00:00:00.000Z" }); // five days left

    const err = await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW));

    expect(err).toMatchObject({ status: 409, code: "not_expired" });
    expect(quoteRow().expires_at).toBe("2026-11-20T00:00:00.000Z");
    untouched();
  });

  it("a quote with no expiry at all has nothing to extend: `not_expired`", async () => {
    seed({ expires_at: null });
    expect((await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW))).code).toBe("not_expired");
    untouched();
  });

  it.each(["accepted", "declined", "draft", "expired"])("a quote whose status is `%s` is refused 409 `invalid_status`, however old its date", async (status) => {
    seed({ status });

    const err = await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW));

    expect(err).toMatchObject({ status: 409, code: "invalid_status" });
    expect(quoteRow()).toMatchObject({ status, expires_at: OLD_EXPIRY });
    untouched();
  });

  it("a SUPERSEDED revision is refused 409 `not_current` — the live revision is the one to resend", async () => {
    seed({ superseded_at: "2026-11-10T00:00:00.000Z" });
    expect(await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW))).toMatchObject({ status: 409, code: "not_current" });
    untouched();
  });

  it("a quote that does not exist is 404", async () => {
    expect(await refusal(resendExpiredQuote(cateringMgr, "a0000000-0000-4000-8000-00000000dead", { expiresAt: NEW_EXPIRY }, NOW))).toMatchObject({ status: 404, code: "not_found" });
  });

  it.each([
    ["in the past", "2026-11-14T00:00:00.000Z"],
    ["this very instant", new Date(NOW).toISOString()],
    ["more than the allowed window out", "2027-06-01T03:59:59.000Z"],
    ["not a date", "next friday"],
    ["empty", ""],
  ])("a new expiry that is %s is refused 400 `invalid_expiry`", async (_what, expiresAt) => {
    const err = await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt }, NOW));
    expect(err).toMatchObject({ status: 400, code: "invalid_expiry" });
    untouched();
  });

  it(`the furthest allowed date is ${QUOTE_RESEND_MAX_DAYS} operational days out — that day is accepted, the next is not`, async () => {
    // NOW is 2026-11-15 (ET); 90 days on is 2027-02-13.
    const last = quoteExpiryInstantForEtDate("2027-02-13")!;
    const tooFar = quoteExpiryInstantForEtDate("2027-02-14")!;

    expect((await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: tooFar }, NOW))).code).toBe("invalid_expiry");
    untouched();
    const out = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: last }, NOW);
    expect(out.expiresAt).toBe(last);
  });
});

describe("resend an expired quote — Send's permission, exactly", () => {
  it("the floor is the SEND floor (one number, not a second opinion)", () => {
    expect(QUOTE_RESEND_MIN).toBe(QUOTE_WRITE_MIN);
  });

  it("a shift lead (below the Send floor) is refused 403 `forbidden`: nothing read past the quote, nothing written, nothing sent", async () => {
    const err = await refusal(resendExpiredQuote(shiftLead, QUOTE, { expiresAt: NEW_EXPIRY }, NOW));

    expect(err).toMatchObject({ status: 403, code: "forbidden" });
    expect(quoteRow().expires_at).toBe(OLD_EXPIRY);
    expect(writes()).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it.each(["key_holder", "employee", "trainer"])("…and so is a %s", async (role) => {
    expect((await refusal(resendExpiredQuote(actor(role), QUOTE, { expiresAt: NEW_EXPIRY }, NOW))).code).toBe("forbidden");
    expect(writes()).toEqual([]);
  });

  it("a GM of ANOTHER shop is refused 403 `location_access_denied`: the bind is to the quote's shop", async () => {
    const err = await refusal(resendExpiredQuote(gmElsewhere, QUOTE, { expiresAt: NEW_EXPIRY }, NOW));

    expect(err).toMatchObject({ status: 403, code: "location_access_denied" });
    expect(writes()).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("everyone who may Send at the quote's shop may resend: the catering manager and the GM", async () => {
    await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);
    expect(quoteRow()).toMatchObject({ expires_at: NEW_EXPIRY, sent_by: cateringMgr.user.id });

    seed();
    await resendExpiredQuote(gm, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);
    expect(quoteRow()).toMatchObject({ expires_at: NEW_EXPIRY, sent_by: gm.user.id });
  });
});

describe("resend an expired quote — the write is a compare-and-set on the row as it was read", () => {
  /** Run `change` in the gap between the resend's reads and its one write. */
  const underTheWrite = (change: () => void) => {
    db.beforeOp = (op) => {
      if (op.table !== "catering_quotes" || op.kind !== "update") return;
      db.beforeOp = null;
      change();
    };
  };
  const nothingHappened = () => {
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(auditOf("catering.quote.resend")).toEqual([]);
  };

  it("STALE REVISION: a revise supersedes the quote under the resend — 409 `status_changed`, the old row keeps its expiry, no email", async () => {
    underTheWrite(() => {
      // What `reviseQuote` does: the live row is superseded and a new revision takes its place.
      quoteRow().superseded_at = "2026-11-15T17:00:00.500Z";
      db.tables.catering_quotes!.push(quote({ id: "a0000000-0000-4000-8000-000000000002", root_id: QUOTE, version: 2, status: "draft", expires_at: "2026-11-29T17:00:00.000Z" }));
    });

    const err = await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW));

    expect(err).toMatchObject({ status: 409, code: "status_changed" });
    expect(quoteRow().expires_at).toBe(OLD_EXPIRY); // the superseded revision was NOT re-opened
    expect(db.tables.catering_quotes![1]).toMatchObject({ version: 2, status: "draft", expires_at: "2026-11-29T17:00:00.000Z" }); // nor the new one touched
    nothingHappened();
  });

  it("a STATUS change under it (someone declined the quote) — 409, the decline stands, no email", async () => {
    underTheWrite(() => {
      quoteRow().status = "declined";
    });

    expect(await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW))).toMatchObject({ status: 409, code: "status_changed" });
    expect(quoteRow()).toMatchObject({ status: "declined", expires_at: OLD_EXPIRY });
    nothingHappened();
  });

  it("TWO RESENDS AT ONCE: the second finds the expiry already moved — one new expiry, ONE email, one audit row", async () => {
    const otherManagersDate = "2026-11-22T04:59:59.000Z";
    underTheWrite(() => {
      quoteRow().expires_at = otherManagersDate; // the other manager's resend landed first
    });

    expect(await refusal(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW))).toMatchObject({ status: 409, code: "status_changed" });
    expect(quoteRow().expires_at).toBe(otherManagersDate); // not overwritten by the loser
    nothingHappened();
  });

  it("the guard is ON THE WRITE: the update is filtered on id, status, the expiry that was read, and `superseded_at IS NULL`", () => {
    const src = readFileSync(join(ROOT, "lib/catering/quotes.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function resendExpiredQuote"));
    const write = fn.slice(fn.indexOf(".update(patch"), fn.indexOf("if (uErr)"));
    expect(write).toContain('.eq("id", id)');
    expect(write).toContain('.eq("status", row.status)');
    expect(write).toContain('.eq("expires_at", previousExpiresAt)');
    expect(write).toContain('.is("superseded_at", null)');
  });
});

describe("resend an expired quote — a payment that landed after the OLD expiry stays flagged", () => {
  it("the late payment is named by the resend, recorded on its audit row, and its row is not touched", async () => {
    const late = payment({ paid_at: "2026-11-02T10:00:00.000Z" }); // the day AFTER the old expiry
    seed({}, [late]);
    const before = snapshot("catering_payments");

    const out = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);

    expect(out.latePaymentIds).toEqual([DEPOSIT]);
    expect(auditOf("catering.quote.resend")[0]!.metadata).toMatchObject({
      previous_expires_at: OLD_EXPIRY,
      late_payment_ids: [DEPOSIT],
    });
    // The payment is exactly what it was: still paid, its `paid_at` (after the old date) kept.
    expect(snapshot("catering_payments")).toEqual(before);
    expect(db.ops.filter((o) => o.table === "catering_payments" && o.kind !== "select")).toEqual([]);
  });

  it("a payment made INSIDE the old window is not late, and one that cannot say when it was paid is treated as late", async () => {
    const inTime = payment({ id: "d0000000-0000-4000-8000-00000000000a", paid_at: "2026-10-30T00:00:00.000Z" });
    const undated = payment({ id: "d0000000-0000-4000-8000-00000000000b", kind: "balance", paid_at: null, provider: "manual", provider_ref: null });
    const due = payment({ id: "d0000000-0000-4000-8000-00000000000c", kind: "full", status: "void", paid_at: null });
    seed({}, [inTime, undated, due]);

    const out = await resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW);

    expect(out.latePaymentIds).toEqual([undated.id]);
  });

  it("if the quote's payments cannot be read, the offer is NOT extended blind: the resend fails and nothing is written", async () => {
    seed({}, [payment()]);
    db.failSelect.push("catering_payments");

    await expect(resendExpiredQuote(cateringMgr, QUOTE, { expiresAt: NEW_EXPIRY }, NOW)).rejects.toThrow(/resendExpiredQuote payments/);
    expect(quoteRow().expires_at).toBe(OLD_EXPIRY);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("resend an expired quote — the route (Send's posture)", () => {
  const post = (body: unknown, origin = "http://localhost") =>
    new NextRequest(`http://localhost/api/catering/quotes/${QUOTE}/resend`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const params = { params: Promise.resolve({ id: QUOTE }) };
  /** A date the real clock accepts: a week from today (ET). */
  const nextWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  beforeEach(() => {
    seed({ expires_at: "2020-01-01T00:00:00.000Z" });
  });

  it("resends: 200, the expiry is the END of the picked ET day, and the answer carries the late-payment count", async () => {
    db.tables.catering_payments!.push(payment({ paid_at: "2020-01-05T00:00:00.000Z" })); // after that old expiry
    const day = nextWeek();

    const res = await resendRoute(post({ expiresOn: day }), params);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, emailed: true, emailOutcome: "sent", latePayments: 1 });
    expect(body.expiresAt).toBe(quoteExpiryInstantForEtDate(day));
    expect(quoteRow().expires_at).toBe(quoteExpiryInstantForEtDate(day));
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("a role below the Send floor is 403 `forbidden` at the route, before the step-up and before any read", async () => {
    session.ctx = shiftLead;
    const res = await resendRoute(post({ expiresOn: nextWeek() }), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(db.ops).toEqual([]);
  });

  it.each(["step_up_required", "step_up_stale"])("without a fresh password it is 403 `%s` and nothing is read or written (Tier B, as Send)", async (code) => {
    stepUp.result = { ok: false, code };
    const res = await resendRoute(post({ expiresOn: nextWeek() }), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code });
    expect(db.ops).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("asserts Tier B, and the path is a step-up surface so the unlock survives its own requireSession", () => {
    const src = readFileSync(join(ROOT, "app/api/catering/quotes/[id]/resend/route.ts"), "utf8");
    expect(src).toContain('assertStepUp(ctx, "B")');
    expect(src.indexOf("assertSameOrigin(req)")).toBeLessThan(src.indexOf("requireSession("));
    expect(isCateringStepUpPath(`/api/catering/quotes/${QUOTE}/resend`)).toBe(true);
    expect(isStepUpSurface(`/api/catering/quotes/${QUOTE}/resend`)).toBe(true);
    // Exactly that segment: nothing else under a quote keeps the unlock.
    for (const path of [
      `/api/catering/quotes/${QUOTE}/resend/again`,
      `/api/catering/quotes/${QUOTE}/payments`,
      `/api/catering/quotes/${QUOTE}`,
      `/api/catering/quotes/${QUOTE}/x/resend`,
      "/api/catering/quotes//resend",
    ]) {
      expect(isCateringStepUpPath(path), path).toBe(false);
    }
  });

  it("a cross-origin POST is refused before anything else", async () => {
    const res = await resendRoute(post({ expiresOn: nextWeek() }, "https://attacker.example"), params);
    expect(res.status).toBe(403);
    expect(db.ops).toEqual([]);
  });

  it.each([[{}], [{ expiresOn: "11/30/2026" }], [{ expiresOn: "2026-02-30" }], [{ expiresOn: 20261130 }], [{ expiresAt: "2026-11-30T00:00:00Z" }]])(
    "a body without a real calendar date (%j) is 400 `invalid_expiry`",
    async (body) => {
      const res = await resendRoute(post(body), params);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_expiry" });
      expect(db.ops).toEqual([]);
    },
  );

  it("a date already past is 400 `invalid_expiry`, and a refusal from the lib keeps its status and code", async () => {
    const past = await resendRoute(post({ expiresOn: "2020-06-01" }), params);
    expect(past.status).toBe(400);
    expect(await past.json()).toMatchObject({ code: "invalid_expiry" });

    quoteRow().status = "accepted";
    const refused = await resendRoute(post({ expiresOn: nextWeek() }), params);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "invalid_status" });
  });
});

describe("the date a person picks → the instant the offer ends", () => {
  it("is the last second of that ET day, in winter and in summer (DST-correct)", () => {
    expect(quoteExpiryInstantForEtDate("2026-11-30")).toBe("2026-12-01T04:59:59.000Z"); // EST, UTC−5
    expect(quoteExpiryInstantForEtDate("2026-07-04")).toBe("2026-07-05T03:59:59.000Z"); // EDT, UTC−4
    // The two days the clocks change: 23 h and 25 h long, still ending at their own midnight.
    expect(quoteExpiryInstantForEtDate("2026-03-08")).toBe("2026-03-09T03:59:59.000Z");
    expect(quoteExpiryInstantForEtDate("2026-11-01")).toBe("2026-11-02T04:59:59.000Z");
  });

  it("refuses anything that is not a real calendar date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-5", "11/30/2026", "", "tomorrow", null, undefined, 20261130, {}]) {
      expect(quoteExpiryInstantForEtDate(bad), String(bad)).toBeNull();
    }
  });
});

describe("resend an expired quote — the screen says it in both languages", () => {
  const en = JSON.parse(readFileSync(join(ROOT, "lib/i18n/en.json"), "utf8")) as Record<string, string>;
  const es = JSON.parse(readFileSync(join(ROOT, "lib/i18n/es.json"), "utf8")) as Record<string, string>;
  const KEYS = [
    "catering.quotes.resend_expired.title",
    "catering.quotes.resend_expired.body",
    "catering.quotes.resend_expired.date_label",
    "catering.quotes.resend_expired.button",
    "catering.quotes.resend_expired.confirm",
    "catering.quotes.resend_expired.confirm_button",
    "catering.quotes.resend_expired.cancel",
    "catering.quotes.resend_expired.working",
    "catering.quotes.resend_expired.done_emailed",
    "catering.quotes.resend_expired.done_no_customer",
    "catering.quotes.resend_expired.done_no_address",
    "catering.quotes.resend_expired.done_send_failed",
    "catering.quotes.resend_expired.late_payment",
    "catering.quotes.error.not_expired",
    "catering.quotes.error.invalid_expiry",
  ];

  it("every key the resend UI uses exists in en AND es, and the confirm line carries the date in both", () => {
    for (const key of KEYS) {
      expect(en[key], `en ${key}`).toEqual(expect.any(String));
      expect(es[key], `es ${key}`).toEqual(expect.any(String));
      expect(es[key], `es ${key} is not a copy of the English`).not.toBe(en[key]);
    }
    expect(en["catering.quotes.resend_expired.confirm"]).toContain("{date}");
    expect(es["catering.quotes.resend_expired.confirm"]).toContain("{date}");
  });

  it("the panel uses exactly those keys, posts to the resend route, and knows the two new refusals", () => {
    const panel = readFileSync(join(ROOT, "components/catering/quotes/QuotesClient.tsx"), "utf8");
    for (const key of KEYS.filter((k) => k.includes("resend_expired"))) expect(panel, key).toContain(`"${key}"`);
    expect(panel).toContain("/api/catering/quotes/${id}/resend");
    // Drawn from the ONE shared clock rule, not a second spelling of "expired".
    expect(panel).toContain("quoteTimeExpired(q.status, q.expiresAt)");
    const shared = readFileSync(join(ROOT, "components/catering/quotes/shared.ts"), "utf8");
    expect(shared).toContain('"not_expired"');
    expect(shared).toContain('"invalid_expiry"');
  });
});
