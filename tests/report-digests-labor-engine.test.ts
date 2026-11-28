/**
 * Digests round 3, PR 4, packet E: the ENGINE's labor-money wiring (lib/report-digests-engine.ts: the run plan,
 * `Run.willCompose`, `Run.preload`, phase 0 `loadOrdinaryFacts`, `laborAccess`, `laborHolders`, the envelope's
 * `laborMoney` / `access.business` / `viewer.business`) and `loadShopDayFacts(..., { onSource })` (lib/report-digests.ts).
 *
 * FAKE pieces we control (`io.laborMoney`), fake ordinary facts with a separate SOURCE promise, the in-memory send
 * store, ONE fake timeline, and ONE ordered call log per test. The composers are stubbed: these tests assert what the
 * composers are GIVEN (rendered bytes of the labor lines are a later packet).
 *
 * Contract items proved here, by number: A4-1 (closes A-N4), A4-2, A4-3, A-N6 (= O-N2), O-N3, O-N5a, O-N6, O-N7,
 * Opus N4 (access decided once), L7, P2-B.
 *
 * Synthetic only: "Shop A" / "Shop B", made-up ids, example.com addresses. Nothing is sent or fetched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runClosingDigestsWith, runDigestTickWith } from "@/lib/report-digests-engine";
import { digestAccessFor } from "@/lib/report-digests-access-shared";
import { businessAccessFor, GM_VISIBILITY_DEFAULTS, type GmVisibility } from "@/lib/business-access-shared";
import type { Envelope } from "@/lib/report-digests-compose";
import {
  A, B, CLOCK_START, CLOSING_NOW, D0, D1, MemStore, TICK_NOW, cutHourly, flush, harness, hourlyFacts, ov, ref, roleFacts, stableText,
  type Harness, type HarnessOpts,
} from "./fixtures/digest-labor-engine";

vi.mock("@/lib/report-digests-compose", async () => (await import("./fixtures/digest-labor-engine")).composeModuleStub());

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

const isLaborStart = (ev: string) => /^(settings|hourly\(|roles\()/.test(ev) && ev.endsWith(":start");
const isPhase0Settle = (ev: string) => /^(shopFacts:settle|shopFacts:reject|source:settle|cateringFacts:settle|cateringFacts:reject)/.test(ev);
const firstIdx = (h: Harness, pred: (ev: string) => boolean) => h.log.events.findIndex((e) => pred(e.ev));
const lastIdx = (h: Harness, pred: (ev: string) => boolean) => { let i = -1; h.log.events.forEach((e, j) => { if (pred(e.ev)) i = j; }); return i; };
const laborStarts = (h: Harness) => h.log.events.filter((e) => isLaborStart(e.ev));
const rowsOf = (h: Harness, kind: string, r: string, locationId?: string | null) =>
  h.store.rows.filter((x) => x.kind === kind && x.recipient_ref === r && (locationId === undefined || (x.location_id ?? null) === locationId));
const outcomes = (h: Harness, kind: string, r: string, locationId?: string | null) => rowsOf(h, kind, r, locationId).map((x) => x.outcome);
const sentTo = (h: Harness) => h.sent.map((m) => `${m.ref}|${m.subject}`).sort();

/** The closing run of D0 for `locationId` (both shops finalized by default: the unified digest is due). */
function closingRun(h: Harness, locationId = A, day = D0) { return h.clock.until(runClosingDigestsWith(h.io, locationId, day)); }
function tickRun(h: Harness) { return h.clock.until(runDigestTickWith(h.io)); }

const CLOSING_BOTH: HarnessOpts = { now: CLOSING_NOW, finalized: { [D0]: [A, B] } };
/** A tick whose only due day is D1 (D0's fallback is not yet due). Catering not due unless asked. */
const ONE_DAY = (catering = false): HarnessOpts => ({
  now: TICK_NOW, finalized: { [D1]: [A, B] },
  settings: { unifiedFallbackTimeEt: "23:59", cateringTimeEt: catering ? "07:00" : "23:59" },
});
/** A tick with both D0 and D1 finalized at both shops. */
const TWO_DAY = (catering = false): HarnessOpts => ({
  now: TICK_NOW, finalized: { [D0]: [A, B], [D1]: [A, B] },
  settings: { cateringTimeEt: catering ? "07:00" : "23:59" },
});

const hasLaborMoneyKey = (env: Envelope) => Object.prototype.hasOwnProperty.call(env, "laborMoney");
const businessOf = (env: Envelope) => env.access?.business ?? null;
const viewerBusinessOf = (env: Envelope) => (env.viewer as { business?: unknown } | null | undefined)?.business ?? null;

let unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
beforeEach(() => { unhandled = []; process.on("unhandledRejection", onUnhandled); });
afterEach(() => { process.off("unhandledRejection", onUnhandled); });

// ── switch off ──────────────────────────────────────────────────────────────────────────────────

describe("switch off (no io.laborMoney): PR 2's behaviour, byte for byte", () => {
  it("the first io.shopFacts call is inside the first compose; two arguments; no envelope carries labor money; access = digestAccessFor(viewer, digest)", async () => {
    const h = harness({ ...CLOSING_BOTH });
    const summary = await closingRun(h);
    // The first facts load happens after the first claim, i.e. inside the first compose (as today).
    expect(firstIdx(h, (e) => e.startsWith("shopFacts:start"))).toBeGreaterThan(firstIdx(h, (e) => e.startsWith("claim(")));
    expect(h.shop.calls.length).toBeGreaterThan(0);
    expect(h.shop.calls.every((c) => c.args === 2), JSON.stringify(h.shop.calls)).toBe(true);
    expect(h.labor.starts).toBe(0);
    expect(h.composes.length).toBe(5);
    for (const c of h.composes) {
      expect(hasLaborMoneyKey(c.env), c.ref).toBe(false);
      expect(businessOf(c.env), c.ref).toBeNull();
      expect(viewerBusinessOf(c.env), c.ref).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(c.env.access ?? {}, "business"), c.ref).toBe(false);
      const digest = c.kind === "shop" ? { kind: "gm_shop" as const, shops: [A] } : { kind: "unified" as const, shops: [A, B] };
      expect(c.env.access, c.ref).toEqual(digestAccessFor(c.env.viewer, digest));
    }
    // PR 2's sends for this fixture: Shop A's digest to its GM, the flagged MoO and the flagged AGM; the unified to MoO + owner.
    expect(sentTo(h)).toEqual([
      `${ref("agm")}|shop Shop A ${D0}`, `${ref("gm-a")}|shop Shop A ${D0}`, `${ref("moo")}|shop Shop A ${D0}`,
      `${ref("moo")}|unified unified ${D0}`, `${ref("own")}|unified unified ${D0}`,
    ].sort());
    expect(summary?.counts.gm_shop).toEqual({ sent: 3, skipped: 0, failed: 0, ambiguous: 0 });
    expect(summary?.counts.unified).toEqual({ sent: 2, skipped: 0, failed: 0, ambiguous: 0 });
  });
});

