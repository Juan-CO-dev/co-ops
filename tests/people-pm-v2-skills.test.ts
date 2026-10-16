/**
 * Scheduling Phase 1, Task 23 (c) — PM v2 grades feed the position SKILLS.
 *
 * - observations come from SUBMITTED v2 days only (an open v2 day, a superseded grade, a "Didn't see" and a grade
 *   with no position never enter), valued by `tunables.gradeValue` and weighted by the minutes the grading copy
 *   observed the person at that position (Task 19's `observationMinutes`);
 * - independent of the gradientTally switch: the skills read PM v2 with NO settings row (switch off) — skills are
 *   a new view, not a legacy number;
 * - a PM v1 grade has no position and never enters a position skill (J6);
 * - one overlap: a v2 grade + a closing line + a prep batch for the same position on the same day add ONE
 *   quality day (P2-7);
 * - before 0271 is applied (no format column) the skills still load, with no PM evidence.
 */
import { describe, expect, it } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { emptyPmV2Facts } from "@/lib/people/facts-shared";
import { pmV2PositionGrades } from "@/lib/people/skill-matrix-shared";
import type { PositionInterval } from "@/lib/people/positions-shared";
import type { PeopleActor } from "@/lib/people/access-shared";

const { loadSkills } = await import("@/lib/people/skills");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GM = id(1), EMP = id(4), ST = id(12), P_WALK = id(23), P_EXPO = id(24);
const NOW = new Date("2026-10-15T20:00:00Z");
const gm: PeopleActor = { userId: GM, role: "gm", level: 7, locations: [A] };

