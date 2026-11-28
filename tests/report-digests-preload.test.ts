/**
 * Digests round 3, PR 4, packet E: the PRE-LOAD RUNNER alone (lib/preload-runner.ts; plan §15.2.2, CC addendum
 * O-N3, findings L10 / L15, N3 / N5). Generic pieces on ONE fake timeline (tests/fixtures/digest-labor-engine.ts): the
 * fake clock can cross a deadline while the timer callback has not run yet.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { definePreload, preloadValue, signalDeadline, type PieceCtx, type PreloadPhase, type PreloadPiece, type PreloadResults } from "@/lib/preload-runner";
import { CLOCK_START, FakeClock, deferred, fakePiece, flush, type PieceBehaviour, type PieceRecord } from "./fixtures/digest-labor-engine";

type Due = { tag: string };
const DUE: Due = { tag: "due" };

function mk(clock: FakeClock, records: PieceRecord[]) {
  return <T,>(key: string, capMs: number, b: PieceBehaviour<T>, empty?: T): PreloadPiece<unknown> =>
    fakePiece<T>(key, capMs, b, { timers: clock.timers, records, empty }) as PreloadPiece<unknown>;
}
const phase = (name: string, maxCapMs: number, pieces: PreloadPhase<Due>["pieces"]): PreloadPhase<Due> => ({ name, maxCapMs, pieces });
const okSources = async () => ({ writersSettled: true });
const rec = (records: PieceRecord[], key: string) => records.find((r) => r.key === key)!;

async function runWith(clock: FakeClock, phases: PreloadPhase<Due>[], budgetMs = 20_000, sources = okSources): Promise<PreloadResults> {
  const p = definePreload<Due>({ phases, budgetMs }).run({ sources, due: DUE, clock: clock.clock, timers: clock.timers });
  return clock.until(p, { stepMs: 50 });
}

describe("a piece's result is its snapshot(), taken exactly once on every path", () => {
  it("done first: the snapshot is taken at once, its value is the result", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 10_000, () => [piece("a", 10_000, { kind: "after", ms: 1_000, value: "A" })])]);
    expect(out.get("a")).toEqual({ kind: "ok", value: "A" });
    expect(rec(records, "a").snapshots).toBe(1);
    expect(rec(records, "a").snapshotAt).toBe(CLOCK_START + 1_000);
  });

  it("cap first: snapshotted at start + cap, exactly once, with what the ledger held (nothing)", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 10_000, () => [piece("a", 4_000, { kind: "never", empty: "EMPTY" })])]);
    expect(out.get("a")).toEqual({ kind: "ok", value: "EMPTY" });
    expect(rec(records, "a").snapshots).toBe(1);
    expect(rec(records, "a").snapshotAt).toBe(CLOCK_START + 4_000);
  });

  it("the run's absolute time first: snapshotted at the absolute time, exactly once", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    // Budget 8 s = the caps' sum. Phase one's piece is cut late (its timer is delivered at 6 s, the clock having jumped),
    // so phase two's piece starts at 6 s: its cutoff is min(6 + 3, 0 + 8) = 8 s, the absolute time, BEFORE its cap.
    const p = definePreload<Due>({ phases: [
      phase("one", 5_000, () => [piece("x", 5_000, { kind: "never", empty: "X0" })]),
      phase("two", 3_000, () => [piece("y", 3_000, { kind: "never", empty: "Y0" })]),
    ], budgetMs: 8_000 }).run({ sources: okSources, due: DUE, clock: clock.clock, timers: clock.timers });
    await flush();
    await clock.advance(4_000);
    clock.moveClockOnly(2_000);
    await clock.fireDue();
    const out = await clock.until(p, { stepMs: 50 });
    expect(rec(records, "x").snapshotAt).toBe(CLOCK_START + 6_000);
    expect(rec(records, "y").startedAt).toBe(CLOCK_START + 6_000);
    expect(rec(records, "y").ctx.cutoffAt).toBe(CLOCK_START + 8_000);
    expect(rec(records, "y").snapshotAt).toBe(CLOCK_START + 8_000);
    expect(rec(records, "y").snapshots).toBe(1);
    expect(out.get("y")).toEqual({ kind: "ok", value: "Y0" });
  });

  it("done REJECTED: the result is still the snapshot (taken once), not unavailable", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = [];
    const piece: PreloadPiece<unknown> = {
      key: "a", capMs: 5_000,
      start(ctx) {
        const r: PieceRecord = { key: "a", ctx, startedAt: ctx.clock(), snapshots: 0, snapshotAt: null };
        records.push(r);
        return { done: Promise.reject(new Error("boom")), snapshot: () => { r.snapshots++; r.snapshotAt = ctx.clock(); return "LEDGER"; } };
      },
    };
    const out = await runWith(clock, [phase("p", 5_000, () => [piece])]);
    expect(out.get("a")).toEqual({ kind: "ok", value: "LEDGER" });
    expect(rec(records, "a").snapshots).toBe(1);
    expect(rec(records, "a").snapshotAt).toBe(CLOCK_START);
  });

  // Astra R5 (P2), O-N3 as ruled: a throw inside the pre-load seals EVERY result unavailable. (Rewritten: this test
  // used to pin the old piece-local rule, "the other piece is untouched".)
  it("O-N3 (Astra R5): start THROWS beside a piece that would succeed → the sealed result has NO key at all; snapshot is never called; run() resolves", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 5_000, () => [piece("bad", 5_000, { kind: "throwStart" }), piece("good", 5_000, { kind: "now", value: "G" })])]);
    expect(out.size).toBe(0);
    expect(out.has("good"), "the sibling of a throwing start must not be ok").toBe(false);
    expect(out.get("bad")).toBeUndefined();
    expect(rec(records, "bad").snapshots).toBe(0);
  });
});

describe("L15: one owner of the cutoff", () => {
  it("a piece whose done never settles is snapshotted at exactly min(start + cap, absolute) and returns what its ledger ACCEPTED", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = [];
    let accept: ((v: string) => void) | null = null;
    const piece: PreloadPiece<unknown> = {
      key: "a", capMs: 6_000,
      start(ctx) {
        const r: PieceRecord = { key: "a", ctx, startedAt: ctx.clock(), snapshots: 0, snapshotAt: null };
        records.push(r);
        let closed = false; const ledger: string[] = [];
        accept = (v) => { if (!closed && !ctx.expired()) ledger.push(v); };
        return { done: new Promise<void>(() => {}), snapshot: () => { r.snapshots++; r.snapshotAt = ctx.clock(); closed = true; return [...ledger]; } };
      },
    };
    const p = definePreload<Due>({ phases: [phase("p", 10_000, () => [piece])], budgetMs: 20_000 }).run({ sources: okSources, due: DUE, clock: clock.clock, timers: clock.timers });
    await flush();
    await clock.advance(2_000);
    accept!("first");
    await clock.advance(3_999);
    accept!("second");
    const out = await clock.until(p, { stepMs: 50 });
    // A result "arriving" after the snapshot changes nothing in the sealed results.
    accept!("late");
    expect(rec(records, "a").snapshotAt).toBe(CLOCK_START + 6_000);
    expect(rec(records, "a").snapshots).toBe(1);
    expect(out.get("a")).toEqual({ kind: "ok", value: ["first", "second"] });
    expect(preloadValue<string[]>(out, "a")).toEqual(["first", "second"]);
  });

  it("the absolute time before the cap: cut at the absolute time, ledger kept", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    // budget 4 s, cap 4 s → coincide; budget equals the sum of caps. Second-phase piece starting at 1 s:
    const out = await runWith(clock, [
      phase("one", 1_000, () => [piece("x", 1_000, { kind: "after", ms: 1_000, value: "X" })]),
      phase("two", 3_000, () => [piece("y", 3_000, { kind: "after", ms: 100, value: "Y" }), piece("z", 3_000, { kind: "never", empty: "Z0" })]),
    ], 4_000);
    expect(rec(records, "z").ctx.cutoffAt).toBe(CLOCK_START + 4_000);
    expect(out.get("y")).toEqual({ kind: "ok", value: "Y" });
    expect(out.get("z")).toEqual({ kind: "ok", value: "Z0" });
  });

  it("a snapshot() that throws → that key unavailable, the other pieces untouched", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 5_000, () => [piece("bad", 5_000, { kind: "throwSnapshot" }), piece("good", 5_000, { kind: "now", value: 7 })])]);
    expect(out.get("bad")).toEqual({ kind: "unavailable" });
    expect(rec(records, "bad").snapshots).toBe(1);
    expect(out.get("good")).toEqual({ kind: "ok", value: 7 });
  });

  it("the sealed results cannot be written after the seal (contract §2 step 8: frozen read-only)", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 5_000, () => [piece("a", 5_000, { kind: "now", value: { n: 1 } })])]);
    // A Map frozen with Object.freeze still accepts set/delete: the seal must not be writable by a later reader.
    let wrote = true;
    try { (out as Map<string, unknown>).set("a", { kind: "ok", value: { n: 2 } }); } catch { wrote = false; }
    expect(wrote && (out.get("a") as { value: { n: number } }).value.n === 2, "the sealed map accepted a write after the seal").toBe(false);
  });

  it("the shared EMPTY result of a failed run cannot be polluted for the next run", async () => {
    const clock = new FakeClock();
    const bad = await runWith(clock, [phase("p", 5_000, () => { throw new Error("x"); })]);
    try { (bad as Map<string, unknown>).set("leak", { kind: "ok", value: 1 }); } catch { /* refused: good */ }
    try {
      const clock2 = new FakeClock();
      const again = await runWith(clock2, [phase("p", 5_000, () => { throw new Error("y"); })]);
      expect(again.has("leak"), "a write to one run's empty result leaked into another run's").toBe(false);
    } finally {
      // Clean up so the leak (if the defect is there) does not cascade into the other tests of this file.
      try { (bad as Map<string, unknown>).delete("leak"); } catch { /* frozen: nothing to clean */ }
    }
  });
});

