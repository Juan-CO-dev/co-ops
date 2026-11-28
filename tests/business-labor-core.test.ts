/**
 * Digest labor money (PR 4, packet H): lib/business-labor-core.ts under the REAL pre-load runner
 * (lib/preload-runner.ts), on fake timers and the fake clock they drive, over the business report's own fake
 * client (tests/helpers/business-report-fake.ts) wrapped so every request is COUNTED, records its signal and its
 * `.retry(false)`, and can be held (never settles, answers late, answers after the snapshot).
 *
 *   twins        each span deep-equals `loadBusinessReport` for the same custom range on the same fake client
 *   finality     stale / moved / fingerprint-changed weeks, a Sunday, a Monday, a DST week, no final day: never a 0
 *   L15          a fingerprint answering at 9 s is kept, one that never settles is `null`: the runner's cutoff ends it
 *   §13.2.5      week A's fingerprint never settles / null / errors: the same facts three times
 *   stage cuts   bracket-1 data cut (Opus N2), a span cut, a coverage-after cut
 *   L10          no page, no queued item and no request after its stage / the snapshot
 *   O-N4         every request carries a stage signal and `.retry(false)`; one HTTP attempt on the real SDK; the source scan
 *   roles        no read without a role step; a moved generation; no person key anywhere (Opus P3-5)
 */
import { readFileSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { createClient } from "@supabase/supabase-js";
import { hourlyLaborPiece, preloadRequest, roleLaborPiece, type LaborCoreDeps } from "@/lib/business-labor-core";
import { loadBusinessReport } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { definePreload, preloadValue, signalDeadline, type PreloadPiece } from "@/lib/preload-runner";
import { laborHourlyKey, laborRolesKey, type HourlyLaborFacts, type RoleLaborFacts } from "@/lib/report-digests-labor-shared";
import { roleBuckets } from "@/lib/business-labor-roles-shared";
import { A, fakeClient, type FakeOpts } from "./helpers/business-report-fake";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const MOO = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const D = "2026-10-08"; // Thursday
const WD = "2026-10-04", WP = "2026-09-27";
const FP = "f".repeat(32);
const RICH = { salaried_cents: 4_000, salary_basis: "wages" };
const ready = (week_start: string, extra: Record<string, unknown> = {}) =>
  ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-10-08T05:00:00.000Z", source_fingerprint: FP, ...extra });

// ── The counting, holding wrapper over the report's fake client ──────────────────────────────────

type Req = { kind: "rpc" | "table"; name: string; args: Record<string, unknown>; filters: Record<string, unknown>; range?: [number, number];
  signal?: AbortSignal; retry?: boolean; n: number; at: number };
type Answer = { data: unknown; error?: unknown };
/** What the fake does with a request: undefined = the report fake's own answer; "hang" = never settles (held); a delay;
 * or its own rows. `n` = this request's index among requests of the same name (and same week for fingerprints). */
type Respond = (r: Req) => undefined | "hang" | { delayMs: number } | { rows: unknown[] } | { answer: Answer } | { delayMs: number; answer: Answer };

function wrap(base: ReturnType<typeof fakeClient>, respond: Respond = () => undefined) {
  const sent: Req[] = [];
  const counts = new Map<string, number>();
  const held: Array<() => void> = [];
  const make = (kind: Req["kind"], name: string, args: Record<string, unknown>, inner: Record<string, unknown>) => {
    const req: Req = { kind, name, args, filters: {}, n: 0, at: 0 };
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "abortSignal") return (s: AbortSignal) => { req.signal = s; return proxy; };
        if (prop === "retry") return (v: boolean) => { req.retry = v; return proxy; };
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const k = name === "fact_labor_week_fingerprint" ? `${name}|${String(args.p_week_start)}` : name;
            req.n = counts.get(k) ?? 0;
            counts.set(k, req.n + 1);
            req.at = Date.now();
            sent.push(req);
            const how = respond(req);
            const own = (): Promise<unknown> => {
              // A held request answers, once released, with the report fake's own answer.
              if (how && typeof how === "object" && "rows" in how) {
                const [lo, hi] = req.range ?? [0, Number.POSITIVE_INFINITY];
                return Promise.resolve({ data: how.rows.slice(lo, hi + 1), error: null, count: how.rows.length });
              }
              if (how && typeof how === "object" && "answer" in how) return Promise.resolve({ error: null, ...how.answer });
              return Promise.resolve(inner).then((v) => v);
            };
            if (how === "hang") return new Promise((r) => held.push(() => r(undefined))).then(() => own()).then(res, rej);
            if (how && "delayMs" in how) return new Promise((r) => setTimeout(r, how.delayMs)).then(() => own()).then(res, rej);
            return own().then(res, rej);
          };
        }
        const f = inner[prop];
        if (typeof f !== "function") return f;
        return (...a: unknown[]) => {
          if (prop === "range") req.range = [a[0] as number, a[1] as number];
          else if (["eq", "gte", "lte", "in"].includes(prop)) req.filters[`${prop}:${String(a[0])}`] = a[1];
          (f as (...x: unknown[]) => unknown).apply(inner, a);
          return proxy;
        };
      },
    });
    return proxy;
  };
  const b = base.client as unknown as { rpc: (fn: string, a: Record<string, unknown>, o?: unknown) => Record<string, unknown>; from: (t: string) => Record<string, unknown> };
  const client = {
    rpc: (fn: string, args: Record<string, unknown>, o?: unknown) => make("rpc", fn, args, b.rpc(fn, args, o)),
    from: (t: string) => make("table", t, {}, b.from(t)),
  };
  return { client: client as never, sent, releaseAll: () => { while (held.length) held.shift()!(); } };
}

