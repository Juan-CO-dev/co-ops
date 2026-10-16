/**
 * Scheduling Phase 1, Task 19 — the PM v2 rules, pure (lib/pm-report-v2-shared.ts).
 *
 * - observation minutes and the weighted average per person × position × criterion (60·3 + 180·2)/240;
 * - "Didn't see" excluded; zero overlap → equal weights, flagged;
 * - write-in themes (en + es, light stemming, ≥ 2 authors OR ≥ 3 days, attributed, deterministic);
 * - the visibility truth table;
 * - r1 P1-1: `gradeTargetProblem` returns the SAME code as the RPC for every case of the SHARED file
 *   tests/fixtures/pm-grade-target-cases.json (the 0271 harness iterates the same file);
 * - r1 P2-9: the lifecycle walks the SHARED file tests/fixtures/pm-copy-lifecycle-cases.json, and the lib's
 *   refusal names the RPC's code (after submit a write is report_already_submitted, as in SQL);
 * - the roster for a copy (worked positions, the null bucket, this copy's additions).
 */
import { describe, expect, it } from "vitest";
import gradeCases from "./fixtures/pm-grade-target-cases.json";
import lifecycle from "./fixtures/pm-copy-lifecycle-cases.json";
import type { PeopleActor, PmCopyAct, PmCopyStatus, PmDayStatus } from "@/lib/people/access-shared";
import { pmCopyActRefusal } from "@/lib/people/access-shared";
import type { PositionInterval } from "@/lib/people/positions-shared";
import {
  PM_GRADE_VALUE, averageGrades, copyFormState, copyVisibility, criteriaForPosition, gradeBand, gradeTargetProblem,
  observationMinutes, pmRefusalCode, rosterForCopy, weightKey, writeInThemes, type AttributedNote, type LiveGrade,
} from "@/lib/pm-report-v2-shared";

const A = "loc-a";
const B = "loc-b";
const iv = (userId: string, positionId: string | null, start: string, end: string | null, stationId = "st-1"): PositionInterval => ({
  locationId: A, businessDate: "2026-10-15", userId, stationId, positionId, start, end, source: "claimed",
});
const actor = (role: PeopleActor["role"], userId: string, level: number, locations = [A]): PeopleActor => ({ userId, role, level, locations });

describe("observationMinutes", () => {
  const person = [iv("p1", "expo", "2026-10-15T18:00:00Z", "2026-10-15T22:00:00Z"), iv("p1", "reg", "2026-10-15T22:00:00Z", "2026-10-16T00:00:00Z")];
  it("the overlap of the manager's window with the person's intervals AT that position", () => {
    expect(observationMinutes({ copyId: "c1", authorId: "m1", from: "2026-10-15T21:00:00Z", to: "2026-10-15T23:00:00Z" }, person, "p1", "expo")).toBe(60);
    expect(observationMinutes({ copyId: "c1", authorId: "m1", from: "2026-10-15T21:00:00Z", to: "2026-10-15T23:00:00Z" }, person, "p1", "reg")).toBe(60);
  });
  it("a manager-added position (and the null bucket) counts the overlap with the person's whole day presence", () => {
    const copy = { copyId: "c1", authorId: "m1", from: "2026-10-15T17:00:00Z", to: "2026-10-15T23:00:00Z" };
    expect(observationMinutes(copy, person, "p1", "walk", { added: true })).toBe(300);
    expect(observationMinutes(copy, person, "p1", null)).toBe(300);
    expect(observationMinutes(copy, [], "p9", null)).toBe(360);
  });
  it("no window (or an open window) observes nothing; disjoint is 0; DST-safe instants", () => {
    expect(observationMinutes({ copyId: "c", authorId: "m", from: null, to: null }, person, "p1", "expo")).toBe(0);
    expect(observationMinutes({ copyId: "c", authorId: "m", from: "2026-10-15T18:00:00Z", to: null }, person, "p1", "expo")).toBe(0);
    expect(observationMinutes({ copyId: "c", authorId: "m", from: "2026-10-15T10:00:00Z", to: "2026-10-15T11:00:00Z" }, person, "p1", "expo")).toBe(0);
    const dst = [iv("p2", "expo", "2026-11-01T05:00:00Z", "2026-11-01T07:00:00Z")];
    expect(observationMinutes({ copyId: "c", authorId: "m", from: "2026-11-01T04:30:00Z", to: "2026-11-01T08:00:00Z" }, dst, "p2", "expo")).toBe(120);
  });
});