describe("L10: stages", () => {
  async function startOne(capMs = 10_000) {
    const clock = new FakeClock();
    const ctxs: PieceCtx[] = [];
    const piece = (key: string): PreloadPiece<unknown> => ({ key, capMs, start(ctx) { ctxs.push(ctx); return { done: new Promise<void>(() => {}), snapshot: () => key }; } });
    const p = definePreload<Due>({ phases: [phase("p", 10_000, () => [piece("one"), piece("two")])], budgetMs: 20_000 })
      .run({ sources: okSources, due: DUE, clock: clock.clock, timers: clock.timers });
    await flush();
    return { clock, ctxs, p };
  }

  it("stage(4000) aborts its own signal at 4 s and not the piece's, not a sibling stage's, not another piece's", async () => {
    const { clock, ctxs, p } = await startOne();
    const [one, two] = ctxs as [PieceCtx, PieceCtx];
    const s4 = one.stage(4_000); const s8 = one.stage(8_000); const other = two.stage(4_000);
    expect(s4.deadlineAt).toBe(CLOCK_START + 4_000);
    expect(s8.deadlineAt).toBe(CLOCK_START + 8_000);
    await clock.advance(3_999);
    expect([s4.signal.aborted, s8.signal.aborted, one.signal.aborted, other.signal.aborted]).toEqual([false, false, false, false]);
    await clock.advance(1);
    expect(s4.signal.aborted).toBe(true);
    expect(s4.expired()).toBe(true);
    expect([s8.signal.aborted, one.signal.aborted, two.signal.aborted]).toEqual([false, false, false]);
    // another piece's stage with the same end aborts on its OWN timer, independently
    expect(other.signal.aborted).toBe(true);
    expect(s8.expired()).toBe(false);
    await clock.until(p, { stepMs: 100 });
    expect([s8.signal.aborted, one.signal.aborted, two.signal.aborted]).toEqual([true, true, true]);
  });

  it("stage(\"cutoff\") is the piece's own signal and deadline", async () => {
    const { clock, ctxs, p } = await startOne();
    const one = ctxs[0]!;
    const c = one.stage("cutoff");
    expect(c.signal).toBe(one.signal);
    expect(c.deadlineAt).toBe(one.cutoffAt);
    expect(one.cutoffAt).toBe(CLOCK_START + 10_000);
    await clock.until(p, { stepMs: 100 });
  });

  it("a stage asked after its end is born aborted", async () => {
    const { clock, ctxs, p } = await startOne();
    await clock.advance(5_000);
    const late = ctxs[0]!.stage(4_000);
    expect(late.signal.aborted).toBe(true);
    expect(late.expired()).toBe(true);
    // a stage longer than the cutoff is clamped to it
    const long = ctxs[0]!.stage(60_000);
    expect(long.deadlineAt).toBe(ctxs[0]!.cutoffAt);
    await clock.until(p, { stepMs: 100 });
  });

  it("expired() is true once the CLOCK reaches the deadline even while the abort timer has not run", async () => {
    const { clock, ctxs, p } = await startOne();
    const one = ctxs[0]!;
    const s = one.stage(4_000);
    clock.moveClockOnly(4_000);
    expect(s.signal.aborted).toBe(false); // the timer callback is still pending
    expect(s.expired()).toBe(true);
    expect(one.expired()).toBe(false);
    clock.moveClockOnly(6_000); // the piece's cutoff, timer not delivered
    expect(one.signal.aborted).toBe(false);
    expect(one.expired()).toBe(true);
    await clock.fireDue();
    expect(s.signal.aborted).toBe(true);
    await clock.until(p, { stepMs: 100 });
  });

  it("signalDeadline: each stage's and each piece's deadline; undefined for a foreign signal", async () => {
    const { clock, ctxs, p } = await startOne();
    const one = ctxs[0]!; const two = ctxs[1]!;
    const s = one.stage(5_500);
    expect(signalDeadline(s.signal)).toBe(CLOCK_START + 5_500);
    expect(signalDeadline(one.signal)).toBe(CLOCK_START + 10_000);
    expect(signalDeadline(two.signal)).toBe(CLOCK_START + 10_000);
    expect(signalDeadline(new AbortController().signal)).toBeUndefined();
    await clock.until(p, { stepMs: 100 });
  });
});

