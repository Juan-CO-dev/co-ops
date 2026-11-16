/**
 * THE INVENTORY OF EVERY WRITER OF `catering_payments`, AND OF EVERY PLACE A STRIPE CHECKOUT
 * SESSION IS ATTACHED OR RETIRED (audit wave W02, review r5 — CC's requirement to end the
 * review loop).
 *
 * Four review rounds each found one more write that trusted a row it had read a moment
 * earlier. The rule they all broke is one sentence (AGENTS.md, "Catering card payments"):
 *
 *     A WRITE TO A PAYMENT ROW APPLIES ONLY TO THE ROW AS IT WAS READ.
 *
 * "As it was read" means a compare-and-set on what the decision was made from: the row's
 * `status`, and — whenever the decision is about a REVISION (an amount, a quote's
 * payability) — its `quote_id`; whenever it is about a CHECKOUT, its `provider_session_id`.
 *
 * This file makes that rule a list instead of a habit:
 *   1. `WRITERS` is every statement in `lib/` and `app/` that writes `catering_payments`,
 *      with the guard it carries and the test that pins its behaviour.
 *   2. The source is SCANNED. A writer that is not in the list, a listed writer that is
 *      gone, or a writer whose guard changed FAILS this test — so the next writer is
 *      reviewed against the rule on the day it is written, not in a later audit.
 *   3. Every "pinned by" names a test file and a title that must exist.
 *   4. The Stripe call sites (mint / retire) and the one attach function are counted the
 *      same way.
 *
 * The PR's writer table is printed from this list (`PRINT_PAYMENT_WRITERS=1 npx vitest run
 * tests/catering-payments-writers.test.ts`), so the table and the code cannot disagree.
 *
 * Review r6 changed two things in it. The lock-free attach ("write, re-read, undo" for a
 * database without migration 0303) is GONE, with both of its statements: no application
 * statement sets a session id any more — only 0303's function does. And one writer was
 * added: the settlement marker (`markSettlementCleanupDone`), a compare-and-set like the rest.
 *
 * Not in scope, and why: SQL that is not application code — migration 0303's attach function
 * (listed below as the attach; proved by scripts/sql-harness-0303.mjs), migration 0193 (the
 * one-off builder test-data purge, already applied), `scripts/guide-test/reset-catering-fn.sql`
 * and the `scripts/*-smoke.ts` cleanups (sim / manual harness only; never deployed).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ id: "email_1" })),
  teamFrom: () => "Team <team@example.com>",
}));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── The scanner ─────────────────────────────────────────────────────────────────────

interface FoundWriter {
  file: string;
  line: number;
  fn: string;
  verb: "insert" | "update" | "upsert" | "delete";
  /** Every filter in the statement, in order: `eq:status`, `in:quote_id`, `is:provider_session_id`… */
  guards: string[];
  /** The statement's own text. */
  stmt: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Every application source file (`lib/`, `app/`), read once: repo-relative path and text. */
const SOURCES: Array<{ file: string; src: string }> = ["lib", "app"].flatMap((dir) =>
  walk(join(ROOT, dir)).map((full) => ({ file: relative(ROOT, full).replace(/\\/g, "/"), src: readFileSync(full, "utf8") })),
);

/** Code only: comments and imports talk about these functions by name without calling them. */
const codeOf = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^import[\s\S]*?;$/gm, "");

/** The statement that starts at `from`: up to the first `;` outside any bracket. */
function statementFrom(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i]!;
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth -= 1;
    else if (c === ";" && depth <= 0) return src.slice(from, i);
    if (depth < 0) return src.slice(from, i);
  }
  return src.slice(from);
}

