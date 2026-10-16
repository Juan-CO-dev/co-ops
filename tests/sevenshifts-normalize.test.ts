import { describe, expect, it } from "vitest";

import docExample from "./fixtures/sevenshifts/assignments-doc-example.json";
import { SEVENSHIFTS_RESOURCES } from "@/lib/sevenshifts/endpoints-shared";
import { MIRROR_WRITE_SPEC, MIRRORED_RESOURCES, assignmentEdgeKey } from "@/lib/sevenshifts/mirror-spec-shared";
import {
  normalizeAssignments,
  normalizeAvailabilities,
  normalizeDepartments,
  normalizeLaborSettings,
  normalizeLocations,
  normalizeRoles,
  normalizeShifts,
  normalizeTimeOff,
  normalizeTimePunches,
  normalizeUsers,
  normalizeWages,
} from "@/lib/sevenshifts/normalize-shared";
import { assignmentsSnapshot, wagesSnapshot } from "@/lib/sevenshifts/paginate-shared";
import * as normalizers from "@/lib/sevenshifts/normalize-shared";

// ─── Planted PII: none of these strings may appear anywhere in any normalized output ───
const PII = {
  email: "planted.person@example.test",
  mobile: "+1-202-555-0199",
  home: "+1-202-555-0142",
  birth: "1990-01-31",
  wage: "1999",
  tip: "777",
  note: "PLANTED-NOTE-do-not-store",
  comment: "PLANTED-COMMENT-do-not-store",
  reason: "PLANTED-REASON-do-not-store",
  statusMessage: "PLANTED-STATUS-MESSAGE",
  punchId: "PLANTED-PUNCH-4471",
};

const user = {
  id: 501, company_id: 1234, first_name: "Ana", last_name: "Ruiz", preferred_first_name: "Anita",
  email: PII.email, mobile_number: PII.mobile, home_number: PII.home, birth_date: PII.birth,
  punch_id: PII.punchId, employee_id: "EMP-12", type: "employee", active: true, hire_date: "2026-09-01",
  skill_level: 3, hourly_wage: Number(PII.wage), notes: PII.note, address: "1 Planted St",
  modified: "2026-10-14T15:00:00+00:00",
};
const shift = {
  id: 9001, user_id: 501, location_id: 4569, department_id: 7890, role_id: 2583, station_id: 77,
  start: "2026-10-14T14:00:00-04:00", end: "2026-10-14T20:00:00-04:00", draft: false, open: false, deleted: false,
  notes: PII.note, modified: "2026-10-13T12:00:00Z",
};
const punch = {
  id: 7001, user_id: 501, location_id: 4569, department_id: 7890, role_id: 2583, shift_id: 9001,
  clocked_in: "2026-10-14T13:58:00Z", clocked_out: "2026-10-14T20:03:00Z", approved: true, auto_clocked_out: false,
  deleted: false, hourly_wage: Number(PII.wage), tips: Number(PII.tip), notes: PII.note,
  clocked_in_offline: false, breaks: [{ in: "2026-10-14T17:00:00Z", out: "2026-10-14T17:30:00Z", paid: false }],
  modified: "2026-10-14T20:05:00Z",
};
const availability = {
  id: 3001, user_id: 501, company_id: 1234, week: "2026-10-12", week_to: null, repeat: true, status: 1,
  status_action_user_id: 9, status_action_message: PII.statusMessage,
  mon: 1, mon_from: "00:00:00", mon_to: "00:00:00", mon_comments: PII.comment, mon_reason: PII.reason,
  tue: 2, tue_from: "09:00:00", tue_to: "15:00:00", tue_comments: PII.comment, tue_reason: PII.reason,
  wed: 0, wed_from: "00:00:00", wed_to: "00:00:00", wed_comments: null, wed_reason: "",
  thu: 0, thu_from: "00:00:00", thu_to: "00:00:00", thu_comments: null, thu_reason: "",
  fri: 0, fri_from: "00:00:00", fri_to: "00:00:00", fri_comments: null, fri_reason: "",
  sat: 0, sat_from: "00:00:00", sat_to: "00:00:00", sat_comments: null, sat_reason: "",
  sun: 0, sun_from: "00:00:00", sun_to: "00:00:00", sun_comments: null, sun_reason: "",
  created: "2026-10-01T00:00:00Z", modified: "2026-10-02T00:00:00Z", old_approved_data: { mon_comments: PII.comment },
};
const timeOff = {
  id: 4001, user_id: 501, from_date: "2026-10-20", to_date: "2026-10-21", partial: true,
  partial_from: "09:00:00", partial_to: "13:00:00", status: 1, amount_of_hours: 4,
  hours: [{ date: "2026-10-20", hours: 4 }], company_id: 1234, created: "2026-10-01T00:00:00Z", comments: PII.comment,
  category: PII.reason, status_action_message: PII.statusMessage, modified: "2026-10-03T00:00:00Z",
};
const wagesJson = {
  data: {
    current_wages: [{ id: 61, effective_date: "2026-09-01", role_id: 2583, wage_type: "hourly", wage_cents: 1650 }],
    upcoming_wages: [{ id: 62, effective_date: "2026-11-01", role_id: null, wage_type: "hourly", wage_cents: 1700 }],
  },
};
const labor = {
  object: "labor_settings",
  data: {
    // The documented payload (retrievecompanylaborsettings, re-read 2026-10-15).
    company_id: 1234, daily_overtime_threshold: 8, weekly_overtime_threshold: 40, premium_overtime_threshold: 12,
    consecutive_days_threshold: 7, overtime_enabled: true, overtime_by_location_enabled: false,
    consecutive_days_multiplier: 1.5, daily_overtime_multiplier: 1.5, weekly_overtime_multiplier: 1.5,
    premium_overtime_multiplier: 2, regular_rate_of_pay_enabled: true, auto_break_hours: 8, jurisdiction: "california",
    custom_min_wages: null, notes: PII.note,
  },
};