describe("phases", () => {
  it("phase 2's pieces() runs only after every phase-1 piece was snapshotted, and sees their sealed results", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    let seen: { at: number; a: unknown; b: unknown; snaps: number } | null = null;
    const out = await runWith(clock, [
      phase("one", 10_000, () => [piece("a", 10_000, { kind: "after", ms: 1_000, value: "A" }), piece("b", 10_000, { kind: "never", empty: "B0" })]),
      phase("two", 3_000, (sealed) => {
        seen = { at: clock.now, a: sealed.get("a"), b: sealed.get("b"), snaps: records.reduce((n, r) => n + r.snapshots, 0) };
        return [piece("c", 3_000, { kind: "now", value: "C" })];
      }),
    ]);
    expect(seen).toEqual({ at: CLOCK_START + 10_000, a: { kind: "ok", value: "A" }, b: { kind: "ok", value: "B0" }, snaps: 2 });
    expect(out.get("c")).toEqual({ kind: "ok", value: "C" });
  });

  it("all pieces of a phase start at the same instant", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    await runWith(clock, [phase("one", 10_000, () => [1, 2, 3].map((i) => piece(`p${i}`, 10_000, { kind: "after", ms: i * 100, value: i })))]);
    expect(new Set(records.map((r) => r.startedAt))).toEqual(new Set([CLOCK_START]));
  });

  it("a phase that has not started by the absolute time never starts: its pieces() is not even called", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = [];
    let called = 0;
    const p = definePreload<Due>({
      phases: [
        phase("one", 5_000, () => [fakePiece("a", 5_000, { kind: "never", empty: 0 }, { timers: clock.timers, records })]),
        phase("two", 5_000, () => { called++; return []; }),
      ], budgetMs: 10_000,
    }).run({ sources: okSources, due: DUE, clock: clock.clock, timers: clock.timers });
    await flush();
    // The clock jumps past the absolute time while piece a's cutoff timer is still pending.
    clock.moveClockOnly(11_000);
    await clock.fireDue();
    const out = await clock.until(p);
    expect(called).toBe(0);
    expect(out.has("a")).toBe(true);
  });

  it("the root signal is aborted after the seal", async () => {
    const clock = new FakeClock();
    let pieceSignal: AbortSignal | null = null;
    let stage: AbortSignal | null = null;
    const piece: PreloadPiece<unknown> = { key: "a", capMs: 1_000, start(ctx) { pieceSignal = ctx.signal; stage = ctx.stage(900).signal; return { done: Promise.resolve(), snapshot: () => 1 }; } };
    await runWith(clock, [phase("p", 1_000, () => [piece])]);
    expect(pieceSignal!.aborted).toBe(true);
    expect(stage!.aborted).toBe(true);
    // the root: every stage signal derived from it is aborted; a fresh stage from a finished piece is born aborted
  });
});