const TIMERS = { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Runs ONE piece through the real runner (its own phase), advancing the fake timers until it is sealed. */
async function runOne<T>(piece: PreloadPiece<T>, o: { maxCapMs?: number; budgetMs?: number; advanceMs?: number } = {}): Promise<T | null> {
  const preload = definePreload<null>({ budgetMs: o.budgetMs ?? 20_000, phases: [{ name: "p", maxCapMs: o.maxCapMs ?? 10_000, pieces: () => [piece as PreloadPiece<unknown>] }] });
  const p = preload.run({ sources: async () => ({ writersSettled: true }), due: null, clock: () => Date.now(), timers: TIMERS });
  await vi.advanceTimersByTimeAsync(o.advanceMs ?? 25_000);
  return preloadValue<T>(await p, piece.key);
}

function setup(opts: FakeOpts = {}, respond?: Respond) {
  const w = wrap(fakeClient({ weeks: [ready(WP), ready(WD)], ...opts }), respond);
  const deps: LaborCoreDeps = { sb: w.client, wageFallback: "first_known" };
  return { ...w, deps };
}
const hourly = async (opts: FakeOpts = {}, respond?: Respond, day = D) => {
  const s = setup(opts, respond);
  const facts = (await runOne(hourlyLaborPiece(s.deps, A, day)))!;
  return { ...s, facts };
};
/** The report itself, on its own fresh copy of the same fake (its reads must not shift the piece's request counts). */
const report = (opts: FakeOpts, from: string, to: string, respond?: Respond) => loadBusinessReport(MOO,
  { locationId: A, range: resolveBusinessRange({ range: "custom", from, to }, "2026-10-08") },
  { client: wrap(fakeClient({ weeks: [ready(WP), ready(WD)], ...opts }), respond).client, env: ON, wageFallback: "first_known" });

/** Never a 0 for something unknown: a part that is not `ok` carries no figure at all. */
function assertNoFigureUnlessOk(f: HourlyLaborFacts) {
  for (const part of [f.latestFinalDay, f.weekSoFar, f.lastFullWeek]) if (part.kind !== "ok") expect(Object.keys(part)).toEqual(["kind"]);
}
const kinds = (f: HourlyLaborFacts) => [f.latestFinalDay.kind, f.weekSoFar.kind, f.lastFullWeek.kind];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T23:00:00.000Z")); });
afterEach(() => { vi.useRealTimers(); });

// ── Twins ───────────────────────────────────────────────────────────────────────────────────────

describe("twin tests: each span deep-equals loadBusinessReport for the same custom range on the same fake client", () => {
  const STRUCT_TOTAL = { structure: { labor: { targetPct: 30, basis: "total", hourlyTargetPct: 20 } }, created_at: "2026-01-01T00:00:00.000Z" };
  const STRUCT_HOURLY = { structure: { labor: { targetPct: 15, basis: "hourly" } }, created_at: "2026-01-01T00:00:00.000Z" };
  const withStructures = (rows: unknown[]): Respond => (r) => (r.name === "schedule_structures" ? { rows } : undefined);
  const CASES: Array<[string, FakeOpts, Respond | undefined]> = [
    ["the defaults (salary unknown)", {}, undefined],
    ["a stored salary row", { laborCostRow: () => RICH }, undefined],
    ["the salary estimate", { laborCostRow: () => ({ salaried_cents: 3_000, salary_basis: "estimate", estimated_rate_minutes: 10 }) }, undefined],
    ["a non-default target, total basis (hourlyTargetPct)", { laborCostRow: () => RICH }, withStructures([STRUCT_TOTAL])],
    ["a non-default target, hourly basis", { laborCostRow: () => RICH }, withStructures([STRUCT_HOURLY])],
  ];
  it.each(CASES)("%s", async (_name, opts, respond) => {
    const { facts } = await hourly(opts, respond);
    expect(kinds(facts)).toEqual(["ok", "ok", "ok"]);
    const f1 = facts.latestFinalDay as Extract<HourlyLaborFacts["latestFinalDay"], { kind: "ok" }>;
    const f2 = facts.weekSoFar as Extract<HourlyLaborFacts["weekSoFar"], { kind: "ok" }>;
    const f3 = facts.lastFullWeek as Extract<HourlyLaborFacts["lastFullWeek"], { kind: "ok" }>;
    expect(f1.span.from).toBe("2026-10-07");
    const day = await report(opts, "2026-10-07", "2026-10-07", respond);
    expect(f1.span.labor).toEqual(day.days[0]!.labor);
    expect(f1.span.labor).toEqual(day.total.labor);
    expect([f1.span.target, f1.span.loadedTarget]).toEqual([day.total.target, day.total.loadedTarget]);
    const sofar = await report(opts, WD, "2026-10-07", respond);
    expect(f2.span).toMatchObject({ from: WD, to: "2026-10-07" });
    expect(f2.span.labor).toEqual(sofar.weeks[0]!.labor);
    expect(f2.span.labor).toEqual(sofar.total.labor);
    expect([f2.span.target, f2.span.loadedTarget]).toEqual([sofar.weeks[0]!.target, sofar.weeks[0]!.loadedTarget]);
    const last = await report(opts, WP, "2026-10-03", respond);
    expect(f3.span.labor).toEqual(last.weeks[0]!.labor);
    expect(f3.span.labor).toEqual(last.total.labor);
    expect([f3.span.target, f3.span.loadedTarget]).toEqual([last.weeks[0]!.target, last.weeks[0]!.loadedTarget]);
  });
  it("the non-default targets really are non-default (so the twins above test them)", async () => {
    const { facts } = await hourly({ laborCostRow: () => RICH }, withStructures([STRUCT_TOTAL]));
    expect(facts.lastFullWeek).toMatchObject({ kind: "ok", span: { target: 20, loadedTarget: 30 } });
    const h = await hourly({ laborCostRow: () => RICH }, withStructures([STRUCT_HOURLY]));
    expect(h.facts.lastFullWeek).toMatchObject({ kind: "ok", span: { target: 15, loadedTarget: 28 } });
  });
});

// ── Finality ────────────────────────────────────────────────────────────────────────────────────

describe("finality: which day is final, and every state is named (never a 0)", () => {
  it("a stale current week (wrong builder) with a ready previous week → F1 is the previous week's newest day; F2 updating", async () => {
    const { facts } = await hourly({ weeks: [ready(WP), ready(WD, { builder_version: "labor-v2" })] });
    expect(facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } });
    expect(facts.weekSoFar).toEqual({ kind: "updating" });
    expect(facts.lastFullWeek.kind).toBe("ok");
    assertNoFigureUnlessOk(facts);
  });
  it("P2-1: a Toast entry of D changed after the last build (the current week's fingerprint differs) → the same", async () => {
    const { facts } = await hourly({ currentFingerprint: (w) => (w === WD ? "e".repeat(32) : undefined) });
    expect(facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } });
    expect(facts.weekSoFar).toEqual({ kind: "updating" });
    expect(facts.lastFullWeek.kind).toBe("ok");
  });
  it("a late rebuild inside bracket 1 (coverage before ≠ after) → the current week is not a candidate", async () => {
    const moved = ready(WD, { built_at: "2026-10-08T22:00:00.000Z" });
    const { facts } = await hourly({}, (r) => (r.name === "labor_week_coverage" && r.n >= 1 ? { rows: [ready(WP), moved] } : undefined));
    expect(facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } });
    expect(facts.weekSoFar).toEqual({ kind: "updating" });
    expect(facts.lastFullWeek.kind).toBe("ok");
  });
  it("a generation that changes BETWEEN the brackets → F1 is not re-chosen: updating; F2 updating; F3 stands", async () => {
    const moved = ready(WD, { built_at: "2026-10-08T22:00:00.000Z" });
    const { facts } = await hourly({}, (r) => (r.name === "labor_week_coverage" && r.n >= 2 ? { rows: [ready(WP), moved] } : undefined));
    expect(kinds(facts)).toEqual(["updating", "updating", "ok"]);
    expect(facts.roleStep).toBeNull();
    assertNoFigureUnlessOk(facts);
  });
  it("a Sunday D: the week so far is empty → no_final_day_this_week; F1 is Saturday", async () => {
    const { facts, sent } = await hourly({}, undefined, WD);
    expect(facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } });
    expect(facts.weekSoFar).toEqual({ kind: "no_final_day_this_week" });
    expect(facts.lastFullWeek).toMatchObject({ kind: "ok", span: { from: WP, to: "2026-10-03" } });
    // No week-so-far span read on a Sunday: the only span read is the last full week.
    expect(sent.filter((r) => r.name === "fact_labor_cost" && r.args.p_from !== r.args.p_to).map((r) => [r.args.p_from, r.args.p_to])).toEqual([[WP, "2026-10-03"]]);
  });
  it("a Monday D: F1 is Sunday and the week so far is that one day", async () => {
    const { facts } = await hourly({}, undefined, "2026-10-05");
    expect(facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: WD, to: WD } });
    expect(facts.weekSoFar).toMatchObject({ kind: "ok", span: { from: WD, to: WD } });
    expect(facts.lastFullWeek.kind).toBe("ok");
  });
  it("Fable F7: the bracket-1 sales read ends at D − 1 (nothing prints from D), on a Thursday, a Sunday and a Monday", async () => {
    for (const [day, from, to] of [[D, WP, "2026-10-07"], [WD, WP, "2026-10-03"], ["2026-10-05", WP, WD]] as const) {
      const { sent } = await hourly({}, undefined, day);
      const sales = sent.filter((r) => r.name === "sales_report_daily");
      expect(sales.length, day).toBeGreaterThan(0);
      expect(sales.map((r) => String(r.args.p_from)).sort()[0], day).toBe(from);
      expect(sales.map((r) => String(r.args.p_to)).sort().at(-1), day).toBe(to);
      expect(sales.every((r) => String(r.args.p_to) < day && String(r.args.p_from) < day), day).toBe(true);
    }
  });
  it("a DST week (clocks back Sunday 2026-11-01): the payroll weeks and spans are calendar weeks", async () => {
    const { facts } = await hourly({ weeks: [ready("2026-10-25"), ready("2026-11-01")] }, undefined, "2026-11-04");
    expect(facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-11-03" } });
    expect(facts.weekSoFar).toMatchObject({ kind: "ok", span: { from: "2026-11-01", to: "2026-11-03" } });
    expect(facts.lastFullWeek).toMatchObject({ kind: "ok", span: { from: "2026-10-25", to: "2026-10-31" } });
  });
  it("no final day in seven (every day pending) → F1 none, F2 no_final_day_this_week, F3 with its own reason", async () => {
    const { facts } = await hourly({ laborCostRow: () => ({ days_pending: 1 }) });
    expect(facts.latestFinalDay).toEqual({ kind: "none" });
    expect(facts.weekSoFar).toEqual({ kind: "no_final_day_this_week" });
    expect(facts.lastFullWeek).toMatchObject({ kind: "ok", span: { labor: { state: "hours_unknown", pct: null, tone: "none" } } });
  });
});

