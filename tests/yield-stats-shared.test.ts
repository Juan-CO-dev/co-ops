/**
 * Unit spine — batch vs bottle PHASE B drift math (lib/yield-stats-shared.ts).
 *
 * Juan, 2026-10-07: "Average of 10 batches and a nudge when it's off 15%… also we need to track
 * it being under and over." Minimum 6 batches (CC). Pinned here: the window, the 6-batch floor,
 * both directions, the exact-15% edge, recipe-vs-maker independence (opposite drifts cancel for
 * the recipe while each maker is still flagged), the Retrain snooze and its expiry after 10 more
 * batches, and the signed labels in both languages.
 */
import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  YIELD_NUDGE_DRIFT,
  YIELD_NUDGE_MIN_BATCHES,
  YIELD_STATS_WINDOW,
  batchSignedDrift,
  canMarkRetrainDone,
  directionKey,
  evaluateItem,
  formatSignedPct,
  isEligibleRetrainAssignee,
  isOffCard,
  isValidCardYield,
  lastWindow,
  normalizeRetrainNote,
  snoozeState,
  summarizeDrift,
  type RetrainNoteLite,
  type YieldBatch,
} from "@/lib/yield-stats-shared";

const ITEM = "item-ranch";
let seq = 0;
/** One header on day `day` (2026-10-01 + day), one batch by default, card 10. */
function b(day: number, cameOutTo: number, opts: Partial<YieldBatch> = {}): YieldBatch {
  seq += 1;
  const d = new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + day * 3_600_000);
  return { id: `p-${String(seq).padStart(4, "0")}`, itemId: ITEM, producedAt: d.toISOString(), madeBy: "u-ana", batchesMade: 1, cameOutTo, yieldAtTime: 10, ...opts };
}
function many(n: number, cameOutTo: number, opts: Partial<YieldBatch> = {}, startDay = 0): YieldBatch[] {
  return Array.from({ length: n }, (_, i) => b(startDay + i, cameOutTo, opts));
}

describe("Juan's constants", () => {
  it("window 10, minimum 6, drift 15%", () => {
    expect(YIELD_STATS_WINDOW).toBe(10);
    expect(YIELD_NUDGE_MIN_BATCHES).toBe(6);
    expect(YIELD_NUDGE_DRIFT).toBe(0.15);
  });
});

describe("per-batch drift compares came_out_to / batches with that SAME record's yield_at_time", () => {
  it("a double batch that came out to 16 against a card of 10 is −20%", () => {
    expect(batchSignedDrift(b(0, 16, { batchesMade: 2 }))).toBeCloseTo(-0.2, 12);
  });
  it("a card edited mid-window never re-scores the old batches", () => {
    // Old card 10 → 10 out (on card). New card 8 → 8 out (on card). The window is on card,
    // although measured against the NEW card the old batches would read +25%.
    const w = [...many(5, 10), ...many(5, 8, { yieldAtTime: 8 }, 10)];
    const s = summarizeDrift(w)!;
    expect(s.signedDrift).toBeCloseTo(0, 12);
    expect(s.direction).toBe("on_card");
    expect(s.flagged).toBe(false);
  });
  it("the average is batch-weighted: a double batch counts twice", () => {
    // 1 batch at 10 (0%), 1 header of 3 batches at 21 (7/batch, −30%): (31 − 40)/40 = −22.5%.
    const s = summarizeDrift([b(0, 10), b(1, 21, { batchesMade: 3 })])!;
    expect(s.batches).toBe(4);
    expect(s.signedDrift).toBeCloseTo(-0.225, 12);
    expect(s.actualPerBatch).toBeCloseTo(7.75, 12);
    expect(s.cardPerBatch).toBeCloseTo(10, 12);
  });
});