describe("N3 / N5, O-N3: build-time checks and the clamp", () => {
  const p = (maxCapMs: number): PreloadPhase<Due> => phase("x", maxCapMs, () => []);
  it("definePreload throws when the phases' maxCapMs sum above budgetMs", () => {
    expect(() => definePreload({ phases: [p(3_000), p(10_000), p(8_000)], budgetMs: 20_000 })).toThrow("preload_caps_exceed_budget");
    expect(() => definePreload({ phases: [p(3_000), p(10_000), p(3_000)], budgetMs: 20_000 })).not.toThrow();
    expect(() => definePreload({ phases: [p(10_000), p(10_000)], budgetMs: 20_000 })).not.toThrow();
  });
  it("a bad budget and a bad cap throw", () => {
    for (const b of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => definePreload({ phases: [], budgetMs: b }), String(b)).toThrow("preload_bad_budget");
    for (const c of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => definePreload({ phases: [p(c)], budgetMs: 20_000 }), String(c)).toThrow("preload_bad_cap");
  });
  it("a piece declaring capMs above its phase's maxCapMs is cut at the phase's cap", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 3_000, () => [piece("a", 60_000, { kind: "never", empty: "E" })])]);
    expect(rec(records, "a").ctx.cutoffAt).toBe(CLOCK_START + 3_000);
    expect(rec(records, "a").snapshotAt).toBe(CLOCK_START + 3_000);
    expect(out.get("a")).toEqual({ kind: "ok", value: "E" });
  });
});

