/**
 * THE INTERLEAVING MATRIX OF THE CATERING CARD-PAYMENT FLOWS (audit wave W02, review r6 —
 * CC's requirement to end the race loop, next to the writer inventory of
 * tests/catering-payments-writers.test.ts).
 *
 * Six review rounds each found one more pair of flows that could run at the same moment on
 * one order and leave it wrong. A list of WRITERS says how each statement is guarded; it does
 * not say what happens when two FLOWS meet. This file does:
 *
 *   1. `FLOWS` is every way a catering payment row of one quote family is written.
 *   2. `MATRIX` has ONE ENTRY FOR EVERY PAIR of them (28: 21 pairs of different flows and 7
 *      of a flow with itself). Each names its SERIALIZATION POINT — the thing that makes the
 *      two orders of arrival both come out right — and the test(s) that run the two flows
 *      INTERLEAVED: one held at a chosen statement while the other runs to its end.
 *   3. The matrix is CHECKED: every pair is present exactly once, and every "pinned by"
 *      names a test file and a title that exist.
 *   4. The interleavings that had no test before this round are below, in this file.
 *
 * THE SERIALIZATION POINTS, in the words used in the table:
 *   · 0303 lock      migration 0303's `catering_payment_attach_checkout`: the ONLY writer of a
 *                    session id. It locks the quote row FOR UPDATE and every payment row of
 *                    the quote, then decides. Anything that writes a payment row of that quote
 *                    lands wholly before it or wholly after it. (Without 0303 the pay tap
 *                    refuses: there is no second way to attach.)
 *   · CAS            a compare-and-set on the row AS IT WAS READ (`status` always; `quote_id`,
 *                    `provider_session_id`, `provider_ref` when the decision was about a
 *                    revision, a checkout, a charge). The loser matches nothing, RE-READS, and
 *                    acts on what the row has become — never on what it remembered.
 *   · marker         `catering_payments.settlement_cleanup_at`: whether a settlement's cleanup
 *                    is still owed is a durable fact on the row, so whoever finds it NULL runs
 *                    the idempotent cleanup, whichever delivery or press it is.
 *   · ledger         `stripe_events` (primary key = Stripe's event id): one event is worked to
 *                    a terminal verdict once; and it REMEMBERS an event that arrived before
 *                    the thing it is about (a refund before its payment).
 *   · Stripe         a Checkout Session is `open`, then `complete` or `expired` — never both.
 *                    A retire that finds it complete says so; an id is cleared only on
 *                    Stripe's word, and only that exact id.
 *
 * Two flows are "at the same moment" here by real interleaving: every flow runs on its own
 * fake connection over one set of rows (tests/payments-fake-client.ts), bound to its whole
 * async chain with AsyncLocalStorage, and `interleave` HOLDS the first at a statement it
 * names while the second runs to completion. Stripe is tests/stripe-fake.ts. No database, no
 * network, no real Stripe, no mail.
 *
 * The PR's matrix table is printed from this list: `PRINT_INTERLEAVING_MATRIX=1 npx vitest
 * run tests/catering-payment-interleavings.test.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, sameMigrationState, type PaymentsFake, type Row } from "./payments-fake-client";
import { stripeFake, type StripeFake } from "./stripe-fake";

const scope = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { connection: new AsyncLocalStorage<unknown>() };
});

let db: PaymentsFake;
let stripe: StripeFake;
/** The connection of the flow that is running: its own, or the default one. */
const here = (): PaymentsFake => (scope.connection.getStore() as PaymentsFake | undefined) ?? db;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => here().client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ id: "email_1" })),
  teamFrom: () => "Team <team@example.com>",
}));
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return {
    ...actual,
    stripeCredentialsFor: vi.fn(() => ({ secretKey: "sk_shop", webhookSecret: "whsec_shop", source: "location" })),
    createCheckoutSession: vi.fn(),
    retireCheckoutSession: vi.fn(),
    retrieveCheckoutSession: vi.fn(),
  };
});

import { audit } from "@/lib/audit";
import { carryPaymentsToRevision } from "@/lib/catering/payment-carry";
import { CateringPaymentError, markPaymentPaid } from "@/lib/catering/payments";
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";
import * as stripeClient from "@/lib/stripe/client";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

const auditMock = vi.mocked(audit);
const createSessionMock = vi.mocked(stripeClient.createCheckoutSession);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);
const retrieveMock = vi.mocked(stripeClient.retrieveCheckoutSession);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THIS = "tests/catering-payment-interleavings.test.ts";

// ── The matrix ──────────────────────────────────────────────────────────────────────

const FLOWS = [
  "pay tap",
  "webhook completed",
  "webhook async_succeeded / async_failed",
  "session expired",
  "Mark paid",
  "revise carry",
  "refund",
] as const;
type Flow = (typeof FLOWS)[number];

/** What each flow writes, for the table's legend. */
const FLOW_WRITES: Record<Flow, string> = {
  "pay tap": "`initiatePayment` + `createQuoteCheckout`: inserts / re-prices / voids its own due intent, clears retired session ids, ATTACHES a session (0303's function)",
  "webhook completed": "`checkout.session.completed` (paid): the paid flip, the sibling void, the checkout cleanup, the settlement marker, a refund seen first",
  "webhook async_succeeded / async_failed": "`async_payment_succeeded`: the same settlement as completed. `async_payment_failed`: clears the failed session's id from a due / void row",
  "session expired": "`checkout.session.expired`: clears the expired session's id from a due / void row",
  "Mark paid": "`markPaymentPaid`: the hand flip (bound to the revision read), the checkout cleanup, the settlement marker",
  "revise carry": "`carryPaymentsToRevision`: moves every row of the family to the live revision; re-prices or voids a due intent; retires its session",
  refund: "`charge.refunded`: paid → refunded when the WHOLE charge is refunded (bound to the charge)",
};

interface Pinned {
  file: string;
  title: string;
}
interface PairEntry {
  a: Flow;
  b: Flow;
  /** What makes both orders of arrival come out right. */
  serialization: string;
  /** The test(s) that interleave the two flows. */
  pinnedBy: Pinned[];
}

const RACE = "tests/portal-checkout-settlement-race.test.ts";
const RESUME = "tests/stripe-webhook-resume.test.ts";
const CARRY = "tests/catering-payment-carry-concurrency.test.ts";
const REPRICE = "tests/catering-reprice-revision-bound.test.ts";
const ATTEMPTS = "tests/portal-checkout-attempts.test.ts";
const local = (title: string): Pinned => ({ file: THIS, title });

