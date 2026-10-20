/**
 * Juan 2026-10-20 — primary / secondary position per person. The ONE ordered list `cover_positions` (0274): [0] = primary,
 * [1] = secondary, [2..] = "can flex to". The hourly ranking puts the position rank FIRST:
 *   [positionRank, fullTimerFirst, busiest ? 0 : -underSoftMin, -skill, pairing, userId]
 * Pinned here:
 *  - the pure rank, the list helpers, the save-time validation, the Toast suggestion mapping (incl. no confident match);
 *  - `rankCandidates`: a primary beats a higher-skill non-primary; a secondary beats flex; a full-timer short of hours
 *    reorders only WITHIN the same position rank; a null position (the MoD lane) is unchanged; a MANAGER's ranking is
 *    unchanged (the hourly shift lead's cover list is still their cover order, never a primary);
 *  - the reasons: on primary / on secondary / flexed (only with a primary set; never for a manager);
 *  - manager behaviour unchanged: the MoD cover order and `cover_outside_preferences`;
 *  - a whole week: validator-clean, deterministic (byte-identical twice), the primary holder lands on their primary.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import {
  CANDIDATE_KEY, coverWithManager, rankCandidates, whyChosen, type BlockPlan, type BuildCtx, type CandidateOpts, type GShift, type WeekState,
} from "@/lib/scheduling/generator/assign-shared";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import type { SchedPerson } from "@/lib/scheduling/people-input-shared";
import {
  POSITION_RANK, matchToastJob, nameTokens, positionListProblems, positionRankOf, primaryPositionOf, suggestPrimaryFromToast, withPrimarySecondary,
  type SuggestPosition,
} from "@/lib/scheduling/position-rank-shared";
import { MOD, segmentHoldProblems } from "@/lib/scheduling/rules-shared";
import { DATES, H9_EXTRA, I, SMALL_SPECS, day, fixture, type PersonSpec } from "./fixtures/schedule/fixtures";

const MON = DATES[0]!;
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

// ─── The pure rank and the list helpers ──────────────────────────────────────

describe("the position rank (pure)", () => {
  const p = (role: SchedPerson["role"], list: string[]) => ({ role, coverPositions: list });
  it("0 = primary, 1 = secondary, 2 = flex (the 'can flex to' tail, off the list, an empty list, a null position)", () => {
    const x = p("employee", [I.$REG, I.$WALK, I.$EXPO]);
    expect(positionRankOf(x, I.$REG)).toBe(POSITION_RANK.primary);
    expect(positionRankOf(x, I.$WALK)).toBe(POSITION_RANK.secondary);
    expect(positionRankOf(x, I.$EXPO)).toBe(POSITION_RANK.flex);
    expect(positionRankOf(x, I.$BOI)).toBe(POSITION_RANK.flex);
    expect(positionRankOf(x, null)).toBe(POSITION_RANK.flex);
    expect(positionRankOf(p("employee", []), I.$REG)).toBe(POSITION_RANK.flex);
    expect(primaryPositionOf(x)).toBe(I.$REG);
    expect(primaryPositionOf(p("trainee", []))).toBeNull();
  });
  it("a manager (shift lead and up, the hourly shift lead included) has no primary: their list is their cover order, unchanged", () => {
    for (const role of ["shift_lead", "agm", "gm"] as const) {
      expect(positionRankOf(p(role, [I.$REG, I.$EXPO]), I.$REG)).toBe(POSITION_RANK.flex);
      expect(primaryPositionOf(p(role, [I.$REG]))).toBeNull();
    }
    expect(positionRankOf(p("key_holder", [I.$REG]), I.$REG)).toBe(POSITION_RANK.primary);
  });
  it("withPrimarySecondary keeps the 'can flex to' tail, drops a repeated pick, and clears the list with no primary", () => {
    const list = [I.$REG, I.$WALK, I.$EXPO, I.$BOI];
    expect(withPrimarySecondary(list, I.$EXPO, I.$REG)).toEqual([I.$EXPO, I.$REG, I.$BOI]);
    expect(withPrimarySecondary(list, I.$WALK, null)).toEqual([I.$WALK, I.$EXPO, I.$BOI]);
    expect(withPrimarySecondary(list, I.$REG, I.$REG)).toEqual([I.$REG, I.$EXPO, I.$BOI]);
    expect(withPrimarySecondary(list, null, I.$WALK)).toEqual([]);
    expect(withPrimarySecondary([], I.$DISH, I.$PREP)).toEqual([I.$DISH, I.$PREP]);
  });
});

describe("save-time validation: a primary or secondary the work type does not allow", () => {
  const roles = { [I.$PREP]: "prep", [I.$DISH]: "prep_dish", [I.$REG]: "register", [I.$WALK]: "walk" } as const;
  it("FOH on the dish-and-prep position, BOH on the line → refused, by slot; also-allowed opens it; the flex tail is not judged", () => {
    expect(positionListProblems({ role: "employee", workType: "foh", alsoAllowed: [] }, [I.$DISH, I.$REG], roles))
      .toEqual([{ slot: "primary", positionId: I.$DISH, code: "work_type" }]);
    expect(positionListProblems({ role: "employee", workType: "boh", alsoAllowed: [] }, [I.$PREP, I.$REG, I.$WALK], roles))
      .toEqual([{ slot: "secondary", positionId: I.$REG, code: "work_type" }]);
    expect(positionListProblems({ role: "employee", workType: "foh", alsoAllowed: ["boh"] }, [I.$DISH, I.$REG], roles)).toEqual([]);
    expect(positionListProblems({ role: "employee", workType: "boh", alsoAllowed: [] }, [I.$DISH, I.$PREP, I.$REG], roles)).toEqual([]);
  });
  it("unknown position roles (structure not saved yet) are skipped; a manager's list is never judged (unchanged)", () => {
    expect(positionListProblems({ role: "employee", workType: "foh", alsoAllowed: [] }, [I.$DISH], {})).toEqual([]);
    expect(positionListProblems({ role: "shift_lead", workType: "foh", alsoAllowed: [] }, [I.$DISH], roles)).toEqual([]);
  });
  it("the refusal and every new string are en + es, and the es copy is a real translation", () => {
    for (const k of ["schedule.error.position_rank_not_allowed", "schedule.settings.staff.problem_work_type", "schedule.settings.staff.slot_primary",
      "schedule.settings.staff.slot_secondary", "schedule.settings.staff.slot_flex", "schedule.settings.staff.cover_help", "schedule.settings.staff.toast_suggest_help",
      "schedule.reason.on_primary", "schedule.reason.on_secondary", "schedule.reason.flexed", "admin.users.positions.primary", "admin.users.positions.secondary"]) {
      expect(EN[k], k).toBeTruthy();
      expect(ES[k], k).toBeTruthy();
      expect(ES[k], k).not.toBe(EN[k]);
    }
    expect(EN["schedule.reason.flexed"]).toContain("{positionId}");
    expect(EN["schedule.reason.flexed"]).toContain("{primaryId}");
  });
});

// ─── The Toast suggestion ────────────────────────────────────────────────────

describe("the suggested primary from Toast (most-worked job, last 8 weeks; never auto-saved)", () => {
  const shop: SuggestPosition[] = [
    { id: "p-prep", name: "Prep", role: "prep" }, { id: "p-dish", name: "Prep/Dishwasher", role: "prep_dish" },
    { id: "p-reg", name: "Register & Delivery", role: "register" }, { id: "p-expo", name: "Expeditor", role: "expo" },
    { id: "p-walk", name: "Walk-ins", role: "walk" }, { id: "p-boi", name: "Crunchy Boi", role: "line_other" },
  ];
  it("canonical words: dishwashing words are one word, punctuation splits, filler drops", () => {
    expect(nameTokens("Prep / Dishwasher")).toEqual(["dish", "prep"]);
    expect(nameTokens("Dish/Prep")).toEqual(["dish", "prep"]);
    expect(nameTokens("Sandwich Maker")).toEqual(["sandwich"]);
    expect(nameTokens("Preparación")).toEqual(["preparacion"]);
  });
  it("Dish/Prep → Prep/Dishwasher; Prep → Prep; Counter → the shop's one register position", () => {
    expect(matchToastJob("Dish/Prep", shop)).toBe("p-dish");
    expect(matchToastJob("Prep", shop)).toBe("p-prep");
    expect(matchToastJob("Counter", shop)).toBe("p-reg");
    // A shop with only the dish-and-prep position: "Prep" falls inside its name.
    expect(matchToastJob("Prep", shop.filter((x) => x.id !== "p-prep"))).toBe("p-dish");
  });
  it("no confident match → no suggestion: Sandwich Maker without a sandwich position, two register positions, an unknown job", () => {
    expect(matchToastJob("Sandwich Maker", shop)).toBeNull();
    expect(matchToastJob("Sandwich Maker", [...shop, { id: "p-sand", name: "Sandwich line", role: "line_other" }])).toBe("p-sand");
    expect(matchToastJob("Counter", [...shop, { id: "p-reg2", name: "Register 2", role: "register" }])).toBeNull();
    expect(matchToastJob("Dish", [...shop, { id: "p-dish2", name: "Dish pit", role: "prep_dish" }])).toBeNull();
    expect(matchToastJob("Manager", shop)).toBeNull();
    expect(matchToastJob("  ", shop)).toBeNull();
  });
  it("the MOST-worked job decides; a tie at the top, an unmapped top job or no hours → no suggestion", () => {
    expect(suggestPrimaryFromToast({ "Dish/Prep": 120, Counter: 30 }, shop)).toEqual({ positionId: "p-dish", jobName: "Dish/Prep" });
    expect(suggestPrimaryFromToast({ Counter: 60, Prep: 60 }, shop)).toBeNull();
    expect(suggestPrimaryFromToast({ "Sandwich Maker": 90, Counter: 10 }, shop)).toBeNull();
    expect(suggestPrimaryFromToast({}, shop)).toBeNull();
    expect(suggestPrimaryFromToast({ Counter: 0 }, shop)).toBeNull();
  });
});

// ─── rankCandidates ──────────────────────────────────────────────────────────

/** The small shop on Monday, people overridden; an empty built Monday. */
function ctxWith(over: Record<string, Partial<SchedPerson>> = {}, specs: PersonSpec[] = [...SMALL_SPECS, ...H9_EXTRA]) {
  const input = fixture({ specs, days: [day(MON)] });
  const out = buildWeek(input);
  const people = Object.fromEntries(input.people.map((p) => [p.userId, { ...p, ...(over[p.userId] ?? {}) }]));
  const b: BuildCtx = { ctx: out.context, structure: out.context.days[MON]!.structure, people, lookup: input.skills, budgetedDates: [], budgetHours: 0, busiest: {}, notes: [], pinCover: {} };
  const week: WeekState = { built: { [MON]: [] }, inherited: [] };
  return { b, week };
}
const plan = (positionId: string, startQ = 44, endQ = 60): BlockPlan => ({ startQ, endQ, segments: [{ positionId, startQ, endQ, kind: "core" }] });
const opts = (positionId: string | null, p: BlockPlan): CandidateOpts => ({ date: MON, plan: p, positionId, closingLead: false, allowOvertime: false, mod: positionId === null });
const order = (b: BuildCtx, week: WeekState, o: CandidateOpts) => rankCandidates(b, week, week.built[MON]!, o).map((c) => c.person.userId);