describe("the window is the last 10 headers, newest first", () => {
  it("only the newest 10 count — 5 old bad batches fall out once 10 good ones follow", () => {
    const old = many(5, 5, {}, 0);   // −50% each, oldest
    const recent = many(10, 10, {}, 100);
    const w = lastWindow([...old, ...recent]);
    expect(w).toHaveLength(10);
    expect(w.every((x) => x.cameOutTo === 10)).toBe(true);
    expect(summarizeDrift(w)!.flagged).toBe(false);
  });
  it("the 11th-newest batch is excluded and the 10th included (boundary)", () => {
    const eleventh = b(0, 0);        // −100%, oldest
    const ten = many(10, 8.5, {}, 1); // −15% each
    const w = lastWindow([eleventh, ...ten]);
    expect(w.map((x) => x.id)).not.toContain(eleventh.id);
    expect(summarizeDrift(w)!.signedDrift).toBeCloseTo(-0.15, 9);
  });
  it("an unusable header (0 batches, no card) is never in the window", () => {
    const w = lastWindow([b(0, 10, { batchesMade: 0 }), b(1, 10, { yieldAtTime: 0 }), b(2, 10)]);
    expect(w).toHaveLength(1);
  });
  it("order is by produced_at, not by input order; a tie breaks on id", () => {
    const later = b(5, 10);
    const earlier = b(1, 10);
    expect(lastWindow([earlier, later])[0]!.id).toBe(later.id);
    const t1 = b(9, 10); const t2 = { ...b(9, 10), producedAt: t1.producedAt };
    expect(lastWindow([t1, t2])[0]!.id).toBe(t1.id < t2.id ? t2.id : t1.id);
  });
});

describe("minimum 6 batches before any nudge", () => {
  it("5 batches all 40% under: no nudge (enough=false), the drift is still reported", () => {
    const s = summarizeDrift(many(5, 6))!;
    expect(s.batches).toBe(5);
    expect(s.enough).toBe(false);
    expect(s.flagged).toBe(false);
    expect(s.signedDrift).toBeCloseTo(-0.4, 12);
  });
  it("the 6th batch turns the same drift into a nudge", () => {
    const s = summarizeDrift(many(6, 6))!;
    expect(s.enough).toBe(true);
    expect(s.flagged).toBe(true);
  });
  it("an empty window has no verdict", () => {
    expect(summarizeDrift([])).toBeNull();
  });
});

describe("both directions are errors", () => {
  it("UNDER: 8.2 against 10 is −18%, flagged, direction under", () => {
    const s = summarizeDrift(many(10, 8.2))!;
    expect(s.direction).toBe("under");
    expect(s.flagged).toBe(true);
    expect(formatSignedPct(s.signedDrift)).toBe("−18%");
  });
  it("OVER: 12.2 against 10 is +22%, flagged, direction over", () => {
    const s = summarizeDrift(many(10, 12.2))!;
    expect(s.direction).toBe("over");
    expect(s.flagged).toBe(true);
    expect(formatSignedPct(s.signedDrift)).toBe("+22%");
  });
});

describe("the exact-15% edge: exactly 15% off IS a nudge (stated choice)", () => {
  it("8.5 against 10 (−15.000…) flags", () => {
    expect(summarizeDrift(many(10, 8.5))!.flagged).toBe(true);
  });
  it("11.5 against 10 (+15%) flags", () => {
    expect(summarizeDrift(many(10, 11.5))!.flagged).toBe(true);
  });
  it("float noise around the edge resolves to the nudge side; a real 14.9% does not flag", () => {
    expect(isOffCard(-0.15)).toBe(true);
    expect(isOffCard(0.15 - 1e-12)).toBe(true);
    expect(isOffCard(0.149)).toBe(false);
    expect(summarizeDrift(many(10, 8.51))!.flagged).toBe(false);
  });
});

