/**
 * Scheduling Phase 1, Task 11 — the ONE people fact loader and the pure performance rules.
 *
 * - A pure rule refuses to compute from a family that was not loaded (`fact_family_not_loaded`)
 *   or outside the loaded window (`fact_window_not_loaded`): a missing load fails loudly.
 * - A compare loads ONCE over the union of its windows and computes twice; the numbers equal two
 *   separate loads, including a task first completed in the previous window and again in the
 *   current one (it counts in BOTH windows, as the two legacy loads counted it).
 * - The loader reads only the families asked for.
 * - `PeopleInputs`: every new input is OFF in `LEGACY_INPUTS`.
 * - `Viewer.role` is REQUIRED (a type-level check, enforced by tsc).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { loadPeopleFacts } from "@/lib/people/facts";
import {
  emptyPeopleFacts, FactFamilyNotLoadedError, LEGACY_PERSON_FAMILIES, LEGACY_TEAM_FAMILIES, unionWindow, type FactWindow,
} from "@/lib/people/facts-shared";
import { LEGACY_INPUTS } from "@/lib/people/inputs-shared";
import { personMetrics, teamWindow, type PeopleWindow, type RosterMember } from "@/lib/people/performance-shared";
import { reportTimestampBounds } from "@/lib/report-range";
import { bucketStart, clippedBucketKeys } from "@/lib/reports-trends";
import type { Viewer } from "@/lib/team-metrics";

const SHOP = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";

const win = (from: string, to: string): PeopleWindow => ({
  bounds: reportTimestampBounds(from, to), dates: { from, to }, granularity: "day",
  keys: clippedBucketKeys(from, to, "day"), bucketOf: (d) => bucketStart(d, "day"),
});
const CUR = win("2026-10-08", "2026-10-14");
const PREV = win("2026-10-01", "2026-10-07");
const roster: RosterMember[] = [{ userId: EMP, name: "Ana", role: "employee", level: 3 }];

function tables(): Tables {
  return {
    checklist_instances: [
      { id: "i1", location_id: SHOP, date: "2026-10-03", confirmed_by: null, confirmed_at: null },
      { id: "i2", location_id: SHOP, date: "2026-10-10", confirmed_by: EMP, confirmed_at: "2026-10-10T22:00:00.000Z" },
    ],
    // The SAME task (i1 / item t1) completed in the previous window, then again in the current one.
    checklist_completions: [
      { id: "c1", instance_id: "i1", template_item_id: "t1", completed_by: EMP, completed_at: "2026-10-03T15:00:00.000Z", notes: null, superseded_at: null, revoked_at: null },
      { id: "c2", instance_id: "i1", template_item_id: "t1", completed_by: EMP, completed_at: "2026-10-09T15:00:00.000Z", notes: "fixed it", superseded_at: null, revoked_at: null },
      { id: "c3", instance_id: "i2", template_item_id: "t2", completed_by: EMP, completed_at: "2026-10-10T15:00:00.000Z", notes: null, superseded_at: null, revoked_at: null },
    ],
    cash_reports: [], pm_reports: [], pm_employee_evals: [], audit_log: [],
  };
}

describe("the pure rules refuse what was not loaded", () => {
  it("fact_family_not_loaded: a team rule over a fact set with no families", () => {
    const facts = emptyPeopleFacts(SHOP, { kind: "team", memberIds: [EMP] }, CUR);
    let err: unknown = null;
    try { teamWindow(facts, roster, CUR); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(FactFamilyNotLoadedError);
    expect((err as Error).message).toBe("fact_family_not_loaded");
  });

  it("fact_window_not_loaded: a window outside the load", async () => {
    const db = createFakeDb(tables());
    const facts = await loadPeopleFacts(db.client as unknown as SupabaseClient, {
      locationId: SHOP, subject: { kind: "team", memberIds: [EMP] }, window: CUR, families: LEGACY_TEAM_FAMILIES,
    });
    expect(() => teamWindow(facts, roster, PREV)).toThrow("fact_window_not_loaded");
  });

  it("person rules need a person load", async () => {
    const db = createFakeDb(tables());
    const facts = await loadPeopleFacts(db.client as unknown as SupabaseClient, {
      locationId: SHOP, subject: { kind: "team", memberIds: [EMP] }, window: CUR, families: LEGACY_TEAM_FAMILIES,
    });
    expect(() => personMetrics(facts, { role: "employee", createdAt: "2026-01-01T00:00:00Z" }, CUR, "2026-10-14")).toThrow("fact_family_not_loaded");
  });
});

describe("a compare loads once over the union and computes twice — equal to two loads", () => {
  const load = async (subject: Parameters<typeof loadPeopleFacts>[1]["subject"], window: FactWindow, families: typeof LEGACY_TEAM_FAMILIES) =>
    loadPeopleFacts(createFakeDb(tables()).client as unknown as SupabaseClient, { locationId: SHOP, subject, window, families });

  it("team: each window from the union load equals its own load (the repeated task counts in both)", async () => {
    const team = { kind: "team" as const, memberIds: [EMP] };
    const union = await load(team, unionWindow(CUR, PREV), LEGACY_TEAM_FAMILIES);
    for (const w of [CUR, PREV]) {
      expect(teamWindow(union, roster, w)).toEqual(teamWindow(await load(team, w, LEGACY_TEAM_FAMILIES), roster, w));
    }
    expect(teamWindow(union, roster, CUR).members[0]!.counts.tasks).toBe(2);
    expect(teamWindow(union, roster, PREV).members[0]!.counts.tasks).toBe(1);
  });

  it("person: the union load gives the same metrics as two loads, previous score included", async () => {
    const person = { kind: "person" as const, personId: EMP };
    const who = { role: "employee" as const, createdAt: "2026-01-01T00:00:00Z" };
    const union = await load(person, unionWindow(CUR, PREV), LEGACY_PERSON_FAMILIES);
    const two = personMetrics(await load(person, CUR, LEGACY_PERSON_FAMILIES), who, CUR, "2026-10-14");
    const prevScore = personMetrics(await load(person, PREV, LEGACY_PERSON_FAMILIES), who, PREV, "2026-10-14").score;
    const once = personMetrics(union, who, CUR, "2026-10-14", PREV);
    expect(once).toEqual({ ...two, previousScore: prevScore, scoreDeltaPct: once.scoreDeltaPct });
    expect(once.counts.tasks).toBe(2);
    expect(once.counts.notes).toBe(1);
    expect(once.previousScore).toBe(prevScore);
  });
});

describe("the loader reads only what it is asked for", () => {
  it("a completions-only load reads instances and completions, nothing else", async () => {
    const db = createFakeDb(tables());
    const facts = await loadPeopleFacts(db.client as unknown as SupabaseClient, {
      locationId: SHOP, subject: { kind: "team", memberIds: [EMP] }, window: CUR, families: ["completions"],
    });
    expect([...new Set(db.log.map((l) => l.table))]).toEqual(["checklist_instances", "checklist_completions"]);
    expect([...facts.loaded].sort()).toEqual(["completions", "instances"]);
    expect(db.writes).toEqual([]);
  });

  it("person-only families refuse a team load", async () => {
    const db = createFakeDb(tables());
    for (const family of ["confirmations", "pmGrades", "mvps"] as const) {
      await expect(loadPeopleFacts(db.client as unknown as SupabaseClient, {
        locationId: SHOP, subject: { kind: "team", memberIds: [EMP] }, window: CUR, families: [family],
      })).rejects.toThrow(/need_a_person/);
    }
  });
});

describe("PeopleInputs and the trusted role", () => {
  it("LEGACY_INPUTS switches every new input off, and cannot be mutated", () => {
    expect(LEGACY_INPUTS).toEqual({ pmV2: false });
    expect(Object.isFrozen(LEGACY_INPUTS)).toBe(true);
  });

  it("Viewer.role is required (tsc enforces the line below)", () => {
    // @ts-expect-error — a viewer without its trusted role does not compile (r1 P2-8).
    const v: Viewer = { userId: EMP, level: 6, locations: [SHOP] };
    expect(v.level).toBe(6);
  });
});