describe("averageGrades — per person × position × criterion, weighted by observed minutes", () => {
  const g = (copyId: string, authorId: string, grade: LiveGrade["grade"], criterionId = "acc", positionId: string | null = "expo"): LiveGrade =>
    ({ copyId, authorId, subjectId: "p1", positionId, criterionId, grade });
  it("two managers overlapping 60 and 180 minutes with Great and Good → (60·3 + 180·2)/240 = 2.25", () => {
    const w = new Map([[weightKey("c1", "p1", "expo"), 60], [weightKey("c2", "p1", "expo"), 180]]);
    const [cell] = averageGrades([g("c1", "m1", "great"), g("c2", "m2", "good")], w);
    expect(cell!.average).toBe(2.25);
    expect(cell!.weights).toBe("observed");
    expect(cell!.contributions.map((c) => [c.authorId, c.grade, c.minutes])).toEqual([["m1", "great", 60], ["m2", "good", 180]]);
    expect(PM_GRADE_VALUE).toEqual({ great: 3, good: 2, needs_work: 1 });
  });
  it("\"Didn't see\" is excluded from the average (and counted as not observed)", () => {
    const w = new Map([[weightKey("c1", "p1", "expo"), 60], [weightKey("c2", "p1", "expo"), 180]]);
    const [cell] = averageGrades([g("c1", "m1", "needs_work"), g("c2", "m2", null)], w);
    expect(cell!.average).toBe(1);
    expect(cell!.notObserved).toBe(1);
    const [none] = averageGrades([g("c2", "m2", null)], w);
    expect(none!.average).toBeNull();
  });
  it("zero overlap for every grader → equal weights, flagged equal_fallback", () => {
    const w = new Map([[weightKey("c1", "p1", "expo"), 0]]);
    const [cell] = averageGrades([g("c1", "m1", "great"), g("c2", "m2", "needs_work")], w);
    expect(cell!.average).toBe(2);
    expect(cell!.weights).toBe("equal_fallback");
  });
  it("cells are separate per position and criterion, deterministic and order-stable", () => {
    const w = new Map<string, number>();
    const grades = [g("c1", "m1", "great", "b"), g("c1", "m1", "good", "a"), g("c1", "m1", "good", "a", null)];
    const one = averageGrades(grades, w);
    const two = averageGrades([...grades].reverse(), w);
    expect(one).toEqual(two);
    expect(one.map((c) => `${c.positionId}/${c.criterionId}`)).toEqual(["null/a", "expo/a", "expo/b"]);
  });
  it("bands for the subject: great ≥ 2.5, good ≥ 1.75, else building", () => {
    expect([gradeBand(3), gradeBand(2.5), gradeBand(2.49), gradeBand(1.75), gradeBand(1.74), gradeBand(1)]).toEqual(
      ["great", "great", "good", "good", "building", "building"]);
  });
});