const MATRIX: PairEntry[] = [
  // ── pay tap × … ───────────────────────────────────────────────────────────────────
  {
    a: "pay tap",
    b: "pay tap",
    serialization:
      "0303 lock + the one-open-checkout index: both taps mint, ONE attach lands; the other answers `in_progress` / `session_unresolved`, closes the session it minted, 409. The intent insert is arbitrated by 0130's one-due index",
    pinnedBy: [
      local("pay tap × pay tap — the deposit and the full amount are tapped at the same moment: ONE checkout survives, the other request is refused and its session is closed"),
      { file: ATTEMPTS, title: "the second to record its session loses, closes its own checkout, and is told a payment is in progress" },
      { file: CARRY, title: "the stale request never erases the checkout the other attached: ONE open checkout, and the row names it" },
    ],
  },
  {
    a: "pay tap",
    b: "webhook completed",
    serialization:
      "0303 lock: the paid flip is a write to a payment row of the quote, so it lands before the attach (→ `already_paid` / `not_due`, minted session closed) or after it (→ the settlement voids that intent and retires its checkout). Before the attach: the tap re-reads for a paid row after its own insert",
    pinnedBy: [
      { file: RACE, title: "THE REPORTED INTERLEAVING: a full request past the already-paid gate, the deposit settles, the request resumes — refused, nothing left payable" },
      { file: RACE, title: "THE OTHER ORDER: the full checkout is attached FIRST, then a deposit settles — the open full checkout is closed and its intent voided" },
      local("pay tap × webhook checkout.session.completed — the full tap is at its attach when the deposit's payment lands: the attach is refused and the session it minted is closed"),
    ],
  },
  {
    a: "pay tap",
    b: "webhook async_succeeded / async_failed",
    serialization:
      "succeeded: the same 0303 lock as completed (one code path). failed: CAS on the exact session id the event names (+ status due/void) — a tap that already read the failed session asks Stripe (`complete` → 409, nothing minted); a tap that reads after the clear mints ONE fresh checkout through the 0303 lock",
    pinnedBy: [
      local("pay tap × webhook checkout.session.async_payment_succeeded — the full tap is at its attach when the deposit's payment lands: the attach is refused and the session it minted is closed"),
      local("pay tap × async_payment_failed — the failure lands while the tap is asking Stripe about that same session: nothing is minted, and the next tap opens ONE fresh checkout"),
      local("pay tap × async_payment_failed — the failure lands before the tap reads the intent: the tap finds it released and opens ONE checkout"),
    ],
  },
  {
    a: "pay tap",
    b: "session expired",
    serialization:
      "CAS on the exact session id, on both sides: the tap's clear of a stale session and the event's clear are the same guarded write, so one lands and the other matches nothing (the tap then answers 409 and mints nothing); the next tap attaches through the 0303 lock",
    pinnedBy: [
      local("pay tap × session expired — the expiry event clears the stale session under the tap's own clear: the tap mints nothing, and the next tap opens ONE fresh checkout"),
      { file: RACE, title: "an expiry for an OLDER session never clears the checkout the row names now" },
    ],
  },
  {
    a: "pay tap",
    b: "Mark paid",
    serialization:
      "0303 lock: the hand flip is a write to a payment row of the quote — before the attach (→ `already_paid`, minted session closed) or after it (→ `closeQuoteCheckouts` retires the checkout it finds)",
    pinnedBy: [
      { file: RACE, title: "the same race one step later: the settlement lands while the full checkout is being ATTACHED — refused, and the minted session is closed" },
      { file: RACE, title: "an intent that was already there when the settlement landed is not voided by the refused request — only the one it raised itself" },
      { file: RACE, title: "the OTHER intent's open checkout is retired too — and that intent is left for the team (still due, no session)" },
    ],
  },
  {
    a: "pay tap",
    b: "revise carry",
    serialization:
      "0303 lock (it holds the quote row FOR UPDATE and re-reads `superseded_at`; a moved or re-priced intent → `not_payable`) + CAS on `quote_id` for the tap's re-price and its own-intent void + the tap's re-read of `superseded_at` after its insert",
    pinnedBy: [
      { file: REPRICE, title: "the pay tap: a revise between the read and the re-price — v2's $300 is NOT overwritten with v1's $200, and the tap is refused" },
      { file: REPRICE, title: "a revise between the payability read and the insert: the intent the tap raised is closed, and the tap is refused `not_payable`" },
      { file: RACE, title: "THE ATTACH'S HALF: a checkout whose quote was SUPERSEDED while it was at Stripe is refused — a deposit settled and carried to the new revision is not raced past" },
      { file: CARRY, title: "an intent a revise moved and re-priced while our session was at Stripe does not get that session" },
    ],
  },
  {
    a: "pay tap",
    b: "refund",
    serialization:
      "CAS (`status = paid` + the charge) for the refund; the tap's gates and the 0303 lock read the COMMITTED row: a whole-charge refund that lands first re-opens collection (by design), a partial one leaves the row paid and the tap refused",
    pinnedBy: [
      local("pay tap × refund — a WHOLE-charge refund lands under the tap's already-paid gate: the gate reads the committed row, collection re-opens, ONE checkout"),
      local("pay tap × refund — a PARTIAL refund lands under the same gate: the payment is still paid and the tap is still refused"),
    ],
  },
  // ── webhook completed × … ─────────────────────────────────────────────────────────
  {
    a: "webhook completed",
    b: "webhook completed",
    serialization:
      "same charge: CAS on the paid flip + the marker (whoever finds the charge on a row whose cleanup is not recorded runs it; one marker write, one report) + the ledger. Two different payments of one order: each flips its own row, and a sibling void that matches nothing RE-READS the sibling — paid meanwhile → `another_payment_already_paid`",
    pinnedBy: [
      { file: RESUME, title: "THE REPORTED INTERLEAVING: B dies between its flip and the sibling void — A does NOT stamp `already_advanced`; it finishes the settlement" },
      { file: RESUME, title: "neither dies: both run the idempotent cleanup side by side — one marker, ONE report, the sibling closed once" },
      { file: RESUME, title: "THREE deliveries: A paused, B dies after its flip, C (another retry) finishes — then A resumes and finds it done" },
      local("webhook completed × webhook checkout.session.completed — the deposit AND the full amount are paid at the same moment: both recorded, and BOTH flagged as a second payment"),
    ],
  },
  {
    a: "webhook completed",
    b: "webhook async_succeeded / async_failed",
    serialization:
      "succeeded: the same CAS + marker as two completed events (one code path). failed: its clear is a CAS on `status` due/void + the exact session — once the row is paid it matches nothing and the id stays as history",
    pinnedBy: [
      local("webhook completed × webhook checkout.session.async_payment_succeeded — the deposit AND the full amount are paid at the same moment: both recorded, and BOTH flagged as a second payment"),
      { file: RESUME, title: "A DIFFERENT EVENT about the same charge arrives while the first event's delivery lies dead after its flip: it finishes the settlement too" },
      local("webhook completed × async_payment_failed — a failure held at its clear while the same intent is paid: the clear matches nothing, the paid row keeps its session id as history"),
    ],
  },
  {
    a: "webhook completed",
    b: "session expired",
    serialization:
      "CAS on the exact session id (+ status due/void) for every clear, and Stripe: the settlement's retire of an already-expired session answers `expired`, so the event's clear and the cleanup's clear are the same idempotent write",
    pinnedBy: [
      local("webhook completed × session expired — the other checkout's expiry event is held at its clear while the deposit settles: the settlement closes that checkout, and the event's clear matches nothing"),
      { file: RACE, title: "a PAID row's session id is history: an expiry event does not touch it" },
    ],
  },
  {
    a: "webhook completed",
    b: "Mark paid",
    serialization:
      "same row: CAS on `status` — one flip lands; a card payment that loses is `already_settled` (flagged), a hand mark that loses is 409. Different rows: the webhook's sibling void is a CAS that, matching nothing, RE-READS — marked paid meanwhile → `another_payment_already_paid`; voided first → the hand mark is 409",
    pinnedBy: [
      { file: "tests/stripe-webhook-review.test.ts", title: "staff marked the deposit paid by hand, then the customer paid it through Stripe: nothing to flip, loudly flagged" },
      local("webhook completed × Mark paid — the other intent is marked paid by hand between the card settlement's read of it and its void: the void matches nothing, and the card payment is flagged as a second payment"),
      local("webhook completed × Mark paid — the card settlement voids the other intent first: the hand mark that was reading it is refused, nothing is recorded twice"),
      local("webhook completed × Mark paid — a hand mark was CUT OFF after its flip and the customer then pays that intent's page by card: the charge is flagged, and the delivery runs the cleanup the mark never reached"),
    ],
  },
  {
    a: "webhook completed",
    b: "revise carry",
    serialization:
      "CAS + the flip RETURNS the row it wrote: the order is judged and cleaned up on the revision the row is on NOW, across the whole family; a sibling void that matches nothing re-reads, and a sibling a revise carried meanwhile is voided where it is. The carry's own writes are CAS on (status, quote_id, session): a row paid under it is moved as it is",
    pinnedBy: [
      { file: RACE, title: "THE WEBHOOK'S VERSION: the event reads P on v1, a revise carries P and a FULL checkout opens on v2, the flip lands — that checkout is closed, not left beside a paid deposit" },
      { file: CARRY, title: "…and if that late checkout is already COMPLETE, the intent moves untouched: the money is landing" },
      local("webhook completed × revise carry — a revise carries the other intent to a new revision between the settlement's read of it and its void: it is voided where it is now"),
    ],
  },
  {
    a: "webhook completed",
    b: "refund",
    serialization:
      "in order: CAS (`status = paid` + `provider_ref`, which only the paid flip writes). OUT OF ORDER (the refund processed before its payment): the ledger — the refund that found no row is remembered (`payment_not_found`), and the settlement looks for it, tells a person (`refund_seen_first`) and applies it",
    pinnedBy: [
      local("webhook completed × refund — the refund is processed FIRST (its payment is not recorded yet): when the payment lands it is recorded, flagged, and the refund is applied — never left `paid`"),
      local("webhook completed × refund — the refund lands while the payment's delivery is held at its flip: the same end"),
      local("webhook completed × refund — the refund's delivery has looked for its payment (not there yet) and is still IN FLIGHT when the payment lands: the settlement finds its unfinished ledger row and applies it"),
      local("webhook completed × refund — a PARTIAL refund seen first: the payment is recorded and stays paid, the refunded amount is audited, and the team is told"),
      local("webhook completed × refund — in order (payment, then refund): an ordinary payment, then an ordinary refund; nothing is flagged"),
      local("webhook completed × refund — the ledger could not be read for an earlier refund: flagged `refund_check_failed`, and the settlement is NOT recorded as done"),
    ],
  },
  // ── webhook async × … ─────────────────────────────────────────────────────────────
  {
    a: "webhook async_succeeded / async_failed",
    b: "webhook async_succeeded / async_failed",
    serialization:
      "succeeded × succeeded: CAS + marker + ledger, as completed. failed × failed: CAS on the exact session id — one clear lands, the other matches nothing; the ledger closes the event",
    pinnedBy: [
      local("async_payment_failed × async_payment_failed — two deliveries of one failure event at once: ONE clear lands, the other matches nothing"),
      { file: "tests/stripe-async-payment-failed.test.ts", title: "a REDELIVERY of the processed failure event is a ledger duplicate and touches nothing" },
    ],
  },
  {
    a: "webhook async_succeeded / async_failed",
    b: "session expired",
    serialization:
      "CAS on the exact session id (+ status due/void): each event clears only the session it names, so neither can clear a newer checkout the row was given in between",
    pinnedBy: [
      local("async_payment_failed × session expired — both name the same session, and the customer is given a NEW checkout in between: the old id is cleared once, the new one is never touched"),
    ],
  },
  {
    a: "webhook async_succeeded / async_failed",
    b: "Mark paid",
    serialization:
      "succeeded: as completed × Mark paid (CAS on `status`). failed: its clear needs `status` due/void — after the hand flip it matches nothing; the hand mark's cleanup asks Stripe about the row's own session and is told `complete` (kept as history)",
    pinnedBy: [
      local("async_payment_failed × Mark paid — the failure event arrives between the hand flip and its cleanup: the paid row's id is not cleared by the event, and the mark finishes"),
    ],
  },
  {
    a: "webhook async_succeeded / async_failed",
    b: "revise carry",
    serialization:
      "succeeded: as completed × revise carry. failed: CAS on the session id on BOTH sides — the carry's write names the session it read, so a session the event cleared under it makes the write match nothing and the pass runs again from a fresh read",
    pinnedBy: [
      local("checkout.session.async_payment_failed × revise carry — the event clears the session between the carry's read and its write: the carry re-reads and moves the intent without it"),
    ],
  },
  {
    a: "webhook async_succeeded / async_failed",
    b: "refund",
    serialization:
      "succeeded: as completed × refund. failed: DISJOINT BY `status` — the failure clears a session on a due / void row, the refund moves a paid row carrying that charge; neither guard can match the other's row",
    pinnedBy: [
      local("checkout.session.async_payment_failed × refund — the refund is held at its write while the event clears another intent's session: both land, each on its own row"),
    ],
  },
  // ── session expired × … ───────────────────────────────────────────────────────────
  {
    a: "session expired",
    b: "session expired",
    serialization: "CAS on the exact session id + the ledger: one clear lands, the other matches nothing",
    pinnedBy: [local("session expired × session expired — two deliveries of one expiry event at once: ONE clear lands, the other matches nothing")],
  },
  {
    a: "session expired",
    b: "Mark paid",
    serialization:
      "CAS: the event's clear needs `status` due/void; the hand mark's cleanup retires the session the FLIP returned (Stripe answers `expired` for one already expired) and clears that exact id",
    pinnedBy: [local("session expired × Mark paid — the expiry event arrives between the hand flip and its cleanup: the mark's own cleanup clears the id, once")],
  },
  {
    a: "session expired",
    b: "revise carry",
    serialization: "CAS on the session id on both sides (as async_failed × revise carry): the carry's write matches nothing and the pass runs again from a fresh read",
    pinnedBy: [local("checkout.session.expired × revise carry — the event clears the session between the carry's read and its write: the carry re-reads and moves the intent without it")],
  },
  {
    a: "session expired",
    b: "refund",
    serialization: "DISJOINT BY `status` (due / void vs paid + the charge): neither guard can match the other's row",
    pinnedBy: [local("checkout.session.expired × refund — the refund is held at its write while the event clears another intent's session: both land, each on its own row")],
  },
  // ── Mark paid × … ─────────────────────────────────────────────────────────────────
  {
    a: "Mark paid",
    b: "Mark paid",
    serialization:
      "CAS on `status = due` (+ the revision read): one press flips, the other matches nothing and answers 409 `not_due`. The marker makes the cleanup run to its end exactly as often as it is owed",
    pinnedBy: [
      local("Mark paid × Mark paid — two presses at once: ONE records the payment, the other is 409 `not_due`, and the checkout is closed once"),
      { file: "tests/catering-mark-paid-resume.test.ts", title: "a mark cut off after its flip leaves the marker NULL — and the second press, having closed everything, sets it" },
    ],
  },
  {
    a: "Mark paid",
    b: "revise carry",
    serialization: "CAS on `status` + `quote_id`: a payment the carry moved under the press is REFUSED (409 `not_current`), nothing recorded; the flip returns the row it wrote and the cleanup works from that",
    pinnedBy: [
      {
        file: RACE,
        title:
          "THE REPORTED INTERLEAVING: mark-paid reads P on v1, a revise carries P to v2 and a checkout is attached, mark-paid resumes — never `paid` beside an open checkout nobody knows about",
      },
    ],
  },
  {
    a: "Mark paid",
    b: "refund",
    serialization:
      "DISJOINT BY THE CHARGE: a refund finds its row by `provider_ref` (a Stripe PaymentIntent), which a hand-recorded row never carries; each write is a CAS on its own row's `status`",
    pinnedBy: [local("Mark paid × refund — the card deposit is refunded while the full amount is being marked paid by hand: both land, each on its own row")],
  },
  // ── revise carry × … ──────────────────────────────────────────────────────────────
  {
    a: "revise carry",
    b: "revise carry",
    serialization: "CAS on (status, quote_id, session) as each pass read the row; a pass only writes while its target is still the live revision; a write that matches nothing re-reads and runs again (bounded)",
    pinnedBy: [
      { file: CARRY, title: "the stale request never erases the checkout the other attached: ONE open checkout, and the row names it" },
      { file: CARRY, title: "an intent another request already carried AND gave a checkout is left exactly as it is" },
      { file: CARRY, title: "a carry whose target was superseded in the meantime moves nothing" },
    ],
  },
  {
    a: "revise carry",
    b: "refund",
    serialization:
      "CAS on different facts of one row: the carry moves a settled row bound to `quote_id` (and `status` ≠ due), the refund flips it bound to `status = paid` + the charge and to NO revision — either order lands both",
    pinnedBy: [local("revise carry × refund — the charge is refunded between the carry's read of the paid row and its move: the row arrives on the new revision, refunded")],
  },
  // ── refund × refund ───────────────────────────────────────────────────────────────
  {
    a: "refund",
    b: "refund",
    serialization: "CAS on `status = paid` + the charge, and the ledger: one delivery moves the row, the other matches nothing (`no_paid_row`) and writes no second audit row",
    pinnedBy: [local("refund × refund — two deliveries of one refund event at once: the row is refunded ONCE, and audited once")],
  },
];