describe("rankCandidates: the position rank first (Juan 2026-10-20)", () => {
  it("baseline: with no primaries, Register ranks by skill (Bo 0.9 first) — the key is the old key behind a flex rank", () => {
    const { b, week } = ctxWith();
    const ranked = rankCandidates(b, week, [], opts(I.$REG, plan(I.$REG)));
    expect(ranked[0]!.person.userId).toBe("u-b-bo");
    expect(ranked.every((c) => c.key[CANDIDATE_KEY.positionRank] === POSITION_RANK.flex)).toBe(true);
    expect(ranked.every((c) => c.key.length === 6 && c.key[CANDIDATE_KEY.userId] === c.person.userId)).toBe(true);
  });
  it("a PRIMARY beats a higher-skill non-primary (Mia 0.7 with Register as her primary over Bo 0.9)", () => {
    const { b, week } = ctxWith({ "u-m-mia": { coverPositions: [I.$REG] } });
    const ids = order(b, week, opts(I.$REG, plan(I.$REG)));
    expect(ids[0]).toBe("u-m-mia");
    expect(ids[1]).toBe("u-b-bo");
  });
  it("a SECONDARY beats flex, and a primary beats a secondary", () => {
    const { b, week } = ctxWith({ "u-n-noe": { coverPositions: [I.$WALK, I.$REG] } });
    expect(order(b, week, opts(I.$REG, plan(I.$REG))).slice(0, 2)).toEqual(["u-n-noe", "u-b-bo"]);
    const both = ctxWith({ "u-n-noe": { coverPositions: [I.$WALK, I.$REG] }, "u-m-mia": { coverPositions: [I.$REG, I.$WALK] } });
    expect(order(both.b, both.week, opts(I.$REG, plan(I.$REG))).slice(0, 3)).toEqual(["u-m-mia", "u-n-noe", "u-b-bo"]);
    // The "can flex to" tail ranks as flex: Register third on Mia's list → by skill again (Bo first).
    const tail = ctxWith({ "u-m-mia": { coverPositions: [I.$WALK, I.$BOI, I.$REG] } });
    expect(order(tail.b, tail.week, opts(I.$REG, plan(I.$REG)))[0]).toBe("u-b-bo");
  });
  it("a full-timer short of their hours reorders ONLY within the same position rank", () => {
    // Bo (flex, strongest) is a full-timer short of 30 h; Mia's primary is Register: Mia still first, Bo first among flex.
    const { b, week } = ctxWith({ "u-m-mia": { coverPositions: [I.$REG] }, "u-n-noe": { fullTime: true, fullTimeMinH: 30 } });
    const ids = order(b, week, opts(I.$REG, plan(I.$REG)));
    expect(ids[0]).toBe("u-m-mia");
    expect(ids[1]).toBe("u-n-noe");
    // Two primaries: the full-timer short of hours goes first between them.
    const two = ctxWith({ "u-m-mia": { coverPositions: [I.$REG] }, "u-n-noe": { coverPositions: [I.$REG], fullTime: true, fullTimeMinH: 30 } });
    expect(order(two.b, two.week, opts(I.$REG, plan(I.$REG))).slice(0, 2)).toEqual(["u-n-noe", "u-m-mia"]);
  });
  it("eligibility is unchanged: a primary the person may not hold never makes them a candidate", () => {
    // Mia is FOH; the dish-and-prep position needs BOH.
    const { b, week } = ctxWith({ "u-m-mia": { coverPositions: [I.$DISH] } });
    expect(order(b, week, opts(I.$DISH, plan(I.$DISH, 30, 46)))).not.toContain("u-m-mia");
  });
  it("a null position (the MoD lane) is unchanged: everyone ranks flex, the order equals the no-primary order", () => {
    const base = ctxWith();
    const withLists = ctxWith({ "u-a-ana": { coverPositions: [I.$REG] }, "u-h-hal": { coverPositions: [I.$WALKON, I.$REG] } });
    // The evening MoD lane from 7:00 PM (the key holders count from keyHolderModAfterQ = 76).
    const mod = (x: ReturnType<typeof ctxWith>) => rankCandidates(x.b, x.week, [], { ...opts(null, { startQ: 76, endQ: 83, segments: [{ positionId: MOD, startQ: 76, endQ: 83, kind: "core" }] }), modFromQ: 76 });
    const a = mod(base);
    const z = mod(withLists);
    expect(a.length).toBeGreaterThan(1);
    expect(z.map((c) => c.person.userId)).toEqual(a.map((c) => c.person.userId));
    expect(z.every((c) => c.key[CANDIDATE_KEY.positionRank] === POSITION_RANK.flex)).toBe(true);
  });
  it("MANAGER ranking unchanged: the hourly shift lead's cover list [Register, Expo] gives no primary rank — the order is the old one", () => {
    // Gus (shift lead, cover [REG, EXPO]) and the same roster with his list emptied rank identically on Register.
    const withList = ctxWith();
    const without = ctxWith({ "u-g-gus": { coverPositions: [] } });
    const a = rankCandidates(withList.b, withList.week, [], opts(I.$REG, plan(I.$REG)));
    const z = rankCandidates(without.b, without.week, [], opts(I.$REG, plan(I.$REG)));
    expect(a.map((c) => c.person.userId)).toEqual(z.map((c) => c.person.userId));
    const gus = a.find((c) => c.person.userId === "u-g-gus");
    if (gus) expect(gus.key[CANDIDATE_KEY.positionRank]).toBe(POSITION_RANK.flex);
  });
});