// ── order ───────────────────────────────────────────────────────────────────────────────────────

describe("order (§15.2.5; A-N6 = O-N2)", () => {
  it("every phase-0 call and settlement precedes the first labor piece; both hourly pieces start together after the last settlement and before the first send; nothing is started by a compose", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    await closingRun(h);
    const firstLabor = firstIdx(h, isLaborStart);
    expect(firstLabor).toBeGreaterThan(-1);
    expect(lastIdx(h, (e) => e.startsWith("shopFacts:start"))).toBeLessThan(firstLabor);
    expect(lastIdx(h, isPhase0Settle)).toBeLessThan(firstLabor);
    expect(h.log.count("shopFacts:settle")).toBe(2);
    expect(h.log.count("source:settle")).toBe(2);
    // the seal: every snapshot is taken before the first send
    const firstSend = firstIdx(h, (e) => e.startsWith("sendEmail("));
    expect(lastIdx(h, (e) => e.startsWith("snapshot("))).toBeLessThan(firstSend);
    expect(lastIdx(h, (e) => e.startsWith("snapshot("))).toBeLessThan(firstIdx(h, (e) => e.startsWith("compose(")));
    // A-N6: both hourly pieces after the last phase-0 settlement and before the first send, at the same instant
    const hourly = h.log.all("hourly(").filter((e) => e.ev.endsWith(":start"));
    expect(hourly.map((e) => e.ev).sort()).toEqual([`hourly(A,${D0}):start`, `hourly(B,${D0}):start`]);
    for (const e of hourly) { expect(e.i).toBeGreaterThan(lastIdx(h, isPhase0Settle)); expect(e.i).toBeLessThan(firstSend); }
    expect(new Set(hourly.map((e) => e.at)).size).toBe(1);
    // nothing is started (and no fact is read) by a compose
    const finalStarts = h.labor.starts;
    expect(h.composes.every((c) => c.startsAtCompose === finalStarts)).toBe(true);
    expect(lastIdx(h, (e) => e.startsWith("shopFacts:start"))).toBeLessThan(firstIdx(h, (e) => e.startsWith("compose(")));
    expect(h.shop.calls.every((c) => c.args === 3)).toBe(true);
  });

  it("O-N6: a two-day tick: all four shop fact sets (and the catering facts) settle before the first labor piece", async () => {
    const h = harness({ ...TWO_DAY(true), switchOn: true });
    await tickRun(h);
    const firstLabor = firstIdx(h, isLaborStart);
    expect(firstLabor).toBeGreaterThan(-1);
    const settles = h.log.all("shopFacts:settle").map((e) => e.ev).sort();
    expect(settles).toEqual([`shopFacts:settle(A,${D0})`, `shopFacts:settle(A,${D1})`, `shopFacts:settle(B,${D0})`, `shopFacts:settle(B,${D1})`]);
    for (const e of h.log.all("shopFacts:settle")) expect(e.i).toBeLessThan(firstLabor);
    expect(h.log.all("cateringFacts:settle")[0]!.i).toBeLessThan(firstLabor);
    expect(h.log.all("hourly(").filter((e) => e.ev.endsWith(":start")).length).toBe(4);
  });
});

// ── phase 0 ─────────────────────────────────────────────────────────────────────────────────────

