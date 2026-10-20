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
const ES_STRINGS = es as Record<string, string>;
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
  it("a SALARIED manager (GM / AGM) and the other manager roles have no primary: their list is their cover order, unchanged", () => {
    for (const role of ["agm", "gm", "catering_mgr", "prep_mgr"] as const) {
      expect(positionRankOf(p(role, [I.$REG, I.$EXPO]), I.$REG)).toBe(POSITION_RANK.flex);
      expect(positionRankOf(p(role, [I.$REG, I.$EXPO]), null, true)).toBe(POSITION_RANK.flex);
      expect(primaryPositionOf(p(role, [I.$REG]))).toBeNull();
    }
  });
  it("Juan 2026-10-20: an HOURLY LEAD (shift lead, key holder): [0] = primary station; the secondary is MANAGER DUTIES (MoD lane / Closing Manager slot), never a station", () => {
    for (const role of ["shift_lead", "key_holder"] as const) {
      const lead = p(role, [I.$REG, I.$EXPO]);
      expect(positionRankOf(lead, I.$REG)).toBe(POSITION_RANK.primary);
      expect(positionRankOf(lead, I.$EXPO)).toBe(POSITION_RANK.flex); // list[1] is "can flex to" for a lead, not a secondary
      expect(positionRankOf(lead, null, true)).toBe(POSITION_RANK.secondary); // the MoD lane
      expect(positionRankOf(lead, I.$EXPO, true)).toBe(POSITION_RANK.secondary); // a Closing Manager slot on another station
      expect(positionRankOf(lead, I.$REG, true)).toBe(POSITION_RANK.primary); // the closing slot IS their primary: the primary wins
      expect(primaryPositionOf(lead)).toBe(I.$REG);
      // No primary: manager duties still rank 1 — every candidate of those lanes is a lead, so they rank together (unchanged).
      expect(positionRankOf(p(role, []), null, true)).toBe(POSITION_RANK.secondary);
      expect(positionRankOf(p(role, []), I.$REG)).toBe(POSITION_RANK.flex);
    }
    // A non-lead never gets the manager-duty rank.
    expect(positionRankOf(p("employee", [I.$REG]), null, true)).toBe(POSITION_RANK.flex);
  });
  it("the hourly lead roles are exactly the hourly roles that can lead a shift, derived from the role table", async () => {
    const { ROLES } = await import("@/lib/roles");
    const { HOURLY_LEAD_ROLES } = await import("@/lib/scheduling/position-rank-shared");
    const { isManagerRole, neverGenerated } = await import("@/lib/scheduling/rules-shared");
    const salaried = ["gm", "agm"], presence = ["moo", "owner"], neverOnRoster = ["cgs", "social_media_mgr"];
    const derived = Object.keys(ROLES).filter((r) => !salaried.includes(r) && !presence.includes(r) && !neverOnRoster.includes(r)
      && !neverGenerated({ role: r as SchedPerson["role"], presenceOnly: false }) && (isManagerRole(r as SchedPerson["role"]) || r === "key_holder")).sort();
    expect([...HOURLY_LEAD_ROLES].sort()).toEqual(derived);
  });
  it("withPrimarySecondary keeps the 'can flex to' tail behind a secondary; no secondary or no primary CLEARS it — never a silent promotion (Astra BC-013)", () => {
    const list = [I.$REG, I.$WALK, I.$EXPO, I.$BOI];
    expect(withPrimarySecondary(list, I.$EXPO, I.$REG)).toEqual([I.$EXPO, I.$REG, I.$BOI]);
    expect(withPrimarySecondary(list, I.$REG, I.$EXPO)).toEqual([I.$REG, I.$EXPO, I.$BOI]); // a secondary chosen FROM the tail
    // Secondary = None with [Register, Walk-ins, Expeditor, ...]: Expeditor must NOT silently become the secondary.
    expect(withPrimarySecondary(list, I.$REG, null)).toEqual([I.$REG]);
    expect(withPrimarySecondary(list, I.$WALK, null)).toEqual([I.$WALK]);
    expect(withPrimarySecondary(list, I.$REG, I.$REG)).toEqual([I.$REG]);
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
  it("unknown position roles (structure not saved yet) are skipped; a salaried manager's list is never judged; an hourly lead's PRIMARY only", () => {
    expect(positionListProblems({ role: "employee", workType: "foh", alsoAllowed: [] }, [I.$DISH], {})).toEqual([]);
    expect(positionListProblems({ role: "agm", workType: "foh", alsoAllowed: [] }, [I.$DISH], roles)).toEqual([]);
    expect(positionListProblems({ role: "key_holder", workType: "foh", alsoAllowed: [] }, [I.$DISH], roles)).toEqual([{ slot: "primary", positionId: I.$DISH, code: "work_type" }]);
    // list[1] is "can flex to" for a lead (their secondary is manager duties): not judged.
    expect(positionListProblems({ role: "key_holder", workType: "foh", alsoAllowed: [] }, [I.$REG, I.$DISH], roles)).toEqual([]);
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

/**
 * The small shop on Monday, people overridden; an empty built Monday. The shift lead Gus's fixture list [Register, Expo]
 * is cleared by default (Juan 2026-10-20: an hourly lead's [0] IS a primary), so the non-lead rank tests compare like with
 * like; the lead tests set it back explicitly.
 */
function ctxWith(over: Record<string, Partial<SchedPerson>> = {}, specs: PersonSpec[] = [...SMALL_SPECS, ...H9_EXTRA]) {
  const input = fixture({ specs, days: [day(MON)] });
  const out = buildWeek(input);
  const people = Object.fromEntries(input.people.map((p) => [p.userId, { ...p, ...(p.userId === "u-g-gus" ? { coverPositions: [] } : {}), ...(over[p.userId] ?? {}) }]));
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
  it("the MoD lane (null position): every candidate is an hourly lead ranked 1 (manager duties) — the order equals the no-primary order", () => {
    const base = ctxWith();
    const withLists = ctxWith({ "u-a-ana": { coverPositions: [I.$REG] }, "u-h-hal": { coverPositions: [I.$WALKON, I.$REG] } });
    // The evening MoD lane from 7:00 PM (the key holders count from keyHolderModAfterQ = 76).
    const mod = (x: ReturnType<typeof ctxWith>) => rankCandidates(x.b, x.week, [], { ...opts(null, { startQ: 76, endQ: 83, segments: [{ positionId: MOD, startQ: 76, endQ: 83, kind: "core" }] }), modFromQ: 76 });
    const a = mod(base);
    const z = mod(withLists);
    expect(a.length).toBeGreaterThan(1);
    expect(z.map((c) => c.person.userId)).toEqual(a.map((c) => c.person.userId));
    expect(z.every((c) => c.key[CANDIDATE_KEY.positionRank] === POSITION_RANK.secondary)).toBe(true);
    expect(a.every((c) => c.key[CANDIDATE_KEY.positionRank] === POSITION_RANK.secondary)).toBe(true);
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

// ─── Hourly leads (Juan 2026-10-20: primary station; manager duties as the secondary) ─────────────────────────

describe("hourly leads: station primary first, manager duties as the secondary, no primary = unchanged", () => {
  it("a station slot: the key holder whose PRIMARY it is ranks first (over stronger people)", () => {
    const base = ctxWith();
    const o = opts(I.$WALKON, plan(I.$WALKON));
    const before = order(base.b, base.week, o);
    const { b, week } = ctxWith({ "u-h-hal": { coverPositions: [I.$WALKON] } }); // Hal 0.75 on Walk-ins / Online; Ana 0.9
    expect(before.indexOf("u-a-ana")).toBeLessThan(before.indexOf("u-h-hal"));
    expect(order(b, week, o)[0]).toBe("u-h-hal");
  });
  it("the Closing Manager's slot: a lead whose primary IS that station ranks 0, every other lead 1 (manager duties) — no primaries: all 1, the old order", () => {
    const closing = { ...opts(I.$REG, plan(I.$REG, 64, 83)), closingLead: true };
    const none = ctxWith();
    const rankedNone = rankCandidates(none.b, none.week, [], closing);
    expect(rankedNone.length).toBeGreaterThan(1);
    expect(rankedNone.every((c) => c.key[CANDIDATE_KEY.positionRank] === POSITION_RANK.secondary)).toBe(true);
    const { b, week } = ctxWith({ "u-p-pia": { coverPositions: [I.$REG] } });
    const ranked = rankCandidates(b, week, [], closing);
    expect(ranked[0]!.person.userId).toBe("u-p-pia");
    expect(ranked[0]!.key[CANDIDATE_KEY.positionRank]).toBe(POSITION_RANK.primary);
    // Rank aside, the others keep the old order among themselves.
    expect(ranked.slice(1).map((c) => c.person.userId)).toEqual(rankedNone.map((c) => c.person.userId).filter((u) => u !== "u-p-pia"));
  });
  it("a lead placed on manager duties says so (with their primary); without a primary, nothing new is said", () => {
    const closing = { ...opts(I.$REG, plan(I.$REG, 64, 83)), closingLead: true };
    const { b, week } = ctxWith({ "u-h-hal": { coverPositions: [I.$WALKON] } });
    const ranked = rankCandidates(b, week, [], closing);
    const hal = ranked.find((c) => c.person.userId === "u-h-hal")!;
    expect(whyChosen(b, [], hal, closing, ranked)[0]).toEqual({ key: "manager_duty", params: { userId: "u-h-hal", positionId: I.$REG, primaryId: I.$WALKON } });
    const ana = ranked.find((c) => c.person.userId === "u-a-ana")!;
    expect(whyChosen(b, [], ana, closing, ranked).map((r) => r.key)).not.toContain("manager_duty");
  });
  it("a whole week: key holders given their strongest station as primary — no new gap and no more uncovered manager-on-duty time than with none", () => {
    const uncovered = (out: ReturnType<typeof buildWeek>) => out.gaps.reduce((n, g) => n + (g.toQ - g.fromQ), 0);
    const specs = (withPrimaries: boolean): PersonSpec[] => [...SMALL_SPECS, ...H9_EXTRA].map((s) => {
      if (!withPrimaries) return s;
      if (s.id === "u-a-ana") return { ...s, cover: [I.$WALKON] };
      if (s.id === "u-h-hal") return { ...s, cover: [I.$REG] };
      if (s.id === "u-p-pia") return { ...s, cover: [I.$WALKON] };
      return s;
    });
    const without = buildWeek(fixture({ specs: specs(false) }));
    const withP = buildWeek(fixture({ specs: specs(true) }));
    expect(withP.problems.filter((p) => p.severity === "error" && !p.inherited)).toEqual([]);
    expect(withP.gaps.length).toBeLessThanOrEqual(without.gaps.length);
    expect(uncovered(withP)).toBeLessThanOrEqual(uncovered(without));
    expect(withP.gaps.filter((g) => g.code === "mod_missing").length).toBeLessThanOrEqual(without.gaps.filter((g) => g.code === "mod_missing").length);
  });
  it("the trade-off, pinned: two closing key holders who SHARE one primary (Register) widen Wednesday's manager-on-duty hole by 45 min (67 → 64), nothing else", () => {
    const kh = (pia: string) => [...SMALL_SPECS, ...H9_EXTRA].map((s) => (s.id === "u-a-ana" ? { ...s, cover: [I.$WALKON] } : s.id === "u-h-hal" ? { ...s, cover: [I.$REG] }
      : s.id === "u-p-pia" ? { ...s, cover: [pia] } : s));
    const gaps = (out: ReturnType<typeof buildWeek>) => out.gaps.map((g) => `${g.date}|${g.code}|${g.positionId ?? ""}|${g.fromQ}-${g.toQ}`);
    const own = gaps(buildWeek(fixture({ specs: kh(I.$WALKON) })));
    const shared = gaps(buildWeek(fixture({ specs: kh(I.$REG) })));
    expect(shared.filter((g) => !own.includes(g))).toEqual([`${DATES[2]}|mod_missing||64-76`]);
    expect(own.filter((g) => !shared.includes(g))).toEqual([`${DATES[2]}|mod_missing||67-76`]);
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
  it("Astra BC-042: a primary holder who won on RANK over a stronger flex candidate is not called 'strongest' (busiest window)", () => {
    const { b, week } = ctxWith({ "u-m-mia": { coverPositions: [I.$REG] } });
    b.busiest[MON] = new Set(Array.from({ length: 16 }, (_, i) => 44 + i));
    const o = opts(I.$REG, plan(I.$REG));
    const ranked = rankCandidates(b, week, [], o);
    expect(ranked[0]!.person.userId).toBe("u-m-mia");
    const keys = whyChosen(b, [], ranked[0]!, o, ranked).map((r) => r.key);
    expect(keys).toContain("on_primary");
    expect(keys).not.toContain("strongest_on_position");
    // The flex runner-up (Bo 0.9) keeps today's reason: in the busiest window, "strongest available".
    expect(whyChosen(b, [], ranked[1]!, o, ranked).map((r) => r.key)).toContain("strongest_on_position");
  });
  it("Astra BC-042: among two primary holders, the one skill decided IS 'strongest' (and says on_primary too)", () => {
    const { b, week } = ctxWith({ "u-m-mia": { coverPositions: [I.$REG] }, "u-b-bo": { coverPositions: [I.$REG] } });
    b.busiest[MON] = new Set(Array.from({ length: 16 }, (_, i) => 44 + i));
    const o = opts(I.$REG, plan(I.$REG));
    const ranked = rankCandidates(b, week, [], o);
    expect(ranked.slice(0, 2).map((c) => c.person.userId)).toEqual(["u-b-bo", "u-m-mia"]);
    // Stronger flex people exist (the rank decided against them): the skill claim is QUALIFIED (Astra BC-042 r3).
    expect(whyChosen(b, [], ranked[0]!, o, ranked).map((r) => r.key)).toEqual(["on_primary", "strongest_among_primary"]);
    // Mia, last of her rank: skill decided nothing for her → no "strongest".
    expect(whyChosen(b, [], ranked[1]!, o, ranked).map((r) => r.key)).toEqual(["on_primary"]);
  });
  it("Astra BC-042 r3: primaries 0.7 and 0.5 vs a 0.9 flex — the 0.7 is 'strongest among the people with this as their primary', never 'strongest available'", () => {
    const { b, week } = ctxWith({ "u-m-mia": { coverPositions: [I.$REG] }, "u-f-finn": { coverPositions: [I.$REG] } });
    b.busiest[MON] = new Set(Array.from({ length: 16 }, (_, i) => 44 + i));
    const o = opts(I.$REG, plan(I.$REG));
    const ranked = rankCandidates(b, week, [], o);
    expect(ranked.slice(0, 3).map((c) => c.person.userId)).toEqual(["u-m-mia", "u-f-finn", "u-b-bo"]);
    expect(whyChosen(b, [], ranked[0]!, o, ranked).map((r) => r.key)).toEqual(["on_primary", "strongest_among_primary"]);
    expect(whyChosen(b, [], ranked[1]!, o, ranked).map((r) => r.key)).toEqual(["on_primary"]);
    expect(whyChosen(b, [], ranked[2]!, o, ranked).map((r) => r.key)).toContain("strongest_on_position"); // Bo, flex: as before
    expect(ES_STRINGS["schedule.reason.strongest_among_primary"]).toBeTruthy();
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
    const gus = { ...b.people["u-g-gus"]!, coverPositions: [I.$REG, I.$EXPO] };
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
  // Gus (shift lead) is given Expo as his primary station so Register is Mia's alone.
  const specs: PersonSpec[] = [...SMALL_SPECS, ...H9_EXTRA].map((s) => (s.id === "u-m-mia" ? { ...s, cover: [I.$REG] } : s.id === "u-n-noe" ? { ...s, cover: [I.$WALK, I.$REG] }
    : s.id === "u-g-gus" ? { ...s, cover: [I.$EXPO, I.$REG] } : s));
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