const pairKey = (a: Flow, b: Flow): string => [FLOWS.indexOf(a), FLOWS.indexOf(b)].sort((x, y) => x - y).join("×");

describe("W02 review r6 — the interleaving matrix is complete and every entry is pinned", () => {
  it("there is exactly ONE entry for every pair of flows (28: 21 different + 7 with itself)", () => {
    const every: string[] = [];
    for (let i = 0; i < FLOWS.length; i += 1) for (let j = i; j < FLOWS.length; j += 1) every.push(`${i}×${j}`);
    expect(every).toHaveLength(28);
    expect(MATRIX.map((m) => pairKey(m.a, m.b)).sort()).toEqual([...every].sort());
  });

  it("every entry names its serialization point and at least one interleaving test", () => {
    for (const m of MATRIX) {
      expect(m.serialization.length, `${m.a} × ${m.b}`).toBeGreaterThan(20);
      expect(m.serialization, `${m.a} × ${m.b}`).toMatch(/0303 lock|CAS|marker|ledger|DISJOINT|Stripe/);
      expect(m.pinnedBy.length, `${m.a} × ${m.b}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every `pinned by` names a real test", () => {
    for (const m of MATRIX) {
      for (const pin of m.pinnedBy) {
        const path = join(ROOT, pin.file);
        expect(existsSync(path), pin.file).toBe(true);
        // `it.each` titles carry a `%s`: match the title's own text on either side of it.
        const src = readFileSync(path, "utf8");
        const found = src.includes(pin.title) || templatesIn(src).some((t) => matchesTemplate(t, pin.title));
        expect(found, `${pin.file} › ${pin.title}`).toBe(true);
      }
    }
  });

  it("every flow is in the legend", () => {
    expect(Object.keys(FLOW_WRITES).sort()).toEqual([...FLOWS].sort());
  });
});

/** Titles of `it.each(...)("…%s…")` in a source file. */
function templatesIn(src: string): string[] {
  return [...src.matchAll(/\)\(\s*"([^"\n]*%s[^"\n]*)"/g)].map((m) => m[1]!);
}
function matchesTemplate(template: string, title: string): boolean {
  const [before, after] = template.split("%s") as [string, string];
  return title.startsWith(before) && title.endsWith(after) && title.length >= before.length + after.length;
}

// ── The harness ─────────────────────────────────────────────────────────────────────

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const FULL = "d0000000-0000-4000-8000-000000000002";
const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };
const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;
const notifyPaid = vi.fn(async () => {});

const quotes = () => db.tables.catering_quotes!;
const pays = () => db.tables.catering_payments!;
const rowOf = (id: string) => pays().find((p) => p.id === id)!;
const byKind = (kind: string) => pays().filter((p) => p.kind === kind);
const ledger = (id: string) => db.tables.stripe_events!.find((r) => r.id === id)!;
const liveQuote = () => quotes().find((q) => q.superseded_at == null)!;
const openSessions = () => [...stripe.sessions.values()].filter((s) => s.status === "open");
const audits = (action: string) => auditMock.mock.calls.map((c) => c[0]).filter((a) => a.action === action);
const metaOf = (action: string) => audits(action).map((a) => a.metadata as Record<string, unknown>);

/** A payment row of the order, as the table holds it. */
function seed(over: Row): Row {
  const r: Row = {
    quote_id: QUOTE,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 20000,
    currency: "usd",
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    paid_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
  pays().push(r);
  return r;
}
const seedDeposit = (over: Row = {}) => seed({ id: DEPOSIT, ...over });
const seedFull = (over: Row = {}) => seed({ id: FULL, kind: "full", amount_cents: 100000, ...over });

/** A hosted Checkout Session at Stripe for one of our intents (open). */
async function sessionFor(paymentId: string, amountCents: number, kind: "deposit" | "full" = "deposit"): Promise<string> {
  const s = await stripe.create(
    "sk_shop",
    {
      quoteId: QUOTE,
      paymentId,
      kind,
      amountCents,
      currency: "usd",
      productName: "x",
      description: "x",
      customerEmail: "customer@example.com",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
    },
    `seed-${paymentId}-${stripe.creates.length}`,
  );
  return s.id;
}

let eventSeq = 0;
/** A paid event for a session of the Stripe fake; the customer completes it there too. */
function paidEvent(sessionId: string, type = "checkout.session.completed", eventId = `evt_paid_${++eventSeq}`) {
  const s = stripe.sessions.get(sessionId)!;
  stripe.complete(sessionId);
  return {
    id: eventId,
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: s.id,
        payment_status: "paid",
        payment_intent: `pi_${s.id}`,
        amount_total: s.amountCents,
        metadata: { quote_id: s.quoteId, payment_id: s.paymentId, kind: "deposit" },
      },
    },
  };
}
/** `checkout.session.expired` / `checkout.session.async_payment_failed` for a session of one of our intents. */
function sessionOverEvent(type: "checkout.session.expired" | "checkout.session.async_payment_failed", sessionId: string, paymentId: string, eventId = `evt_over_${++eventSeq}`) {
  return {
    id: eventId,
    type,
    livemode: false,
    data: { object: { id: sessionId, payment_status: "unpaid", payment_intent: `pi_${sessionId}`, amount_total: 20000, metadata: { quote_id: QUOTE, payment_id: paymentId, kind: "deposit" } } },
  };
}
/** `charge.refunded` for a PaymentIntent: the charge's own amount, total refunded, and flag. */
function refundEvent(paymentIntent: string, charge: { amount: number; amount_refunded: number; refunded: boolean }, eventId = `evt_refund_${++eventSeq}`) {
  return { id: eventId, type: "charge.refunded", livemode: false, data: { object: { id: "ch_1", payment_intent: paymentIntent, metadata: {}, ...charge } } };
}
const whole = (amount: number) => ({ amount, amount_refunded: amount, refunded: true });

// ── The flows ───────────────────────────────────────────────────────────────────────

/** The pay route for one tap: `initiatePayment`, then `createQuoteCheckout`. Returns the URL. */
async function tap(kind: "deposit" | "full"): Promise<string> {
  const quoteId = liveQuote().id as string;
  const intent = await initiatePayment(CUSTOMER, quoteId, kind);
  const checkout = await createQuoteCheckout({
    customerId: CUSTOMER,
    customerEmail: "customer@example.com",
    quoteId,
    kind,
    paymentId: intent.paymentId,
    amountCents: intent.amountCents,
    appOrigin: "https://portal.example.com",
  });
  return checkout.url;
}
/** One webhook delivery, on the connection of the flow that is running. */
const webhook = (event: unknown) => processStripeEvent(here().client, event, SINGLE, { notifyPaid });
const markPaid = (paymentId: string) => markPaymentPaid(owner, paymentId);

let revision = 1;
/** A manager's revise: the live revision is superseded, a new one is live, and the carry runs. */
async function revise(next: { depositCents?: number; totalCents?: number } = {}) {
  const live = liveQuote();
  const root = (live.root_id ?? live.id) as string;
  const id = `a0000000-0000-4000-8000-0000000000${String(++revision).padStart(2, "0")}`;
  const depositCents = next.depositCents ?? (live.deposit_cents as number);
  const totalCents = next.totalCents ?? (live.total_cents as number);
  live.superseded_at = "2026-11-12T00:00:00.000Z";
  quotes().push({ ...live, id, root_id: root, superseded_at: null, deposit_cents: depositCents, total_cents: totalCents });
  return carryPaymentsToRevision(here().client, { rootId: root, newQuoteId: id, depositCents, totalCents }, (sessionId) => stripe.retire("sk_shop", sessionId));
}

// ── Interleaving ────────────────────────────────────────────────────────────────────

interface Step {
  table: string;
  kind: "select" | "insert" | "update" | "rpc";
  payload: unknown;
}
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settled = <T>(p: Promise<T>): Promise<Outcome<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

const connection = (): PaymentsFake => sameMigrationState(paymentsFake(db.tables), db);

/**
 * Run `first` on its own connection and HOLD it at the first statement `at` picks —
 * everything before that statement has run, the statement itself has not. Then run `second`
 * to its end on another connection, and only then let `first` finish. Both outcomes come
 * back (a refusal is an outcome, not a failure of the test).
 */
async function interleave<A, B>(first: () => Promise<A>, at: (step: Step) => boolean, second: () => Promise<B>): Promise<{ first: Outcome<A>; second: Outcome<B> }> {
  const conn = connection();
  let release!: () => void;
  let signalReached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const reached = new Promise<"held">((r) => (signalReached = () => r("held")));
  let armed = true;
  const maybeHold = async (step: Step): Promise<void> => {
    if (!armed || !at(step)) return;
    armed = false;
    signalReached();
    await gate;
  };
  conn.beforeOp = (op) => maybeHold(op);
  conn.beforeRpc = (name, args) => maybeHold({ table: `rpc:${name}`, kind: "rpc", payload: args });

  const a = settled(scope.connection.run(conn, first));
  const state = await Promise.race([reached, a.then(() => "finished" as const)]);
  if (state !== "held") throw new Error("the first flow finished without reaching the statement it was to be held at");
  const b = await settled(scope.connection.run(connection(), second));
  release();
  return { first: await a, second: b };
}

/**
 * Run `flow` on its own connection and KILL it at the first statement `at` picks: that
 * statement never answers and the flow's promise stays pending for ever — what a function
 * the platform killed (a timeout, a crash, a deploy) looks like. Resolves once it is dead.
 */
function cutOff(flow: () => Promise<unknown>, at: (step: Step) => boolean): Promise<void> {
  return new Promise<void>((dead, failed) => {
    const conn = connection();
    conn.beforeOp = (op) => {
      if (!at(op)) return;
      conn.beforeOp = null;
      dead();
      return "cut";
    };
    scope.connection.run(conn, flow).then(() => failed(new Error("the flow finished — it was never cut off")), failed);
  });
}

const isAttach = (s: Step) => s.kind === "rpc" && s.table === "rpc:catering_payment_attach_checkout";
const isReadyQuestion = (s: Step) => s.kind === "rpc" && s.table === "rpc:catering_payment_checkout_ready";
const paymentUpdate = (s: Step) => (s.table === "catering_payments" && s.kind === "update" ? (s.payload as Row) : null);
const isPaidFlip = (s: Step) => paymentUpdate(s)?.status === "paid";
const isVoidWrite = (s: Step) => paymentUpdate(s)?.status === "void";
const isRefundWrite = (s: Step) => paymentUpdate(s)?.status === "refunded";
/** A clear of a session id and nothing else (the events' clear, the tap's, the cleanup's). */
const isSessionClear = (s: Step) => {
  const p = paymentUpdate(s);
  return p != null && p.provider_session_id === null && !("status" in p) && !("quote_id" in p) && !("amount_cents" in p);
};
/** The carry's move / re-price of a row (it names the new revision). */
const isCarryWrite = (s: Step) => paymentUpdate(s)?.quote_id != null;
const isFirstPaymentRead = (s: Step) => s.table === "catering_payments" && s.kind === "select";

function valueOf<T>(o: Outcome<T>): T {
  if (!o.ok) throw o.error;
  return o.value;
}
function refusalOf(o: Outcome<unknown>): { status: number; code: string } {
  if (o.ok) throw new Error(`expected a refusal, but the flow succeeded with ${JSON.stringify(o.value)}`);
  if (o.error instanceof PortalQuoteError || o.error instanceof CateringPaymentError) return { status: o.error.status, code: o.error.code };
  throw o.error;
}

/**
 * THE INVARIANT EVERY INTERLEAVING MUST END IN: at most one hosted page of this order is
 * still payable, and every one that is payable is NAMED by a due or void row — nothing a
 * customer can still pay has been forgotten by our records.
 */
function expectNoForgottenCheckout() {
  expect(openSessions().length).toBeLessThanOrEqual(1);
  for (const s of openSessions()) {
    const named = pays().some((r) => r.provider_session_id === s.id && (r.status === "due" || r.status === "void"));
    expect(named, `open session ${s.id} is named by no due / void row`).toBe(true);
  }
}
/** …and once money is recorded on the order, nothing of it is payable at all. */
function expectNothingPayable() {
  expect(openSessions()).toEqual([]);
  expect(pays().filter((r) => (r.status === "due" || r.status === "void") && r.provider_session_id != null)).toEqual([]);
}

beforeEach(() => {
  auditMock.mockClear();
  notifyPaid.mockClear();
  eventSeq = 0;
  revision = 1;
  stripe = stripeFake();
  createSessionMock.mockReset();
  createSessionMock.mockImplementation(stripe.create);
  retireMock.mockReset();
  retireMock.mockImplementation(stripe.retire);
  retrieveMock.mockReset();
  retrieveMock.mockImplementation(stripe.retrieve);
  db = paymentsFake({
    stripe_events: [],
    catering_quotes: [
      {
        id: QUOTE,
        root_id: null,
        customer_id: CUSTOMER,
        location_id: LOCATION,
        origin: "staff",
        status: "sent",
        superseded_at: null,
        pipeline_id: null,
        event_date: "2099-06-01", // far out: a staff quote offers the deposit AND the full amount
        expires_at: "2099-01-01T00:00:00.000Z",
        deposit_cents: 20000,
        total_cents: 100000,
      },
    ],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
});

// ── pay tap × … ─────────────────────────────────────────────────────────────────────

describe("W02 review r6 — interleavings: the pay tap", () => {
  it("pay tap × pay tap — the deposit and the full amount are tapped at the same moment: ONE checkout survives, the other request is refused and its session is closed", async () => {
    // The deposit tap has minted its session and is at its attach when the full tap runs start to finish.
    const out = await interleave(() => tap("deposit"), isAttach, () => tap("full"));

    const fullUrl = valueOf(out.second);
    expect(refusalOf(out.first)).toEqual({ status: 409, code: "payment_in_progress" });
    expect(stripe.creates).toHaveLength(2); // both minted…
    expect(openSessions().map((s) => s.url)).toEqual([fullUrl]); // …one survives
    expect(byKind("deposit")[0]).toMatchObject({ status: "due" });
    expect(byKind("deposit")[0]!.provider_session_id ?? null).toBeNull();
    expectNoForgottenCheckout();
  });

  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
    "pay tap × webhook %s — the full tap is at its attach when the deposit's payment lands: the attach is refused and the session it minted is closed",
    async (type) => {
      seedDeposit();
      const depositSession = await sessionFor(DEPOSIT, 20000); // a deposit checkout the customer is already in

      const out = await interleave(() => tap("full"), isAttach, () => webhook(paidEvent(depositSession, type)));

      expect(valueOf(out.second).result).toBe("paid");
      expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", settlement_cleanup_at: expect.any(String) });
      // The settlement closed the full intent the tap had raised; the attach then found it closed.
      expect(refusalOf(out.first)).toEqual({ status: 409, code: "not_due" });
      expect(byKind("full")[0]).toMatchObject({ status: "void" });
      expectNothingPayable();
    },
  );

  it("pay tap × async_payment_failed — the failure lands while the tap is asking Stripe about that same session: nothing is minted, and the next tap opens ONE fresh checkout", async () => {
    // The customer paid the deposit by bank debit: the session is `complete`, the money pending.
    const pending = await sessionFor(DEPOSIT, 20000);
    stripe.complete(pending);
    seedDeposit({ provider: "stripe", provider_session_id: pending });
    // The tap has read the intent (it names `pending`) and is asking Stripe about it…
    let askedStripe!: () => void;
    let answer!: () => void;
    const asked = new Promise<void>((r) => (askedStripe = r));
    const gate = new Promise<void>((r) => (answer = r));
    retrieveMock.mockImplementationOnce(async (key, id) => {
      askedStripe();
      await gate;
      return stripe.retrieve(key, id);
    });
    const tapping = settled(scope.connection.run(connection(), () => tap("deposit")));
    await asked;

    // …when Stripe reports that the delayed payment failed.
    const failed = await webhook(sessionOverEvent("checkout.session.async_payment_failed", pending, DEPOSIT));
    expect(failed.result).toBe("async_failed");
    expect(rowOf(DEPOSIT).provider_session_id).toBeNull();
    answer();
    const out = await tapping;

    // The session the tap was asking about is `complete`: it opens nothing beside it.
    expect(refusalOf(out)).toEqual({ status: 409, code: "payment_in_progress" });
    expect(createSessionMock).not.toHaveBeenCalled();
    // The customer taps again: the intent was released, and exactly one checkout opens.
    const url = await tap("deposit");
    expect(openSessions().map((s) => s.url)).toEqual([url]);
    expectNoForgottenCheckout();
  });

  it("pay tap × async_payment_failed — the failure lands before the tap reads the intent: the tap finds it released and opens ONE checkout", async () => {
    const pending = await sessionFor(DEPOSIT, 20000);
    stripe.complete(pending);
    seedDeposit({ provider: "stripe", provider_session_id: pending });

    const out = await interleave(
      () => tap("deposit"),
      isReadyQuestion, // the checkout step has not read the intent yet
      () => webhook(sessionOverEvent("checkout.session.async_payment_failed", pending, DEPOSIT)),
    );

    expect(valueOf(out.second).result).toBe("async_failed");
    const url = valueOf(out.first);
    expect(openSessions().map((s) => s.url)).toEqual([url]);
    expect(rowOf(DEPOSIT).provider_session_id).toBe(openSessions()[0]!.id);
    expectNoForgottenCheckout();
  });

  it("pay tap × session expired — the expiry event clears the stale session under the tap's own clear: the tap mints nothing, and the next tap opens ONE fresh checkout", async () => {
    // The intent names a checkout that has lapsed at Stripe; its expiry event is on its way.
    const lapsed = await sessionFor(DEPOSIT, 20000);
    stripe.lapse(lapsed);
    seedDeposit({ provider: "stripe", provider_session_id: lapsed });
    createSessionMock.mockClear();

    // The tap has asked Stripe (expired: not this attempt) and is about to clear the id itself.
    const out = await interleave(() => tap("deposit"), isSessionClear, () => webhook(sessionOverEvent("checkout.session.expired", lapsed, DEPOSIT)));

    expect(valueOf(out.second).result).toBe("expired");
    // Its own clear matched nothing — the row moved under it — so it does not go on to mint.
    expect(refusalOf(out.first)).toEqual({ status: 409, code: "payment_in_progress" });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "due", provider_session_id: null });

    const url = await tap("deposit");
    expect(openSessions().map((s) => s.url)).toEqual([url]);
    expectNoForgottenCheckout();
  });

  it("pay tap × refund — a WHOLE-charge refund lands under the tap's already-paid gate: the gate reads the committed row, collection re-opens, ONE checkout", async () => {
    seedDeposit({ status: "paid", provider: "stripe", provider_ref: "pi_dep", paid_at: "2026-11-02T00:00:00.000Z", settlement_cleanup_at: "2026-11-02T00:00:01.000Z" });

    const out = await interleave(() => tap("full"), isFirstPaymentRead, () => webhook(refundEvent("pi_dep", whole(20000))));

    expect(valueOf(out.second).result).toBe("refunded");
    expect(rowOf(DEPOSIT).status).toBe("refunded");
    // The customer was given their money back: paying is open again, through one checkout.
    const url = valueOf(out.first);
    expect(openSessions().map((s) => s.url)).toEqual([url]);
    expectNoForgottenCheckout();
  });

  it("pay tap × refund — a PARTIAL refund lands under the same gate: the payment is still paid and the tap is still refused", async () => {
    seedDeposit({ status: "paid", provider: "stripe", provider_ref: "pi_dep", paid_at: "2026-11-02T00:00:00.000Z", settlement_cleanup_at: "2026-11-02T00:00:01.000Z" });

    const out = await interleave(() => tap("full"), isFirstPaymentRead, () => webhook(refundEvent("pi_dep", { amount: 20000, amount_refunded: 5000, refunded: false })));

    expect(valueOf(out.second).result).toBe("partially_refunded");
    expect(rowOf(DEPOSIT).status).toBe("paid");
    expect(refusalOf(out.first)).toEqual({ status: 409, code: "already_paid" });
    expect(createSessionMock).not.toHaveBeenCalled();
    expectNothingPayable();
  });
});

// ── webhook completed / async_succeeded × … ─────────────────────────────────────────

describe("W02 review r6 — interleavings: a card settlement beside another settlement", () => {
  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
    "webhook completed × webhook %s — the deposit AND the full amount are paid at the same moment: both recorded, and BOTH flagged as a second payment",
    async (type) => {
      // Two hosted pages were payable (one of them a checkout our rows had lost track of), and the customer paid both.
      seedDeposit();
      const depositSession = await sessionFor(DEPOSIT, 20000);
      const fullSession = await sessionFor(FULL, 100000, "full");
      seedFull({ provider: "stripe", provider_session_id: fullSession });

      // The deposit's settlement has flipped its row, read the full intent as DUE, and is about to void it…
      const out = await interleave(
        () => webhook(paidEvent(depositSession)),
        isVoidWrite,
        // …when the full payment lands and flips that very row to paid.
        () => webhook(paidEvent(fullSession, type)),
      );

      expect(rowOf(DEPOSIT).status).toBe("paid");
      expect(rowOf(FULL).status).toBe("paid"); // money taken is always recorded — never voided over
      // The full payment's own look saw the paid deposit…
      expect(valueOf(out.second).result).toBe("paid_needs_review");
      // …and the deposit's void matched nothing, so it looked AGAIN instead of assuming it had closed the intent.
      expect(valueOf(out.first).result).toBe("paid_needs_review");
      const reasons = metaOf("catering.payment.provider_paid").map((m) => m.needs_review);
      expect(reasons).toEqual([["another_payment_already_paid"], ["another_payment_already_paid"]]);
      expect(notifyPaid).toHaveBeenCalledTimes(2);
      expectNothingPayable();
    },
  );

  it("webhook completed × async_payment_failed — a failure held at its clear while the same intent is paid: the clear matches nothing, the paid row keeps its session id as history", async () => {
    const session = await sessionFor(DEPOSIT, 20000);
    seedDeposit({ provider: "stripe", provider_session_id: session });

    const out = await interleave(
      () => webhook(sessionOverEvent("checkout.session.async_payment_failed", session, DEPOSIT)),
      isSessionClear,
      () => webhook(paidEvent(session, "checkout.session.async_payment_succeeded")),
    );

    expect(valueOf(out.second).result).toBe("paid");
    expect(valueOf(out.first).result).toBe("async_failed");
    // The failure's clear is guarded on a due / void row: a PAID row's id is history.
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider_session_id: session });
    expect(metaOf("catering.payment.provider_payment_failed")[0]).toMatchObject({ session_cleared: false });
  });

  it("webhook completed × session expired — the other checkout's expiry event is held at its clear while the deposit settles: the settlement closes that checkout, and the event's clear matches nothing", async () => {
    seedDeposit();
    const depositSession = await sessionFor(DEPOSIT, 20000);
    const fullSession = await sessionFor(FULL, 100000, "full");
    seedFull({ provider: "stripe", provider_session_id: fullSession });
    stripe.lapse(fullSession); // it has expired at Stripe; the event saying so is in flight

    const out = await interleave(
      () => webhook(sessionOverEvent("checkout.session.expired", fullSession, FULL)),
      isSessionClear,
      () => webhook(paidEvent(depositSession)),
    );

    // The settlement asked Stripe to retire it, was told it is expired, and cleared it.
    expect(valueOf(out.second).result).toBe("paid");
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ voided_sibling_ids: [FULL], closed_checkouts: { retired: [FULL], stillOpen: [], completing: [] } });
    expect(valueOf(out.first).result).toBe("expired");
    expect(rowOf(FULL)).toMatchObject({ status: "void", provider_session_id: null });
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", settlement_cleanup_at: expect.any(String) });
    expectNothingPayable();
  });

  it("webhook completed × Mark paid — the other intent is marked paid by hand between the card settlement's read of it and its void: the void matches nothing, and the card payment is flagged as a second payment", async () => {
    seedDeposit();
    const depositSession = await sessionFor(DEPOSIT, 20000);
    seedFull();

    const out = await interleave(() => webhook(paidEvent(depositSession)), isVoidWrite, () => markPaid(FULL));

    expect(out.second.ok).toBe(true);
    expect(rowOf(FULL)).toMatchObject({ status: "paid", provider: "manual" }); // the person's record stands
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider: "stripe" });
    // Before this round: `paid`, quietly — a deposit by card and the whole total by hand, and nobody told.
    expect(valueOf(out.first).result).toBe("paid_needs_review");
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ needs_review: ["another_payment_already_paid"], voided_sibling_ids: [] });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["another_payment_already_paid"] }));
  });

  it("webhook completed × Mark paid — the card settlement voids the other intent first: the hand mark that was reading it is refused, nothing is recorded twice", async () => {
    seedDeposit();
    const depositSession = await sessionFor(DEPOSIT, 20000);
    seedFull();

    // The person's press has read the full intent as due and is at its flip…
    const out = await interleave(() => markPaid(FULL), isPaidFlip, () => webhook(paidEvent(depositSession)));

    expect(valueOf(out.second).result).toBe("paid");
    expect(rowOf(FULL).status).toBe("void");
    // …which now matches nothing.
    expect(refusalOf(out.first)).toEqual({ status: 409, code: "not_due" });
    expect(audits("catering.payment.mark_paid")).toEqual([]);
  });

  it("webhook completed × Mark paid — a hand mark was CUT OFF after its flip and the customer then pays that intent's page by card: the charge is flagged, and the delivery runs the cleanup the mark never reached", async () => {
    // The deposit's hosted page is open, and so is a voided full intent's (nobody confirmed it closed).
    const depositSession = await sessionFor(DEPOSIT, 20000);
    const fullSession = await sessionFor(FULL, 100000, "full");
    seedDeposit({ provider: "stripe", provider_session_id: depositSession });
    seedFull({ status: "void", provider: "stripe", provider_session_id: fullSession });
    // The customer pays by phone; the person's Mark paid dies right after its flip.
    await cutOff(() => markPaid(DEPOSIT), () => rowOf(DEPOSIT).status === "paid");
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual" });
    expect(rowOf(DEPOSIT).settlement_cleanup_at ?? null).toBeNull();
    expect(openSessions()).toHaveLength(2); // both pages still payable, and nobody will press again

    // The customer pays the deposit's page by card as well.
    const out = await webhook(paidEvent(depositSession));

    // A second charge for money already recorded: said loudly, the row is not rewritten…
    expect(out.result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual", provider_ref: null });
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({
      needs_review: ["already_settled"],
      row_moved: false,
      closed_checkouts: { retired: [FULL], stillOpen: [], completing: [] },
    });
    // …and the page that could have taken a THIRD payment is closed by this delivery, because
    // the row said its cleanup had never been recorded as done.
    expect(stripe.sessions.get(fullSession)!.status).toBe("expired");
    expect(rowOf(FULL)).toMatchObject({ status: "void", provider_session_id: null });
    expect(rowOf(DEPOSIT).settlement_cleanup_at).toEqual(expect.any(String));
    expectNothingPayable();
  });

  it("webhook completed × revise carry — a revise carries the other intent to a new revision between the settlement's read of it and its void: it is voided where it is now", async () => {
    seedDeposit();
    const depositSession = await sessionFor(DEPOSIT, 20000);
    seedFull();
    const V2 = "a0000000-0000-4000-8000-0000000000b2";

    const out = await interleave(
      () => webhook(paidEvent(depositSession)),
      isVoidWrite,
      // A carry that had read the family BEFORE the deposit was paid lands its move of the
      // full intent now — still due — onto a revision the settlement has never heard of.
      async () => {
        liveQuote().superseded_at = "2026-11-12T00:00:00.000Z";
        quotes().push({ ...quotes()[0]!, id: V2, root_id: QUOTE, superseded_at: null });
        rowOf(FULL).quote_id = V2;
      },
    );

    // The void was bound to the family as it was read; it matched nothing; the row was read
    // again, found still due on a newer revision of the SAME order, and closed there.
    expect(valueOf(out.first).result).toBe("paid");
    expect(rowOf(FULL)).toMatchObject({ status: "void", quote_id: V2 });
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ needs_review: [], voided_sibling_ids: [FULL] });
    expect(rowOf(DEPOSIT).settlement_cleanup_at).toEqual(expect.any(String));
  });
});

// ── webhook completed × refund: the one pair that can arrive OUT OF ORDER ───────────

describe("W02 review r6 — interleavings: a refund that is processed before its payment", () => {
  const pi = (session: string) => `pi_${session}`;

  it("webhook completed × refund — the refund is processed FIRST (its payment is not recorded yet): when the payment lands it is recorded, flagged, and the refund is applied — never left `paid`", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);
    const payment = paidEvent(session); // Stripe has the payment; its event has not been worked yet

    // The refund arrives first. No row carries that PaymentIntent — only the paid flip writes it.
    const early = await webhook(refundEvent(pi(session), whole(20000), "evt_refund_early"));
    expect(early.result).toBe("payment_not_found");
    expect(rowOf(DEPOSIT).status).toBe("due");

    const out = await webhook(payment);

    // Before this round: `paid`, for good, with the money already given back.
    expect(out.result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "refunded", provider_ref: pi(session) });
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ needs_review: ["refund_seen_first"], refunds_seen_first: ["evt_refund_early"] });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["refund_seen_first"] }));
    // The refund is audited as the live path audits it, under ITS event id…
    expect(metaOf("catering.payment.provider_refunded")).toEqual([expect.objectContaining({ stripe_event_id: "evt_refund_early", partial: false, row_status: "refunded" })]);
    // …and the ledger no longer says that refund found nothing.
    expect(ledger("evt_refund_early").outcome).toBe("refunded");
    // The person was told BEFORE the refund was applied (a cut-off between the two re-tells it).
    const order = auditMock.mock.calls.map((c) => c[0].action);
    expect(order.indexOf("catering.payment.provider_paid")).toBeLessThan(order.indexOf("catering.payment.provider_refunded"));
  });

  it("webhook completed × refund — the refund lands while the payment's delivery is held at its flip: the same end", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);

    const out = await interleave(() => webhook(paidEvent(session)), isPaidFlip, () => webhook(refundEvent(pi(session), whole(20000), "evt_refund_mid")));

    expect(valueOf(out.second).result).toBe("payment_not_found"); // the flip had not landed yet
    expect(valueOf(out.first).result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT).status).toBe("refunded");
    expect(ledger("evt_refund_mid").outcome).toBe("refunded");
  });

  it("webhook completed × refund — the refund's delivery has looked for its payment (not there yet) and is still IN FLIGHT when the payment lands: the settlement finds its unfinished ledger row and applies it", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);

    // The refund's delivery appended its ledger row, found no row carrying the PaymentIntent,
    // and is held just before it closes its event as `payment_not_found`…
    const out = await interleave(
      () => webhook(refundEvent(pi(session), whole(20000), "evt_refund_flight")),
      (s) => s.table === "stripe_events" && s.kind === "update",
      // …when the payment lands, start to finish.
      () => webhook(paidEvent(session)),
    );

    // The settlement saw the refund's ledger row — unfinished — and did not wait to be told twice.
    expect(valueOf(out.second).result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT).status).toBe("refunded");
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ needs_review: ["refund_seen_first"], refunds_seen_first: ["evt_refund_flight"] });
    // The refund's own delivery answers what IT found; its late stamp does not overwrite the verdict.
    expect(valueOf(out.first).result).toBe("payment_not_found");
    expect(ledger("evt_refund_flight").outcome).toBe("refunded");
    expect(audits("catering.payment.provider_refunded")).toHaveLength(1);
  });

  it("webhook completed × refund — a PARTIAL refund seen first: the payment is recorded and stays paid, the refunded amount is audited, and the team is told", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);
    const payment = paidEvent(session);
    await webhook(refundEvent(pi(session), { amount: 20000, amount_refunded: 5000, refunded: false }, "evt_refund_part"));

    const out = await webhook(payment);

    expect(out.result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT).status).toBe("paid"); // only a whole-charge refund moves the row
    expect(metaOf("catering.payment.provider_refunded")).toEqual([expect.objectContaining({ partial: true, refunded_amount_cents: 5000, row_status: "paid" })]);
    expect(ledger("evt_refund_part").outcome).toBe("partially_refunded");
    // Nothing is left for a later look: the settlement is recorded as done.
    expect(rowOf(DEPOSIT).settlement_cleanup_at).toEqual(expect.any(String));
  });

  it("webhook completed × refund — in order (payment, then refund): an ordinary payment, then an ordinary refund; nothing is flagged", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);

    const paid = await webhook(paidEvent(session));
    const refunded = await webhook(refundEvent(pi(session), whole(20000)));

    expect(paid.result).toBe("paid");
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ needs_review: [] });
    expect(metaOf("catering.payment.provider_paid")[0]).not.toHaveProperty("refunds_seen_first");
    expect(refunded.result).toBe("refunded");
    expect(rowOf(DEPOSIT).status).toBe("refunded");
  });

  it("webhook completed × refund — another charge's refund on the ledger is never applied to this payment", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);
    const payment = paidEvent(session);
    await webhook(refundEvent("pi_someone_else", whole(999), "evt_refund_other"));

    const out = await webhook(payment);

    expect(out.result).toBe("paid");
    expect(rowOf(DEPOSIT).status).toBe("paid");
    expect(ledger("evt_refund_other").outcome).toBe("payment_not_found");
  });

  it("webhook completed × refund — the ledger could not be read for an earlier refund: flagged `refund_check_failed`, and the settlement is NOT recorded as done", async () => {
    seedDeposit();
    const session = await sessionFor(DEPOSIT, 20000);
    const payment = paidEvent(session);
    await webhook(refundEvent(`pi_${session}`, whole(20000), "evt_refund_unread")); // seen first: `payment_not_found`
    // The settlement's look for it fails: the payment delivery's FIRST read of the ledger (a
    // first-seen delivery reads the ledger only for this look).
    db.failSelect.push("stripe_events");

    const out = await webhook(payment);

    // Review r7: not a terminal verdict. A 200 here was the last time anything looked — and
    // the refund the look did not see would have left a refunded charge `paid` for good.
    expect(out.result).toBe("settlement_incomplete");
    expect(rowOf(DEPOSIT).status).toBe("paid"); // the money is recorded regardless
    expect(metaOf("catering.payment.provider_paid")[0]).toMatchObject({ needs_review: ["refund_check_failed"] });
    expect(rowOf(DEPOSIT).settlement_cleanup_at ?? null).toBeNull();

    // The SAME event, redelivered, can read the ledger: it finds the earlier refund and applies it.
    const again = await webhook(payment);
    expect(again.result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT).status).toBe("refunded");
    expect(ledger("evt_refund_unread").outcome).toBe("refunded");
  });
});

// ── the events that END a checkout (async_payment_failed, expired) × … ──────────────

describe("W02 review r6 — interleavings: the events that end a checkout attempt", () => {
  it("async_payment_failed × async_payment_failed — two deliveries of one failure event at once: ONE clear lands, the other matches nothing", async () => {
    const session = await sessionFor(DEPOSIT, 20000);
    stripe.complete(session);
    seedDeposit({ provider: "stripe", provider_session_id: session });
    const event = sessionOverEvent("checkout.session.async_payment_failed", session, DEPOSIT, "evt_failed");

    const out = await interleave(() => webhook(event), isSessionClear, () => webhook(event));

    expect(valueOf(out.first).result).toBe("async_failed");
    expect(valueOf(out.second).result).toBe("async_failed");
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "due", provider_session_id: null });
    expect(metaOf("catering.payment.provider_payment_failed").map((m) => m.session_cleared).sort()).toEqual([false, true]);
    expect(ledger("evt_failed").outcome).toBe("async_failed");
  });

  it("session expired × session expired — two deliveries of one expiry event at once: ONE clear lands, the other matches nothing", async () => {
    const session = await sessionFor(DEPOSIT, 20000);
    stripe.lapse(session);
    seedDeposit({ provider: "stripe", provider_session_id: session });
    const event = sessionOverEvent("checkout.session.expired", session, DEPOSIT, "evt_expired");

    const out = await interleave(() => webhook(event), isSessionClear, () => webhook(event));

    expect(valueOf(out.first).result).toBe("expired");
    expect(valueOf(out.second).result).toBe("expired");
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "due", provider_session_id: null });
    expect(ledger("evt_expired").outcome).toBe("expired");
  });

  it("async_payment_failed × session expired — both name the same session, and the customer is given a NEW checkout in between: the old id is cleared once, the new one is never touched", async () => {
    const old = await sessionFor(DEPOSIT, 20000);
    stripe.lapse(old);
    seedDeposit({ provider: "stripe", provider_session_id: old });

    let newUrl = "";
    const out = await interleave(
      () => webhook(sessionOverEvent("checkout.session.async_payment_failed", old, DEPOSIT)),
      isSessionClear,
      async () => {
        await webhook(sessionOverEvent("checkout.session.expired", old, DEPOSIT));
        newUrl = await tap("deposit"); // the intent was released: the customer opens a new checkout
      },
    );

    expect(out.second.ok).toBe(true);
    expect(valueOf(out.first).result).toBe("async_failed");
    // The held clear names `old`; the row names the NEW session, and still does.
    expect(openSessions().map((s) => s.url)).toEqual([newUrl]);
    expect(rowOf(DEPOSIT).provider_session_id).toBe(openSessions()[0]!.id);
    expectNoForgottenCheckout();
  });

  it("async_payment_failed × Mark paid — the failure event arrives between the hand flip and its cleanup: the paid row's id is not cleared by the event, and the mark finishes", async () => {
    const session = await sessionFor(DEPOSIT, 20000);
    stripe.complete(session); // paid by bank debit, pending — the customer then paid by phone instead
    seedDeposit({ provider: "stripe", provider_session_id: session });

    const out = await interleave(
      () => markPaid(DEPOSIT),
      () => rowOf(DEPOSIT).status === "paid", // the first statement after the flip landed
      () => webhook(sessionOverEvent("checkout.session.async_payment_failed", session, DEPOSIT)),
    );

    expect(valueOf(out.second).result).toBe("async_failed");
    expect(out.first.ok).toBe(true);
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual", provider_session_id: session });
    // The mark's cleanup asked Stripe about that session and was told it is complete.
    expect(metaOf("catering.payment.mark_paid")[0]).toMatchObject({ closed_checkouts: { retired: [], stillOpen: [], completing: [DEPOSIT] } });
    expect(rowOf(DEPOSIT).settlement_cleanup_at).toEqual(expect.any(String));
  });

  it("session expired × Mark paid — the expiry event arrives between the hand flip and its cleanup: the mark's own cleanup clears the id, once", async () => {
    const session = await sessionFor(DEPOSIT, 20000);
    seedDeposit({ provider: "stripe", provider_session_id: session });

    const out = await interleave(
      () => markPaid(DEPOSIT),
      () => rowOf(DEPOSIT).status === "paid",
      async () => {
        stripe.lapse(session);
        return webhook(sessionOverEvent("checkout.session.expired", session, DEPOSIT));
      },
    );

    // The event's clear is for a due / void row: this one is paid by now.
    expect(valueOf(out.second).result).toBe("expired");
    expect(out.first.ok).toBe(true);
    // The mark's cleanup retired the session the FLIP returned (Stripe: already expired) and cleared it.
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider_session_id: null, settlement_cleanup_at: expect.any(String) });
    expect(metaOf("catering.payment.mark_paid")[0]).toMatchObject({ closed_checkouts: { retired: [DEPOSIT], stillOpen: [], completing: [] } });
    expectNothingPayable();
  });

  it.each(["checkout.session.expired", "checkout.session.async_payment_failed"] as const)(
    "%s × revise carry — the event clears the session between the carry's read and its write: the carry re-reads and moves the intent without it",
    async (type) => {
      const session = await sessionFor(DEPOSIT, 20000);
      // Expired at Stripe / completed-then-failed: either way the event is what ends the attempt.
      if (type === "checkout.session.expired") stripe.lapse(session);
      else stripe.complete(session);
      seedDeposit({ provider: "stripe", provider_session_id: session });

      const out = await interleave(() => revise({ depositCents: 25000 }), isCarryWrite, () => webhook(sessionOverEvent(type, session, DEPOSIT)));

      expect(out.second.ok).toBe(true);
      const carried = valueOf(out.first);
      // The carry's write named the session it had read; that session was gone; it read again.
      expect(carried.leftBehind).toEqual([]);
      expect(rowOf(DEPOSIT)).toMatchObject({ status: "due", quote_id: liveQuote().id, provider_session_id: null, amount_cents: 25000 });
      expectNothingPayable();
    },
  );

  it.each(["checkout.session.expired", "checkout.session.async_payment_failed"] as const)(
    "%s × refund — the refund is held at its write while the event clears another intent's session: both land, each on its own row",
    async (type) => {
      // A deposit paid by card (its session id is history), and a voided full intent whose checkout nobody had confirmed closed.
      seedDeposit({ status: "paid", provider: "stripe", provider_ref: "pi_dep", provider_session_id: "cs_history", settlement_cleanup_at: "2026-11-02T00:00:01.000Z" });
      const unresolved = await sessionFor(FULL, 100000, "full");
      if (type === "checkout.session.expired") stripe.lapse(unresolved);
      else stripe.complete(unresolved);
      seedFull({ status: "void", provider: "stripe", provider_session_id: unresolved });

      const out = await interleave(() => webhook(refundEvent("pi_dep", whole(20000))), isRefundWrite, () => webhook(sessionOverEvent(type, unresolved, FULL)));

      expect(out.second.ok).toBe(true);
      expect(valueOf(out.first).result).toBe("refunded");
      expect(rowOf(DEPOSIT)).toMatchObject({ status: "refunded", provider_session_id: "cs_history" }); // history is untouched
      expect(rowOf(FULL)).toMatchObject({ status: "void", provider_session_id: null });
    },
  );
});

// ── Mark paid, the carry and the refund between themselves ──────────────────────────

describe("W02 review r6 — interleavings: Mark paid, the carry and the refund", () => {
  it("Mark paid × Mark paid — two presses at once: ONE records the payment, the other is 409 `not_due`, and the checkout is closed once", async () => {
    const session = await sessionFor(DEPOSIT, 20000);
    seedDeposit({ provider: "stripe", provider_session_id: session });

    // The first press has read the row as due and is at its flip when the second runs start to finish.
    const out = await interleave(() => markPaid(DEPOSIT), isPaidFlip, () => markPaid(DEPOSIT));

    expect(out.second.ok).toBe(true);
    expect(refusalOf(out.first)).toEqual({ status: 409, code: "not_due" });
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual", provider_session_id: null, settlement_cleanup_at: expect.any(String) });
    expect(stripe.retires).toEqual([session]);
    expect(audits("catering.payment.mark_paid")).toHaveLength(1);
    expectNothingPayable();
  });

  it("Mark paid × refund — the card deposit is refunded while the full amount is being marked paid by hand: both land, each on its own row", async () => {
    seedDeposit({ status: "paid", provider: "stripe", provider_ref: "pi_dep", settlement_cleanup_at: "2026-11-02T00:00:01.000Z" });
    seedFull();

    const out = await interleave(() => markPaid(FULL), isPaidFlip, () => webhook(refundEvent("pi_dep", whole(20000))));

    expect(valueOf(out.second).result).toBe("refunded");
    expect(out.first.ok).toBe(true);
    expect(rowOf(DEPOSIT).status).toBe("refunded");
    // A hand-recorded row carries no PaymentIntent: no refund event can ever find it.
    expect(rowOf(FULL)).toMatchObject({ status: "paid", provider: "manual", provider_ref: null });
  });

  it("revise carry × refund — the charge is refunded between the carry's read of the paid row and its move: the row arrives on the new revision, refunded", async () => {
    seedDeposit({ status: "paid", provider: "stripe", provider_ref: "pi_dep", settlement_cleanup_at: "2026-11-02T00:00:01.000Z" });

    const out = await interleave(() => revise(), isCarryWrite, () => webhook(refundEvent("pi_dep", whole(20000))));

    expect(valueOf(out.second).result).toBe("refunded");
    const carried = valueOf(out.first);
    expect(carried.moved).toEqual([{ paymentId: DEPOSIT, fromQuoteId: QUOTE }]);
    expect(carried.leftBehind).toEqual([]);
    expect(rowOf(DEPOSIT)).toMatchObject({ status: "refunded", quote_id: liveQuote().id });
  });

  it("refund × refund — two deliveries of one refund event at once: the row is refunded ONCE, and audited once", async () => {
    seedDeposit({ status: "paid", provider: "stripe", provider_ref: "pi_dep", settlement_cleanup_at: "2026-11-02T00:00:01.000Z" });
    const event = refundEvent("pi_dep", whole(20000), "evt_refund");

    const out = await interleave(() => webhook(event), isRefundWrite, () => webhook(event));

    expect(valueOf(out.second).result).toBe("refunded");
    expect(valueOf(out.first).result).toBe("no_paid_row"); // its guarded write matched nothing
    expect(rowOf(DEPOSIT).status).toBe("refunded");
    expect(audits("catering.payment.provider_refunded")).toHaveLength(1);
    expect(ledger("evt_refund").outcome).toBe("refunded"); // the first terminal verdict stands
  });
});

// ── The PR's table, printed from the list above ─────────────────────────────────────

if (process.env.PRINT_INTERLEAVING_MATRIX === "1") {
  const lines = ["| # | Flow A | Flow B | Serialization point | Interleaved by |", "|---|---|---|---|---|"];
  MATRIX.forEach((m, i) => {
    const pins = m.pinnedBy.map((p) => `\`${p.file.replace("tests/", "")}\` › "${p.title}"`).join("<br>");
    lines.push(`| ${i + 1} | ${m.a} | ${m.b} | ${m.serialization} | ${pins} |`);
  });
  const legend = FLOWS.map((f) => `- **${f}** — ${FLOW_WRITES[f]}`);
  console.log(`\n${legend.join("\n")}\n\n${lines.join("\n")}\n`);
}
