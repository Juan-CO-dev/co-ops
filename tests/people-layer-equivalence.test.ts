/**
 * Scheduling Phase 1 — THE PEOPLE-LAYER EQUIVALENCE PIN (plan Task 1).
 *
 * Team scoring, person detail, My Performance, the person's report shops, the public profile, the
 * directory, My feedback and the export's team section must stay BYTE-IDENTICAL to what today's
 * code produced on this synthetic fixture — through the refactor onto one fact loader (Tasks
 * 11–13) and, with every new input switched OFF, after PM v2 and skills land (Task 23). The fixture
 * already holds rows in the new tables, so "off ⇒ identical" is proven over a database that has them.
 *
 * Frozen 2026-10-15 on feat/scheduling-phase1 @ f1555511 (origin/main 55716e3f merged, so the
 * post-0267_pm_evals_privacy library behaviour is what is recorded), with no lib/ file touched.
 *
 * Regenerate ONLY in Task 1 or with a written reason in the PR:
 *   UPDATE_PEOPLE_LAYER_GOLDEN=1 npx vitest run tests/people-layer-equivalence.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildPeopleLayerFixture, LOC_A, LOC_B, TODAY, U } from "./fixtures/people-layer-fixture";
import { computePeopleOutputs, liveApi, type PeopleOutputs } from "./fixtures/people-layer-harness";
import { withPmV2Rows } from "./fixtures/people-layer-pm-v2";
import { resolveTrendRange, type TrendGranularity } from "@/lib/reports-trends";
import { etCalendarDate } from "@/lib/operational-day";

const GOLDEN = "tests/fixtures/people-layer-golden.json";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => { current = createFakeDb(buildPeopleLayerFixture()); });
afterEach(() => { current = null; });

const golden = (): PeopleOutputs => JSON.parse(readFileSync(GOLDEN, "utf8")) as PeopleOutputs;

describe("the people layer is identical to today (the golden)", () => {
  it("matches the frozen golden for every loader, viewer, shop and window", async () => {
    const got = await computePeopleOutputs(liveApi, buildPeopleLayerFixture(), current!.client);
    if (process.env.UPDATE_PEOPLE_LAYER_GOLDEN === "1") writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(existsSync(GOLDEN), "golden missing — run Task 1 Step 5").toBe(true);
    expect(got).toEqual(golden());
    // …and no loader wrote anything: the read path is read-only.
    expect(current!.writes).toEqual([]);
  }, 180_000);
});

describe("the fixture is not trivial — anchors inside the golden", () => {
  type Team = { members: Array<{ userId: string; counts: Record<string, number>; score: number }> } | null;

  it("team scoring has members at both shops, with scores, for every viewer allowed to see them", () => {
    const g = golden();
    for (const loc of [LOC_A, LOC_B]) {
      const t = g[`team|moo|${loc}|week|cmp=false`] as Team;
      expect(t!.members.length).toBeGreaterThan(1);
      expect(t!.members.some((m) => m.score > 0)).toBe(true);
    }
    // The AGM and GM are bound to shop A: shop B is refused (null), today.
    expect(g[`team|agm|${LOC_B}|week|cmp=false`]).toBeNull();
    expect(g[`team|gm|${LOC_B}|week|cmp=false`]).toBeNull();
  });

  it("the roster excludes MoO+, deactivated users and inactive memberships", () => {
    const ids = (golden()[`team|moo|${LOC_A}|month|cmp=false`] as Team)!.members.map((m) => m.userId);
    expect(ids).not.toContain(U.moo);
    expect(ids).not.toContain(U.deactivated);
    expect(ids).not.toContain(U.inactiveMember);
    expect(ids).toContain(U.slBoth);
  });

  it("the both-shops SL's oversight is counted at each shop separately (the location bind)", () => {
    const g = golden();
    const at = (loc: string) => (g[`team|moo|${loc}|day|cmp=false`] as Team)!.members.find((m) => m.userId === U.slBoth)!.counts.oversight!;
    expect(at(LOC_A)).toBeGreaterThan(0);
    expect(at(LOC_B)).toBeGreaterThan(0);
  });

  it("person detail, My Performance, the profile, the directory and My feedback all carry data", () => {
    const g = golden();
    expect(g[`detail|moo|${U.emp}|${LOC_A}|week|cmp=true`]).not.toBeNull();
    expect(g[`detail|moo|${U.moo}|${LOC_A}|week|cmp=true`]).toBeNull(); // not rankable
    expect(g[`mine|${U.emp}|${LOC_A}|week|cmp=true`]).not.toBeNull();
    expect(g[`mine|${U.emp}|${LOC_B}|week|cmp=true`]).toBeNull(); // no membership at B
    expect((g[`profile|all|${U.emp}`] as { tasksAllTime: number }).tasksAllTime).toBeGreaterThan(0);
    expect(g[`profile|oneShopB|${U.emp}`]).toBeNull(); // no shared shop
    expect((g[`directory|all`] as { staff: unknown[]; leadership: unknown[] }).leadership.length).toBeGreaterThan(0);
    expect((g[`myFeedback|${U.empB}`] as unknown[]).length).toBeGreaterThan(0);
    expect((g[`export.team|gm|${LOC_A}|week-default`] as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });

  it("My feedback never carries a manager's note (post-0267)", () => {
    expect(JSON.stringify(golden()[`myFeedback|${U.empB}`])).not.toContain("manager-only note");
  });
});

// ─── Task 23: PM v2 grades feed the people layer, behind the per-shop switch ─────────────────────────────────

type Counts = Record<string, number>;
type Tally = { great: number; good: number; needsWork: number };
const windowOf = (g: TrendGranularity, compare: boolean) => resolveTrendRange({ compare: compare ? "1" : "0" }, TODAY, g);
const inDates = (day: string, r: { from: string; to: string }) => day >= r.from && day <= r.to;

describe("Task 23 (a): the switch OFF ⇒ the golden, byte-identical, with PM v2 rows present", () => {
  it("no settings row at one shop, pm_v2 = false at the other, v2 days + copies + grades + notes everywhere", async () => {
    const o = withPmV2Rows(buildPeopleLayerFixture(), [{ location_id: LOC_A, pm_v2: false }]);
    current = createFakeDb(o.tables);
    const got = await computePeopleOutputs(liveApi, o.tables, current.client);
    expect(got).toEqual(golden());
    expect(current.writes).toEqual([]);
  }, 180_000);
});

describe("Task 23 (b): the switch ON for LOC_A only moves LOC_A, by exactly the v2 grades and notes", () => {
  it("LOC_B and every shop-less output are byte-identical; LOC_A gains the v2 gradients and the authors' notes", async () => {
    const o = withPmV2Rows(buildPeopleLayerFixture(), [{ location_id: LOC_A, pm_v2: true }, { location_id: LOC_B, pm_v2: false }]);
    current = createFakeDb(o.tables);
    const got = await computePeopleOutputs(liveApi, o.tables, current.client);
    const g = golden();
    expect(Object.keys(got).sort()).toEqual(Object.keys(g).sort());
    expect(current.writes).toEqual([]);

    let moved = 0;
    for (const key of Object.keys(g)) {
      if (!key.includes(LOC_A)) { expect(got[key], key).toEqual(g[key]); continue; }
      if (g[key] === null) { expect(got[key], key).toBeNull(); continue; }
      const parts = key.split("|");
      const kind = parts[0]!;
      if (kind === "team") {
        // team|viewer|loc|grain|cmp=… ; the custom range (2026-09-14..10-03) holds no v2 day.
        const [, , , grain, cmp] = parts;
        const range = grain === "custom" ? { from: "2026-09-14", to: "2026-10-03" } : windowOf(grain as TrendGranularity, cmp === "cmp=true");
        type T = { members: Array<{ userId: string; counts: Counts }> };
        const before = g[key] as T, after = got[key] as T;
        expect(after.members.map((m) => m.userId).sort(), key).toEqual(before.members.map((m) => m.userId).sort());
        for (const m of before.members) {
          const now = after.members.find((x) => x.userId === m.userId)!;
          const extra = (o.notesA[m.userId] ?? []).filter((n) => inDates(etCalendarDate(n.submittedAt), range)).length;
          expect(now.counts, `${key} ${m.userId}`).toEqual({ ...m.counts, notes: m.counts.notes! + extra });
          if (extra) moved++;
        }
      } else if (kind === "detail" || kind === "mine") {
        // detail|moo|person|loc|grain|cmp=…  ·  detail|moo|person|loc|custom  ·  mine|person|loc|grain|cmp=…
        const person = kind === "detail" ? parts[2]! : parts[1]!;
        const grain = kind === "detail" ? parts[4]! : parts[3]!;
        const cmp = kind === "detail" ? parts[5] : parts[4];
        const range = grain === "custom" ? { from: "2026-09-01", to: "2026-09-30" } : windowOf(grain as TrendGranularity, cmp === "cmp=true");
        type P = { counts: Counts; gradientTally: Tally };
        const before = g[key] as P, after = got[key] as P;
        const grades = (o.gradesA[person] ?? []).filter((x) => inDates(x.date, range));
        const tally = { great: grades.filter((x) => x.grade === "great").length, good: grades.filter((x) => x.grade === "good").length, needsWork: grades.filter((x) => x.grade === "needs_work").length };
        const extra = (o.notesA[person] ?? []).filter((n) => inDates(etCalendarDate(n.submittedAt), range)).length;
        expect(after.gradientTally, key).toEqual({ great: before.gradientTally.great + tally.great, good: before.gradientTally.good + tally.good, needsWork: before.gradientTally.needsWork + tally.needsWork });
        if (before.counts) expect(after.counts, key).toEqual({ ...before.counts, notes: before.counts.notes! + extra }); // My Performance has no counts
        else if (!extra) expect((after as unknown as { score: number }).score, key).toBe((before as unknown as { score: number }).score);
        if (extra || grades.length) moved++;
      } else if (kind === "export.team") {
        expect((got[key] as { rows: unknown[] }).rows.length, key).toBe((g[key] as { rows: unknown[] }).rows.length);
      } else {
        expect(got[key], key).toEqual(g[key]); // reportLocations etc.: shop ids only, no numbers
      }
    }
    // The overlay is not trivial: the employee's v2 grades and both authors' notes really moved LOC_A numbers.
    expect(moved).toBeGreaterThan(20);
    const week = got[`detail|moo|${U.emp}|${LOC_A}|week|cmp=false`] as { gradientTally: Tally };
    const weekBefore = g[`detail|moo|${U.emp}|${LOC_A}|week|cmp=false`] as { gradientTally: Tally };
    expect(week.gradientTally.great - weekBefore.gradientTally.great).toBe(4); // 2 days × (GM great + KH great); the open day and the superseded grade never count
    expect(week.gradientTally.needsWork - weekBefore.gradientTally.needsWork).toBe(2);
  }, 180_000);
});