// ── L15 ─────────────────────────────────────────────────────────────────────────────────────────

describe("L15: the runner's cutoff ends the piece; what was accepted stays", () => {
  /** Bracket 2's fingerprints (the second per week): the previous week's answers at 9 s, the current week's never. */
  const l15: Respond = (r) => (r.name === "fact_labor_week_fingerprint" && r.n === 1
    ? (r.args.p_week_start === WP ? { delayMs: 9_000 } : "hang") : undefined);
  it("the previous week's bracket-2 fingerprint answers at 9 s, the current week's never → F3 ok, the current week's parts updating", async () => {
    const s = setup({}, l15);
    const facts = (await runOne(hourlyLaborPiece(s.deps, A, D)))!;
    expect(kinds(facts)).toEqual(["updating", "updating", "ok"]);
    // A result that arrives after snapshot() changes nothing.
    const before = structuredClone(facts);
    s.releaseAll();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(facts).toEqual(before);
    expect(Object.isFrozen(facts.lastFullWeek)).toBe(true);
  });
  it("the same when the runner's cutoff comes before the piece's own 10 s cap (the phase clamps it to 9.5 s)", async () => {
    // definePreload refuses a budget below the caps' sum, so an absolute time earlier than the cap cannot be built;
    // the phase clamp is the other way the runner ends a piece early, through the same cutoffAt.
    const s = setup({}, l15);
    const facts = (await runOne(hourlyLaborPiece(s.deps, A, D), { maxCapMs: 9_500, budgetMs: 9_500 }))!;
    expect(kinds(facts)).toEqual(["updating", "updating", "ok"]);
  });
  it("the previous week's answer at 9.6 s, after a 9.5 s cutoff, is NOT accepted: F3 updating too", async () => {
    const s = setup({}, (r) => (r.name === "fact_labor_week_fingerprint" && r.n === 1 ? (r.args.p_week_start === WP ? { delayMs: 9_600 } : "hang") : undefined));
    const facts = (await runOne(hourlyLaborPiece(s.deps, A, D), { maxCapMs: 9_500, budgetMs: 9_500 }))!;
    expect(kinds(facts)).toEqual(["updating", "updating", "updating"]);
  });
  it("the role piece at 3 s: an answer at 2.9 s is kept; one that never settles is unavailable; a later answer changes nothing", async () => {
    const people = [
      { week_start: WD, person_key: "k1", user_id: null, person_label: "Person A", role_key: 11, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 300 },
      { week_start: WD, person_key: "k2", user_id: null, person_label: "Person B", role_key: 11, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 300 },
      { week_start: WD, person_key: "k3", user_id: null, person_label: "Person C", role_key: 12, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 150 },
      { week_start: WD, person_key: "k4", user_id: null, person_label: "Person D", role_key: 12, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 150 },
    ];
    const names = [{ id: 11, name: "Line" }, { id: 12, name: "Prep" }];
    const base: Respond = (r) => (r.name === "business_report_labor_people" ? { rows: people } : r.name === "sevenshifts_roles" ? { rows: names } : undefined);
    const { facts: h } = await hourly({}, base);
    expect(h.roleStep).not.toBeNull();
    const expected = roleBuckets(people.map((p) => ({ personKey: p.person_key, roleKey: String(p.role_key), source: p.source, payClass: p.pay_class, straightCents: p.straight_cents })),
      new Map([["11", "Line"], ["12", "Prep"]]), { date: h.roleStep!.date, dayStraightCents: h.roleStep!.dayStraightCents, wageEstimated: h.roleStep!.wageEstimated });
    const fp = (how: "late" | "hang"): Respond => (r) => (r.name === "fact_labor_week_fingerprint" ? (how === "late" ? { delayMs: 2_900 } : "hang") : base(r));
    const late = setup({}, fp("late"));
    expect(await runOne(roleLaborPiece(late.deps, A, D, h), { maxCapMs: 3_000 })).toEqual(expected);
    const hang = setup({}, fp("hang"));
    const sealed = await runOne(roleLaborPiece(hang.deps, A, D, h), { maxCapMs: 3_000 });
    expect(sealed).toEqual({ kind: "unavailable" });
    hang.releaseAll();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sealed).toEqual({ kind: "unavailable" });
  });
});