describe("recipe level and maker level are independent", () => {
  it("one maker +20% and another −20% cancel for the recipe, and EACH maker is flagged", () => {
    const ana = many(6, 12, { madeBy: "u-ana" }, 0);  // +20%
    const ben = many(6, 8, { madeBy: "u-ben" }, 50);  // −20%
    // The recipe window is the last 10: 6 of Ben's (newest) + 4 of Ana's → (48+48 − 100)/100 = −4%.
    const v = evaluateItem(ITEM, [...ana, ...ben], []);
    expect(v.recipe.summary!.flagged).toBe(false);
    expect(v.recipe.nudge).toBe(false);
    const byId = new Map(v.makers.map((m) => [m.makerId, m]));
    expect(byId.get("u-ana")!.nudge).toBe(true);
    expect(byId.get("u-ana")!.summary!.direction).toBe("over");
    expect(formatSignedPct(byId.get("u-ana")!.summary!.signedDrift)).toBe("+20%");
    expect(byId.get("u-ben")!.nudge).toBe(true);
    expect(byId.get("u-ben")!.summary!.direction).toBe("under");
  });
  it("a maker's item needs THEIR OWN 6 batches of that recipe", () => {
    const v = evaluateItem(ITEM, [...many(5, 5, { madeBy: "u-cy" }), ...many(6, 10, { madeBy: "u-ana" }, 20)], []);
    const cy = v.makers.find((m) => m.makerId === "u-cy")!;
    expect(cy.summary!.enough).toBe(false);
    expect(cy.nudge).toBe(false);
  });
  it("only that item's batches count", () => {
    const other = many(10, 1, { itemId: "item-other" });
    const v = evaluateItem(ITEM, [...other, ...many(10, 10)], []);
    expect(v.recipe.summary!.batches).toBe(10);
    expect(v.recipe.nudge).toBe(false);
  });
  it("the recipe nudge names the outlier makers, worst first", () => {
    const v = evaluateItem(ITEM, [...many(5, 5, { madeBy: "u-ben" }, 0), ...many(3, 8, { madeBy: "u-cy" }, 10), ...many(2, 10, { madeBy: "u-ana" }, 20)], []);
    expect(v.recipe.nudge).toBe(true);
    expect(v.recipe.outlierMakerIds).toEqual(["u-ben", "u-cy"]);
  });
});

describe("Retrain holds the nudge for the next 10 BATCHES, then it expires", () => {
  const bad = many(10, 7, {}, 0); // −30% recipe nudge (every batch by u-ana)
  const noteAt = new Date(Date.parse(bad[9]!.producedAt) + 60_000).toISOString();
  // status "done": these pin the 10-batch snooze on its own; open-retrain holds are pinned below.
  const note: RetrainNoteLite = { id: "n1", itemId: ITEM, scope: "recipe", makerId: null, createdAt: noteAt, snoozeBatches: 10, status: "done", assignedTo: "u-kh", doneAt: noteAt, doneBy: "u-kh" };

  it("right after the note the nudge is held with 10 batches to go", () => {
    const v = evaluateItem(ITEM, bad, [note]);
    expect(v.recipe.summary!.flagged).toBe(true);
    expect(v.recipe.hold).toMatchObject({ noteId: "n1", remaining: 10, snoozed: true, open: false, via: "own" });
    expect(v.recipe.nudge).toBe(false);
  });
  it("after 9 more (still bad) batches it is still held, 1 to go", () => {
    const v = evaluateItem(ITEM, [...bad, ...many(9, 7, {}, 100)], [note]);
    expect(v.recipe.hold!.remaining).toBe(1);
    expect(v.recipe.nudge).toBe(false);
  });
  it("the 10th batch after the note ends the snooze — a still-bad recipe nudges again", () => {
    const v = evaluateItem(ITEM, [...bad, ...many(10, 7, {}, 100)], [note]);
    expect(v.recipe.hold).toBeNull();
    expect(v.recipe.nudge).toBe(true);
  });
  it("double batches after a Retrain use 2 snooze slots each (batches, not entries)", () => {
    const v = evaluateItem(ITEM, [...bad, ...many(4, 14, { batchesMade: 2 }, 100)], [note]);
    expect(v.recipe.hold!.remaining).toBe(2);
    const w = evaluateItem(ITEM, [...bad, ...many(5, 14, { batchesMade: 2 }, 100)], [note]);
    expect(w.recipe.hold).toBeNull();
    expect(w.recipe.nudge).toBe(true);
  });
  it("a RECIPE-level Retrain holds that recipe's maker items at once, on the recipe's batch counter", () => {
    const now = evaluateItem(ITEM, bad, [note]).makers.find((m) => m.makerId === "u-ana")!;
    expect(now.summary!.flagged).toBe(true);
    expect(now.nudge).toBe(false);
    expect(now.hold).toMatchObject({ noteId: "n1", via: "recipe" });
    // Ben makes the next 10 batches: the RECIPE counter reaches 10 and Ana's item comes back,
    // although Ana herself made nothing after the note.
    const after = evaluateItem(ITEM, [...bad, ...many(10, 7, { madeBy: "u-ben" }, 100)], [note]);
    const ana = after.makers.find((m) => m.makerId === "u-ana")!;
    expect(ana.hold).toBeNull();
    expect(ana.nudge).toBe(true);
  });
  it("a maker note never holds the recipe", () => {
    const makerNote: RetrainNoteLite = { ...note, id: "n2", scope: "maker", makerId: "u-ana" };
    const v = evaluateItem(ITEM, bad, [makerNote]);
    expect(v.recipe.nudge).toBe(true);
    expect(v.makers.find((m) => m.makerId === "u-ana")!.hold).toMatchObject({ via: "own" });
  });
  it("the LATEST note governs", () => {
    const older: RetrainNoteLite = { ...note, id: "n0", createdAt: bad[0]!.producedAt };
    expect(snoozeState(bad, [older, note])!.noteId).toBe("n1");
  });
});