describe("sources (phase 0)", () => {
  it("sources() is awaited before the budget opens: the absolute time is counted from its END", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const gate = deferred<void>();
    let piecesAt = -1;
    const p = definePreload<Due>({ phases: [phase("p", 10_000, () => { piecesAt = clock.now; return [piece("a", 10_000, { kind: "never", empty: 0 })]; })], budgetMs: 10_000 })
      .run({ sources: async () => { await gate.promise; return { writersSettled: true }; }, due: DUE, clock: clock.clock, timers: clock.timers });
    await clock.advance(30_000);
    expect(piecesAt).toBe(-1);
    gate.resolve();
    await flush();
    const out = await clock.until(p);
    expect(piecesAt).toBe(CLOCK_START + 30_000);
    expect(rec(records, "a").ctx.cutoffAt).toBe(CLOCK_START + 40_000);
    expect(out.has("a")).toBe(true);
  });
  it("writersSettled false → no phase runs, every key absent", async () => {
    const clock = new FakeClock();
    let called = 0;
    const out = await runWith(clock, [phase("p", 5_000, () => { called++; return []; })], 20_000, async () => ({ writersSettled: false }));
    expect(called).toBe(0);
    expect(out.size).toBe(0);
  });
  it("sources() throwing → the same, and run() resolves", async () => {
    const clock = new FakeClock();
    let called = 0;
    const out = await runWith(clock, [phase("p", 5_000, () => { called++; return []; })], 20_000, async () => { throw new Error("sources failed"); });
    expect(called).toBe(0);
    expect(out.size).toBe(0);
  });
});