// ── §13.2.5: one week's fingerprint never costs the other week its answer ────────────────────────

describe("§13.2.5: week A's fingerprint never settles / answers null at once / errors, week B's answers", () => {
  const facts: HourlyLaborFacts[] = [];
  const cases: Array<[string, FakeOpts, Respond | undefined]> = [
    ["never settles", {}, (r) => (r.name === "fact_labor_week_fingerprint" && r.args.p_week_start === WD ? "hang" : undefined)],
    ["answers null at once", { currentFingerprint: (w) => (w === WD ? null : undefined) }, undefined],
    ["errors", { currentFingerprint: (w) => (w === WD ? "error" : undefined) }, undefined],
  ];
  it.each(cases)("A %s: B's figures print, A's read updating", async (_n, opts, respond) => {
    const r = await hourly(opts, respond);
    expect(r.facts.latestFinalDay).toMatchObject({ kind: "ok", span: { from: "2026-10-03" } }); // B's newest day
    expect(r.facts.weekSoFar).toEqual({ kind: "updating" });
    expect(r.facts.lastFullWeek.kind).toBe("ok");
    facts.push(r.facts);
  });
  it("the same facts in all three", () => {
    expect(facts).toHaveLength(3);
    expect(facts[1]).toEqual(facts[0]);
    expect(facts[2]).toEqual(facts[0]);
  });
});