describe("phase 0 (A4-1, A4-2, A4-3, O-N5a)", () => {
  it("A4-3: a shop's second day starts only after its first day's SOURCE settled; the other shop and the catering facts start at once", async () => {
    const h = harness({ ...TWO_DAY(true), switchOn: true });
    const src = h.shop.holdSource(A, D0);
    const p = runDigestTickWith(h.io);
    await flush(6);
    await h.clock.advance(1_000);
    const started = () => h.log.all("shopFacts:start").map((e) => e.ev);
    expect(started()).toContain(`shopFacts:start(A,${D0})`);
    expect(started()).toContain(`shopFacts:start(B,${D0})`);
    expect(started()).toContain(`shopFacts:start(B,${D1})`);
    expect(h.log.count("cateringFacts:start")).toBe(1);
    expect(started()).not.toContain(`shopFacts:start(A,${D1})`);
    expect(laborStarts(h)).toHaveLength(0);
    src.resolve();
    await flush(6);
    expect(started()).toContain(`shopFacts:start(A,${D1})`);
    expect(h.log.first(`shopFacts:start(A,${D1})`)).toBeGreaterThan(h.log.first(`source:settle(A,${D0})`));
    await h.clock.until(p);
    expect(h.labor.starts).toBeGreaterThan(0);
  });

  it("A4-2: shop A's facts REJECT early while A's source is pending → no labor piece (shop B not certified) until the source settles; then A's composes fail as compose failures and B's digest is sent", async () => {
    const h = harness({ ...ONE_DAY(), switchOn: true });
    const fail = h.shop.rejectFactsLater(A, D1);
    const src = h.shop.holdSource(A, D1);
    const p = runDigestTickWith(h.io);
    await flush(6);
    fail.resolve(); // A's facts promise rejects now
    await flush(6);
    expect(h.log.first(`shopFacts:reject(A,${D1})`)).toBeGreaterThan(-1);
    await h.clock.advance(10_000);
    expect(laborStarts(h)).toHaveLength(0);
    expect(h.log.first(`hourly(B,${D1}):start`)).toBe(-1);
    expect(h.composes).toHaveLength(0);
    src.resolve();
    await h.clock.until(p);
    expect(h.log.first(`hourly(B,${D1}):start`)).toBeGreaterThan(h.log.first(`source:settle(A,${D1})`));
    for (const r of ["gm-a", "moo", "agm"]) {
      expect(outcomes(h, "gm_shop", ref(r), A), r).toEqual(["failed"]);
      expect(h.alerts.some((a) => a.detector === "digest-send" && a.ref === ref(r) && a.kind === "gm_shop" && /compose: facts_read_failed/.test(a.error ?? ""))).toBe(true);
    }
    expect(outcomes(h, "gm_shop", ref("gm-b"), B)).toEqual(["sent"]);
    expect(h.sent.some((m) => m.ref === ref("gm-b") && m.subject.includes("Shop B"))).toBe(true);
    expect(unhandled).toEqual([]);
  });

  async function cateringNeverAnswers(opts: HarnessOpts, budgetMs: number) {
    const h = harness({ ...opts, switchOn: true });
    h.catering.never();
    const summary = await tickRun(h);
    // Phase 0 ends at the budget exactly (the first labor piece starts then).
    expect(laborStarts(h)[0]?.at).toBe(CLOCK_START + budgetMs);
    expect(h.composes.filter((c) => c.kind === "catering")).toHaveLength(0);
    const cateringRows = h.store.rows.filter((r) => r.kind === "catering");
    expect(cateringRows.length).toBeGreaterThan(0);
    for (const r of cateringRows) {
      expect(r.outcome, r.recipient_ref).toBe("failed");
      expect(r.error ?? "").toContain("ordinary_facts_timeout");
    }
    expect(h.alerts.some((a) => a.kind === "catering" && a.detector === "digest-send" && /ordinary_facts_timeout/.test(a.error ?? ""))).toBe(true);
    // every healthy shop and unified email reaches the sender
    expect(summary?.counts.gm_shop.failed).toBe(0);
    expect(summary?.counts.unified.failed).toBe(0);
    return h;
  }

  // A4-1 as ruled: "45 s per business day OF THE RUN" (a closing run 45 s; a tick has two business days, so 90 s,
  // whatever is due on each). The closing run's 45 s is pinned in the next describe ("a closing run: 45 s").
  it("A4-1 (A-N4): a catering read that never answers → frozen at 90 s in a tick with ONE day due; every healthy email is sent", async () => {
    const h = await cateringNeverAnswers(ONE_DAY(true), 90_000);
    expect(h.sent.filter((m) => m.subject.startsWith("shop "))).toHaveLength(4);
    expect(h.sent.filter((m) => m.subject.startsWith("unified"))).toHaveLength(2);
  });

  it("A4-1 (A-N4): the same in a two-day tick → frozen at 90 s", async () => {
    const h = await cateringNeverAnswers(TWO_DAY(true), 90_000);
    expect(h.sent.filter((m) => m.subject.startsWith("shop "))).toHaveLength(8);
    expect(h.sent.filter((m) => m.subject.startsWith("unified"))).toHaveLength(4);
  });

  it("A4-1: a second shop's facts never answer → shop A's emails are sent; shop B's and the unified composes fail; a late answer changes nothing", async () => {
    const h = harness({ ...ONE_DAY(), switchOn: true });
    const late = h.shop.holdFacts(B, D1);
    const summary = await tickRun(h);
    expect(laborStarts(h)[0]?.at).toBe(CLOCK_START + 90_000);
    for (const r of ["gm-a", "moo", "agm"]) expect(outcomes(h, "gm_shop", ref(r), A), r).toEqual(["sent"]);
    expect(outcomes(h, "gm_shop", ref("gm-b"), B)).toEqual(["failed"]);
    for (const r of ["moo", "own"]) expect(outcomes(h, "unified", ref(r)), r).toEqual(["failed"]);
    expect(rowsOf(h, "gm_shop", ref("gm-b"), B)[0]!.error ?? "").toContain("ordinary_facts_timeout");
    expect(summary?.counts.gm_shop).toEqual({ sent: 3, skipped: 0, failed: 1, ambiguous: 0 });
    // the late answer
    const sentBefore = h.sent.length; const composesBefore = h.composes.length; const rowsBefore = JSON.stringify(h.store.rows);
    late.resolve();
    await h.clock.advance(5_000);
    expect(h.sent.length).toBe(sentBefore);
    expect(h.composes.length).toBe(composesBefore);
    expect(JSON.stringify(h.store.rows)).toBe(rowsBefore);
    expect(h.composes.some((c) => c.kind === "shop" && (c.facts as { location: { id: string } }).location.id === B)).toBe(false);
  });

  it("A4-1, the writer rule: a SOURCE still pending at the budget → no pre-load: zero piece starts; the owner's store is empty for every shop; a GM gets no business", async () => {
    const h = harness({ ...ONE_DAY(), switchOn: true });
    h.shop.neverSource(B, D1);
    const summary = await tickRun(h);
    expect(h.labor.starts).toBe(0);
    expect(laborStarts(h)).toHaveLength(0);
    // every digest still goes out (its facts settled)
    expect(summary?.counts.gm_shop.sent).toBe(4);
    expect(summary?.counts.unified.sent).toBe(2);
    for (const c of h.envOf(ref("own"))) {
      expect(c.env.laborMoney, "the owner is in a labor-money run").toBeTruthy();
      for (const shop of [A, B]) expect(c.env.laborMoney!.hourly(shop, D1)).toBeNull();
      expect(c.env.laborMoney!.roles(A, D1)).toBeNull();
    }
    for (const c of h.envOf(ref("gm-a"))) expect(businessOf(c.env)).toBeNull();
    for (const c of h.envOf(ref("gm-b"))) expect(businessOf(c.env)).toBeNull();
  });

  it("O-N5a: one shop's facts and the catering facts both reject → only the composes that print them fail; no unhandled rejection", async () => {
    const h = harness({ ...ONE_DAY(true), switchOn: true });
    h.shop.rejectFacts(B, D1);
    h.catering.reject();
    await tickRun(h);
    await flush(6);
    for (const r of ["gm-a", "moo", "agm"]) expect(outcomes(h, "gm_shop", ref(r), A), r).toEqual(["sent"]);
    expect(outcomes(h, "gm_shop", ref("gm-b"), B)).toEqual(["failed"]);
    for (const r of ["moo", "own"]) expect(outcomes(h, "unified", ref(r)), r).toEqual(["failed"]);
    expect(h.store.rows.filter((r) => r.kind === "catering").every((r) => r.outcome === "failed")).toBe(true);
    // the labor pre-load still ran (no writer pending)
    expect(h.labor.starts).toBeGreaterThan(0);
    expect(unhandled).toEqual([]);
  });
});

