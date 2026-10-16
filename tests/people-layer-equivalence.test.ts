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
import { buildPeopleLayerFixture, LOC_A, LOC_B, U } from "./fixtures/people-layer-fixture";
import { computePeopleOutputs, liveApi, type PeopleOutputs } from "./fixtures/people-layer-harness";

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