// ── Stage cuts ──────────────────────────────────────────────────────────────────────────────────

describe("stage cuts", () => {
  it("bracket-1 data that never answers → F1, F2 unavailable; F3 unavailable too (sales / structures missing, Opus N2); bracket 2 still ran", async () => {
    const { facts, sent } = await hourly({}, (r) => (r.n === 0 && ["sales_report_daily", "schedule_structures"].includes(r.name)) || (r.name === "fact_labor_cost" && r.args.p_from === r.args.p_to) ? "hang" : undefined);
    expect(kinds(facts)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(sent.filter((r) => r.name === "fact_labor_cost" && r.args.p_from === WP && r.args.p_to === "2026-10-03")).toHaveLength(1);
    expect(sent.filter((r) => r.name === "labor_week_coverage")).toHaveLength(4);
    expect(sent.filter((r) => r.name === "fact_labor_week_fingerprint")).toHaveLength(4);
    assertNoFigureUnlessOk(facts);
  });
  it("only the day costs cut: F1 and F2 unavailable, F3 stands (it needs no final day)", async () => {
    const { facts } = await hourly({}, (r) => (r.name === "fact_labor_cost" && r.args.p_from === "2026-10-02" ? "hang" : undefined));
    expect(kinds(facts)).toEqual(["unavailable", "unavailable", "ok"]);
  });
  it("a span that never answers → its part unavailable, the closing checks still ran, F1 and F3 stand", async () => {
    const { facts, sent } = await hourly({}, (r) => (r.name === "fact_labor_cost" && r.args.p_from === WD && r.args.p_to === "2026-10-07" ? "hang" : undefined));
    expect(kinds(facts)).toEqual(["ok", "unavailable", "ok"]);
    expect(sent.filter((r) => r.name === "labor_week_coverage")).toHaveLength(4);
    expect(sent.filter((r) => r.name === "fact_labor_week_fingerprint")).toHaveLength(4);
    // The closing checks ran AFTER bracket 2's data stage ended (8 s), not at the cap.
    expect(sent.filter((r) => r.name === "labor_week_coverage")[3]!.at - sent[0]!.at).toBeGreaterThanOrEqual(8_000);
  });
  it("a coverage-AFTER read that never answers (either bracket) → every figure withheld", async () => {
    for (const n of [1, 3]) {
      const { facts } = await hourly({}, (r) => (r.name === "labor_week_coverage" && r.n === n ? "hang" : undefined));
      expect(kinds(facts), `coverage read ${n}`).toEqual(["unavailable", "unavailable", "unavailable"]);
      expect(facts.roleStep).toBeNull();
      assertNoFigureUnlessOk(facts);
    }
  });
  it("a read that errors is a failure of that read only (a day cost error → no choice; F3 stands)", async () => {
    const { facts } = await hourly({}, (r) => (r.name === "fact_labor_cost" && r.args.p_from === "2026-10-05" ? { answer: { data: null, error: { code: "57014" } } } : undefined));
    expect(kinds(facts)).toEqual(["unavailable", "unavailable", "ok"]);
  });
});

// ── L10 ─────────────────────────────────────────────────────────────────────────────────────────

describe("L10: no request after its stage or the snapshot", () => {
  it("a first page that answers AFTER its stage ended → zero second-page requests", async () => {
    const many = Array.from({ length: 1_500 }, (_, i) => ({ structure: null, created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z` }));
    const { facts, sent } = await hourly({}, (r) => (r.name === "schedule_structures" ? { delayMs: 4_500, answer: { data: many.slice(0, 1_000), count: 1_500 } as Answer } : undefined));
    expect(sent.filter((r) => r.name === "schedule_structures")).toHaveLength(1);
    expect(facts.lastFullWeek).toEqual({ kind: "unavailable" });
  });
  it("a structures read that pages (1,500 rows) in time is read to completion", async () => {
    const many = Array.from({ length: 1_500 }, () => ({ structure: null, created_at: "2026-01-01T00:00:00.000Z" }));
    const { facts, sent } = await hourly({}, (r) => (r.name === "schedule_structures" ? { rows: many } : undefined));
    expect(sent.filter((r) => r.name === "schedule_structures").map((r) => r.range)).toEqual([[0, 999], [1_000, 1_999]]);
    expect(facts.lastFullWeek.kind).toBe("ok");
  });
  it("a queued day-cost read whose turn comes after the stage ended is never sent (at most 4 in flight)", async () => {
    // Sales, structures and the two newest day costs hold the four slots; the five older day costs wait behind them.
    const { sent } = await hourly({}, (r) => ((r.n === 0 && ["sales_report_daily", "schedule_structures"].includes(r.name))
      || (r.name === "fact_labor_cost" && ["2026-10-07", "2026-10-06"].includes(String(r.args.p_from))) ? "hang" : undefined));
    const dayReads = sent.filter((r) => r.name === "fact_labor_cost" && r.args.p_from === r.args.p_to).map((r) => r.args.p_from);
    expect(dayReads).toEqual(["2026-10-07", "2026-10-06"]);
  });
  it("at most four requests of one stage are in flight", async () => {
    let live = 0, peak = 0;
    const { facts } = await hourly({}, (r) => {
      if (r.name === "fact_labor_cost" || r.name === "sales_report_daily" || r.name === "schedule_structures") {
        live++; peak = Math.max(peak, live);
        setTimeout(() => { live--; }, 100);
        return { delayMs: 100 };
      }
      return undefined;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
    expect(kinds(facts)).toEqual(["ok", "ok", "ok"]);
  });
  /** A hand-built context whose stages END BY THE CLOCK while their abort has not been delivered (rules 1 and 3 must
   * hold on `expired()` alone, not only on the signal). */
  const clockOnlyCtx = (expiredFor: (stageIndex: number) => () => boolean) => {
    let i = 0;
    return { signal: new AbortController().signal, expired: () => false, clock: () => Date.now(), cutoffAt: Number.POSITIVE_INFINITY,
      stage: () => { const n = i++; return { signal: new AbortController().signal, expired: expiredFor(n), deadlineAt: Number.POSITIVE_INFINITY }; } };
  };
  it("rule 1: a stage that has ended by the clock sends nothing, even before its abort is delivered", async () => {
    const s = setup();
    const h = hourlyLaborPiece(s.deps, A, D).start(clockOnlyCtx(() => () => true));
    await h.done;
    expect(s.sent).toHaveLength(0);
    expect(kinds(h.snapshot())).toEqual(["unavailable", "unavailable", "unavailable"]);
  });
  it("rule 3: an answer that arrives once its stage has ended by the clock is not accepted (and nothing that needed it is sent)", async () => {
    let ended = false;
    const s = setup({}, (r) => { if (r.name === "labor_week_coverage" && r.n === 0) ended = true; return undefined; });
    const h = hourlyLaborPiece(s.deps, A, D).start(clockOnlyCtx((n) => () => n === 0 && ended));
    await vi.advanceTimersByTimeAsync(1_000);
    await h.done;
    expect(s.sent.filter((r) => r.name === "sales_report_daily" || (r.name === "fact_labor_cost" && r.args.p_from === r.args.p_to))).toHaveLength(0);
    expect(kinds(h.snapshot())).toEqual(["unavailable", "unavailable", "unavailable"]);
  });
  it("rule 1 on a single request: the fingerprints of a stage that ended (by the clock) after its coverage was accepted are never sent", async () => {
    let answered = false, calls = 0;
    const s = setup({}, (r) => { if (r.name === "labor_week_coverage" && r.n === 1) answered = true; return undefined; });
    // Stage 1 (bracket-1 closing checks): its coverage-after answer is accepted (the first expired() after it), then it ends.
    const h = hourlyLaborPiece(s.deps, A, D).start(clockOnlyCtx((n) => () => (n === 1 && answered ? ++calls > 1 : false)));
    await vi.advanceTimersByTimeAsync(1_000);
    await h.done;
    // Only bracket 2's two fingerprints were sent (each week's first request).
    expect(s.sent.filter((r) => r.name === "fact_labor_week_fingerprint").map((r) => r.n)).toEqual([0, 0]);
    expect(s.sent.filter((r) => r.name === "labor_week_coverage")).toHaveLength(4);
    // Both weeks have no bracket-1 fingerprint (null = stale_source): no day can be chosen, and the window was not
    // verified, so it is "updating", never "no final day" (Opus R-1).
    expect(h.snapshot().latestFinalDay).toEqual({ kind: "updating" });
  });
  it("rule 3 on a single request: fingerprints answering after their stage ended (by the clock) are not accepted", async () => {
    let ended = false;
    const s = setup({}, (r) => { if (r.name === "fact_labor_week_fingerprint" && r.n === 0) ended = true; return undefined; });
    const h = hourlyLaborPiece(s.deps, A, D).start(clockOnlyCtx((n) => () => n === 1 && ended));
    await vi.advanceTimersByTimeAsync(1_000);
    await h.done;
    // The first one sent ends the stage: its answer is refused; accepted, the previous week would make 10-03 final.
    // Without it no week of the window is ready in bracket 1: "updating", never "no final day" (Opus R-1).
    expect(h.snapshot().latestFinalDay).toEqual({ kind: "updating" });
  });
  it("the ledger closes at the snapshot: an answer after it is never accepted, even on a stage that has not ended", async () => {
    const s = setup({}, (r) => (r.name === "fact_labor_week_fingerprint" && r.n === 1 ? "hang" : undefined));
    const h = hourlyLaborPiece(s.deps, A, D).start(clockOnlyCtx(() => () => false));
    await vi.advanceTimersByTimeAsync(1_000);
    const first = h.snapshot();
    expect(first.lastFullWeek).toEqual({ kind: "updating" }); // its bracket-2 fingerprint had not answered
    s.releaseAll();
    await vi.advanceTimersByTimeAsync(1_000);
    await h.done;
    expect(h.snapshot()).toEqual(first);
  });
  it("after the snapshot the request counter does not move", async () => {
    const s = setup({}, (r) => (r.name === "fact_labor_week_fingerprint" && r.n === 1 ? "hang" : undefined));
    await runOne(hourlyLaborPiece(s.deps, A, D));
    const count = s.sent.length;
    s.releaseAll();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.sent.length).toBe(count);
  });
});

// ── preloadRequest (O-N4, O-N8) ─────────────────────────────────────────────────────────────────

describe("preloadRequest: every request carries a stage signal and .retry(false)", () => {
  it("every request of both pieces (the fake builder records both)", async () => {
    const people = [{ week_start: WD, person_key: "k1", user_id: "11111111-1111-4111-8111-111111111111", person_label: "Person A", role_key: 11, source: "7shifts",
      pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 900 }];
    const respond: Respond = (r) => (r.name === "business_report_labor_people" ? { rows: people } : r.name === "sevenshifts_roles" ? { rows: [{ id: 11, name: "Line" }] } : undefined);
    const s = setup({}, respond);
    const h = (await runOne(hourlyLaborPiece(s.deps, A, D)))!;
    await runOne(roleLaborPiece(s.deps, A, D, h), { maxCapMs: 3_000 });
    const names = new Set(s.sent.map((r) => r.name));
    for (const n of ["labor_week_coverage", "sales_report_daily", "schedule_structures", "fact_labor_cost", "fact_labor_week_fingerprint", "business_report_labor_people", "sevenshifts_roles"]) {
      expect(names.has(n), n).toBe(true);
    }
    for (const r of s.sent) {
      expect(r.retry, r.name).toBe(false);
      expect(r.signal, r.name).toBeInstanceOf(AbortSignal);
      expect(signalDeadline(r.signal!), r.name).toEqual(expect.any(Number)); // a signal the runner made (a stage's)
    }
    // P3-7: the day rows and the people read used the same wage fallback.
    expect(new Set(s.sent.filter((r) => "p_wage_fallback" in r.args).map((r) => r.args.p_wage_fallback))).toEqual(new Set(["first_known"]));
  });
  it("preloadRequest applies both, in one call", () => {
    const seen: string[] = [];
    const b = { abortSignal(s: AbortSignal) { seen.push(`signal:${s.aborted}`); return b; }, retry(v: boolean) { seen.push(`retry:${v}`); return b; } };
    const c = new AbortController();
    expect(preloadRequest(b, { signal: c.signal, expired: () => false, deadlineAt: 0 })).toBe(b);
    expect(seen).toEqual(["signal:false", "retry:false"]);
  });
  it("O-N4: on the REAL SDK one request is one HTTP attempt (a 503 GET is not retried); the control without .retry(false) retries", async () => {
    const urls: string[] = [];
    const fetch503 = async (input: RequestInfo | URL) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ message: "x" }), { status: 503, headers: { "content-type": "application/json" } });
    };
    const sb = createClient("https://example.invalid", "test-key", { global: { fetch: fetch503 as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const facts = (await runOne(hourlyLaborPiece({ sb, wageFallback: "first_known" }, A, D)))!;
    expect(kinds(facts)).toEqual(["unavailable", "unavailable", "unavailable"]);
    const gets = urls.filter((u) => u.includes("/rest/v1/labor_week_coverage"));
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.length).toBe(4); // one attempt for each of the four coverage reads, none from a back-off
    // The control: the same GET without .retry(false) is retried by the SDK (so the assertion above means something).
    urls.length = 0;
    const p = sb.from("labor_week_coverage").select("week_start");
    const settled = Promise.resolve(p).then(() => undefined, () => undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
    expect(urls.length).toBeGreaterThan(1);
  });
  it("the source scan: no sb.from( / sb.rpc( in the core (or the pre-load factory) is sent without preloadRequest", () => {
    for (const file of ["lib/business-labor-core.ts", "lib/report-digests-labor.ts"]) {
      if (!existsSync(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      const requests = lines.filter((l) => /\bsb\.(from|rpc)\(/.test(l) && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      if (file === "lib/business-labor-core.ts") expect(requests.length).toBeGreaterThanOrEqual(7);
      for (const l of requests) expect(l, `${file}: ${l.trim()}`).toMatch(/preloadRequest\(\s*\w*\.?sb\.(from|rpc)\(/);
    }
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────────────────────────

describe("the role piece", () => {
  const people = [
    { week_start: WD, person_key: "u:11111111-1111-4111-8111-111111111111", user_id: "11111111-1111-4111-8111-111111111111", person_label: "Person A", role_key: 11, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 450 },
    { week_start: WD, person_key: "u:22222222-2222-4222-8222-222222222222", user_id: "22222222-2222-4222-8222-222222222222", person_label: "Person B", role_key: "12", source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 450 },
    { week_start: WD, person_key: "u:33333333-3333-4333-8333-333333333333", user_id: "33333333-3333-4333-8333-333333333333", person_label: "Person C", role_key: 0, source: "7shifts", pay_class: "salaried", minutes: 60, ot_minutes: 0, straight_cents: null },
  ];
  const respond: Respond = (r) => (r.name === "business_report_labor_people" ? { rows: people } : r.name === "sevenshifts_roles" ? { rows: [{ id: 11, name: "Line" }, { id: 12, name: "Prep" }] } : undefined);
  it("no role read when roleStep is null: the piece reads nothing and certifies unavailable (decided: refused, not called)", async () => {
    const { facts } = await hourly({ laborCostRow: () => ({ days_pending: 1 }) });
    expect(facts.roleStep).toBeNull();
    const s = setup();
    const piece = roleLaborPiece(s.deps, A, D, facts);
    expect(piece.key).toBe(laborRolesKey(A, D));
    expect(await runOne(piece, { maxCapMs: 3_000 })).toEqual({ kind: "unavailable" });
    expect(s.sent).toHaveLength(0);
  });
  it("certified: the core hands exactly (key, role, source, pay class, cents) to roleBuckets; role names only for the HOURLY rows", async () => {
    const { facts } = await hourly({}, respond);
    const s = setup({}, respond);
    const roles = await runOne(roleLaborPiece(s.deps, A, D, facts), { maxCapMs: 3_000 });
    const expected = roleBuckets(people.map((p) => ({ personKey: p.person_key, roleKey: p.role_key === 0 ? null : String(p.role_key), source: p.source, payClass: p.pay_class, straightCents: p.straight_cents })),
      new Map([["11", "Line"], ["12", "Prep"]]), { date: "2026-10-07", dayStraightCents: 900, wageEstimated: false });
    expect(roles).toEqual(expected);
    const names = s.sent.filter((r) => r.name === "sevenshifts_roles");
    expect(names).toHaveLength(1);
    expect(names[0]!.filters["in:id"]).toEqual(["11", "12"]);
    expect(s.sent.find((r) => r.name === "business_report_labor_people")!.args).toEqual({ p_location_id: A, p_from: "2026-10-07", p_to: "2026-10-07", p_wage_fallback: "first_known" });
  });
  it("a generation that moved since bracket 2 → unavailable", async () => {
    const { facts } = await hourly({}, respond);
    const moved = ready(WD, { built_at: "2026-10-08T22:30:00.000Z" });
    const s = setup({}, (r) => (r.name === "labor_week_coverage" ? { rows: [moved] } : respond(r)));
    expect(await runOne(roleLaborPiece(s.deps, A, D, facts), { maxCapMs: 3_000 })).toEqual({ kind: "unavailable" });
  });
  it("a role key that is not an id refuses the people read → unavailable", async () => {
    const { facts } = await hourly({}, respond);
    const s = setup({}, (r) => (r.name === "business_report_labor_people" ? { rows: [{ ...people[0], role_key: "x" }] } : respond(r)));
    expect(await runOne(roleLaborPiece(s.deps, A, D, facts), { maxCapMs: 3_000 })).toEqual({ kind: "unavailable" });
  });
  it("Opus P3-5: the facts of both pieces hold no person_label, user_id, person_key / personKey at any depth", async () => {
    const { facts } = await hourly({}, respond);
    const s = setup({}, respond);
    const roles = await runOne<RoleLaborFacts>(roleLaborPiece(s.deps, A, D, facts), { maxCapMs: 3_000 });
    const keys = (v: unknown, out = new Set<string>()): Set<string> => {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
      return out;
    };
    for (const f of [facts, roles]) {
      const ks = keys(f);
      for (const banned of ["person_label", "user_id", "person_key", "personKey", "label", "userId"]) expect(ks.has(banned), banned).toBe(false);
      expect(JSON.stringify(f)).not.toMatch(/Person [A-C]|11111111|22222222/);
    }
  });
  it("the hourly piece's key and cap are the contract's", () => {
    const s = setup();
    const p = hourlyLaborPiece(s.deps, A, D);
    expect([p.key, p.capMs]).toEqual([laborHourlyKey(A, D), 10_000]);
    expect(hourlyLaborPiece(s.deps, "all", D).start({} as never).snapshot()).toMatchObject({ latestFinalDay: { kind: "unavailable" } });
  });
});