// ── due = will compose ──────────────────────────────────────────────────────────────────────────

describe("due = will compose (§15.2.4 N2, O-N7)", () => {
  const NOW = new Date(CLOSING_NOW).getTime();
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const H = 3_600_000;
  const row = { kind: "gm_shop" as const, business_day: D0, recipient_ref: ref("gm-a"), location_id: A, revision: 1, mode: "live" as const };
  type State = { name: string; due: boolean; seed?: (s: MemStore) => void; sendLog?: (s: MemStore) => ReturnType<MemStore["seed"]>[]; overrides?: ReturnType<typeof ov>[] };
  const states: State[] = [
    { name: "no row", due: true },
    { name: "sent", due: false, seed: (s) => { s.seed({ ...row, outcome: "sent", first_attempt_at: iso(H), provider_message_id: "m1" }); } },
    { name: "claimed (fresh)", due: false, seed: (s) => { s.seed({ ...row, outcome: "claimed", attempted_at: iso(60_000) }); } },
    { name: "failed (released)", due: true, seed: (s) => { s.seed({ ...row, outcome: "failed", attempted_at: iso(H) }); } },
    { name: "ambiguous inside the window", due: true, seed: (s) => { s.seed({ ...row, outcome: "ambiguous", attempted_at: iso(H), first_attempt_at: iso(H) }); } },
    { name: "ambiguous past the window", due: false, seed: (s) => { s.seed({ ...row, outcome: "ambiguous", attempted_at: iso(24 * H), first_attempt_at: iso(24 * H) }); } },
    { name: "failed_ambiguous", due: false, seed: (s) => { s.seed({ ...row, outcome: "failed_ambiguous", attempted_at: iso(30 * H), first_attempt_at: iso(30 * H) }); } },
    { name: "a recipient with skip (disabled)", due: false, overrides: [ov("gm-a", { active: false })] },
  ];
  for (const st of states) {
    it(`${st.name}: composed iff due (${st.due}); a labor read iff due`, async () => {
      const store = new MemStore();
      store.now = new Date(CLOSING_NOW).toISOString();
      st.seed?.(store);
      const h = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, store, dir: { who: ["gm-a", "gm-b"], overrides: st.overrides } });
      await closingRun(h);
      expect(h.envOf(ref("gm-a"), "shop").length > 0, "composed").toBe(st.due);
      expect(h.log.first(`hourly(A,${D0}):start`) > -1, "hourly piece").toBe(st.due);
      expect(h.log.first("settings:start") > -1, "settings piece").toBe(st.due);
      expect(h.shop.calls.length > 0, "a facts read").toBe(st.due);
      if (st.name.startsWith("a recipient with skip")) {
        expect(h.store.skips.map((s) => `${s.recipient_ref}|${s.skip_reason}`)).toEqual([`${ref("gm-a")}|recipient_disabled`]);
      }
    });
  }

  it("ambiguous inside the window WITH a provider_message_id: not due; sendOnce still reconciles it (finish → sent) and nothing is read", async () => {
    const store = new MemStore();
    store.now = new Date(CLOSING_NOW).toISOString();
    const seeded = store.seed({ ...row, outcome: "ambiguous", attempted_at: iso(H), first_attempt_at: iso(H), provider_message_id: "m-accepted" });
    // The run reads an older version of the row, so the sweep's compare-and-set misses and sendOnce's reconcile is the one that runs.
    const stale = { ...seeded, attempted_at: iso(2 * H) };
    const h = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, store, sendLog: [stale], dir: { who: ["gm-a", "gm-b"] } });
    await closingRun(h);
    expect(h.envOf(ref("gm-a"))).toHaveLength(0);
    expect(h.labor.starts).toBe(0);
    expect(h.shop.calls).toHaveLength(0);
    expect(store.finishes.some((f) => f.id === seeded.id && f.outcome === "sent" && !f.guard)).toBe(true);
    expect(store.rows.find((r) => r.id === seeded.id)!.outcome).toBe("sent");
  });

  it("the three stated exceptions (due, read, not composed): a duplicate claim, a reclaim that loses, a claim that throws", async () => {
    // duplicate
    const h1 = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, dir: { who: ["gm-a", "gm-b"] } });
    h1.store.duplicateFor.add(ref("gm-a"));
    await closingRun(h1);
    expect(h1.log.first(`hourly(A,${D0}):start`)).toBeGreaterThan(-1);
    expect(h1.envOf(ref("gm-a"))).toHaveLength(0);
    expect(h1.store.skips.map((s) => s.skip_reason)).toEqual(["already_sent"]);
    // reclaim loses
    const store = new MemStore();
    store.now = new Date(CLOSING_NOW).toISOString();
    store.seed({ ...row, outcome: "ambiguous", attempted_at: iso(H), first_attempt_at: iso(H) });
    store.reclaimLoses = true;
    const h2 = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, store, dir: { who: ["gm-a", "gm-b"] } });
    await closingRun(h2);
    expect(h2.log.first(`hourly(A,${D0}):start`)).toBeGreaterThan(-1);
    expect(h2.log.first(`reclaim(${ref("gm-a")})`)).toBeGreaterThan(-1);
    expect(h2.envOf(ref("gm-a"))).toHaveLength(0);
    expect(h2.sent).toHaveLength(0);
    // claim throws (the run itself rejects, as PR 2's does on a store error)
    const h3 = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, dir: { who: ["gm-a", "gm-b"] } });
    h3.store.throwFor.add(ref("gm-a"));
    await expect(closingRun(h3)).rejects.toThrow("claim_failed");
    expect(h3.log.first(`hourly(A,${D0}):start`)).toBeGreaterThan(-1);
    expect(h3.envOf(ref("gm-a"))).toHaveLength(0);
  });

  it("a tick after everything was sent: ZERO facts calls, zero settings, zero labor pieces; the skip log and reconcile cause no labor read", async () => {
    const store = new MemStore();
    const first = harness({ ...ONE_DAY(true), switchOn: true, store });
    await tickRun(first);
    expect(first.sent.length).toBeGreaterThan(0);
    const second = harness({ ...ONE_DAY(true), switchOn: true, store });
    await tickRun(second);
    expect(second.shop.calls).toHaveLength(0);
    expect(second.catering.calls).toBe(0);
    expect(second.labor.starts).toBe(0);
    expect(second.composes).toHaveLength(0);
    expect(second.sent).toHaveLength(0);
  });
});