describe("an OPEN (assigned, not done) retrain holds the nudge past the 10-batch snooze", () => {
  const bad = many(10, 7, {}, 0);
  const noteAt = new Date(Date.parse(bad[9]!.producedAt) + 60_000).toISOString();
  const open: RetrainNoteLite = { id: "o1", itemId: ITEM, scope: "recipe", makerId: null, createdAt: noteAt, snoozeBatches: 10, status: "open", assignedTo: "u-kh", doneAt: null, doneBy: null };
  it("still open after 12 more bad batches: held as open, no nudge", () => {
    const v = evaluateItem(ITEM, [...bad, ...many(12, 7, {}, 100)], [open]);
    expect(v.recipe.hold).toMatchObject({ open: true, snoozed: false, holding: true });
    expect(v.recipe.nudge).toBe(false);
  });
  it("marked done after those batches: the expired snooze lets it nudge again", () => {
    const done = { ...open, status: "done" as const, doneAt: noteAt, doneBy: "u-kh" };
    const v = evaluateItem(ITEM, [...bad, ...many(12, 7, {}, 100)], [done]);
    expect(v.recipe.nudge).toBe(true);
    expect(v.recipe.latestNoteId).toBe("o1");
  });
});

describe("batches, not entries: window, minimum and boundary (Astra r1 #3)", () => {
  it("3 double-batch entries at −20% hold 6 batches and DO nudge", () => {
    const s = summarizeDrift(lastWindow(many(3, 16, { batchesMade: 2 })))!;
    expect(s.entries).toBe(3);
    expect(s.batches).toBe(6);
    expect(s.enough).toBe(true);
    expect(s.flagged).toBe(true);
  });
  it("the window stops at 10 batches: five double batches fill it, an older entry is out", () => {
    const older = b(0, 0); // −100%, would poison the window if it got in
    const w = lastWindow([older, ...many(5, 20, { batchesMade: 2 }, 10)]);
    expect(w.map((x) => x.id)).not.toContain(older.id);
    expect(summarizeDrift(w)!.batches).toBe(10);
  });
  it("PROPORTIONAL boundary: 9 single batches + an older triple contribute exactly 1/3 of the triple", () => {
    const triple = b(0, 15, { batchesMade: 3 }); // 5 per batch = −50%
    const w = lastWindow([triple, ...many(9, 10, {}, 10)]);
    const t = w.find((x) => x.id === triple.id)!;
    expect(t.weight).toBeCloseTo(1 / 3, 12);
    const s = summarizeDrift(w)!;
    expect(s.batches).toBe(10);
    // (90 + 15/3 − 100) / 100 = −5%
    expect(s.signedDrift).toBeCloseTo(-0.05, 12);
  });
});