describe("O-N3: run() never rejects", () => {
  it("a throw inside pieces() → resolves with an EMPTY result (even what earlier phases sealed)", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [
      phase("one", 3_000, () => [piece("a", 3_000, { kind: "now", value: 1 })]),
      phase("two", 3_000, () => { throw new Error("pieces failed"); }),
    ]);
    expect(out.size).toBe(0);
  });
  it("a duplicate key (within a phase, and across phases) → empty result", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    expect((await runWith(clock, [phase("one", 3_000, () => [piece("a", 3_000, { kind: "now", value: 1 }), piece("a", 3_000, { kind: "now", value: 2 })])])).size).toBe(0);
    const clock2 = new FakeClock(); const piece2 = mk(clock2, []);
    expect((await runWith(clock2, [phase("one", 3_000, () => [piece2("a", 3_000, { kind: "now", value: 1 })]), phase("two", 3_000, () => [piece2("a", 3_000, { kind: "now", value: 2 })])])).size).toBe(0);
  });
  it("a throw anywhere (the clock, the timers) → resolves empty", async () => {
    const clock = new FakeClock();
    let n = 0;
    const throwingClock = () => { if (++n > 1) throw new Error("clock"); return clock.now; };
    const out = await definePreload<Due>({ phases: [phase("p", 3_000, () => [])], budgetMs: 10_000 }).run({ sources: okSources, due: DUE, clock: throwingClock, timers: clock.timers });
    expect(out.size).toBe(0);
    const piece: PreloadPiece<unknown> = { key: "a", capMs: 1_000, start: () => ({ done: new Promise<void>(() => {}), snapshot: () => 1 }) };
    const out2 = await definePreload<Due>({ phases: [phase("p", 3_000, () => [piece])], budgetMs: 10_000 })
      .run({ sources: okSources, due: DUE, clock: clock.clock, timers: { set: () => { throw new Error("timers"); }, clear: () => {} } });
    expect(out2.size).toBe(0);
  });
});

describe("§13.2.7: PR 5's extension point (a fourth phase)", () => {
  it("a synthetic fourth phase: its result is sealed, the others are unchanged, the caps / absolute time / seal hold for it", async () => {
    const build = (extra: boolean) => {
      const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
      const phases = [
        phase("settings", 3_000, () => [piece("s", 3_000, { kind: "now", value: "S" })]),
        phase("hourly", 10_000, () => [piece("h", 10_000, { kind: "after", ms: 2_000, value: "H" })]),
        phase("roles", 3_000, () => [piece("r", 3_000, { kind: "now", value: "R" })]),
        ...(extra ? [phase("pr5", 4_000, () => [piece("x", 60_000, { kind: "never", empty: "X0" })])] : []),
      ];
      return { clock, records, phases };
    };
    const base = build(false);
    const without = await runWith(base.clock, base.phases);
    const ext = build(true);
    const withX = await runWith(ext.clock, ext.phases);
    expect(withX.get("x")).toEqual({ kind: "ok", value: "X0" });
    for (const k of ["s", "h", "r"]) expect(withX.get(k)).toEqual(without.get(k));
    const x = rec(ext.records, "x");
    expect(x.ctx.cutoffAt - x.startedAt).toBe(4_000); // clamped to its phase's cap
    expect(x.ctx.cutoffAt).toBeLessThanOrEqual(CLOCK_START + 20_000);
    expect(x.snapshots).toBe(1);
    // and a fourth phase that would overrun the budget is refused at build time
    expect(() => definePreload({ phases: [...ext.phases, phase("too-much", 1_000, () => [])], budgetMs: 20_000 })).toThrow("preload_caps_exceed_budget");
  });
});

// ── post-build review, the ONE fix round ────────────────────────────────────────────────────────

describe("Astra R4 (P1): a done that is ALREADY REJECTED when its cutoff has already passed", () => {
  let unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => { unhandled.push(e); };
  beforeEach(() => { unhandled = []; process.on("unhandledRejection", onUnhandled); });
  afterEach(() => { process.off("unhandledRejection", onUnhandled); });

  it("zero unhandledRejection events; snapshot() is called exactly once; the result is the snapshot", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = [];
    const piece: PreloadPiece<unknown> = {
      key: "a", capMs: 5_000,
      start(ctx) {
        const r: PieceRecord = { key: "a", ctx, startedAt: ctx.clock(), snapshots: 0, snapshotAt: null };
        records.push(r);
        // start() itself consumes the whole remaining budget: the cutoff has passed when the runner reads the clock.
        clock.moveClockOnly(30_000);
        return { done: Promise.reject(new Error("x")), snapshot: () => { r.snapshots++; r.snapshotAt = ctx.clock(); return "LEDGER"; } };
      },
    };
    const out = await runWith(clock, [phase("p", 5_000, () => [piece])]);
    // Give the microtask and the macrotask queues a turn, so a rejection with no handler is reported.
    await flush(6);
    await new Promise<void>((r) => setTimeout(r, 0));
    await flush(6);
    expect(unhandled).toEqual([]);
    expect(rec(records, "a").snapshots).toBe(1);
    expect(out.get("a")).toEqual({ kind: "ok", value: "LEDGER" });
  });
});