// ── access ──────────────────────────────────────────────────────────────────────────────────────

const GM_SAVED: GmVisibility = { ...GM_VISIBILITY_DEFAULTS, loaded: true, person_cost: false };
const GM_NO_HOURLY: GmVisibility = { ...GM_VISIBILITY_DEFAULTS, hourly_cost: false, loaded: false, quarter_cost: false, person_cost: false };

describe("access (contract §1, Opus N4)", () => {
  it("one settings piece per run with a due GM; none when only MoO / Owner / CGS are due", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    await closingRun(h);
    expect(h.log.count("settings:start")).toBe(1);
    const h2 = harness({ ...CLOSING_BOTH, switchOn: true, dir: { who: ["moo", "own"] } });
    await closingRun(h2);
    expect(h2.log.count("settings:start")).toBe(0);
    expect(h2.log.all("hourly(").filter((e) => e.ev.endsWith(":start"))).toHaveLength(2);
  });

  it("owner / MoO everything; a GM the defaults (no row) or the saved row", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    await closingRun(h);
    for (const c of h.envOf(ref("own"))) expect(businessOf(c.env)).toEqual(businessAccessFor("owner", null));
    for (const c of h.envOf(ref("moo"))) expect(businessOf(c.env)).toEqual(businessAccessFor("moo", null));
    const gm = h.envOf(ref("gm-a"), "shop")[0]!;
    expect(businessOf(gm.env)).toEqual(businessAccessFor("gm", null));
    expect(viewerBusinessOf(gm.env)).toMatchObject({ access: businessAccessFor("gm", null), enabled: true });

    const h2 = harness({ ...CLOSING_BOTH, switchOn: true });
    h2.labor.setGm(GM_SAVED);
    await closingRun(h2);
    expect(businessOf(h2.envOf(ref("gm-a"), "shop")[0]!.env)).toEqual(businessAccessFor("gm", GM_SAVED));
    expect(businessOf(h2.envOf(ref("moo"), "shop")[0]!.env)).toEqual(businessAccessFor("moo", null));
  });

  it("GM with settings unavailable, or a settings piece that never settles (cut at 3 s) → no business; no hourly piece for a shop only that GM holds; the MoO's pieces still run", async () => {
    for (const mode of ["unavailable", "never"] as const) {
      const store = new MemStore();
      store.now = new Date(TICK_NOW).toISOString();
      // The MoO's unified digest of D1 is already sent, so Shop B's only holder is its GM.
      store.seed({ kind: "unified", business_day: D1, recipient_ref: ref("moo"), location_id: null, revision: 1, mode: "live", outcome: "sent", first_attempt_at: TICK_NOW, provider_message_id: "m" });
      const h = harness({ ...ONE_DAY(), switchOn: true, store, dir: { who: ["gm-a", "gm-b", "moo"] } });
      h.labor.settingsBehaviour = mode === "unavailable" ? { kind: "now", value: { kind: "unavailable" } } : { kind: "never", empty: { kind: "unavailable" } };
      await tickRun(h);
      expect(h.log.count("settings:start"), mode).toBe(1);
      if (mode === "never") {
        const s = h.labor.records.find((r) => r.key === "settings")!;
        expect(s.snapshotAt! - s.startedAt).toBe(3_000);
      }
      for (const r of ["gm-a", "gm-b"]) for (const c of h.envOf(ref(r))) { expect(businessOf(c.env), `${mode} ${r}`).toBeNull(); expect(viewerBusinessOf(c.env)).toBeNull(); }
      expect(h.log.first(`hourly(B,${D1}):start`), mode).toBe(-1);
      expect(h.log.first(`hourly(A,${D1}):start`), mode).toBeGreaterThan(-1);
      expect(businessOf(h.envOf(ref("moo"), "shop")[0]!.env)).toEqual(businessAccessFor("moo", null));
    }
  });

  it("AGM, catering manager, every catering-digest envelope and a package send: never business, never laborMoney", async () => {
    const h = harness({ ...ONE_DAY(true), switchOn: true, packages: true });
    await tickRun(h);
    expect(h.composes.some((c) => c.kind === "package")).toBe(true);
    const offenders = h.composes.filter((c) => c.ref === ref("agm") || c.ref === ref("cat") || c.kind === "catering" || c.kind === "package");
    expect(offenders.length).toBeGreaterThan(3);
    for (const c of offenders) {
      expect(businessOf(c.env), `${c.kind} ${c.ref}`).toBeNull();
      expect(viewerBusinessOf(c.env), `${c.kind} ${c.ref}`).toBeNull();
    }
    // laborMoney: asserted separately so a failure names exactly who received the store.
    const withStore = offenders.filter((c) => hasLaborMoneyKey(c.env)).map((c) => `${c.kind}:${c.ref}`);
    expect(withStore, "envelopes that carry laborMoney though the recipient holds no labor money").toEqual([]);
  });

  it("a recipient missing from the access map (the AGM) is composed with no business and starts no piece of its own", async () => {
    const h = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, dir: { who: ["agm", "gm-b"] } });
    await closingRun(h);
    expect(h.envOf(ref("agm"), "shop")).toHaveLength(1);
    expect(businessOf(h.envOf(ref("agm"), "shop")[0]!.env)).toBeNull();
    expect(h.labor.starts).toBe(0);
  });

  it("O-N6: switch on with no due holder (only an AGM-flagged shop digest and the catering digest) → facts first, zero settings / labor pieces, no laborMoney, and the same emails as the switch-off run", async () => {
    const opts: HarnessOpts = { now: TICK_NOW, finalized: { [D1]: [A] }, settings: { unifiedFallbackTimeEt: "23:59" }, dir: { who: ["agm", "cat"] } };
    const on = harness({ ...opts, switchOn: true });
    await tickRun(on);
    const firstClaim = firstIdx(on, (e) => e.startsWith("claim("));
    expect(on.log.first(`shopFacts:start(A,${D1})`)).toBeLessThan(firstClaim);
    expect(on.log.first("cateringFacts:start")).toBeLessThan(firstClaim);
    expect(on.labor.starts).toBe(0);
    expect(on.composes.length).toBe(2);
    for (const c of on.composes) expect(hasLaborMoneyKey(c.env), c.ref).toBe(false);
    const off = harness({ ...opts });
    await tickRun(off);
    expect(on.sent.map((m) => `${m.to}|${m.subject}|${m.text}`)).toEqual(off.sent.map((m) => `${m.to}|${m.subject}|${m.text}`));
  });
});