function deepStrings(v: unknown, out: string[] = []): string[] {
  if (v === null || v === undefined) return out;
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepStrings(x, out); }
  } else out.push(String(v));
  return out;
}

describe("THE LEAK TEST — a fully populated payload never leaks PII through any normalizer", () => {
  const outputs = [
    normalizeUsers([user]),
    normalizeShifts([shift]),
    normalizeTimePunches([punch]),
    normalizeAvailabilities([availability]),
    normalizeTimeOff([timeOff]),
    normalizeWages("501", (wagesSnapshot(wagesJson) as { ok: true; value: never }).value),
    normalizeLaborSettings(labor.data),
  ];
  it("every normalizer accepted its fully populated row", () => {
    for (const o of outputs) {
      expect(o.rejected).toEqual([]);
      expect(o.rows.length).toBeGreaterThan(0);
    }
  });
  it.each(Object.entries(PII))("no output contains the planted %s", (_k, planted) => {
    const blob = JSON.stringify(outputs);
    // wage cents are kept on purpose (wages table); the planted punch/user hourly_wage is a different number
    expect(blob.includes(planted)).toBe(false);
  });
  it("no output key names a dropped field", () => {
    const keys = deepStrings(outputs.map((o) => o.rows)).join(" ");
    expect(keys).not.toMatch(/email|mobile|home_number|birth|punch_id|hourly_wage|tips|notes|comment|reason|status_action|address/);
  });
});