describe("writeInThemes — recurring terms pulled forward, attributed", () => {
  const n = (noteId: string, authorId: string, day: string, text: string): AttributedNote =>
    ({ noteId, authorId, authorName: authorId.toUpperCase(), day, text, subjectId: "p1", positionId: "prep" });
  const opts = { minAuthors: 2, minDays: 3, top: 3 } as const;
  it("\"slow on the slicer\" from 2 managers on different days surfaces slicer and slow, with sources", () => {
    const themes = writeInThemes([n("n1", "dani", "2026-10-10", "Slow on the slicer"), n("n2", "iris", "2026-10-12", "slow on the slicer again")], opts);
    expect(themes.map((t) => t.term)).toEqual(["slicer", "slow"]);
    expect(themes[0]!.sources.map((s) => [s.authorName, s.day])).toEqual([["DANI", "2026-10-10"], ["IRIS", "2026-10-12"]]);
    expect(themes[0]!.authors).toBe(2);
  });
  it("a single mention never surfaces", () => {
    expect(writeInThemes([n("n1", "dani", "2026-10-10", "Slow on the slicer")], opts)).toEqual([]);
  });
  it("one author on three different days IS a theme (≥ 3 days); on two days it is not", () => {
    const three = [n("a", "dani", "2026-10-01", "forgot gloves"), n("b", "dani", "2026-10-02", "gloves again"), n("c", "dani", "2026-10-03", "no gloves")];
    expect(writeInThemes(three, opts).map((t) => t.term)).toEqual(["gloves"]);
    expect(writeInThemes(three.slice(0, 2), opts)).toEqual([]);
  });
  it("Spanish notes theme too (stopwords, plurals and accents folded)", () => {
    const themes = writeInThemes([n("n1", "dani", "2026-10-10", "Lento con la rebanadora"), n("n2", "iris", "2026-10-11", "muy lentos con las rebanadoras")], opts);
    expect(themes.map((t) => t.stem)).toEqual(["lento", "rebanadora"]);
    expect(writeInThemes([n("x", "dani", "2026-10-10", "rápido"), n("y", "iris", "2026-10-11", "rapido")], opts).map((t) => t.stem)).toEqual(["rapido"]);
  });
  it("English plurals fold (boxes/box, tables/table); stopwords never theme", () => {
    const themes = writeInThemes([n("n1", "dani", "2026-10-10", "the boxes and the tables"), n("n2", "iris", "2026-10-11", "the box, the table")], opts);
    expect(themes.map((t) => t.stem).sort()).toEqual(["box", "tabl"]);
  });
  it("deterministic and order-stable; top N", () => {
    const notes = [n("1", "a", "2026-10-01", "alpha beta gamma delta"), n("2", "b", "2026-10-02", "alpha beta gamma delta")];
    const one = writeInThemes(notes, opts);
    expect(one).toEqual(writeInThemes([...notes].reverse(), opts));
    expect(one.map((t) => t.term)).toEqual(["alpha", "beta", "delta"]);
  });
});

describe("copyVisibility — the truth table", () => {
  const kh = actor("key_holder", "kh", 4), gm = actor("gm", "gm", 7), moo = actor("moo", "moo", 8, []), smm = actor("social_media_mgr", "smm", 6);
  const sl = actor("shift_lead", "sl", 5), emp = actor("employee", "emp", 3), coAuthor = actor("key_holder", "co", 4);
  const copy = { authorId: "kh", locationId: A, status: "open" as PmCopyStatus };
  const open = { locationId: A, status: "open" as PmDayStatus, authorIds: ["kh", "co"] };
  const done = { ...open, status: "submitted" as PmDayStatus };
  const table: Array<[string, PeopleActor, typeof open, string]> = [
    ["the author, day open", kh, open, "author_only"],
    ["another author, day open", coAuthor, open, "day_open_counts_only"],
    ["the GM, day open", gm, open, "day_open_counts_only"],
    ["the MoO, day open (blind too)", moo, open, "day_open_counts_only"],
    ["the SMM, day open", smm, open, "none"],
    ["an employee, day open", emp, open, "none"],
    ["the author, submitted", kh, done, "day_submitted_full"],
    ["another author, submitted", coAuthor, done, "day_submitted_full"],
    ["the GM, submitted", gm, done, "day_submitted_full"],
    ["the MoO, submitted", moo, done, "day_submitted_full"],
    ["a non-author SL, submitted (J9)", sl, done, "none"],
    ["the SMM, submitted", smm, done, "none"],
  ];
  for (const [name, who, day, want] of table) it(`${name} → ${want}`, () => expect(copyVisibility(who, copy, day)).toBe(want));
});