// ── pieces and holders ──────────────────────────────────────────────────────────────────────────

describe("pieces and holders", () => {
  const hourlyStarts = (h: Harness) => h.log.all("hourly(").filter((e) => e.ev.endsWith(":start")).map((e) => e.ev).sort();
  const roleStarts = (h: Harness) => h.log.all("roles(").filter((e) => e.ev.endsWith(":start")).map((e) => e.ev).sort();

  it("exactly one hourly piece per (shop, day) with a due holder; the unified digest holds every active shop", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    await closingRun(h);
    expect(hourlyStarts(h)).toEqual([`hourly(A,${D0}):start`, `hourly(B,${D0}):start`]);
    const u = harness({ ...CLOSING_BOTH, switchOn: true, dir: { who: ["own"] } });
    await closingRun(u);
    expect(hourlyStarts(u)).toEqual([`hourly(A,${D0}):start`, `hourly(B,${D0}):start`]);
  });

  it("none for a shop whose only due recipient is a GM with hourly cost off (and no role piece either)", async () => {
    const h = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, dir: { who: ["gm-a", "gm-b"] } });
    h.labor.setGm(GM_NO_HOURLY);
    await closingRun(h);
    expect(h.log.count("settings:start")).toBe(1);
    expect(hourlyStarts(h)).toEqual([]);
    expect(roleStarts(h)).toEqual([]);
    expect(businessOf(h.envOf(ref("gm-a"), "shop")[0]!.env)).toEqual(businessAccessFor("gm", GM_NO_HOURLY));
  });

  it("role pieces only where a due holder of cost by role meets a sealed roleStep; they start after every hourly snapshot", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    h.labor.hourlyBehaviour.set(`B,${D0}`, { kind: "now", value: hourlyFacts(B, D0, false) });
    await closingRun(h);
    expect(roleStarts(h)).toEqual([`roles(A,${D0}):start`]);
    expect(h.log.first(`roles(A,${D0}):start`)).toBeGreaterThan(lastIdx(h, (e) => e.startsWith("snapshot(hourly(")));
    expect(h.log.first(`roles:given(A,${D0}, ${hourlyFacts(A, D0).roleStep!.date})`)).toBeGreaterThan(-1);
    // a holder of hourly cost WITHOUT cost by role → no role piece
    const h2 = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, dir: { who: ["gm-a", "gm-b"] } });
    h2.labor.setGm(GM_SAVED);
    await closingRun(h2);
    expect(hourlyStarts(h2)).toEqual([`hourly(A,${D0}):start`]);
    expect(roleStarts(h2)).toEqual([]);
  });

  it("the store: what the piece snapshotted; a cut piece's empty-ledger snapshot; null for a key never loaded", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    h.labor.hourlyBehaviour.set(`B,${D0}`, { kind: "never", empty: cutHourly(D0) });
    await closingRun(h);
    const env = h.envOf(ref("own"), "unified")[0]!.env;
    expect(env.laborMoney!.hourly(A, D0)).toEqual(hourlyFacts(A, D0));
    expect(env.laborMoney!.hourly(B, D0)).toEqual(cutHourly(D0));
    expect(env.laborMoney!.roles(A, D0)).toEqual(roleFacts(A, D0));
    expect(env.laborMoney!.roles(B, D0)).toBeNull(); // the cut hourly facts carry no roleStep
    expect(env.laborMoney!.hourly(A, "2026-01-01")).toBeNull();
    expect(env.laborMoney!.hourly("cccccccc-0000-4000-8000-000000000003", D0)).toBeNull();
  });
});

// ── L7: the mechanism ───────────────────────────────────────────────────────────────────────────