describe("normalizeUsers", () => {
  it("keeps exactly what a manager needs to recognise a person (R4), with ids as digit strings", () => {
    expect(normalizeUsers([user])).toEqual({
      rows: [{
        id: "501", company_id: "1234", first_name: "Ana", last_name: "Ruiz", preferred_first_name: "Anita",
        employee_id: "EMP-12", user_type: "employee", active: true, hire_date: "2026-09-01", skill_level: 3,
        source_modified_at: "2026-10-14T15:00:00.000Z",
      }],
      rejected: [],
    });
  });
  it("never throws; a bad row is REPORTED by index with a fixed code, never silently dropped (r2 #2)", () => {
    const r = normalizeUsers([user, { ...user, id: "12x" }, null, { ...user, id: 502, active: "yes" }, { ...user, id: 503, first_name: "x".repeat(61) }]);
    expect(r.rows.map((x) => x.id)).toEqual(["501"]);
    expect(r.rejected).toEqual([
      { index: 1, reason: "bad_id" },
      { index: 2, reason: "not_object" },
      { index: 3, reason: "bad_value" },
      { index: 4, reason: "bad_value" },
    ]);
  });
  it("ids: digit strings up to 18 digits are kept, longer or unsafe numbers are bad_id", () => {
    expect(normalizeUsers([{ ...user, id: "123456789012345678" }]).rows[0]!.id).toBe("123456789012345678");
    expect(normalizeUsers([{ ...user, id: "1234567890123456789" }]).rejected[0]!.reason).toBe("bad_id");
    expect(normalizeUsers([{ ...user, id: 2 ** 60 }]).rejected[0]!.reason).toBe("bad_id");
    expect(normalizeUsers([{ ...user, id: -5 }]).rejected[0]!.reason).toBe("bad_id");
    expect(normalizeUsers([{ ...user, id: 1.5 }]).rejected[0]!.reason).toBe("bad_id");
  });
  it("a missing required field is missing_field; optional fields become null", () => {
    const { id: _id, ...noId } = user;
    expect(normalizeUsers([noId]).rejected[0]!.reason).toBe("missing_field");
    const sparse = normalizeUsers([{ id: 7, company_id: 1234, active: false }]);
    expect(sparse.rows[0]).toEqual({
      id: "7", company_id: "1234", first_name: null, last_name: null, preferred_first_name: null, employee_id: null,
      user_type: null, active: false, hire_date: null, skill_level: null, source_modified_at: null,
    });
  });
  it("an instant without a zone is bad_instant (never read as server local time)", () => {
    expect(normalizeUsers([{ ...user, modified: "2026-10-14 15:00:00" }]).rejected[0]!.reason).toBe("bad_instant");
  });
});