describe("Astra R5 (P2), O-N3 as ruled: any throw inside the pre-load seals EVERY result unavailable", () => {
  const good = (clock: FakeClock, records: PieceRecord[]) => mk(clock, records)("good", 5_000, { kind: "now", value: "G" });
  const bad = (capMs: number, start: PreloadPiece<unknown>["start"]): PreloadPiece<unknown> => ({ key: "bad", capMs, start });
  const okStart: PreloadPiece<unknown>["start"] = () => ({ done: Promise.resolve(), snapshot: () => "B" });

  for (const capMs of [Number.NaN, 0, -1]) {
    it(`a piece with capMs ${capMs} beside one that would succeed → NO key at all; run() resolves`, async () => {
      const clock = new FakeClock(); const records: PieceRecord[] = [];
      const out = await runWith(clock, [phase("p", 5_000, () => [bad(capMs, okStart), good(clock, records)])]);
      expect(out.size).toBe(0);
      expect(out.has("good")).toBe(false);
    });
  }

  const handles: Array<[string, unknown]> = [
    ["a handle with no snapshot function", { done: Promise.resolve() }],
    ["a null handle", null],
    ["a handle that is not an object", 7],
  ];
  for (const [name, handle] of handles) {
    it(`${name} beside a piece that would succeed → NO key at all; run() resolves`, async () => {
      const clock = new FakeClock(); const records: PieceRecord[] = [];
      const out = await runWith(clock, [phase("p", 5_000, () => [bad(5_000, () => handle as never), good(clock, records)])]);
      expect(out.size).toBe(0);
    });
  }

  it("a throwing pieces() in a later phase → NO key at all, not even what the earlier phase sealed; run() resolves", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = [];
    const out = await runWith(clock, [phase("one", 5_000, () => [good(clock, records)]), phase("two", 5_000, () => { throw new Error("pieces"); })]);
    expect(out.size).toBe(0);
  });

  it("a duplicate key → NO key at all (the other key included); run() resolves", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 5_000, () => [piece("a", 5_000, { kind: "now", value: 1 }), piece("a", 5_000, { kind: "now", value: 2 }), good(clock, records)])]);
    expect(out.size).toBe(0);
  });

  it("THE one local exception (plan §15.2.2): a snapshot() that THROWS beside one that succeeds → the thrower unavailable, the sibling ok", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const out = await runWith(clock, [phase("p", 5_000, () => [piece("bad", 5_000, { kind: "throwSnapshot" }), good(clock, records)])]);
    expect(out.get("bad")).toEqual({ kind: "unavailable" });
    expect(out.get("good")).toEqual({ kind: "ok", value: "G" });
  });
});

