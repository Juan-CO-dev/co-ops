/**
 * PR SCH (plan r5, 20.2; ruling D2): the ONE gap partition the crew generator and the edit tail share. A manager-on-duty
 * hole is split at the earliest typed start on a crew day, each piece takes its own truthful proof, and a piece without
 * one is never suppressed (generate: `unresolved_search`; edit: left undeclared for the validator).
 */
import { describe, expect, it } from "vitest";
import type { RuleContext } from "@/lib/scheduling/context-shared";
import { declareDayGaps } from "@/lib/scheduling/gap-partition-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import type { Shift, WeekSchedule } from "@/lib/scheduling/rules-shared";
import { crewPStreetEarly, DATES, WEEK, personId } from "./fixtures/schedule/crew-p-street-2026-10-19";

const TUE = DATES[1]!;
const J = personId("J");
const opened = generateWeek(generatorInputFor(crewPStreetEarly(), WEEK, { today: WEEK, openingOverride: { date: TUE, decision: { kind: "accepted", startQ: 22 } } }));

/** The opened Tuesday with its MoD gaps taken away (so they are undeclared again), J starting at `jStart`. */
function scene(jStart: number, tweak: (ctx: RuleContext) => void = () => {}): { s: WeekSchedule; ctx: RuleContext } {
  const ctx = structuredClone(opened.context) as RuleContext;
  tweak(ctx);
  const shifts: Shift[] = structuredClone(opened.shifts).map((sh) => {
    if (sh.date !== TUE || sh.userId !== J) return sh;
    const segments = sh.segments.filter((g) => g.endQ > jStart).map((g, i) => (i === 0 ? { ...g, startQ: jStart } : g));
    const meta = ctx.days[TUE]!.crew!.shifts.find((m) => m.userId === J && m.startQ === sh.startQ)!;
    meta.startQ = jStart;
    return { ...sh, startQ: jStart, segments };
  });
  return { s: { locationId: "shop-p-street", weekStart: WEEK, shifts, gaps: opened.gaps.filter((g) => !(g.date === TUE && g.code === "mod_missing")), days: opened.days }, ctx };
}
const mod = (r: ReturnType<typeof declareDayGaps>) => r.gaps.filter((g) => g.code === "mod_missing").map((g) => [g.fromQ, g.toQ, g.cause]);

describe("declareDayGaps (the shared partition)", () => {
  it("a hole wholly before the earliest typed start (6:30) is ONE structure piece, with the crew_mod_start_mismatch note", () => {
    const { s, ctx } = scene(26);
    const r = declareDayGaps(TUE, s, ctx, { mode: "generate", candidateIds: [], known: [] });
    expect(mod(r)).toEqual([[22, 26, "structure"]]);
    expect(r.gaps.find((g) => g.code === "mod_missing")!.certificate).toEqual({ rule: "no_mod_member", detail: { earliestTypeStartQ: 26 } });
    expect(r.notes).toEqual([{ code: "crew_mod_start_mismatch", date: TUE, userId: null, positionId: null, params: { earliestQ: 26 } }]);
  });

  it("a hole straddling it is split: the early piece is the structure proof; an unprovable remainder is unresolved_search (generate) or left undeclared (edit)", () => {
    const { s, ctx } = scene(28);
    const gen = declareDayGaps(TUE, s, ctx, { mode: "generate", candidateIds: ["c1"], known: [] });
    expect(mod(gen)).toEqual([[22, 26, "structure"], [26, 28, "unresolved_search"]]);
    expect(gen.gaps.find((g) => g.cause === "unresolved_search")!.certificate).toMatchObject({ candidateIds: ["c1"] });
    const edit = declareDayGaps(TUE, s, ctx, { mode: "edit", candidateIds: [], known: [], managerEdited: true });
    expect(mod(edit)).toEqual([[22, 26, "structure"]]);
    expect(edit.unresolved).toEqual([{ code: "mod_missing", date: TUE, positionId: null, fromQ: 26, toQ: 28 }]);
  });

  it("a remainder that CAN be proven gets its own truthful proof (availability), never the structure certificate", () => {
    const { s, ctx } = scene(28, (c) => {
      for (const p of Object.values(c.people)) p.availability[TUE] = p.userId === J ? { fromQ: 28, toQ: 84, source: "manager_set" } : null;
    });
    const r = declareDayGaps(TUE, s, ctx, { mode: "edit", candidateIds: [], known: [] });
    expect(mod(r)).toEqual([[22, 26, "structure"], [26, 28, "availability"]]);
    expect(r.unresolved).toEqual([]);
  });

  it("a hole wholly after the earliest start takes one normal proof (no split, no note)", () => {
    const { s, ctx } = scene(28, (c) => {
      c.days[TUE]!.structure = { ...c.days[TUE]!.structure, shopDay: { ...c.days[TUE]!.structure.shopDay, prepStartQ: 26 } };
      for (const p of Object.values(c.people)) p.availability[TUE] = p.userId === J ? { fromQ: 28, toQ: 84, source: "manager_set" } : null;
    });
    const r = declareDayGaps(TUE, s, ctx, { mode: "generate", candidateIds: [], known: [] });
    expect(mod(r)).toEqual([[26, 28, "availability"]]);
    expect(r.notes).toEqual([]);
  });

  it("a gap the caller already declared is never declared twice; codes outside the caller's selection are left alone", () => {
    const { s, ctx } = scene(26);
    const first = declareDayGaps(TUE, s, ctx, { mode: "generate", candidateIds: [], known: [] });
    expect(declareDayGaps(TUE, s, ctx, { mode: "generate", candidateIds: [], known: first.gaps }).gaps).toEqual([]);
    expect(declareDayGaps(TUE, s, ctx, { mode: "generate", candidateIds: [], known: [], codes: ["closing_manager_missing"] }).gaps).toEqual([]);
  });

  it("the generator's own output is what the partition yields (a pure refactor of its tail)", () => {
    expect(opened.gaps.filter((g) => g.date === TUE && g.code === "mod_missing").map((g) => [g.fromQ, g.toQ, g.cause])).toEqual([[22, 26, "structure"]]);
  });
});