describe("assignee floor and who may mark done", () => {
  it("an active KH+ at the shop, never above the assigning GM", () => {
    expect(isEligibleRetrainAssignee({ level: 4, active: true, atShop: true }, 7)).toBe(true);
    expect(isEligibleRetrainAssignee({ level: 7, active: true, atShop: true }, 7)).toBe(true);
    expect(isEligibleRetrainAssignee({ level: 3, active: true, atShop: true }, 7)).toBe(false);
    expect(isEligibleRetrainAssignee({ level: 8, active: true, atShop: true }, 7)).toBe(false);
    expect(isEligibleRetrainAssignee({ level: 5, active: false, atShop: true }, 7)).toBe(false);
    expect(isEligibleRetrainAssignee({ level: 5, active: true, atShop: false }, 7)).toBe(false);
  });
  it("the assignee or a GM, only while open", () => {
    const n = { assignedTo: "u-kh", status: "open" as const };
    expect(canMarkRetrainDone({ userId: "u-kh", level: 4 }, n)).toBe(true);
    expect(canMarkRetrainDone({ userId: "u-gm", level: 7 }, n)).toBe(true);
    expect(canMarkRetrainDone({ userId: "u-sl", level: 5 }, n)).toBe(false);
    expect(canMarkRetrainDone({ userId: "u-kh", level: 4 }, { ...n, status: "done" })).toBe(false);
  });
});

describe("signed labels, both languages", () => {
  it("always signed, one decimal at most, U+2212 for under, comma decimal in Spanish", () => {
    expect(formatSignedPct(-0.18)).toBe("−18%");
    expect(formatSignedPct(0.22)).toBe("+22%");
    expect(formatSignedPct(0.155)).toBe("+15.5%");
    expect(formatSignedPct(0.155, "es")).toBe("+15,5%");
    expect(formatSignedPct(0)).toBe("0%");
  });
  it("every direction key exists in en and es and takes {pct}", () => {
    for (const d of ["under", "over", "on_card"] as const) {
      const key = directionKey(d);
      const e = (en as Record<string, string>)[key];
      const s = (es as Record<string, string>)[key];
      expect(e, `${key} en`).toBeTruthy();
      expect(s, `${key} es`).toBeTruthy();
      expect(e).toContain("{pct}");
      expect(s).toContain("{pct}");
    }
    expect((en as Record<string, string>)["yield.direction.under"]).toContain("UNDER");
    expect((en as Record<string, string>)["yield.direction.over"]).toContain("OVER");
  });
});

describe("input guards", () => {
  it("isValidCardYield refuses 0, negatives, NaN, strings and absurd values", () => {
    expect(isValidCardYield(8)).toBe(true);
    expect(isValidCardYield(0)).toBe(false);
    expect(isValidCardYield(-1)).toBe(false);
    expect(isValidCardYield(Number.NaN)).toBe(false);
    expect(isValidCardYield("8")).toBe(false);
    expect(isValidCardYield(1e9)).toBe(false);
  });
  it("normalizeRetrainNote trims, empties to null, refuses non-strings and > 500 chars", () => {
    expect(normalizeRetrainNote("  watch the scale  ")).toBe("watch the scale");
    expect(normalizeRetrainNote("   ")).toBeNull();
    expect(normalizeRetrainNote(undefined)).toBeNull();
    expect(normalizeRetrainNote(5)).toBe("invalid");
    expect(normalizeRetrainNote("x".repeat(501))).toBe("invalid");
  });
});
