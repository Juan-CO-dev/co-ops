/**
 * Scheduling Phase 2, Task 3 Step 3 — PARITY WITH JUAN'S APPROVED MOCKUP v17 (plan "Parity with the
 * mockup", r2: per-violation, not aggregate counts). The fixture is the read-only vm export of the
 * page (scripts/schedule-mockup-export.cjs → tests/fixtures/schedule/mockup-v17-week.json), mapped
 * onto the validator's types by tests/fixtures/schedule/mockup-v17-map.ts. The app never imports the
 * mockup.
 *
 *   1. The clean fixture: the sample week breaks NO mockup check — error-clean under the mockup's own
 *      invariants. Under the full Phase 2 rules (the mockup's head counts as the need, its MoD flag
 *      on), the only errors are UNDECLARED deficits the mockup never checks: they are pinned below as
 *      a finding (the v17 builder leaves them silently; the Phase 2 generator must declare and certify
 *      each one or fill it).
 *   2. Each negative control of the mockup's harness: every mockup message is matched ONE-TO-ONE to
 *      a problem of the mapped code at the same subject (person and day; position and slot), and we
 *      report nothing of a mockup code that the mockup does not. Exact counts only for (h), where
 *      both validators report per slot.
 *   3. Deterministic diagnostics.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScheduleRules, type RuleCode, type RuleProblem } from "@/lib/scheduling/rules-shared";
import { validScheduleStructure } from "@/lib/scheduling/structure-shared";
import { DAY_LABEL, MOCK, dateOf, mockContext, mockStructure, mockWeek, type MockShift } from "./fixtures/schedule/mockup-v17-map";

/** The codes the mockup's `checkInvariants` covers (a–i, the two structural checks, unknown person). */
const MOCKUP_CODES: readonly RuleCode[] = [
  "person_overlap", "position_over_headcount", "shift_below_minimum", "role_not_allowed", "manager_on_boh", "segment_outside_window",
  "closing_manager_role", "leader_setting", "closing_manager_setting", "secondary_without_primary", "cover_outside_preferences",
  "segments_malformed", "unknown_person",
];

/** Message → code, by the mockup's own wording (test-only parsing of the mockup's output). */
const MESSAGE_CODE: Array<[RegExp, RuleCode]> = [
  [/: shift under .* minimum$/, "shift_below_minimum"],
  [/: .* is not allowed on /, "role_not_allowed"],
  [/: manager on Prep\/Dishwasher without call-out last resort$/, "manager_on_boh"],
  [/: manager covers .* outside preferred positions without last-resort reason$/, "cover_outside_preferences"],
  [/: leader setting .* violated$/, "leader_setting"],
  [/: Closing Manager setting does not allow closing$/, "closing_manager_setting"],
  [/: Closing Manager role not permitted$/, "closing_manager_role"],
  [/ outside open–close window$/, "segment_outside_window"],
  [/: overlaps /, "person_overlap"],
  [/: \d+ people, limit \d+$/, "position_over_headcount"],
  [/: secondary filled without /, "secondary_without_primary"],
  [/: segments do not span shift$|: segment gap or overlap$/, "segments_malformed"],
  [/: unknown person$/, "unknown_person"],
];
/** The mockup's position NAMES in its messages → its position ids (parsing the mockup's text only). */
const NAME_TO_ID: Record<string, string> = {
  "Crunchy Boi Station": "boi", "3rd Party Station": "third", "Walk-ins": "walk", "Walk-ins / Online": "hybrid",
  Expeditor: "expo", "Register & Delivery": "register", Prep: "prep", "Prep/Dishwasher": "prepDish",
};
const LABEL_TO_DATE = Object.fromEntries(Object.entries(DAY_LABEL).map(([d, l]) => [l, d]));
const wallQ = (t: string) => {
  const m = /^(\d{1,2})(?::(\d{2}))?([ap])$/.exec(t)!;
  return ((Number(m[1]) % 12) + (m[3] === "p" ? 12 : 0)) * 4 + Number(m[2] ?? 0) / 15;
};

/** A subject both sides can name: a person on a day, or a position at a slot. */
function mockSubject(message: string): { code: RuleCode; key: string } {
  const code = MESSAGE_CODE.find(([re]) => re.test(message))?.[1];
  if (!code) throw new Error(`unmapped mockup message: ${message}`);
  if (code === "secondary_without_primary" || code === "position_over_headcount") {
    const m = /^(\w{3}) (.+) (\d{1,2}(?::\d{2})?[ap]): /.exec(message)!;
    return { code, key: `${LABEL_TO_DATE[m[1]!]}|${NAME_TO_ID[m[2]!]}|${wallQ(m[3]!)}` };
  }
  const m = /^(\w{3}) (\S+) /.exec(message)!;
  return { code, key: `${LABEL_TO_DATE[m[1]!]}|${m[2]!.toLowerCase()}` };
}
function ourSubject(p: RuleProblem): { code: RuleCode; key: string } {
  if (p.code === "secondary_without_primary" || p.code === "position_over_headcount") return { code: p.code, key: `${p.day}|${p.positionId}|${p.q}` };
  return { code: p.code, key: `${p.day}|${p.userId}` };
}
const tally = (xs: Array<{ code: string; key: string }>) => xs.map((x) => `${x.code} @ ${x.key}`).sort();
const mockupView = (ps: RuleProblem[]) => ps.filter((p) => MOCKUP_CODES.includes(p.code));