// ─── The reasons ─────────────────────────────────────────────────────────────

describe("the reasons: on primary / on secondary / flexed", () => {
  const why = (over: Record<string, Partial<SchedPerson>>, userId: string, positionId: string) => {
    const { b, week } = ctxWith(over);
    const o = opts(positionId, plan(positionId));
    const c = rankCandidates(b, week, [], o).find((x) => x.person.userId === userId)!;
    return whyChosen(b, [], c, o);
  };
  it("on the primary / the secondary it says so; elsewhere with a primary set it is 'flexed', naming the position and the primary", () => {
    expect(why({ "u-m-mia": { coverPositions: [I.$REG] } }, "u-m-mia", I.$REG)[0]).toEqual({ key: "on_primary", params: { userId: "u-m-mia", positionId: I.$REG } });
    expect(why({ "u-m-mia": { coverPositions: [I.$WALK, I.$REG] } }, "u-m-mia", I.$REG)[0]).toEqual({ key: "on_secondary", params: { userId: "u-m-mia", positionId: I.$REG, primaryId: I.$WALK } });
    expect(why({ "u-m-mia": { coverPositions: [I.$WALK] } }, "u-m-mia", I.$REG)[0]).toEqual({ key: "flexed", params: { userId: "u-m-mia", positionId: I.$REG, primaryId: I.$WALK } });
  });
  it("no primary set → no position reason (as before); a manager never gets one", () => {
    const keys = (r: Array<{ key: string }>) => r.map((x) => x.key);
    for (const k of ["on_primary", "on_secondary", "flexed"]) {
      expect(keys(why({}, "u-m-mia", I.$REG))).not.toContain(k);
      expect(keys(why({}, "u-g-gus", I.$EXPO))).not.toContain(k);
    }
  });
});