function tables(opts: { v2Column?: boolean } = {}): Tables {
  const v2 = opts.v2Column !== false;
  const day = (idv: string, date: string, status: string, format: "v1" | "v2", loc = A) => ({
    id: idv, location_id: loc, report_date: date, status, submitted_by: status === "open" ? null : GM,
    submitted_at: status === "open" ? null : `${date}T23:50:00Z`, mvp_user_id: null, superseded_at: null, ...(v2 ? { format } : {}),
  });
  const t: Tables = {
    users: [{ id: GM, name: "Alex", role: "gm", active: true }, { id: EMP, name: "Eli", role: "employee", active: true }],
    user_locations: [{ user_id: GM, location_id: A, active: true }, { user_id: EMP, location_id: A, active: true }],
    stations: [{ id: ST, location_id: A, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true, usually_closes_at: "22:00:00" }],
    station_positions: [
      { id: P_WALK, station_id: ST, location_id: A, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true },
      { id: P_EXPO, station_id: ST, location_id: A, name: "Expeditor", name_es: "Expedidor", sort: 2, active: true },
    ],
    station_events: [
      { id: "e1", sequence: 1, location_id: A, business_date: "2026-10-14", user_id: EMP, station_id: ST, position_id: P_WALK, kind: "claim", at: "2026-10-14T20:00:00Z", source: "claimed", effective_at: null },
      { id: "e2", sequence: 2, location_id: A, business_date: "2026-10-14", user_id: EMP, station_id: null, position_id: null, kind: "release", at: "2026-10-15T02:30:00Z", source: null, effective_at: null },
      { id: "e3", sequence: 3, location_id: A, business_date: "2026-10-13", user_id: EMP, station_id: ST, position_id: P_WALK, kind: "claim", at: "2026-10-13T20:00:00Z", source: "claimed", effective_at: null },
      { id: "e4", sequence: 4, location_id: A, business_date: "2026-10-13", user_id: EMP, station_id: null, position_id: null, kind: "release", at: "2026-10-14T01:00:00Z", source: null, effective_at: null },
    ],
    checklist_templates: [{ id: "tA", location_id: A, type: "closing" }],
    checklist_instances: [{ id: "iA", location_id: A, template_id: "tA", date: "2026-10-14", dropped_at: null, shift_start_at: null, triggered_at: null }],
    checklist_template_items: [{ id: "li1", template_id: "tA", station: "Walk-ins", active: true }],
    checklist_completions: [{ id: "cc1", instance_id: "iA", template_item_id: "li1", completed_by: EMP, completed_at: "2026-10-15T02:10:00Z", superseded_at: null, revoked_at: null }],
    productions: [{ id: "pr1", location_id: A, output_item_id: "ham", produced_at: "2026-10-14T21:00:00Z", made_by: EMP, batches_made: 1, came_out_to: 10, yield_at_time: 10, superseded_at: null, revoked_at: null }],
    people_skill_adjustments: [], people_skill_ratings: [], people_skill_tunables: [],
    // NO people_shop_settings row for A: the PM v2 switch is OFF — the skills read PM v2 anyway.
    people_shop_settings: [],
    pm_reports: [
      day("d-sub", "2026-10-14", "submitted", "v2"),
      day("d-open", "2026-10-13", "open", "v2"),
      day("d-v1", "2026-10-12", "submitted", "v1"),
      day("d-other", "2026-10-14", "submitted", "v2", B),
    ],
    pm_employee_evals: [{ id: "ev1", pm_report_id: "d-v1", location_id: A, employee_id: EMP, arrived_ready: "great", attitude: "great", production: "great", team_player: "great", area_to_improve: null, note: null, superseded_at: null }],
    pm_report_copies: [
      { id: "c-sub", pm_report_id: "d-sub", location_id: A, author_id: GM, status: "sealed", observed_from: "2026-10-14T20:00:00Z", observed_to: "2026-10-14T23:00:00Z" },
      { id: "c-open", pm_report_id: "d-open", location_id: A, author_id: GM, status: "open", observed_from: "2026-10-13T20:00:00Z", observed_to: "2026-10-13T23:00:00Z" },
      { id: "c-other", pm_report_id: "d-other", location_id: B, author_id: GM, status: "sealed", observed_from: "2026-10-14T20:00:00Z", observed_to: "2026-10-14T23:00:00Z" },
    ],
    pm_copy_grades: [
      { id: "g1", copy_id: "c-sub", location_id: A, subject_id: EMP, position_id: P_WALK, criterion_id: "k1", grade: "great", superseded_at: null },
      { id: "g2", copy_id: "c-sub", location_id: A, subject_id: EMP, position_id: P_WALK, criterion_id: "k2", grade: null, superseded_at: null }, // Didn't see
      { id: "g3", copy_id: "c-sub", location_id: A, subject_id: EMP, position_id: P_WALK, criterion_id: "k3", grade: "needs_work", superseded_at: "2026-10-14T23:10:00Z" },
      { id: "g4", copy_id: "c-sub", location_id: A, subject_id: EMP, position_id: null, criterion_id: "k4", grade: "good", superseded_at: null }, // no position
      { id: "g5", copy_id: "c-open", location_id: A, subject_id: EMP, position_id: P_WALK, criterion_id: "k1", grade: "needs_work", superseded_at: null },
      { id: "g6", copy_id: "c-other", location_id: B, subject_id: EMP, position_id: P_WALK, criterion_id: "k1", grade: "needs_work", superseded_at: null },
    ],
    pm_copy_notes: [],
  };
  return t;
}
const service = (t: Tables) => Object.assign(createFakeDb(t).client, { rpc: async () => ({ data: null, error: null }) }) as unknown as Parameters<typeof loadSkills>[0];

