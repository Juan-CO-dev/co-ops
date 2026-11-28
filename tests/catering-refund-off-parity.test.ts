/**
 * Catering refunds Part B1 — `CATERING_REFUNDS` OFF is main (9ce98df5) byte for byte (plan B1.6 "(r5) OFF parity").
 *
 *   1. BYTE IDENTITY: every OFF-path module B1 did not change equals main's blob (the frozen copies under
 *      tests/fixtures/main-9ce98df5/, themselves checked against `git show 9ce98df5:<path>` when that object exists).
 *   2. TRACE EQUALITY for the two changed modules: MAIN's frozen lib/stripe/webhook.ts and THIS BRANCH's, the switch
 *      OFF, over the same predicate-aware fake (tests/payments-fake-client.ts) wrapped to log every table call (every
 *      builder method with its arguments: filters, payloads, ordering) and every RPC in order, the same inputs and the
 *      same clock. Identical results, identical ordered calls, identical audit / notify / checkout-retire calls and
 *      identical final rows; zero RPCs, zero provider calls.
 *   3. lib/stripe/client.ts `createRefund` with no 4th argument sends main's request (URL, headers, body, 20 s).
 *   4. The pay tap, a quote revision and settlement cleanup import nothing from refund-reconcile.ts /
 *      refund-outcomes-shared.ts (module-graph read).
 * The four refund ROUTES, the cron route and the job watch are another packet's. No network, synthetic rows only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ log: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (input: unknown) => {
    h.log.push({ audit: JSON.parse(JSON.stringify(input)) });
  }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "email_fixture" })), teamFrom: () => "Team <team@example.com>" }));
vi.mock("@/lib/stripe/shared", async (orig) => {
  const real = await orig<typeof import("@/lib/stripe/shared")>();
  return { ...real, parseRefundIngress: vi.fn(real.parseRefundIngress) };
});

import * as branchShared from "@/lib/stripe/shared";
import * as branchWebhook from "@/lib/stripe/webhook";
import * as branchClient from "@/lib/stripe/client";
import * as mainWebhook from "./fixtures/main-9ce98df5/lib/stripe/webhook";
import * as mainShared from "./fixtures/main-9ce98df5/lib/stripe/shared";
import * as mainClient from "./fixtures/main-9ce98df5/lib/stripe/client";
import { paymentsFake, type Row } from "./payments-fake-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN = join(ROOT, "tests/fixtures/main-9ce98df5");
const HEADER = "// FROZEN COPY of main @ 9ce98df5 — never edit\n";
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const frozenBody = (path: string): string => {
  const text = lf(readFileSync(join(FROZEN, path), "utf8"));
  expect(text.startsWith(HEADER), `${path}: the frozen copy carries its header`).toBe(true);
  return text.slice(HEADER.length);
};
/** `git show 9ce98df5:<path>`, or null when the object is not in this clone (a shallow CI checkout). */
const mainBlob = (path: string): string | null => {
  try {
    return lf(execFileSync("git", ["show", `9ce98df5:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 }));
  } catch {
    return null;
  }
};

const fetchCalls: unknown[] = [];
beforeEach(() => {
  delete process.env.CATERING_REFUNDS;
  h.log = [];
  fetchCalls.length = 0;
  vi.mocked(branchShared.parseRefundIngress).mockClear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (...a: unknown[]) => {
    fetchCalls.push(a);
    throw new Error("no provider call is allowed on the OFF path");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ═══════════════════════════════ 1. Byte identity ═══════════════════════════════════════════════════════════
// The MONEY-PATH modules the OFF traces below run through and that Part B1 must not touch: the shared
// checkout-retirement helper (pay tap, quote revision, settlement cleanup), the payment writers, the refund-event
// reader and the webhook's front door. (The portal and digest modules are covered by the module-graph test: nothing
// they import reaches a Part B1 module. They are not frozen here: main edits them for unrelated work.)
// A GOLDEN, like tests/shop-versions-equivalence.test.ts: when main legitimately changes one of these files, refresh
// its frozen copy with a written reason in that PR. Retire this whole file when CATERING_REFUNDS is activated.
const UNCHANGED = [
  "lib/catering/payment-sessions.ts",
  "lib/catering/payment-carry.ts",
  "lib/catering/payments.ts",
  "lib/catering/refund-events-shared.ts",
  "app/api/webhooks/stripe/_handler.ts",
  "app/api/webhooks/stripe/route.ts",
  "app/api/webhooks/stripe/[locationCode]/route.ts",
];

// ═══════════════════════════════ The scenarios ══════════════════════════════════════════════════════════════
const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const FULL = "d0000000-0000-4000-8000-000000000002";
const CLOCK = Date.UTC(2030, 4, 6, 15, 0, 0);
const CREATED = Math.floor(CLOCK / 1000) - 120;

type Ctx = { locationId: string | null; locationCode: string | null };
const SINGLE: Ctx = { locationId: null, locationCode: null };
const PER_SHOP_OTHER: Ctx = { locationId: OTHER, locationCode: "S2" };

interface Scenario {
  name: string;
  tables: () => Record<string, Row[]>;
  steps: Array<{ event: unknown; ctx?: Ctx }>;
  expect: string[];
}
interface WebhookModule {
  processStripeEvent(sb: never, event: unknown, ctx: Ctx, deps: Record<string, unknown>): Promise<{ result: string; locationId: string | null }>;
}

const pay = (over: Row): Row => ({ quote_id: QUOTE, kind: "deposit", amount_cents: 20000, status: "due", provider: null, provider_ref: null, provider_session_id: null, paid_at: null, settlement_cleanup_at: null, ...over });
function baseTables(payments: Row[], extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    stripe_events: [],
    locations: [{ id: LOCATION, code: "S1", active: true }, { id: OTHER, code: "S2", active: true }],
    catering_quotes: [{ id: QUOTE, root_id: null, location_id: LOCATION, status: "sent", superseded_at: null, expires_at: "2099-01-01T00:00:00.000Z",
      deposit_cents: 20000, total_cents: 100000, pipeline_id: null, event_date: "2099-06-01" }],
    catering_payments: payments,
    catering_payment_refund_events: [],
    ...extra,
  };
}
const paidDeposit = () => pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1", paid_at: "2030-05-01T12:00:00.000Z", settlement_cleanup_at: "2030-05-01T12:00:01.000Z" });
const dueFullWithCheckout = () => pay({ id: FULL, kind: "full", amount_cents: 100000, provider: "stripe", provider_session_id: "cs_full" });

let n = 0;
const charge = (o: { id?: string; cumulative?: number | null; amount?: number; full?: boolean | null; pi?: string | null; expanded?: boolean }) => ({
  id: o.id ?? `evt_off_${++n}`, object: "event", type: "charge.refunded", livemode: false, created: CREATED,
  data: { object: { id: "ch_1", object: "charge",
    ...(o.pi === null ? {} : { payment_intent: o.expanded ? { id: o.pi ?? "pi_1", object: "payment_intent" } : (o.pi ?? "pi_1") }),
    amount: o.amount ?? 20000,
    ...(o.cumulative === null ? {} : { amount_refunded: o.cumulative ?? 20000 }),
    ...(o.full === null ? {} : { refunded: o.full ?? true }) } },
});
const refundObject = (type: string, id: string) => ({ id, object: "event", type, livemode: false, created: CREATED,
  data: { object: { id: `re_${id}`, object: "refund", status: "succeeded", amount: 500, payment_intent: "pi_1", charge: "ch_1" } } });
const completed = (id: string, over: Row = {}) => ({ id, object: "event", type: "checkout.session.completed", livemode: false, created: CREATED,
  data: { object: { id: "cs_dep", object: "checkout.session", payment_status: "paid", payment_intent: "pi_1", amount_total: 20000,
    metadata: { quote_id: QUOTE, payment_id: DEPOSIT, kind: "deposit" }, ...over } } });
const twice = (event: unknown, ctx?: Ctx) => [{ event, ctx }, { event, ctx }];

function SCENARIOS(): Scenario[] {
  const whole = charge({ id: "evt_whole", cumulative: 20000, full: true });
  const partial = charge({ id: "evt_partial", cumulative: 5000, full: false });
  const missing = charge({ id: "evt_missing", cumulative: null, full: null });
  const noPi = charge({ id: "evt_nopi", pi: null });
  const expandedWhole = charge({ id: "evt_whole_exp", cumulative: 20000, full: true, expanded: true });
  const out: Scenario[] = [
    { name: "charge.refunded whole (+ duplicate)", tables: () => baseTables([paidDeposit()]), steps: twice(whole), expect: ["refunded", "duplicate"] },
    { name: "charge.refunded whole, expanded PaymentIntent", tables: () => baseTables([paidDeposit()]), steps: [{ event: expandedWhole }], expect: ["refunded"] },
    { name: "charge.refunded partial (+ duplicate)", tables: () => baseTables([paidDeposit()]), steps: twice(partial), expect: ["partially_refunded", "duplicate"] },
    { name: "charge.refunded missing amount (+ duplicate)", tables: () => baseTables([paidDeposit()]), steps: twice(missing), expect: ["partially_refunded", "duplicate"] },
    { name: "charge.refunded with no PaymentIntent (+ duplicate)", tables: () => baseTables([paidDeposit()]), steps: twice(noPi), expect: ["payment_not_found", "duplicate"] },
    { name: "charge.refunded on an already refunded row", tables: () => baseTables([{ ...paidDeposit(), status: "refunded" }]), steps: [{ event: charge({ id: "evt_again", cumulative: 20000, full: true }) }], expect: ["no_paid_row"] },
    { name: "preexisting 0333 history, then a later partial", tables: () => baseTables([paidDeposit()], { catering_payment_refund_events: [{ stripe_event_id: "evt_hist", payment_id: DEPOSIT, refunded_at: "2030-05-02T00:00:00.000Z", cumulative_refunded_cents: 3000, charge_amount_cents: 20000, refunded_at_approximate: false }] }), steps: twice(charge({ id: "evt_later", cumulative: 8000, full: false })), expect: ["partially_refunded", "duplicate"] },
    { name: "per-location mismatch (another shop's endpoint): a refund and a checkout", tables: () => baseTables([paidDeposit(), pay({ id: FULL, kind: "full", amount_cents: 100000 })]),
      steps: [{ event: charge({ id: "evt_mm", cumulative: 20000, full: true }), ctx: PER_SHOP_OTHER }, { event: completed("evt_mm_pay", { metadata: { quote_id: QUOTE, payment_id: FULL, kind: "full" }, amount_total: 100000 }), ctx: PER_SHOP_OTHER }],
      expect: ["location_mismatch", "location_mismatch"] },
    {
      name: "early settlement: the refund seen first, then the payment (main's seen-first replay), then the refund's redelivery",
      tables: () => baseTables([pay({ id: DEPOSIT })]),
      steps: [{ event: whole }, { event: completed("evt_pay_early") }, { event: whole }],
      expect: ["payment_not_found", "paid_needs_review", "duplicate"],
    },
    {
      name: "early settlement, partial refund seen first",
      tables: () => baseTables([pay({ id: DEPOSIT })]),
      steps: [{ event: partial }, { event: completed("evt_pay_early_p") }],
      expect: ["payment_not_found", "paid_needs_review"],
    },
    {
      name: "checkout.session.completed with a sibling checkout (closeQuoteCheckouts retires it) (+ duplicate)",
      tables: () => baseTables([pay({ id: DEPOSIT, provider: "stripe", provider_session_id: "cs_dep" }), dueFullWithCheckout()]),
      steps: twice(completed("evt_pay_sib")),
      expect: ["paid", "duplicate"],
    },
  ];
  for (const type of ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]) {
    out.push({ name: `${type} (+ duplicate): main answers ignored`, tables: () => baseTables([paidDeposit()]), steps: twice(refundObject(type, `evt_${type.replace(/\W/g, "_")}`)), expect: ["ignored", "duplicate"] });
  }
  return out;
}
function allScenarioEvents(): unknown[] {
  return SCENARIOS().flatMap((s) => s.steps.map((st) => st.event));
}

/** A recorder over the predicate-aware fake: every `from(table)` and every builder call (with its arguments) in order. */
function recorded(client: { from(t: string): unknown; rpc(n: string, a?: unknown): unknown }, log: unknown[]) {
  const clone = (v: unknown) => (v === undefined ? "<undefined>" : JSON.parse(JSON.stringify(v)));
  const wrap = (builder: object, entry: { table: string; chain: unknown[] }): unknown => {
    const proxy: object = new Proxy(builder, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "then" || typeof v !== "function") return typeof v === "function" ? v.bind(target) : v;
        return (...args: unknown[]) => {
          entry.chain.push([String(prop), ...args.map(clone)]);
          const r = (v as (...a: unknown[]) => unknown).apply(target, args);
          return r === target ? proxy : r;
        };
      },
    });
    return proxy;
  };
  return {
    from(table: string) {
      const entry = { table, chain: [] as unknown[] };
      log.push(entry);
      return wrap(client.from(table) as object, entry);
    },
    rpc(name: string, args?: unknown) {
      log.push({ rpc: name, args: clone(args) });
      return client.rpc(name, args);
    },
  };
}

const AUTO_ID = /^00000000-0000-4000-8000-\d{12}$/;
const AUTO_CREATED = /^2030-01-01T/;
function normalizeTables(tables: Record<string, Row[]>): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const [k, rows] of Object.entries(tables)) {
    // The fake stamps an insert with a module-wide sequence (its id when the insert names none, and `created_at`): the
    // sequence differs between the two runs, so those two stamps are masked; every other column is compared.
    out[k] = rows.map((r) => {
      const c: Row = { ...r };
      if (typeof c.id === "string" && AUTO_ID.test(c.id)) c.id = "<auto>";
      if (typeof c.created_at === "string" && AUTO_CREATED.test(c.created_at)) c.created_at = "<auto>";
      return c;
    });
  }
  return out;
}

async function runScenario(mod: WebhookModule, scenario: Scenario) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CLOCK);
  h.log = [];
  const fake = paymentsFake(scenario.tables());
  const sb = recorded(fake.client as never, h.log);
  const deps = {
    notifyPaid: async (a: unknown) => { h.log.push({ notify: JSON.parse(JSON.stringify(a)) }); },
    retireSession: async (sessionId: string) => { h.log.push({ retire: sessionId }); return "expired" as const; },
  };
  const results: string[] = [];
  for (const step of scenario.steps) {
    const r = await mod.processStripeEvent(sb as never, JSON.parse(JSON.stringify(step.event)), step.ctx ?? SINGLE, deps);
    results.push(r.result);
    h.log.push({ answered: r });
  }
  vi.useRealTimers();
  return { results, trace: h.log, tables: normalizeTables(fake.tables) };
}

// ═══════════════════════════════ The module-graph reader ═════════════════════════════════════════════════════
function importsOf(file: string): Array<{ spec: string; resolved: string | null }> {
  const src = readFileSync(join(ROOT, file), "utf8");
  const specs = new Set<string>();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)) specs.add(m[1]!);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specs.add(m[1]!);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]!);
  return [...specs].map((spec) => ({ spec, resolved: resolveSpec(file, spec) }));
}
function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = join(dirname(from), spec).replace(/\\/g, "/");
  else return null; // a package
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(cand) && existsSync(join(ROOT, cand))) return cand;
  }
  return null; // json / css / generated: not code
}
function reachable(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const i of importsOf(f)) if (i.resolved && !seen.has(i.resolved)) stack.push(i.resolved);
  }
  return seen;
}

describe("each_dark_pr_matches_main_off", () => {
  it("each_dark_pr_matches_main_off (1, byte identity): every OFF-path module B1 did not change is main's blob", () => {
    const differs: string[] = [];
    for (const path of UNCHANGED) {
      const frozen = frozenBody(path);
      const blob = mainBlob(path);
      if (blob !== null) expect(frozen, `${path}: the frozen copy IS main's blob`).toBe(blob);
      if (lf(readFileSync(join(ROOT, path), "utf8")) !== frozen) differs.push(path);
    }
    expect(differs, "OFF-path modules that differ from main").toEqual([]);
    // The three changed modules' frozen copies are main's blobs too (the trace tests below run them).
    for (const path of ["lib/stripe/webhook.ts", "lib/stripe/shared.ts", "lib/stripe/client.ts"]) {
      const blob = mainBlob(path);
      if (blob !== null) expect(frozenBody(path), path).toBe(blob);
    }
  });

  it("each_dark_pr_matches_main_off (2a, shared.ts): the branch's shared.ts is main's with ONE additive block, and parseCheckoutEvent answers identically over a payload corpus", () => {
    const branch = lf(readFileSync(join(ROOT, "lib/stripe/shared.ts"), "utf8"));
    const start = branch.indexOf("// ── Refund ingress (catering refunds Part B1");
    const end = branch.indexOf("// ── Per-location credential suffixes");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(branch.slice(0, start) + branch.slice(end), "removing the one added block gives main's file exactly").toBe(frozenBody("lib/stripe/shared.ts"));
    // Behaviour, over the trace corpus below plus hostile shapes.
    const corpus: unknown[] = [
      ...allScenarioEvents(),
      null, undefined, 0, "evt", [], {}, { id: "evt_1" }, { type: "charge.refunded" }, { id: "evt_1", type: "charge.refunded" },
      { id: "evt_1", type: "charge.refunded", data: { object: { payment_intent: { id: "pi_exp" }, amount_refunded: -1, amount: 1.5, refunded: "yes", metadata: { quote_id: "not-a-uuid" } } } },
      { id: "evt_1", type: "checkout.session.completed", created: -5, data: { object: { payment_status: "unpaid", metadata: [] } } },
      { id: "evt_1", type: "checkout.session.async_payment_succeeded", livemode: true, created: 1700000000, data: { object: { id: "cs_1", payment_intent: "pi_1", amount_total: 100 } } },
      { id: "evt_1", type: "checkout.session.expired", data: { object: { id: "cs_1" } } },
      { id: "evt_1", type: "refund.created", data: { object: { id: "re_1", payment_intent: "pi_1" } } },
      { id: "", type: "", data: null },
    ];
    for (const ev of corpus) expect(branchShared.parseCheckoutEvent(ev), JSON.stringify(ev)).toEqual(mainShared.parseCheckoutEvent(ev));
    expect("parseRefundIngress" in mainShared).toBe(false);
  });

  // ═══════════════════════════════ 2. Trace equality, webhook.ts ═══════════════════════════════════════════
  for (const scenario of SCENARIOS()) {
    it(`each_dark_pr_matches_main_off (2b, webhook.ts OFF): ${scenario.name} — main and the branch: same results, same ordered calls, same rows, zero RPCs and provider calls`, async () => {
      const main = await runScenario(mainWebhook as unknown as WebhookModule, scenario);
      const branch = await runScenario(branchWebhook as unknown as WebhookModule, scenario);
      expect(main.results, "main answers what main answers (the scenario is not vacuous)").toEqual(scenario.expect);
      // The trace carries the filters themselves (not only table names): e.g. the ledger insert and its guarded stamp.
      const chains = main.trace.flatMap((e) => ((e as { chain?: unknown[][] }).chain ?? []));
      expect(chains.some((c) => c[0] === "insert")).toBe(true);
      expect(chains.some((c) => c[0] === "eq" || c[0] === "or")).toBe(true);
      expect(branch.results).toEqual(main.results);
      expect(branch.trace).toEqual(main.trace);
      expect(branch.trace.length).toBe(main.trace.length); // zero additional calls
      expect(branch.tables).toEqual(main.tables);
      expect(branch.trace.filter((e) => typeof e === "object" && e !== null && "rpc" in e)).toEqual([]);
      expect(fetchCalls).toEqual([]);
      expect(vi.mocked(branchShared.parseRefundIngress)).not.toHaveBeenCalled();
    });
  }

  // ═══════════════════════════════ 3. client.ts createRefund ═══════════════════════════════════════════════
  it("each_dark_pr_matches_main_off (3, client.ts): createRefund with no 4th argument sends main's request (same URL, headers, body, 20 s timeout)", async () => {
    const seen: Array<{ url: unknown; init: Record<string, unknown>; timeout: unknown }> = [];
    let lastTimeout: unknown = null;
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      lastTimeout = ms;
      return realTimeout(ms);
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (url: unknown, init?: unknown) => {
      const i = { ...(init as Record<string, unknown>) };
      delete i.signal;
      seen.push({ url, init: i, timeout: lastTimeout });
      return new Response(JSON.stringify({ id: "re_fixture_1", object: "refund", status: "pending", amount: 1234, metadata: { refund_request_id: "11111111-2222-4333-8444-555555555555" } }), { status: 200 });
    });
    const input = {
      paymentIntentId: "pi_fixture_1",
      amountCents: 1234,
      reason: "requested_by_customer" as const,
      metadata: { refund_request_id: "11111111-2222-4333-8444-555555555555", quote_id: "a0000000-0000-4000-8000-000000000001", payment_id: "d0000000-0000-4000-8000-000000000001" },
    };
    const a = await mainClient.createRefund("sk_test_fixture_only", input, "catering-refund:fixture");
    const b = await branchClient.createRefund("sk_test_fixture_only", input, "catering-refund:fixture");
    expect(b).toEqual(a);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[0]!.timeout).toBe(20_000);
    // The same with reason null (the body omits it on both).
    seen.length = 0;
    await mainClient.createRefund("sk_test_fixture_only", { ...input, reason: null }, "k2");
    await branchClient.createRefund("sk_test_fixture_only", { ...input, reason: null }, "k2");
    expect(seen[1]).toEqual(seen[0]);
  });

  // ═══════════════════════════════ 4. Module graph ═════════════════════════════════════════════════════════
  it("each_dark_pr_matches_main_off (4, module graph): the pay tap, a quote revision and settlement cleanup reach neither refund-reconcile.ts nor refund-outcomes-shared.ts", () => {
    const FORBIDDEN = ["lib/catering/refund-reconcile.ts", "lib/catering/refund-outcomes-shared.ts"];
    const roots = ["lib/portal/quotes.ts", "lib/portal/draft.ts", "lib/catering/payment-sessions.ts"];
    for (const r of roots) {
      const direct = importsOf(r).map((x) => x.spec);
      expect(direct.filter((s) => /refund-reconcile|refund-outcomes-shared/.test(s)), `${r}: direct imports`).toEqual([]);
    }
    const closure = reachable(roots);
    for (const f of FORBIDDEN) expect(closure.has(f), `${f} is reachable from ${roots.join(", ")}`).toBe(false);
    expect(closure.size).toBeGreaterThan(roots.length); // the walk really walked
  });
});