// ─── Manager behaviour pinned ────────────────────────────────────────────────

describe("manager behaviour is unchanged (regression pin)", () => {
  it("cover_outside_preferences: a manager off their cover list is an error unless marked last resort; a non-manager with a list never is", () => {
    const { b } = ctxWith();
    const dayCtx = b.ctx.days[MON]!;
    const gus = { ...b.people["u-g-gus"]! };
    expect(segmentHoldProblems(gus, I.$WALKON, { startQ: 44, endQ: 60 }, dayCtx).map((x) => x.code)).toContain("cover_outside_preferences");
    expect(segmentHoldProblems(gus, I.$WALKON, { startQ: 44, endQ: 60, lastResort: true }, dayCtx).map((x) => x.code)).not.toContain("cover_outside_preferences");
    expect(segmentHoldProblems(gus, I.$REG, { startQ: 44, endQ: 60 }, dayCtx).map((x) => x.code)).not.toContain("cover_outside_preferences");
    const mia = { ...b.people["u-m-mia"]!, coverPositions: [I.$REG] };
    expect(segmentHoldProblems(mia, I.$WALK, { startQ: 44, endQ: 60 }, dayCtx).map((x) => x.code)).not.toContain("cover_outside_preferences");
  });
  it("the MoD cover order: the salaried manager on the MoD lane covers from their list, by list order, then skill (carved from the MoD block)", () => {
    const { b, week } = ctxWith();
    const gm = b.people["u-j-gm"]!;
    expect(gm.coverPositions).toEqual([I.$PREP, I.$EXPO, I.$REG]);
    const mod: GShift = { userId: "u-j-gm", date: MON, startQ: 28, endQ: 60, segments: [{ positionId: MOD, startQ: 28, endQ: 60, reasons: [] }], closingManager: false, flex: false, pinned: false, reasons: [], origin: "salaried" };
    week.built[MON] = [mod];
    // Register is #3 on the GM's list: "manager_cover" citing rank 3, never last resort; Walk-ins / Online (off the list) only as
    // a last resort. (Both are pair primaries, so no secondary-without-primary.)
    expect(coverWithManager(b, week, MON, I.$REG, 44, 48)).toBe(true);
    const seg = week.built[MON]![0]!.segments.find((g) => g.positionId === I.$REG)!;
    expect(seg.reasons[0]).toEqual({ key: "manager_cover", params: { positionId: I.$REG, fromQ: 44, toQ: 48, rank: 3 } });
    expect(seg.lastResort).toBeUndefined();
    expect(coverWithManager(b, week, MON, I.$WALKON, 50, 54)).toBe(true);
    const walk = week.built[MON]![0]!.segments.find((g) => g.positionId === I.$WALKON)!;
    expect(walk.reasons[0]!.key).toBe("manager_cover_last_resort");
    expect(walk.lastResort).toBe(true);
  });
});