describe("pmV2PositionGrades — pure", () => {
  const iv = (start: string, end: string, positionId: string, businessDate = "2026-10-14"): PositionInterval =>
    ({ locationId: A, businessDate, userId: EMP, stationId: ST, positionId, start, end, source: "claimed" });
  it("one per answered, positioned grade of a submitted day; weighted by the copy's observed minutes at that position", () => {
    const v2 = emptyPmV2Facts();
    v2.days = [{ id: "d", report_date: "2026-10-14", submitted_at: "2026-10-14T23:50:00Z" }];
    v2.copies = [{ id: "c", pm_report_id: "d", author_id: GM, observed_from: "2026-10-14T20:00:00Z", observed_to: "2026-10-14T23:00:00Z" }];
    v2.grades = [
      { id: "g1", copy_id: "c", subject_id: EMP, position_id: P_WALK, criterion_id: "k1", grade: "great" },
      { id: "g2", copy_id: "c", subject_id: EMP, position_id: P_WALK, criterion_id: "k2", grade: null },
      { id: "g3", copy_id: "c", subject_id: EMP, position_id: null, criterion_id: "k3", grade: "good" },
      { id: "g4", copy_id: "c", subject_id: EMP, position_id: P_EXPO, criterion_id: "k1", grade: "good" },
    ];
    const intervals = [iv("2026-10-14T21:00:00Z", "2026-10-14T22:00:00Z", P_WALK), iv("2026-10-14T22:00:00Z", "2026-10-15T01:00:00Z", P_EXPO),
      iv("2026-10-13T21:00:00Z", "2026-10-13T23:00:00Z", P_WALK, "2026-10-13")];
    expect(pmV2PositionGrades(v2, intervals)).toEqual([
      { id: "g1", day: "2026-10-14", subjectId: EMP, positionId: P_WALK, grade: "great", observedMinutes: 60 },
      { id: "g4", day: "2026-10-14", subjectId: EMP, positionId: P_EXPO, grade: "good", observedMinutes: 60 },
    ]);
  });
  it("a position the copy ADDED (no interval that day) counts the copy's whole window of presence", () => {
    const v2 = emptyPmV2Facts();
    v2.days = [{ id: "d", report_date: "2026-10-14", submitted_at: "2026-10-14T23:50:00Z" }];
    v2.copies = [{ id: "c", pm_report_id: "d", author_id: GM, observed_from: "2026-10-14T20:00:00Z", observed_to: "2026-10-14T23:00:00Z" }];
    v2.grades = [{ id: "g1", copy_id: "c", subject_id: EMP, position_id: P_EXPO, criterion_id: "k1", grade: "great" }];
    expect(pmV2PositionGrades(v2, [iv("2026-10-14T21:00:00Z", "2026-10-14T22:30:00Z", P_WALK)])[0]!.observedMinutes).toBe(90);
  });
});

describe("the skills read PM v2 — submitted days only, switch-independent, never v1", () => {
  it("Walk-ins: ONE pm observation (the submitted day's Great), with the closing line and the batch on the same day = ONE quality day", async () => {
    const r = await loadSkills(service(tables()), { actor: gm, locationId: A, personId: EMP, now: NOW });
    if (!r.available) throw new Error("unavailable");
    const walk = r.view.rows.find((x) => x.position.positionId === P_WALK)!;
    expect(walk.skill.perKind.pm).toMatchObject({ count: 1, mean: 1, days: 1 }); // gradeValue.great = 1; open day, v1, superseded, Didn't see, other shop: none
    expect(walk.skill.perKind.closeOnTime).toMatchObject({ count: 1 });
    expect(walk.skill.perKind.prepYield).toMatchObject({ count: 1 });
    expect(walk.skill.qualityDays).toBe(1);
    expect(walk.skill.evidence.map((e) => e.key)).toContain("people.skills.evidence.pm");
    const expo = r.view.rows.find((x) => x.position.positionId === P_EXPO)!;
    expect(expo.skill.perKind.pm).toBeNull();
  });

  it("before 0271 (no format column): the skills load, with no PM evidence", async () => {
    const t = tables({ v2Column: false });
    delete t.pm_report_copies; delete t.pm_copy_grades; delete t.pm_copy_notes;
    // PostgREST's answer to a filter on a column that does not exist yet.
    const missing: Record<string, unknown> = new Proxy({}, { get: (_o, k) => k === "then"
      ? (res: (v: unknown) => unknown) => res({ data: null, error: { code: "42703", message: "column pm_reports.format does not exist" } })
      : () => missing });
    const base = service(t) as unknown as { from: (x: string) => unknown };
    const real = base.from.bind(base);
    const svc = Object.assign(base, { from: (x: string) => (x === "pm_reports" ? missing : real(x)) }) as unknown as Parameters<typeof loadSkills>[0];
    const r = await loadSkills(svc, { actor: gm, locationId: A, personId: EMP, now: NOW });
    if (!r.available) throw new Error("unavailable");
    const walk = r.view.rows.find((x) => x.position.positionId === P_WALK)!;
    expect(walk.skill.perKind.pm).toBeNull();
    expect(walk.skill.qualityDays).toBe(1);
  });
});