describe("r1 P1-1 — gradeTargetProblem returns the RPC's code for EVERY shared case", () => {
  const POS: Record<string, { id: string; locationId: string; active: boolean } | undefined> = {
    own_active: { id: "pos-p", locationId: A, active: true },
    own_retired: { id: "pos-r", locationId: A, active: false },
    // the lib looks the position up with its station: usable = position active AND station active
    own_station_retired: { id: "pos-t", locationId: A, active: false },
    other_shop: { id: "pos-s", locationId: B, active: true },
    nonexistent: undefined,
  };
  for (const c of gradeCases.cases) {
    it(`${c.name} → ${c.expect ?? "accepted"}`, () => {
      const key = String(c.position);
      const position = c.position === null ? null : POS[key];
      const positionId = c.position === null ? null : (POS[key]?.id ?? "no-such-uuid");
      const worked = new Set(c.worked && positionId ? [positionId] : []);
      const added = new Set(c.added === "this" && positionId ? [positionId] : []);
      const criterion = {
        own_shared: { locationId: A, positionId: null, active: true },
        own_position_same: { locationId: A, positionId, active: true },
        own_position_other: { locationId: A, positionId: "pos-q", active: true },
        own_inactive: { locationId: A, positionId: null, active: false },
        other_shop: { locationId: B, positionId: null, active: true },
      }[c.criterion as "own_shared"];
      expect(gradeTargetProblem({ position, positionId, copyLocationId: A, workedPositionIds: worked, addedByThisCopy: added, criterion })).toBe(c.expect);
    });
  }
  it("a criterion that was not found is criterion_mismatch; a note (no criterion) skips check 8", () => {
    const base = { position: null, positionId: null, copyLocationId: A, workedPositionIds: new Set<string>(), addedByThisCopy: new Set<string>() };
    expect(gradeTargetProblem({ ...base, criterion: null })).toBe("criterion_mismatch");
    expect(gradeTargetProblem({ ...base, criterion: undefined })).toBeNull();
  });
});

describe("r1 P2-9 — the lifecycle, and the lib names the RPC's code", () => {
  const author = actor("key_holder", "kh", 4);
  const other = actor("gm", "gm", 7);
  for (const c of lifecycle.cases) {
    it(`${c.act} / ${c.copy} / day ${c.day} / ${c.author ? "author" : "not author"} → ${c.expect ?? "allowed"}`, () => {
      const copy = { authorId: author.userId, locationId: A, status: c.copy as PmCopyStatus };
      const day = { locationId: A, status: (c.day === "open" ? "open" : "submitted") as PmDayStatus, authorIds: [author.userId] };
      expect(pmCopyActRefusal(c.act as PmCopyAct, c.author ? author : other, copy, day)).toBe(c.expect);
    });
  }
  it("after submit a write is refused for the DAY first, exactly as the RPC orders it (sealed copy, submitted day)", () => {
    const copy = { authorId: author.userId, locationId: A, status: "sealed" as PmCopyStatus };
    const day = { locationId: A, status: "submitted" as PmDayStatus, authorIds: [author.userId] };
    expect(pmCopyActRefusal("write", author, copy, day)).toBe("day_closed");
    expect(pmRefusalCode("day_closed")).toBe("report_already_submitted");
    expect(pmRefusalCode("not_author")).toBe("not_copy_author");
    expect(pmRefusalCode("copy_done")).toBe("copy_done");
  });
  it("the form state comes from the same table: open → editable, done → read-only + Reopen, sealed → results", () => {
    const day = { locationId: A, status: "open" as PmDayStatus, authorIds: [author.userId] };
    expect(copyFormState({ authorId: "kh", locationId: A, status: "open" }, day)).toBe("editable");
    expect(copyFormState({ authorId: "kh", locationId: A, status: "done" }, day)).toBe("done_readonly");
    expect(copyFormState({ authorId: "kh", locationId: A, status: "sealed" }, day)).toBe("sealed");
    expect(copyFormState({ authorId: "kh", locationId: A, status: "open" }, { ...day, status: "submitted" })).toBe("sealed");
  });
});