// ─── A whole week ────────────────────────────────────────────────────────────

describe("a whole week with primaries: validator-clean, deterministic, the primary holder on their primary", () => {
  const specs: PersonSpec[] = [...SMALL_SPECS, ...H9_EXTRA].map((s) => (s.id === "u-m-mia" ? { ...s, cover: [I.$REG] } : s.id === "u-n-noe" ? { ...s, cover: [I.$WALK, I.$REG] } : s));
  const input = () => fixture({ specs, days: DATES.slice(0, 3).map((d) => day(d)) });
  it("no error, byte-identical twice, permutation-invariant; Mia's hours land on Register and every reason is one of the three", () => {
    const out = buildWeek(input());
    expect(out.problems.filter((p) => p.severity === "error" && !p.inherited)).toEqual([]);
    expect(canonicalJson(buildWeek(input()))).toBe(canonicalJson(out));
    const reversed = input();
    reversed.people = [...reversed.people].reverse();
    expect(canonicalJson(buildWeek(reversed))).toBe(canonicalJson(out));
    const mia = out.shifts.filter((x) => x.userId === "u-m-mia");
    expect(mia.length).toBeGreaterThan(0);
    const onReg = mia.flatMap((x) => x.segments).filter((g) => g.positionId === I.$REG).reduce((n, g) => n + g.endQ - g.startQ, 0);
    const total = mia.flatMap((x) => x.segments).reduce((n, g) => n + g.endQ - g.startQ, 0);
    expect(onReg / total).toBeGreaterThan(0.5);
    const keys = new Set(Object.values(out.reasons).flatMap((r) => r.shift.map((x) => x.key)));
    expect(keys.has("on_primary")).toBe(true);
  });
});