describe("the list normalizers", () => {
  it("locations, departments, roles", () => {
    expect(normalizeLocations([{ id: 4569, company_id: 1234, name: "Restaurant", timezone: "America/New_York", active: true, address: "x" }]).rows)
      .toEqual([{ id: "4569", company_id: "1234", name: "Restaurant", timezone: "America/New_York", active: true }]);
    expect(normalizeDepartments([{ id: 7890, company_id: 1234, location_id: 4569, name: "FOH" }]).rows)
      .toEqual([{ id: "7890", location_id: "4569", name: "FOH" }]);
    expect(normalizeRoles([{ id: 2583, location_id: 4569, department_id: 7890, name: "Host", active: true }]).rows)
      .toEqual([{ id: "2583", location_id: "4569", department_id: "7890", name: "Host", active: true }]);
  });
  it("shifts: instants normalised to UTC ISO, station_id a bare id, deleted kept", () => {
    expect(normalizeShifts([shift]).rows).toEqual([{
      id: "9001", user_id: "501", location_id: "4569", department_id: "7890", role_id: "2583", station_id: "77",
      start_at: "2026-10-14T18:00:00.000Z", end_at: "2026-10-15T00:00:00.000Z", draft: false, open: false, deleted: false,
      source_modified_at: "2026-10-13T12:00:00.000Z",
    }]);
  });
  it("an open shift (user 0 or null) keeps user_id null", () => {
    expect(normalizeShifts([{ ...shift, user_id: 0, open: true }]).rows[0]!.user_id).toBeNull();
    expect(normalizeShifts([{ ...shift, user_id: null, open: true }]).rows[0]!.user_id).toBeNull();
  });
  it("a shift with a malformed start is bad_instant", () => {
    expect(normalizeShifts([{ ...shift, start: "soon" }]).rejected).toEqual([{ index: 0, reason: "bad_instant" }]);
  });
  it("punches: break minutes summed, wage/tips/notes dropped, a still-open punch keeps clocked_out null", () => {
    expect(normalizeTimePunches([punch]).rows[0]).toEqual({
      id: "7001", user_id: "501", location_id: "4569", department_id: "7890", role_id: "2583", shift_id: "9001",
      clocked_in: "2026-10-14T13:58:00.000Z", clocked_out: "2026-10-14T20:03:00.000Z", break_minutes: 30,
      approved: true, auto_clocked_out: false, deleted: false, source_modified_at: "2026-10-14T20:05:00.000Z",
    });
    const open = normalizeTimePunches([{ ...punch, clocked_out: null, breaks: undefined }]).rows[0]!;
    expect(open.clocked_out).toBeNull();
    expect(open.break_minutes).toBeNull();
  });
  it("availability: day codes and times kept raw (no comments, no reasons), repeat → repeating", () => {
    const row = normalizeAvailabilities([availability]).rows[0]!;
    expect(row).toMatchObject({ id: "3001", user_id: "501", week: "2026-10-12", week_to: null, repeating: true, status: 1,
      source_modified_at: "2026-10-02T00:00:00.000Z" });
    expect(row.days.tue).toEqual({ code: 2, from: "09:00:00", to: "15:00:00" });
    expect(Object.keys(row.days)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });
  it("time off: no comments, no category text", () => {
    expect(normalizeTimeOff([timeOff]).rows[0]).toEqual({
      id: "4001", user_id: "501", from_date: "2026-10-20", to_date: "2026-10-21", partial: true,
      from_time: "09:00:00", to_time: "13:00:00", status: 1, hours: 4, source_modified_at: "2026-10-03T00:00:00.000Z",
    });
    expect(normalizeTimeOff([{ ...timeOff, from_date: "20/10/2026" }]).rejected[0]!.reason).toBe("bad_date");
  });
  it("labor settings: one row, thresholds and multipliers", () => {
    expect(normalizeLaborSettings(labor.data).rows).toEqual([{
      company_id: "1234", daily_ot_threshold: 8, weekly_ot_threshold: 40, premium_ot_threshold: 12,
      consecutive_days_threshold: 7, overtime_enabled: true, overtime_by_location_enabled: false,
      multipliers: { consecutive_days_multiplier: 1.5, daily_overtime_multiplier: 1.5, premium_overtime_multiplier: 2, weekly_overtime_multiplier: 1.5 },
    }]);
    expect(normalizeLaborSettings({ daily_ot_threshold: 8 }).rejected[0]!.reason).toBe("missing_field");
  });
});

describe("chunk A review (Astra) — the documented field names", () => {
  it("#3 labor thresholds: the documented 8 / 40 / 12 survive (they were null/null/null under the invented names)", () => {
    const row = normalizeLaborSettings(labor.data).rows[0]!;
    expect([row.daily_ot_threshold, row.weekly_ot_threshold, row.premium_ot_threshold]).toEqual([8, 40, 12]);
    expect(normalizeLaborSettings(labor.data).rejected).toEqual([]);
    // The old invented names are NOT read: a payload carrying only them yields nulls.
    const legacy = normalizeLaborSettings({ company_id: 1234, daily_ot_threshold: 8, weekly_ot_threshold: 40 }).rows[0]!;
    expect([legacy.daily_ot_threshold, legacy.weekly_ot_threshold]).toEqual([null, null]);
  });

  it("#5 a deleted break adds 0; a corrected punch with a retired AND a current break counts only the current", () => {
    const onlyDeleted = normalizeTimePunches([{ ...punch, breaks: [{ id: 1, in: "2026-10-14T17:00:00Z", out: "2026-10-14T17:30:00Z", paid: false, deleted: true }] }]);
    expect(onlyDeleted.rejected).toEqual([]);
    expect(onlyDeleted.rows[0]!.break_minutes).toBe(0);
    const corrected = normalizeTimePunches([{ ...punch, breaks: [
      { id: 1, in: "2026-10-14T17:00:00Z", out: "2026-10-14T17:30:00Z", paid: false, deleted: true },
      { id: 2, in: "2026-10-14T17:10:00Z", out: "2026-10-14T17:25:00Z", paid: false, deleted: false },
    ] }]);
    expect(corrected.rows[0]!.break_minutes).toBe(15);
    expect(normalizeTimePunches([{ ...punch, breaks: [{ in: "2026-10-14T17:00:00Z", out: "2026-10-14T17:30:00Z", deleted: "yes" }] }]).rejected[0]!.reason).toBe("bad_value");
  });

  it("#2 a punch deleted in 7shifts normalizes with deleted: true (the deleted=true pass carries it to the mirror)", () => {
    expect(normalizeTimePunches([{ ...punch, deleted: true }]).rows[0]!.deleted).toBe(true);
  });

  it("time off (docs re-read): hours come from amount_of_hours; the per-date hours array is not stored", () => {
    expect(normalizeTimeOff([timeOff]).rows[0]!.hours).toBe(4);
    expect(normalizeTimeOff([{ ...timeOff, amount_of_hours: undefined }]).rows[0]!.hours).toBeNull();
  });
});

describe("normalizeAssignments (r2 #1) — the singleton becomes EDGES", () => {
  const snap = (json: unknown) => {
    const r = assignmentsSnapshot(json);
    if (!r.ok) throw new Error("fixture rejected");
    return r.value;
  };

  it("the documented example gives ONE edge (4569, 7890, 2583)", () => {
    expect(normalizeAssignments("501", snap(docExample))).toEqual({
      rows: [{ edge_key: "501:4569:7890:2583", user_id: "501", location_id: "4569", department_id: "7890", role_id: "2583", is_primary: false }],
      rejected: [],
    });
  });

  it("a department with no role under it, and a location with neither, are edges too", () => {
    const json = { data: {
      locations: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
      departments: [{ id: 10, location_id: 1, name: "FOH" }, { id: 11, location_id: 1, name: "BOH" }],
      roles: [{ id: 100, location_id: 1, department_id: 10, name: "Host", is_primary: true }],
    } };
    expect(normalizeAssignments("7", snap(json)).rows.map((r) => r.edge_key)).toEqual([
      "7:1:10:100", "7:1:11:-", "7:2:-:-",
    ]);
  });

  it("a role whose location/department are NOT in the snapshot's own lists is still an edge (7shifts is the authority)", () => {
    const json = { data: { locations: [], departments: [], roles: [{ id: 100, location_id: 9, department_id: 99, name: "X" }] } };
    expect(normalizeAssignments("7", snap(json))).toEqual({
      rows: [{ edge_key: "7:9:99:100", user_id: "7", location_id: "9", department_id: "99", role_id: "100", is_primary: null }],
      rejected: [],
    });
  });

  it("a malformed role id is REJECTED (reported), the valid edges still come back", () => {
    const json = { data: { locations: [{ id: 1 }], departments: [], roles: [
      { id: 100, location_id: 1, department_id: null }, { id: "abc", location_id: 1, department_id: null },
    ] } };
    const r = normalizeAssignments("7", snap(json));
    expect(r.rows.map((x) => x.edge_key)).toEqual(["7:1:-:100"]);
    expect(r.rejected).toEqual([{ index: 1, reason: "bad_id", part: "roles" }]);
  });

  it("an entirely invalid snapshot rejects every row and returns none (incomplete, never 'empty')", () => {
    const json = { data: { locations: [{ id: "x" }], departments: [], roles: [{ id: "y", location_id: 1 }] } };
    const r = normalizeAssignments("7", snap(json));
    expect(r.rows).toEqual([]);
    expect(r.rejected.length).toBe(2);
  });

  it("a genuinely empty snapshot is zero rows and zero rejections", () => {
    expect(normalizeAssignments("7", snap({ data: { locations: [], departments: [], roles: [] } }))).toEqual({ rows: [], rejected: [] });
  });

  it("a duplicated role is one edge", () => {
    const role = { id: 100, location_id: 1, department_id: 10 };
    expect(normalizeAssignments("7", snap({ data: { locations: [], departments: [], roles: [role, role] } })).rows).toHaveLength(1);
  });

  it("refuses a bad user id outright", () => {
    expect(() => normalizeAssignments("7a", snap(docExample))).toThrow("bad_id");
  });
});

describe("normalizeWages", () => {
  const snap = (json: unknown) => {
    const r = wagesSnapshot(json);
    if (!r.ok) throw new Error("fixture rejected");
    return r.value;
  };
  it("current and upcoming become rows keyed (user, wage, upcoming)", () => {
    expect(normalizeWages("501", snap(wagesJson))).toEqual({
      rows: [
        { user_id: "501", wage_id: "61", upcoming: false, effective_date: "2026-09-01", wage_type: "hourly", wage_cents: 1650, role_id: "2583" },
        { user_id: "501", wage_id: "62", upcoming: true, effective_date: "2026-11-01", wage_type: "hourly", wage_cents: 1700, role_id: null },
      ],
      rejected: [],
    });
  });
  it("an unknown wage_type or a negative amount is rejected and reported with its list", () => {
    const r = normalizeWages("501", snap({ data: {
      current_wages: [{ id: 61, effective_date: "2026-09-01", wage_type: "piecework", wage_cents: 1 }],
      upcoming_wages: [{ id: 62, effective_date: "2026-11-01", wage_type: "hourly", wage_cents: -5 }],
    } }));
    expect(r.rows).toEqual([]);
    expect(r.rejected).toEqual([
      { index: 0, reason: "bad_value", part: "current_wages" },
      { index: 0, reason: "bad_value", part: "upcoming_wages" },
    ]);
  });
});

describe("MIRROR_WRITE_SPEC (r1 P2-4) — the ONE place a resource's write shape is decided", () => {
  it("one entry per mirrored resource (every resource but whoami), none extra", () => {
    expect([...MIRRORED_RESOURCES].sort()).toEqual(SEVENSHIFTS_RESOURCES.filter((r) => r !== "whoami").sort());
    expect(Object.keys(MIRROR_WRITE_SPEC).sort()).toEqual([...MIRRORED_RESOURCES].sort());
  });

  it("pins each table, mode and key", () => {
    const pinned = Object.fromEntries(Object.entries(MIRROR_WRITE_SPEC).map(([r, s]) => [r, [s.table, s.mode, s.mode === "upsert" ? s.onConflict.join(",") : s.identity.join(",")]]));
    expect(pinned).toEqual({
      locations: ["sevenshifts_locations", "upsert", "id"],
      departments: ["sevenshifts_departments", "upsert", "id"],
      roles: ["sevenshifts_roles", "upsert", "id"],
      users: ["sevenshifts_users", "upsert", "id"],
      availabilities: ["sevenshifts_availabilities", "upsert", "id"],
      time_off: ["sevenshifts_time_off", "upsert", "id"],
      shifts: ["sevenshifts_shifts", "upsert", "id"],
      time_punches: ["sevenshifts_time_punches", "upsert", "id"],
      labor_settings: ["sevenshifts_labor_settings", "upsert", "company_id"],
      assignments: ["sevenshifts_user_assignments", "reconcile", "edge_key"],
      wages: ["sevenshifts_wages", "reconcile", "user_id,wage_id,upcoming"],
    });
  });

  it("every normalizer's output keys equal the spec's column set EXACTLY", () => {
    const samples: Record<string, object | undefined> = {
      users: normalizeUsers([user]).rows[0],
      locations: normalizeLocations([{ id: 1, company_id: 2, name: "A", timezone: "America/New_York", active: true }]).rows[0],
      departments: normalizeDepartments([{ id: 1, location_id: 2, name: "A" }]).rows[0],
      roles: normalizeRoles([{ id: 1, location_id: 2, department_id: 3, name: "A", active: true }]).rows[0],
      shifts: normalizeShifts([shift]).rows[0],
      time_punches: normalizeTimePunches([punch]).rows[0],
      availabilities: normalizeAvailabilities([availability]).rows[0],
      time_off: normalizeTimeOff([timeOff]).rows[0],
      labor_settings: normalizeLaborSettings(labor.data).rows[0],
      assignments: normalizeAssignments("501", (assignmentsSnapshot(docExample) as { ok: true; value: never }).value).rows[0],
      wages: normalizeWages("501", (wagesSnapshot(wagesJson) as { ok: true; value: never }).value).rows[0],
    };
    for (const r of MIRRORED_RESOURCES) {
      const row = samples[r];
      expect(row, r).toBeDefined();
      expect(Object.keys(row!).sort(), r).toEqual([...MIRROR_WRITE_SPEC[r].columns].sort());
    }
  });

  it("every spec names a normalizer that exists", () => {
    for (const r of MIRRORED_RESOURCES) {
      expect(typeof (normalizers as Record<string, unknown>)[MIRROR_WRITE_SPEC[r].normalizer], r).toBe("function");
    }
  });

  it("every conflict key / identity is among the emitted columns", () => {
    for (const r of MIRRORED_RESOURCES) {
      const s = MIRROR_WRITE_SPEC[r];
      for (const k of s.mode === "upsert" ? s.onConflict : s.identity) expect(s.columns).toContain(k);
    }
  });

  it("assignmentEdgeKey is stable and spells nulls '-'", () => {
    expect(assignmentEdgeKey({ user_id: "7", location_id: "1", department_id: null, role_id: null })).toBe("7:1:-:-");
    expect(assignmentEdgeKey({ user_id: "7", location_id: null, department_id: null, role_id: "100" })).toBe("7:-:-:100");
    expect(assignmentEdgeKey({ user_id: "7", location_id: "1", department_id: "2", role_id: "3" }))
      .toBe(assignmentEdgeKey({ role_id: "3", department_id: "2", location_id: "1", user_id: "7" }));
    // the 0268 CHECK shape
    expect(assignmentEdgeKey({ user_id: "7", location_id: "1", department_id: null, role_id: "3" })).toMatch(/^\d{1,18}:(\d{1,18}|-):(\d{1,18}|-):(\d{1,18}|-)$/);
  });
});