describe("the export is the approved v17 sample week", () => {
  it("78 shifts, 82 segments, 2 multi-segment, 7 Closing Manager flags, checkInvariants = 0; the header names the source SHA-256", () => {
    expect(MOCK.shifts).toHaveLength(78);
    expect(MOCK.shifts.reduce((n, s) => n + (s.segments?.length ?? 1), 0)).toBe(82);
    expect(MOCK.shifts.filter((s) => (s.segments?.length ?? 1) > 1)).toHaveLength(2);
    expect(MOCK.shifts.filter((s) => s.closingManager)).toHaveLength(7);
    expect(MOCK.sampleProblems).toEqual([]);
    const header = JSON.parse(readFileSync("tests/fixtures/schedule/mockup-v17-week.json", "utf8"))._header;
    expect(header.sha256).toMatch(/^[0-9a-f]{64}$/);
    // When the mockup file is present (the CO desktop), it is still exactly what was exported.
    let source: Buffer | null = null;
    try { source = readFileSync("C:/co/share/schedule-board/schedule-board.html"); } catch { source = null; }
    if (source) expect(createHash("sha256").update(source).digest("hex")).toBe(header.sha256);
  });

  it("the mapped mockup structure is a VALID schedule structure", () => {
    expect(validScheduleStructure(mockStructure())).toEqual({ ok: true });
  });
});

describe("1. the clean fixture", () => {
  it("under the mockup's own invariants (no need grid, no MoD lane) the sample week has 0 error-class problems", () => {
    const ctx = mockContext();
    for (const d of Object.values(ctx.days)) {
      d.structure.leadership.modRequired = false;
      for (const arr of Object.values(d.need.positions)) arr.fill(0);
    }
    const ps = checkScheduleRules(mockWeek(), ctx);
    expect(ps.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("under the full Phase 2 rules, no mockup check fails; the only errors are the undeclared deficits the mockup never checks (pinned finding)", () => {
    const ps = checkScheduleRules(mockWeek(), mockContext());
    expect(mockupView(ps)).toEqual([]);
    const errors = ps.filter((p) => p.severity === "error");
    expect([...new Set(errors.map((p) => p.code))]).toEqual(["undeclared_gap"]);
    const byKind = (gap: string) => errors.filter((p) => p.params.gap === gap).map((p) => `${MOCK.days[Object.values(DAY_LABEL).indexOf(DAY_LABEL[p.day]!)]} ${p.positionId ?? "MoD"} ${p.params.fromQ}-${p.params.toQ}`);
    // The evening MoD lane is empty every day (the closers are Key Holders; every manager opens).
    expect(byKind("mod_missing")).toEqual(["Mon MoD 60-83", "Tue MoD 66-83", "Wed MoD 66-83", "Thu MoD 66-83", "Fri MoD 66-83", "Sat MoD 66-83", "Sun MoD 66-83"]);
    expect(errors.filter((p) => p.params.gap === "coverage_gap")).toHaveLength(32);
    expect(ps.filter((p) => p.severity === "warning").map((p) => p.code)).toEqual(["overtime", "overtime"]);
  });
});

describe("2. each mockup check is detected at its subject, one-to-one", () => {
  const baseline = MOCK.shifts;
  const check = (list: readonly MockShift[]) => mockupView(checkScheduleRules(mockWeek(list), mockContext()));

  it("the short Pete shift (Owner, Prep/Dishwasher, Wed 5:30–6:00 PM): exactly the mockup's four messages", () => {
    const { added, messages } = MOCK.controls.short_pete;
    expect(messages).toHaveLength(4);
    const ours = check([...baseline, ...added]);
    expect(tally(ours.map(ourSubject))).toEqual(tally(messages.map(mockSubject)));
    expect(ours.map((p) => [p.code, p.userId, p.day, p.positionId ?? null, p.q]).sort()).toEqual([
      ["cover_outside_preferences", "pete", dateOf(2), "prepDish", 70],
      ["manager_on_boh", "pete", dateOf(2), "prepDish", 70],
      ["role_not_allowed", "pete", dateOf(2), "prepDish", 70],
      ["shift_below_minimum", "pete", dateOf(2), null, 70],
    ]);
  });

  it("(g) Dani — Opens only, extended to scheduled out on Manager on duty: leader_setting at (dani, that day)", () => {
    const { list, messages } = MOCK.controls.g_dani;
    const ours = check(list);
    expect(tally(ours.map(ourSubject))).toEqual(tally(messages.map(mockSubject)));
    expect(ours.map((p) => [p.code, p.userId])).toEqual([["leader_setting", "dani"]]);
  });

  it("(h) the primary Walk-ins / Online removed: secondary_without_primary at EVERY (day, slot) the mockup lists — exact count", () => {
    const { removedIds, messages } = MOCK.controls.h_without_primary;
    const ours = check(baseline.filter((s) => !removedIds.includes(s.id)));
    expect(messages).toHaveLength(26);
    expect(ours).toHaveLength(26);
    expect(tally(ours.map(ourSubject))).toEqual(tally(messages.map(mockSubject)));
  });

  it("(i) Alex on Walk-ins with an unmarked reason: cover_outside_preferences at (alex, walk), and the rest of the mockup's list", () => {
    const { list, messages } = MOCK.controls.i_alex;
    const ours = check(list);
    expect(tally(ours.map(ourSubject))).toEqual(tally(messages.map(mockSubject)));
    expect(ours.filter((p) => p.code === "cover_outside_preferences").map((p) => [p.userId, p.positionId])).toEqual([["alex", "walk"]]);
  });
});

describe("3. deterministic diagnostics", () => {
  it("the same input gives the same ordered problem list, byte-identical, twice", () => {
    const list = [...MOCK.shifts, ...MOCK.controls.short_pete.added];
    const a = JSON.stringify(checkScheduleRules(mockWeek(list), mockContext()));
    const b = JSON.stringify(checkScheduleRules(mockWeek([...list].reverse()), mockContext()));
    expect(b).toBe(a);
  });
});