describe("rosterForCopy and criteriaForPosition", () => {
  const roster = [{ id: "p1", name: "Ana" }, { id: "p2", name: "Ben" }, { id: "p3", name: "Cy" }];
  const intervals = [
    iv("p1", "expo", "2026-10-15T18:00:00Z", "2026-10-15T20:10:00Z"),
    iv("p1", "reg", "2026-10-15T20:10:00Z", "2026-10-15T21:10:00Z"),
    iv("p3", null, "2026-10-15T18:00:00Z", "2026-10-15T19:00:00Z"),
    iv("zz", "expo", "2026-10-15T18:00:00Z", "2026-10-15T19:00:00Z"),
  ];
  it("each roster person with the positions worked (minutes, first-held order); no events → one null row", () => {
    const r = rosterForCopy(roster, intervals, []);
    expect(r.map((p) => [p.subjectId, p.positions.map((x) => [x.positionId, x.minutes])])).toEqual([
      ["p1", [["expo", 130], ["reg", 60]]],
      ["p2", [[null, 0]]],
      ["p3", [[null, 60]]],
    ]);
  });
  it("this copy's additions are offered, marked added, and replace the null bucket", () => {
    const r = rosterForCopy(roster, intervals, [{ subjectId: "p2", positionId: "walk", byAuthorId: "m1", reason: "covered lunch" }, { subjectId: "p1", positionId: "expo", byAuthorId: "m1", reason: "dup" }]);
    expect(r[1]!.positions).toEqual([{ positionId: "walk", stationId: null, minutes: 0, added: { by: "m1", reason: "covered lunch" } }]);
    expect(r[0]!.positions.map((x) => x.positionId)).toEqual(["expo", "reg"]);
  });
  it("criteria: the position's own (in sort order, so the Walk-ins guest line leads) then the shared ones; inactive never offered", () => {
    const crit = [
      { id: "s1", positionId: null, label: "Arrived ready", sort: 1, active: true },
      { id: "w2", positionId: "walk", label: "Builds to spec", sort: 2, active: true },
      { id: "w1", positionId: "walk", label: "Greets guests", sort: 1, active: true },
      { id: "x", positionId: "walk", label: "Old", sort: 0, active: false },
      { id: "e1", positionId: "expo", label: "Ticket accuracy", sort: 1, active: true },
    ];
    expect(criteriaForPosition(crit, "walk").map((c) => c.id)).toEqual(["w1", "w2", "s1"]);
    expect(criteriaForPosition(crit, null).map((c) => c.id)).toEqual(["s1"]);
  });
});

describe("windowFromWallTimes — the form's \"My time on the floor\" (ET wall times) as instants", () => {
  it("2:00 PM – 9:00 PM on the 15th; a close after midnight rolls to the 16th; DST-correct; bad input is null", async () => {
    const { windowFromWallTimes, wallTimeOf } = await import("@/lib/pm-report-v2-shared");
    expect(windowFromWallTimes("2026-10-15", "14:00", "21:00")).toEqual({ from: "2026-10-15T18:00:00.000Z", to: "2026-10-16T01:00:00.000Z" });
    expect(windowFromWallTimes("2026-10-15", "17:00", "00:30")).toEqual({ from: "2026-10-15T21:00:00.000Z", to: "2026-10-16T04:30:00.000Z" });
    expect(windowFromWallTimes("2026-10-31", "18:00", "01:30")).toEqual({ from: "2026-10-31T22:00:00.000Z", to: "2026-11-01T05:30:00.000Z" });
    expect(windowFromWallTimes("2026-10-15", "14:00", null)).toEqual({ from: "2026-10-15T18:00:00.000Z", to: null });
    expect(windowFromWallTimes("2026-10-15", "25:00", null)).toBeNull();
    expect(wallTimeOf("2026-10-16T01:00:00.000Z")).toBe("21:00");
    expect(wallTimeOf(null)).toBe("");
  });
});
