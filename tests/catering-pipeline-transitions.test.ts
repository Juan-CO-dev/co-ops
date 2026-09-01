/**
 * Unit spine — THE CATERING PIPELINE'S TRANSITION TABLE (audit v2, seat C5, finding F5).
 *
 * The stage machine had NO table. `moveStage`'s only validation was `isPipelineStage` — a
 * membership test over the six labels — plus a same-stage no-op, so the transition relation
 * was the COMPLETE GRAPH: every stage could move to every other, `completed` and `lost`
 * included.
 *
 * WHY THAT IS A DATA BUG AND NOT A TIDINESS ONE. `moveStage` drives the prep-demand ledger:
 * `confirmed` RESERVES, `out`/`completed` CONSUME, `lost`/`inquiry`/`quote_sent` RELEASE.
 * Each of reserve/consume/release guards on `status = 'reserved'`, so a CONSUMED set is
 * invisible to the re-reserve's own idempotency sweep. Move a completed lead back to
 * `confirmed` — one mis-tap in a six-option selector — and `reservePrepDemand` retires
 * nothing and INSERTS a fresh full reserved set from the same quote. The ledger then holds
 * BOTH a consumed and a reserved copy of one event's demand, and W4b SKU-demand, the
 * shortfall advisory and prep planning all see it twice. Moving forward again consumes the
 * duplicate, permanently.
 *
 * THE RULE THE TABLE ENCODES, in one line: forward is always fine, backward is fine only
 * while the demand is still merely RESERVED, `lost` is always reachable, and nothing leaves
 * a terminal stage.
 *
 * SCOPE — THE WIRING IS A NAMED FOLLOW-UP. `lib/catering/pipeline.ts` is owned by another
 * open PR in this program and is untouched here, so `moveStage` does not yet CALL
 * `canTransition`. This file ships the pure authority and pins it exhaustively — all 36
 * ordered pairs — so the wiring PR is a two-line change against a table that is already
 * proven, rather than a table and a refusal invented together at the call site.
 */
import { describe, it, expect } from "vitest";

import {
  PIPELINE_STAGES,
  TERMINAL_PIPELINE_STAGES,
  LEGAL_TRANSITIONS,
  canTransition,
  type PipelineStage,
} from "@/lib/catering/pipeline-shared";

/** Every ordered pair of distinct stages, so no case can be forgotten. */
const ALL_PAIRS: Array<[PipelineStage, PipelineStage]> = PIPELINE_STAGES.flatMap((from) =>
  PIPELINE_STAGES.filter((to) => to !== from).map((to) => [from, to] as [PipelineStage, PipelineStage]),
);

/** The expected relation, written out INDEPENDENTLY of the implementation. */
const EXPECTED: Record<PipelineStage, PipelineStage[]> = {
  // Forward (including skips) + lost. No backward edge: nothing precedes inquiry.
  inquiry: ["quote_sent", "confirmed", "out", "completed", "lost"],
  // Forward + lost + one backward step, to a stage where no demand is reserved yet.
  quote_sent: ["inquiry", "confirmed", "out", "completed", "lost"],
  // Forward + lost + backward to either pre-reservation stage: both RELEASE the reserved
  // set, which is the correct undo of this stage's reserve.
  confirmed: ["inquiry", "quote_sent", "out", "completed", "lost"],
  // The demand is CONSUMED from here. Forward to completed and out to lost only — every
  // backward edge is a route to the re-reserve that F5 describes, `out → confirmed`
  // directly and `out → quote_sent → confirmed` in two hops.
  out: ["completed", "lost"],
  // TERMINAL.
  completed: [],
  lost: [],
};

describe("the stage vocabulary is unchanged", () => {
  it("still names the same six stages in the same order", () => {
    // The table is keyed by these labels and the DB CHECK constraint spells them; a
    // rename here is a migration, not an edit.
    expect([...PIPELINE_STAGES]).toEqual(["inquiry", "quote_sent", "confirmed", "out", "completed", "lost"]);
  });
});

describe("LEGAL_TRANSITIONS covers every stage, exhaustively", () => {
  it("has an entry for each stage — no stage falls off the table into undefined", () => {
    // An absent key would make canTransition throw or silently permit, depending on how the
    // caller reads it. Every stage answers.
    for (const s of PIPELINE_STAGES) {
      expect(LEGAL_TRANSITIONS[s], `no entry for ${s}`).toBeDefined();
    }
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...PIPELINE_STAGES].sort());
  });

  it("lists only real stages as destinations", () => {
    for (const s of PIPELINE_STAGES) {
      for (const to of LEGAL_TRANSITIONS[s]) {
        expect(PIPELINE_STAGES).toContain(to);
      }
    }
  });

  it("never lists a stage as its own destination", () => {
    for (const s of PIPELINE_STAGES) expect(LEGAL_TRANSITIONS[s]).not.toContain(s);
  });
});