describe("Astra R8 (P2) = Fable F6: sealed = read-only, for real", () => {
  const valued = (key: string, value: () => unknown): PreloadPiece<unknown> => ({ key, capMs: 5_000, start: () => ({ done: Promise.resolve(), snapshot: value }) });
  const cases: Array<[string, () => unknown]> = [
    ["a Map at the top level", () => new Map([["k", 1]])],
    ["a Set at the top level", () => new Set([1])],
    ["a Map nested inside an object inside an array", () => ({ rows: [{ inner: new Map([["k", 1]]) }] })],
    ["a Set nested inside an object inside an array", () => ({ rows: [{ inner: new Set([1]) }] })],
  ];
  for (const [name, value] of cases) {
    it(`${name} → that piece unavailable, the others untouched`, async () => {
      const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
      const out = await runWith(clock, [phase("p", 5_000, () => [valued("bad", value), piece("good", 5_000, { kind: "now", value: { n: 1 } })])]);
      expect(out.get("bad")).toEqual({ kind: "unavailable" });
      expect(out.get("good")).toEqual({ kind: "ok", value: { n: 1 } });
    });
  }

  it("a plain object / array snapshot is frozen at every depth (also through the producer's retained reference); the results have no set / delete / clear", async () => {
    const clock = new FakeClock();
    const produced = { a: { b: [{ c: 1 }] }, list: [[1, 2], [3]] };
    const out = await runWith(clock, [phase("p", 5_000, () => [valued("a", () => produced)])]);
    const r = out.get("a") as { kind: "ok"; value: typeof produced };
    expect(r.kind).toBe("ok");
    // The very object the producer keeps: freezing it in place is what stops a mutation through that reference.
    expect(r.value).toBe(produced);
    // ES modules are strict: a write to a frozen object throws.
    expect(() => { r.value.a.b[0]!.c = 2; }).toThrow(TypeError);
    expect(() => { produced.a.b[0]!.c = 3; }).toThrow(TypeError);
    expect(() => { produced.a.b.push({ c: 4 }); }).toThrow(TypeError);
    expect(() => { produced.list[0]![0] = 9; }).toThrow(TypeError);
    expect(() => { (r as { kind: string }).kind = "unavailable"; }).toThrow(TypeError);
    expect(produced.a.b[0]!.c).toBe(1);
    for (const m of ["set", "delete", "clear"]) expect((out as unknown as Record<string, unknown>)[m], m).toBeUndefined();
    expect(Object.isFrozen(out)).toBe(true);
  });
});

describe("needsSettledWriters (A4-1 as updated: who may see a line is still decided)", () => {
  it("writersSettled false: a phase with needsSettledWriters false runs and its result is sealed; every other phase does not run (its pieces() is not called)", async () => {
    const clock = new FakeClock(); const records: PieceRecord[] = []; const piece = mk(clock, records);
    const called: string[] = [];
    const phases: PreloadPhase<Due>[] = [
      { name: "settings", maxCapMs: 3_000, needsSettledWriters: false, pieces: () => { called.push("settings"); return [piece("s", 3_000, { kind: "now", value: "S" })]; } },
      { name: "hourly", maxCapMs: 10_000, pieces: () => { called.push("hourly"); return [piece("h", 10_000, { kind: "now", value: "H" })]; } },
      { name: "explicit", maxCapMs: 3_000, needsSettledWriters: true, pieces: () => { called.push("explicit"); return [piece("e", 3_000, { kind: "now", value: "E" })]; } },
      { name: "access", maxCapMs: 1, needsSettledWriters: false, pieces: () => { called.push("access"); return []; } },
    ];
    const out = await runWith(clock, phases, 20_000, async () => ({ writersSettled: false }));
    expect(called).toEqual(["settings", "access"]);
    expect(out.get("s")).toEqual({ kind: "ok", value: "S" });
    expect([...out.keys()]).toEqual(["s"]);
    // the same phases with the writers settled: every phase runs
    const clock2 = new FakeClock(); const piece2 = mk(clock2, []);
    const all: string[] = [];
    const out2 = await runWith(clock2, [
      { name: "settings", maxCapMs: 3_000, needsSettledWriters: false, pieces: () => { all.push("settings"); return [piece2("s", 3_000, { kind: "now", value: "S" })]; } },
      { name: "hourly", maxCapMs: 10_000, pieces: () => { all.push("hourly"); return [piece2("h", 10_000, { kind: "now", value: "H" })]; } },
    ]);
    expect(all).toEqual(["settings", "hourly"]);
    expect(out2.size).toBe(2);
  });

  it("sources() throwing: no phase runs, not even one with needsSettledWriters false", async () => {
    const clock = new FakeClock();
    let called = 0;
    const out = await runWith(clock, [{ name: "settings", maxCapMs: 3_000, needsSettledWriters: false, pieces: () => { called++; return []; } }], 20_000,
      async () => { throw new Error("sources failed"); });
    expect(called).toBe(0);
    expect(out.size).toBe(0);
  });

  it("a writersSettled that is not exactly true (missing) counts as not settled", async () => {
    const clock = new FakeClock();
    let called = 0;
    const out = await runWith(clock, [phase("hourly", 5_000, () => { called++; return []; })], 20_000, async () => ({}) as { writersSettled: boolean });
    expect(called).toBe(0);
    expect(out.size).toBe(0);
  });
});