describe("L7: a recipient's inputs do not depend on another recipient's reads or on the order of recipients", () => {
  /** The GM's compose inputs in a closing run of Shop A, with the Toast state changing at T = start + 1 s. */
  async function gmInputs(mooId: string | null, rolesStall: boolean, gm?: GmVisibility) {
    const who = mooId ? (["gm-a", "moo", "gm-b"] as const) : (["gm-a", "gm-b"] as const);
    const h = harness({ now: CLOSING_NOW, finalized: { [D0]: [A] }, switchOn: true, dir: { who: [...who], mooId: mooId ?? undefined } });
    if (gm) h.labor.setGm(gm);
    if (rolesStall) h.labor.rolesBehaviour.set(`A,${D0}`, { kind: "never", empty: { kind: "unavailable" } });
    h.clock.timers.set(() => { h.shop.toast.outAt = "out-after-T"; }, 1_000);
    await closingRun(h);
    const gmc = h.envOf(ref("gm-a"), "shop");
    expect(gmc).toHaveLength(1);
    return { h, facts: JSON.stringify(gmc[0]!.facts), hourly: JSON.stringify(gmc[0]!.env.laborMoney?.hourly(A, D0) ?? null), roleStarts: h.log.all("roles(").filter((e) => e.ev.endsWith(":start")).length };
  }

  for (const mooId of ["aa-moo", "zz-moo"]) {
    it(`MoO ref ${mooId < "gm-a" ? "before" : "after"} the GM's: the GM's facts and hourly store are the same whether the MoO's role step answers at once or stalls past T`, async () => {
      const fast = await gmInputs(mooId, false);
      const slow = await gmInputs(mooId, true);
      expect(fast.roleStarts).toBe(1);
      expect(slow.roleStarts).toBe(1);
      // T fell inside the stalled role step: the 3 s cap ended it after T
      const r = slow.h.labor.records.find((x) => x.key.startsWith("roles("))!;
      expect(r.snapshotAt! - r.startedAt).toBe(3_000);
      expect(slow.h.shop.toast.outAt).toBe("out-after-T");
      expect(JSON.parse(fast.facts).toastOutAt).toBe("out-before-T");
      expect(slow.facts).toBe(fast.facts);
      expect(slow.hourly).toBe(fast.hourly);
    });
  }

  it("O-N6: the L7 case in a TICK with the catering digest due: the catering recipient's email and the GM's inputs are byte-identical whether the role step answers or stalls", async () => {
    const run = async (stall: boolean) => {
      const h = harness({ ...ONE_DAY(true), switchOn: true, dir: { who: ["gm-a", "gm-b", "moo", "cat"], mooId: "aa-moo" } });
      if (stall) h.labor.rolesBehaviour.set(`A,${D1}`, { kind: "never", empty: { kind: "unavailable" } });
      h.clock.timers.set(() => { h.shop.toast.outAt = "out-after-T"; }, 1_000);
      await tickRun(h);
      return h;
    };
    const fast = await run(false);
    const slow = await run(true);
    expect(slow.shop.toast.outAt).toBe("out-after-T");
    const cat = (h: Harness) => h.sent.filter((m) => m.ref === ref("cat")).map((m) => `${m.subject}|${m.text}`);
    expect(cat(fast)).toHaveLength(1);
    expect(cat(slow)).toEqual(cat(fast));
    const gm = (h: Harness) => h.envOf(ref("gm-a"), "shop").map((c) => JSON.stringify(c.facts) + JSON.stringify(c.env.laborMoney?.hourly(A, D1) ?? null));
    expect(gm(slow)).toEqual(gm(fast));
  });

  it("with no holder of cost by role: no role piece, and the GM's inputs are the same again", async () => {
    const base = await gmInputs("aa-moo", false);
    const none = await gmInputs(null, false, GM_SAVED);
    expect(none.roleStarts).toBe(0);
    expect(none.facts).toBe(base.facts);
    expect(none.hourly).toBe(base.hourly);
  });
});

// ── P2-B ────────────────────────────────────────────────────────────────────────────────────────

describe("P2-B: a closing run with the unified digest due", () => {
  it("both shops' facts load in phase 0 side by side; both hourly pieces start together; a stalled second shop leaves the first shop's inputs unchanged", async () => {
    const healthy = harness({ ...CLOSING_BOTH, switchOn: true });
    await closingRun(healthy);
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    h.labor.hourlyBehaviour.set(`B,${D0}`, { kind: "never", empty: cutHourly(D0) });
    await closingRun(h);
    const startA = h.log.first(`shopFacts:start(A,${D0})`); const startB = h.log.first(`shopFacts:start(B,${D0})`);
    const firstSettle = firstIdx(h, (e) => e.startsWith("shopFacts:settle"));
    expect(Math.max(startA, startB)).toBeLessThan(firstSettle);
    const hourly = h.log.all("hourly(").filter((e) => e.ev.endsWith(":start"));
    expect(hourly).toHaveLength(2);
    expect(new Set(hourly.map((e) => e.at)).size).toBe(1);
    const uni = h.envOf(ref("own"), "unified")[0]!.env;
    expect(uni.laborMoney!.hourly(A, D0)).toEqual(hourlyFacts(A, D0));
    expect(uni.laborMoney!.hourly(B, D0)).toEqual(cutHourly(D0));
    const gm = (x: Harness) => x.envOf(ref("gm-a"), "shop")[0]!;
    expect(JSON.stringify(gm(h).facts)).toBe(JSON.stringify(gm(healthy).facts));
    expect(gm(h).env.laborMoney!.hourly(A, D0)).toEqual(gm(healthy).env.laborMoney!.hourly(A, D0));
    expect(stableText(gm(h).facts, gm(h).env)).toBe(stableText(gm(healthy).facts, gm(healthy).env));
  });
});

// ── the absolute time ───────────────────────────────────────────────────────────────────────────

describe("the absolute time (20 s after phase 0)", () => {
  it("pieces that ignore their caps are cut at their phase's cap, inside 20 s", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    h.labor.caps = { settings: 60_000, hourly: 60_000, roles: 60_000 };
    h.labor.settingsBehaviour = { kind: "never", empty: { kind: "unavailable" } };
    for (const s of [A, B]) {
      h.labor.hourlyBehaviour.set(`${s === A ? "A" : "B"},${D0}`, { kind: "never", empty: hourlyFacts(s, D0) });
      h.labor.rolesBehaviour.set(`${s === A ? "A" : "B"},${D0}`, { kind: "never", empty: { kind: "unavailable" } });
    }
    await closingRun(h);
    const phase0End = CLOCK_START;
    for (const r of h.labor.records) {
      expect(r.snapshotAt!, r.key).toBeLessThanOrEqual(phase0End + 20_000);
      expect(r.startedAt, r.key).toBeLessThan(phase0End + 20_000);
    }
    const settings = h.labor.records.find((r) => r.key === "settings")!;
    expect(settings.snapshotAt! - settings.startedAt).toBe(3_000);
    for (const r of h.labor.records.filter((x) => x.key.startsWith("hourly("))) expect(r.snapshotAt! - r.startedAt).toBe(10_000);
    for (const r of h.labor.records.filter((x) => x.key.startsWith("roles("))) expect(r.snapshotAt! - r.startedAt).toBe(3_000);
  });

  it("no piece starts after the absolute time (the clock jumps past it while the hourly cut is still pending)", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    for (const s of ["A", "B"]) h.labor.hourlyBehaviour.set(`${s},${D0}`, { kind: "never", empty: hourlyFacts(s === "A" ? A : B, D0) });
    const p = runClosingDigestsWith(h.io, A, D0);
    await flush(8);
    expect(h.log.all("hourly(").filter((e) => e.ev.endsWith(":start"))).toHaveLength(2);
    h.clock.moveClockOnly(25_000);
    await h.clock.fireDue();
    await h.clock.until(p);
    expect(h.log.all("roles(").filter((e) => e.ev.endsWith(":start"))).toHaveLength(0);
    expect(h.sent.length).toBe(5);
  });

  it("A4-1 (A-N4), a closing run: 45 s. The other shop's facts never answer → phase 0 is frozen at 45 s and the closing shop's digest is sent", async () => {
    const h = harness({ ...CLOSING_BOTH, switchOn: true });
    h.shop.holdFacts(B, D0);
    await closingRun(h);
    // One business day in a closing run: the budget is 45 s, and the first labor piece starts exactly then.
    expect(laborStarts(h)[0]?.at).toBe(CLOCK_START + 45_000);
    expect(h.sent.some((m) => m.ref === ref("gm-a"))).toBe(true);
  });
});