describe("canTransition — all 36 ordered pairs, one assertion each", () => {
  it.each(ALL_PAIRS)("%s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(EXPECTED[from].includes(to));
  });

  it("the relation is not the complete graph any more", () => {
    // The finding in one assertion: before the table, all 30 distinct pairs were legal.
    const legal = ALL_PAIRS.filter(([f, t]) => canTransition(f, t));
    expect(legal.length).toBeLessThan(ALL_PAIRS.length);
    expect(legal).toHaveLength(17);
  });
});

describe("completed and lost are TERMINAL — the finding's minimum", () => {
  it("names them, and names only them", () => {
    expect([...TERMINAL_PIPELINE_STAGES].sort()).toEqual(["completed", "lost"]);
  });

  it("no stage is reachable FROM a terminal one", () => {
    for (const term of TERMINAL_PIPELINE_STAGES) {
      expect(LEGAL_TRANSITIONS[term]).toEqual([]);
      for (const to of PIPELINE_STAGES) expect(canTransition(term, to)).toBe(false);
    }
  });

  it("THE FINDING'S CASE: completed → confirmed is refused", () => {
    // reservePrepDemand retires only `reserved` rows; the completed lead's rows are
    // `consumed`, so they survive AND a fresh reserved set is inserted beside them.
    expect(canTransition("completed", "confirmed")).toBe(false);
  });

  it("and so is the two-hop route through a non-terminal stage", () => {
    // out → quote_sent → confirmed reaches the same re-reserve without ever touching a
    // terminal stage, which is why terminality alone is not the whole fix.
    expect(canTransition("out", "quote_sent")).toBe(false);
    expect(canTransition("out", "inquiry")).toBe(false);
    expect(canTransition("out", "confirmed")).toBe(false);
  });
});

describe("lost stays reachable from every non-terminal stage", () => {
  it("a lead can always be marked lost", () => {
    // Losing a lead is the one thing that must never be blocked by the machine: it is how
    // an operator closes anything, at any point, and it RELEASES the reserved demand.
    for (const s of PIPELINE_STAGES) {
      if ((TERMINAL_PIPELINE_STAGES as readonly string[]).includes(s)) continue;
      expect(canTransition(s, "lost"), `${s} → lost`).toBe(true);
    }
  });
});

describe("forward motion is never blocked, skips included", () => {
  it("each stage can reach every later stage on the happy path", () => {
    const order: PipelineStage[] = ["inquiry", "quote_sent", "confirmed", "out", "completed"];
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const [from, to] = [order[i]!, order[j]!];
        // A walk-in that is quoted, confirmed and out the door in one afternoon must not be
        // forced through four taps; consume is a no-op when nothing is reserved, so a skip
        // is ledger-safe in a way a backward move is not.
        expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });
});

describe("backward motion is allowed exactly while the demand is still reserved", () => {
  it("confirmed can be walked back — release is the correct undo of reserve", () => {
    expect(canTransition("confirmed", "quote_sent")).toBe(true);
    expect(canTransition("confirmed", "inquiry")).toBe(true);
  });

  it("quote_sent can be walked back to inquiry — nothing is reserved yet", () => {
    expect(canTransition("quote_sent", "inquiry")).toBe(true);
  });
});

describe("a same-stage move is NOT a transition, and the caller handles it first", () => {
  it("canTransition(s, s) is false for every stage", () => {
    // moveStage returns early on `fromStage === args.toStage` (an idempotent re-tap), so
    // the no-op is answered BEFORE this function is asked. Saying "true" here would mean
    // the table endorses a self-edge on a terminal stage, which it must not.
    for (const s of PIPELINE_STAGES) expect(canTransition(s, s), `${s} → ${s}`).toBe(false);
  });
});

describe("canTransition is total — an unknown label is refused, never crashed on", () => {
  it("refuses a stage that is not in the vocabulary, in either position", () => {
    // A legacy or hand-edited row can carry a label outside PIPELINE_STAGES; `moveStage`
    // already tolerates one (`fromStage` is null when isPipelineStage says no). Refusing is
    // the safe answer — an operator repairs it through a path that knows what it is doing.
    expect(canTransition("archived" as PipelineStage, "lost")).toBe(false);
    expect(canTransition("inquiry", "archived" as PipelineStage)).toBe(false);
  });
});