/** The nearest `function name(` above an offset. */
function enclosingFunction(src: string, at: number): string {
  let name = "(module)";
  for (const m of src.slice(0, at).matchAll(/function\s+([A-Za-z0-9_]+)\s*[(<]/g)) name = m[1]!;
  return name;
}

function scanWriters(): FoundWriter[] {
  const found: FoundWriter[] = [];
  for (const { file, src } of SOURCES) {
    for (const m of src.matchAll(/\.from\(\s*["'`]catering_payments["'`]\s*\)/g)) {
      const stmt = statementFrom(src, m.index!);
      const verb = /\.(insert|update|upsert|delete)\(/.exec(stmt)?.[1] as FoundWriter["verb"] | undefined;
      if (!verb) continue; // a read
      found.push({
        file,
        line: src.slice(0, m.index!).split("\n").length,
        fn: enclosingFunction(src, m.index!),
        verb,
        guards: [...stmt.matchAll(/\.(eq|neq|in|is|not)\(\s*"([a-z_]+)"/g)].map((g) => `${g[1]}:${g[2]}`),
        stmt,
      });
    }
  }
  return found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

// ── The inventory ───────────────────────────────────────────────────────────────────

interface Writer {
  file: string;
  fn: string;
  verb: FoundWriter["verb"];
  /** What the statement writes, in words. */
  writes: string;
  /** The filters the scanner must find in the statement, in order. */
  guards: string[];
  /** A guard added in the NEXT statement (a conditional `.eq` / `.is`), named here. */
  thenAlso?: string;
  /** Which kind of bind this is, for the table. */
  bind: string;
  pinnedBy: { file: string; title: string };
}

const WRITERS: Writer[] = [
  // ── lib/catering/payment-carry.ts — a revise moving a family's payments ────────────
  {
    file: "lib/catering/payment-carry.ts",
    fn: "writeDue",
    verb: "update",
    writes: "a due intent: move to the live revision, re-price, clear a retired session, or void",
    guards: ["eq:id", "eq:status", "eq:quote_id"],
    thenAlso: "provider_session_id = the session read (or IS NULL)",
    bind: "status + quote_id + provider_session_id CAS, as the pass read the row",
    pinnedBy: { file: "tests/catering-payment-carry-concurrency.test.ts", title: "an intent another request already carried AND gave a checkout is left exactly as it is" },
  },
  {
    file: "lib/catering/payment-carry.ts",
    fn: "moveSettled",
    verb: "update",
    writes: "a paid / refunded / void row: quote_id only",
    guards: ["eq:id", "eq:quote_id", "neq:status"],
    bind: "quote_id CAS (the revision it was read on) + status is not due",
    pinnedBy: { file: "tests/catering-payment-carry-concurrency.test.ts", title: "a settled row a newer pass already moved on is not pulled back" },
  },
  // ── lib/catering/payment-sessions.ts — closing checkouts after a settlement ────────
  {
    file: "lib/catering/payment-sessions.ts",
    fn: "markSettlementCleanupDone",
    verb: "update",
    writes: "settlement_cleanup_at = now: a SETTLED payment's cleanup is recorded as done, once (r6). The marker and nothing else: never the money status (r8)",
    guards: ["eq:id", "in:status", "is:settlement_cleanup_at"],
    bind: "status IN (paid, refunded) = money was recorded on the row (r8: a row refunded mid-settlement owes the same cleanup; due / void never take it) + marker IS NULL CAS: written once, by the run that finished the cleanup; the run whose write lands reports an ordinary payment",
    pinnedBy: { file: "tests/stripe-webhook-resume.test.ts", title: "two deliveries of one event at once: the run that LOSES the marker, with nothing to review, stays quiet" },
  },
  {
    file: "lib/catering/payment-sessions.ts",
    fn: "closeQuoteCheckouts",
    verb: "update",
    writes: "provider_session_id = null, after Stripe confirmed that session expired",
    guards: ["eq:id", "eq:provider_session_id"],
    bind: "provider_session_id CAS (the exact session retired)",
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "a paid row that names a checkout OTHER than the one that was paid: that other checkout is closed too" },
  },
  // ── lib/catering/payments.ts ───────────────────────────────────────────────────────
  {
    file: "lib/catering/payments.ts",
    fn: "syncDuePaymentAmount",
    verb: "update",
    writes: "amount_cents of a due intent (and clears a session the caller already retired)",
    guards: ["eq:id", "eq:status", "eq:quote_id"],
    thenAlso: "provider_session_id = the retired session (or IS NULL)",
    bind: "status + quote_id + provider_session_id CAS (quote_id added in review r5)",
    pinnedBy: { file: "tests/catering-reprice-revision-bound.test.ts", title: "`syncDuePaymentAmount` itself: the write names the quote, and matches nothing once the intent is on another one" },
  },
  {
    file: "lib/catering/payments.ts",
    fn: "createPaymentDue",
    verb: "insert",
    writes: "a new due intent for (quote, kind)",
    guards: [],
    bind: "INSERT (nothing to compare): 0130's one-due index arbitrates a duplicate; the pay tap re-reads superseded_at after it and closes its own intent (r5); a row stranded on an earlier revision shuts every door until reconcileFamilyPayments moves it",
    pinnedBy: { file: "tests/catering-reprice-revision-bound.test.ts", title: "a revise between the payability read and the insert: the intent the tap raised is closed, and the tap is refused `not_payable`" },
  },
  {
    file: "lib/catering/payments.ts",
    fn: "markPaymentPaid",
    verb: "update",
    writes: "due → paid by hand (returns the row it wrote)",
    guards: ["eq:id", "eq:status", "eq:quote_id"],
    bind: "status + quote_id CAS (the revision the person was looking at); refused 409 not_current otherwise",
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "THE REPORTED INTERLEAVING: mark-paid reads P on v1, a revise carries P to v2 and a checkout is attached, mark-paid resumes — never `paid` beside an open checkout nobody knows about" },
  },
  // ── lib/portal/quotes.ts — the customer's pay tap ──────────────────────────────────
  {
    file: "lib/portal/quotes.ts",
    fn: "initiatePayment",
    verb: "update",
    writes: "void the intent THIS tap raised, when a payment landed on the quote meanwhile",
    guards: ["eq:id", "eq:quote_id", "eq:status", "is:provider_session_id"],
    bind: "status + quote_id + no-session CAS (the row exactly as it was inserted)",
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "an intent that was already there when the settlement landed is not voided by the refused request — only the one it raised itself" },
  },
  {
    file: "lib/portal/quotes.ts",
    fn: "initiatePayment",
    verb: "update",
    writes: "void the intent THIS tap raised, when the quote was superseded meanwhile (r5)",
    guards: ["eq:id", "eq:quote_id", "eq:status", "is:provider_session_id"],
    bind: "status + quote_id + no-session CAS (the row exactly as it was inserted)",
    pinnedBy: { file: "tests/catering-reprice-revision-bound.test.ts", title: "a revise between the payability read and the insert: the intent the tap raised is closed, and the tap is refused `not_payable`" },
  },
  {
    file: "lib/portal/quotes.ts",
    fn: "createQuoteCheckout",
    verb: "update",
    writes: "clear ANOTHER intent's session, after its owning account confirmed it retired",
    guards: ["eq:id", "in:status", "eq:provider_session_id"],
    bind: "status (due or void) + provider_session_id CAS",
    pinnedBy: { file: "tests/portal-quote-payments.test.ts", title: "a VOID sibling that still names a session IS an open checkout: it is retired, and cleared, before the new one is minted" },
  },
  {
    file: "lib/portal/quotes.ts",
    fn: "createQuoteCheckout",
    verb: "update",
    writes: "clear the intent's OWN stored session that is not this attempt (retired or lapsed)",
    guards: ["eq:id", "eq:status", "eq:provider_session_id"],
    bind: "status + provider_session_id CAS; zero rows = 409 payment_in_progress",
    pinnedBy: { file: "tests/portal-quote-payments.test.ts", title: "a stored session at ANOTHER amount is retired BEFORE a new one is minted, and replaced" },
  },
  // ── lib/stripe/webhook.ts — Stripe's events ────────────────────────────────────────
  {
    file: "lib/stripe/webhook.ts",
    fn: "reviewSiblings",
    verb: "update",
    writes: "void the order's other due deposit / full intent once money landed (its session id stays)",
    guards: ["eq:id", "eq:status", "in:quote_id"],
    bind: "status + quote_id IN the order's family (family bind added in review r5)",
    pinnedBy: { file: "tests/catering-payments-writers.test.ts", title: "the sibling void is bound to the order's family: a row that is no longer on one of its revisions is not voided" },
  },
  {
    file: "lib/stripe/webhook.ts",
    fn: "dispatch",
    verb: "update",
    writes: "checkout.session.async_payment_failed: provider_session_id = null (r5)",
    guards: ["eq:id", "in:status", "eq:provider_session_id"],
    bind: "status (due or void) + provider_session_id CAS (the session the EVENT names)",
    pinnedBy: { file: "tests/stripe-async-payment-failed.test.ts", title: "a second failure event for the OLD session, after the customer has a new checkout: the new session stays on the row" },
  },
  {
    file: "lib/stripe/webhook.ts",
    fn: "dispatch",
    verb: "update",
    writes: "checkout.session.expired: provider_session_id = null",
    guards: ["eq:id", "in:status", "eq:provider_session_id"],
    bind: "status (due or void) + provider_session_id CAS (the session the EVENT names)",
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "an expiry for an OLDER session never clears the checkout the row names now" },
  },
  {
    file: "lib/stripe/webhook.ts",
    fn: "dispatch",
    verb: "update",
    writes: "THE PAID FLIP: due or void → paid, paid_at, provider, provider_ref (returns the row it wrote)",
    guards: ["eq:id", "in:status"],
    bind: "status CAS. DELIBERATELY NOT bound to a revision: money Stripe took is recorded wherever its row now is. The flip RETURNS the row; the order is re-judged and cleaned up on that row's revision and family; a cut-off settlement is finished by ANY delivery that finds the charge on the row with its marker NULL — paid, or refunded since (r5, r6, r8)",
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "THE WEBHOOK'S VERSION: the event reads P on v1, a revise carries P and a FULL checkout opens on v2, the flip lands — that checkout is closed, not left beside a paid deposit" },
  },
  {
    file: "lib/stripe/webhook.ts",
    fn: "refund",
    verb: "update",
    writes: "charge.refunded (whole charge): paid → refunded (the event itself is appended to catering_payment_refund_events first, 0333)",
    guards: ["eq:id", "eq:status", "eq:provider_ref"],
    bind: "status + provider_ref CAS (the charge the row was found by; charge bind added in review r5). Not revision-bound on purpose: a refund is about a charge",
    pinnedBy: { file: "tests/catering-payments-writers.test.ts", title: "the refund is bound to the charge: a row that no longer carries that PaymentIntent is not moved" },
  },
];

/** Stripe calls and the attach function: where each may appear, and how many times. */
const SESSION_SITES: Array<{ what: string; pattern: RegExp; sites: Record<string, number>; pinnedBy: { file: string; title: string } }> = [
  {
    what: "MINT a Checkout Session (createCheckoutSession)",
    pattern: /(?<![A-Za-z.])createCheckoutSession\(/g,
    sites: { "lib/portal/quotes.ts": 1, "lib/stripe/client.ts": 1 },
    pinnedBy: { file: "tests/portal-quote-payments.test.ts", title: "every mint carries a key no earlier mint used, prefixed with the intent it is for" },
  },
  {
    what: "ATTACH — the ONLY way a session id is ever written (rpc catering_payment_attach_checkout, 0303: quote row + payment rows locked)",
    pattern: /\.rpc\("catering_payment_attach_checkout"/g,
    sites: { "lib/portal/quotes.ts": 1 },
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "the attach goes through 0303's function, and there is NO second way to attach when it is not there (review r6)" },
  },
  {
    what: "READY? — asked before anything reaches Stripe; no 0303 = no checkout (rpc catering_payment_checkout_ready, r6)",
    pattern: /\.rpc\("catering_payment_checkout_ready"\)/g,
    sites: { "lib/portal/quotes.ts": 1 },
    pinnedBy: { file: "tests/portal-checkout-settlement-race.test.ts", title: "one tap: 503 `payment_unavailable`, the intent is recorded, and Stripe was never called — no session exists" },
  },
  {
    what: "RETIRE with one key (retireCheckoutSession): the definition, the owner loop, and a session minted in this same request",
    pattern: /(?<![A-Za-z.])retireCheckoutSession\(/g,
    sites: { "lib/stripe/client.ts": 1, "lib/stripe/session-owner.ts": 1, "lib/portal/quotes.ts": 1 },
    pinnedBy: { file: "tests/stripe-two-accounts.test.ts", title: "a STORED session is only ever retired through its owning account" },
  },
  {
    what: "RETIRE a STORED session through the account that owns it (retireSessionInOwningAccount)",
    pattern: /(?<![A-Za-z.])retireSessionInOwningAccount\(/g,
    sites: { "lib/stripe/session-owner.ts": 1, "lib/portal/quotes.ts": 1, "lib/catering/payment-carry.ts": 1 },
    pinnedBy: { file: "tests/stripe-two-accounts.test.ts", title: "NO configured account knows it: THROWS `session_not_found` — unresolved, never `expired`" },
  },
];

// ── The pins ────────────────────────────────────────────────────────────────────────

const found = scanWriters();

describe("W02 review r5 — every writer of catering_payments is on the list, with its guard", () => {
  it("the source has exactly the writers the inventory names, in the same places", () => {
    expect(found.map((w) => `${w.file} ${w.fn} ${w.verb}`)).toEqual(WRITERS.map((w) => `${w.file} ${w.fn} ${w.verb}`));
  });

  it.each(WRITERS.map((w, i) => [`${w.file} › ${w.fn} — ${w.writes}`, w, i] as const))("%s", (_label, writer, i) => {
    const actual = found[i];
    expect(actual, "the scanner found no statement for this entry").toBeDefined();
    // The guard in the source is the guard in the inventory — a filter dropped (or added)
    // without updating this list fails here.
    expect(actual!.guards).toEqual(writer.guards);
    // Nothing that UPDATES a payment row is guarded on its id alone.
    if (writer.verb === "update") expect(actual!.guards.length).toBeGreaterThanOrEqual(2);
  });

  it("every UPDATE compares at least one fact beyond the id that the row can lose: status, quote_id or the session", () => {
    for (const w of found.filter((f) => f.verb === "update")) {
      const facts = w.guards.filter((g) => /:(status|quote_id|provider_session_id|provider_ref|amount_cents)$/.test(g));
      expect(facts.length, `${w.file}:${w.line} ${w.fn}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every write that decides something about a REVISION (an amount, a status by hand, a move) is bound to quote_id", () => {
    const revisionBound = ["writeDue", "moveSettled", "syncDuePaymentAmount", "markPaymentPaid", "initiatePayment", "reviewSiblings"];
    for (const w of found.filter((f) => f.verb === "update" && revisionBound.includes(f.fn))) {
      expect(w.guards.some((g) => g.endsWith(":quote_id")), `${w.file}:${w.line} ${w.fn}`).toBe(true);
    }
    // …and there is no application attach left to check (review r6): 0303's function is the
    // attach, and it compares quote_id and amount under the quote's lock.
    expect(found.some((f) => /attach/i.test(f.fn))).toBe(false);
  });

  it("every write that touches a session id is bound to the session it is about (or to there being none)", () => {
    for (const w of found.filter((f) => f.verb === "update")) {
      const inv = WRITERS[found.indexOf(w)]!;
      const touchesSession = /session/i.test(inv.writes) && !/its session id stays/.test(inv.writes);
      if (!touchesSession) continue;
      const bound = w.guards.some((g) => g.endsWith(":provider_session_id")) || /provider_session_id/.test(inv.thenAlso ?? "");
      expect(bound, `${w.file}:${w.line} ${w.fn}`).toBe(true);
    }
  });

  it("the two conditional guards are really there: the statement after the write adds the session compare", () => {
    const carry = readFileSync(join(ROOT, "lib/catering/payment-carry.ts"), "utf8");
    expect(carry).toMatch(/guarded\.eq\("provider_session_id", read\.provider_session_id\)\s*:\s*guarded\.is\("provider_session_id", null\)/);
    const payments = readFileSync(join(ROOT, "lib/catering/payments.ts"), "utf8");
    expect(payments).toMatch(/base\.eq\("provider_session_id", retiredSessionId\)\s*:\s*base\.is\("provider_session_id", null\)/);
  });

  it("every `pinned by` names a real test", () => {
    for (const entry of [...WRITERS, ...SESSION_SITES]) {
      const path = join(ROOT, entry.pinnedBy.file);
      expect(existsSync(path), entry.pinnedBy.file).toBe(true);
      expect(readFileSync(path, "utf8").includes(entry.pinnedBy.title), `${entry.pinnedBy.file} › ${entry.pinnedBy.title}`).toBe(true);
    }
  });
});

describe("W02 review r5 — every place a Checkout Session is minted, attached or retired", () => {
  it.each(SESSION_SITES.map((s) => [s.what, s] as const))("%s", (_what, site) => {
    const counts: Record<string, number> = {};
    for (const { file, src } of SOURCES) {
      const n = [...codeOf(src).matchAll(site.pattern)].length;
      if (n > 0) counts[file] = n;
    }
    expect(counts).toEqual(site.sites);
  });

  it("the only way `provider_session_id` is ever SET to a value is the attach — 0303's function; NO application statement sets one (review r6)", () => {
    // In a statement's own payload, i.e. before its first filter…
    const payloadOf = (w: FoundWriter): string => {
      const firstFilter = w.stmt.search(/\.(eq|neq|in|is)\(/);
      return firstFilter > 0 ? w.stmt.slice(0, firstFilter) : w.stmt;
    };
    const setters = found.filter((w) => /provider_session_id:\s*(?!null\b)[A-Za-z]/.test(payloadOf(w)));
    expect(setters.map((w) => `${w.file} ${w.fn}`)).toEqual([]);
    // …and in the two patches that are built before their statement (the carry's, and the
    // carry is the only writer handed a patch object): only ever `null`.
    const carry = codeOf(SOURCES.find((x) => x.file === "lib/catering/payment-carry.ts")!.src);
    expect([...carry.matchAll(/provider_session_id\s*[:=]\s*([A-Za-z_.]+)/g)].map((m) => m[1]).filter((v) => v !== "null" && v !== "string")).toEqual([]);
    const migration = readFileSync(join(ROOT, "supabase/migrations/0303_catering_payments_one_open_checkout.sql"), "utf8");
    expect(migration).toMatch(/set provider = 'stripe', provider_session_id = p_session_id\s+where id = p_payment_id;/);
    expect(migration).toMatch(/from public\.catering_quotes q where q\.id = p_quote_id for update;/);
  });
});

// ── The two guards this round added to the webhook, as behaviour ─────────────────────

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const OTHER_ORDER = "a0000000-0000-4000-8000-0000000000ff";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const FULL = "d0000000-0000-4000-8000-000000000002";
const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };

describe("W02 review r5 — the webhook's two remaining id + status writes are bound to what was read", () => {
  let db: PaymentsFake;
  const deps = { notifyPaid: vi.fn(async () => {}), retireSession: null };
  const row = (id: string) => db.tables.catering_payments!.find((r) => r.id === id)!;
  const pay = (over: Row): Row => ({
    quote_id: QUOTE,
    kind: "deposit",
    amount_cents: 20000,
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    ...over,
  });
  const quote = (id: string): Row => ({
    id,
    root_id: null,
    location_id: LOCATION,
    status: "sent",
    superseded_at: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    deposit_cents: 20000,
    total_cents: 100000,
    pipeline_id: null,
    event_date: "2099-06-01",
  });
  const depositPaid = {
    id: "evt_1",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: "cs_dep", payment_status: "paid", payment_intent: "pi_1", amount_total: 20000, metadata: { quote_id: QUOTE, payment_id: DEPOSIT, kind: "deposit" } } },
  };
  const refunded = {
    id: "evt_r",
    type: "charge.refunded",
    livemode: false,
    data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 20000, amount_refunded: 20000, refunded: true, metadata: {} } },
  };

  beforeEach(() => {
    vi.mocked(audit).mockClear();
    db = paymentsFake({ stripe_events: [], catering_quotes: [quote(QUOTE), quote(OTHER_ORDER)], catering_payments: [] });
  });

  it("the sibling void: the order's other due intent is voided when a deposit lands", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }), pay({ id: FULL, kind: "full", amount_cents: 100000 }));

    const out = await processStripeEvent(db.client, depositPaid, SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(row(FULL).status).toBe("void");
  });

  it("the sibling void is bound to the order's family: a row that is no longer on one of its revisions is not voided", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }), pay({ id: FULL, kind: "full", amount_cents: 100000 }));
    // Between the read of the order's payments and the void, the row stops being this
    // order's. (Nothing in the app does this — a payment never leaves its family — which is
    // exactly why the write may say so instead of trusting it.)
    db.beforeOp = (op) => {
      if (op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).status === "void") {
        db.beforeOp = null;
        row(FULL).quote_id = OTHER_ORDER;
      }
    };

    await processStripeEvent(db.client, depositPaid, SINGLE, deps);

    expect(row(FULL)).toMatchObject({ quote_id: OTHER_ORDER, status: "due" });
  });

  it("the refund: a fully refunded charge moves its paid row to refunded", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }));

    const out = await processStripeEvent(db.client, refunded, SINGLE, deps);

    expect(out.result).toBe("refunded");
    expect(row(DEPOSIT).status).toBe("refunded");
  });

  it("the refund is bound to the charge: a row that no longer carries that PaymentIntent is not moved", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }));
    // Between finding the row by its charge and the write, the row's charge changes.
    db.beforeOp = (op) => {
      if (op.table === "catering_payments" && op.kind === "update") {
        db.beforeOp = null;
        row(DEPOSIT).provider_ref = "pi_other";
      }
    };

    const out = await processStripeEvent(db.client, refunded, SINGLE, deps);

    expect(out.result).toBe("no_paid_row");
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider_ref: "pi_other" });
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});

// ── The table for the PR body ───────────────────────────────────────────────────────

if (process.env.PRINT_PAYMENT_WRITERS === "1") {
  const lines = ["| # | Writer | Where | What it writes | Guard | Pinned by |", "|---|---|---|---|---|---|"];
  WRITERS.forEach((w, i) => {
    const at = found[i];
    const guard = [at ? at.guards.map((g) => `\`${g.replace(":", " ")}\``).join(" · ") || "—" : "?", w.thenAlso ? `then \`${w.thenAlso}\`` : ""].filter(Boolean).join("; ");
    lines.push(`| ${i + 1} | \`${w.fn}\` (${w.verb}) | \`${w.file}:${at?.line ?? "?"}\` | ${w.writes} | ${guard}. **${w.bind}** | \`${w.pinnedBy.file}\` › "${w.pinnedBy.title}" |`);
  });
  console.log(`\n${lines.join("\n")}\n`);
}