// ── O-N3 ────────────────────────────────────────────────────────────────────────────────────────

describe("O-N3: a throw inside the pre-load never fails the run", () => {
  const cases: Array<[string, (h: Harness) => void]> = [
    ["lm.hourly() throws synchronously", (h) => { h.labor.hourlyThrows = true; }],
    ["lm.settings() throws", (h) => { h.labor.settingsThrows = true; }],
    ["a piece whose start throws", (h) => { h.labor.hourlyBehaviour.set(`A,${D0}`, { kind: "throwStart" }); h.labor.hourlyBehaviour.set(`B,${D0}`, { kind: "throwStart" }); }],
  ];
  for (const [name, arrange] of cases) {
    it(`${name}: runClosingDigestsWith resolves, every digest is sent, no business-holding envelope has facts`, async () => {
      const h = harness({ ...CLOSING_BOTH, switchOn: true });
      arrange(h);
      const summary = await closingRun(h);
      expect(summary?.counts.gm_shop.sent).toBe(3);
      expect(summary?.counts.unified.sent).toBe(2);
      for (const c of h.composes) if (businessOf(c.env)) for (const s of [A, B]) {
        expect(c.env.laborMoney?.hourly(s, D0) ?? null, `${c.ref} ${s}`).toBeNull();
        expect(c.env.laborMoney?.roles(s, D0) ?? null).toBeNull();
      }
    });
  }
  it("runDigestTickWith does not reject either (lm.hourly throws)", async () => {
    const h = harness({ ...TWO_DAY(true), switchOn: true });
    h.labor.hourlyThrows = true;
    const summary = await tickRun(h);
    expect(summary?.counts.gm_shop.sent).toBe(8);
    expect(summary?.counts.unified.sent).toBe(4);
  });
});

// ── loadShopDayFacts (A4-2, pure wiring) ────────────────────────────────────────────────────────

const v2 = vi.hoisted(() => ({ calls: [] as unknown[][], next: null as null | (() => Promise<unknown>) }));
const hub = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/report-digests-v2", () => ({
  loadShopV2Facts: (...args: unknown[]) => { v2.calls.push(args); return v2.next ? v2.next() : Promise.resolve({ v2: true }); },
}));
vi.mock("@/lib/reports-hub", () => ({ listReports: () => (hub.next ? hub.next() : Promise.resolve([])) }));
vi.mock("@/lib/supabase-paginate", () => ({ selectAllRows: async () => [] }));
// lib/report-digests.ts imports the labor loader another builder is writing; this wiring test never needs it.
vi.mock("@/lib/report-digests-labor", () => ({ buildLaborMoneyIO: () => null }));

function fakeSb() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "in", "is", "order", "range"]) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ count: 0, error: null, data: [] }).then(res, rej);
  return { from: () => q } as never;
}

describe("loadShopDayFacts (A4-2): onSource", () => {
  beforeEach(() => { v2.calls = []; v2.next = null; hub.next = null; });

  it("onSource is called exactly once, synchronously, with the v2 load's own promise; it settles only when the v2 load does, even when another part rejects first", async () => {
    const { loadShopDayFacts } = await import("@/lib/report-digests");
    let releaseV2!: (v: unknown) => void;
    const v2Promise = new Promise((r) => { releaseV2 = r; });
    v2.next = () => v2Promise;
    hub.next = () => Promise.reject(new Error("reports read failed (synthetic)"));
    const sources: Array<Promise<unknown>> = [];
    const now = new Date(CLOSING_NOW);
    const p = loadShopDayFacts(fakeSb(), { id: A, name: "Shop A" }, D0, now, { onSource: (s) => sources.push(s) });
    // synchronously: before the returned promise's first microtask
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe(v2Promise);
    let rejected = false;
    p.catch(() => { rejected = true; });
    let sourceSettled = false;
    void sources[0]!.then(() => { sourceSettled = true; }, () => { sourceSettled = true; });
    await flush(4);
    expect(rejected).toBe(true);
    expect(sourceSettled).toBe(false);
    releaseV2({ v2: "done" });
    await flush(2);
    expect(sourceSettled).toBe(true);
    expect(sources).toHaveLength(1);
  });

  it("with no onSource the call is exactly as before", async () => {
    const { loadShopDayFacts } = await import("@/lib/report-digests");
    const now = new Date(CLOSING_NOW);
    const sb = fakeSb();
    const withCb = await loadShopDayFacts(sb, { id: A, name: "Shop A" }, D0, now, { onSource: () => {} });
    const without = await loadShopDayFacts(sb, { id: A, name: "Shop A" }, D0, now);
    const withSchedule = await loadShopDayFacts(sb, { id: A, name: "Shop A" }, D0, now, {});
    expect(without).toEqual(withCb);
    expect(withSchedule).toEqual(withCb);
    expect(v2.calls).toHaveLength(3);
    for (const c of v2.calls) expect(c).toEqual([sb, A, D0, now, { schedule: undefined }]);
  });
});
