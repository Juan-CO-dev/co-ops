import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  employeeFirstNames,
  entryHours,
  jobTitles,
  laborBusinessDate,
  normalizeTimeEntries,
  summarizeLabor,
  toastInstant,
  weekStart,
  type LaborEntryFact,
} from "@/lib/toast/labor-shared";

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/toast/${name}.json`, "utf8")) as unknown;
const LOC = "11111111-1111-4111-8111-111111111111";

describe("Toast labor normalizer (fixtures shaped like the real timeEntries / jobs / employees)", () => {
  const jobs = jobTitles(fixture("labor-jobs-sample"));
  const employees = employeeFirstNames(fixture("labor-employees-sample"));
  const { rows, skipped } = normalizeTimeEntries(fixture("labor-time-entries-sample"), { locationId: LOC, businessDate: "2026-10-07", jobs, employees });

  it("jobs → titles; employees → FIRST name only (chosen name wins); nothing else is read", () => {
    expect(jobs.get("job-line")).toBe("Line Cook");
    expect(employees.get("emp-ana")).toBe("Ana");
    expect(employees.get("emp-luis")).toBe("Lu");
    expect([...employees.values()].join(" ")).not.toMatch(/Pérez|López|@/);
  });

  it("keeps only the minimal fields: no wage, tips or sales survive normalisation", () => {
    expect(rows).toHaveLength(5);
    expect(skipped).toBe(1);
    const json = JSON.stringify(rows);
    for (const banned of ["hourlyWage", "Tips", "Sales", "wage", "16.5", "López"]) expect(json).not.toContain(banned);
    expect(rows[0]).toEqual({
      location_id: LOC, time_entry_guid: "te-1", business_date: "2026-10-07", employee_guid: "emp-ana", employee_first_name: "Ana",
      job_guid: "job-line", job_name: "Line Cook", in_at: "2026-10-07T12:00:00.000Z", out_at: "2026-10-07T20:30:00.000Z",
      hours: 8, overtime_hours: 0, auto_clocked_out: false, deleted: false, source_modified_at: "2026-10-07T20:31:00.000Z",
    });
  });

  it("no regularHours: (out - in) minus the UNPAID breaks[] only (Astra r2 P2) — 8 h with a 30-min unpaid + 15-min paid break = 7.5", () => {
    expect(rows.find((r) => r.time_entry_guid === "te-5")!.hours).toBe(7.5);
  });

  it("insufficient break data = hours unavailable, never a guess", () => {
    const at = ["2026-10-07T12:00:00.000Z", "2026-10-07T20:00:00.000Z"] as const;
    expect(entryHours({ breaks: [] }, ...at)).toBe(8);
    expect(entryHours({}, ...at)).toBeNull(); // no breaks array at all
    expect(entryHours({ breaks: [{ paid: false, inDate: "2026-10-07T16:00:00.000+0000", outDate: null, missed: false }] }, ...at)).toBeNull();
    expect(entryHours({ breaks: [{ paid: false, inDate: "2026-10-07T16:00:00.000+0000", outDate: null, missed: true }] }, ...at)).toBe(8); // a missed break was not taken
    expect(entryHours({ unpaidBreakTime: 0.5, breaks: [] }, ...at)).toBe(8); // the undocumented field is never read
  });

  it("the modification window accepts any business date and keeps archive tombstones (deleted=true)", () => {
    const { rows: m } = normalizeTimeEntries([
      { guid: "te-old", deleted: true, businessDate: "20261005", employeeReference: { guid: "emp-ana" }, jobReference: { guid: "job-line" }, inDate: "2026-10-05T12:00:00.000+0000", outDate: "2026-10-05T20:00:00.000+0000", regularHours: 8, overtimeHours: 0 },
      { guid: "te-nodate", deleted: true, employeeReference: { guid: "emp-ana" }, inDate: "2026-10-05T12:00:00.000+0000" },
    ], { locationId: LOC, businessDate: null, jobs, employees });
    expect(m.map((r) => [r.time_entry_guid, r.business_date, r.deleted])).toEqual([["te-old", "2026-10-05", true]]);
  });

  it("an open entry (still clocked in) has no hours yet; Toast's regular + overtime win over clock math", () => {
    const open = rows.find((r) => r.time_entry_guid === "te-4")!;
    expect(open.out_at).toBeNull();
    expect(open.hours).toBeNull();
    expect(rows.find((r) => r.time_entry_guid === "te-3")!.hours).toBe(11);
  });

  it("an entry for another business day is refused, never filed under this one", () => {
    expect(() => normalizeTimeEntries([{ guid: "x", businessDate: 20261006, employeeReference: { guid: "e" }, inDate: "2026-10-06T12:00:00.000+0000" }],
      { locationId: LOC, businessDate: "2026-10-07", jobs, employees })).toThrow("toast_labor_business_date_mismatch");
    expect(() => normalizeTimeEntries({ not: "an array" }, { locationId: LOC, businessDate: "2026-10-07", jobs, employees })).toThrow("toast_labor_bad_payload");
  });

  it("time and date helpers", () => {
    expect(toastInstant("2026-10-07T12:00:00.000+0000")).toBe("2026-10-07T12:00:00.000Z");
    expect(toastInstant("2026-10-07T08:00:00.000-0400")).toBe("2026-10-07T12:00:00.000Z");
    expect(toastInstant(null)).toBeNull();
    expect(() => toastInstant("nope")).toThrow("toast_labor_invalid_timestamp");
    expect(laborBusinessDate(20261007)).toBe("2026-10-07");
    // The payroll week starts on SUNDAY (it used to be the ISO Monday).
    expect(weekStart("2026-10-07")).toBe("2026-10-04"); // Wed → Sun before
    expect(weekStart("2026-10-11")).toBe("2026-10-11"); // Sun → itself (it starts the next week)
    expect(weekStart("2026-10-05")).toBe("2026-10-04"); // Mon → Sun before
  });
});

describe("weekStart: the Sunday on or before the day (payroll week, Sunday 00:00 ET)", () => {
  it("a Sunday is its own week start", () => {
    for (const sun of ["2026-10-04", "2026-10-11", "2026-11-01", "2026-03-08", "2027-01-03"]) expect(weekStart(sun)).toBe(sun);
  });
  it("Monday..Saturday go back to the previous Sunday", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
    for (const d of days) expect(weekStart(d)).toBe("2026-10-04");
  });
  it("across a month boundary", () => {
    expect(weekStart("2026-10-31")).toBe("2026-10-25"); // Sat → Sun 25 Oct
    expect(weekStart("2026-12-01")).toBe("2026-11-29"); // Tue 1 Dec → Sun 29 Nov
  });
  it("across a year boundary", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-27"); // Fri
    expect(weekStart("2027-01-02")).toBe("2026-12-27"); // Sat
    expect(weekStart("2027-01-03")).toBe("2027-01-03"); // Sun
  });
  it("DST weeks: spring forward (Sun 2026-03-08) and fall back (Sun 2026-11-01) move nothing", () => {
    for (const d of ["2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14"]) expect(weekStart(d)).toBe("2026-03-08");
    expect(weekStart("2026-03-07")).toBe("2026-03-01"); // the Saturday before is the previous week
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) expect(weekStart(d)).toBe("2026-11-01");
    expect(weekStart("2026-10-31")).toBe("2026-10-25");
  });
});

describe("the digest's labor math", () => {
  const e = (employeeGuid: string, firstName: string, businessDate: string, hours: number | null, jobName: string | null = "Line Cook", overtimeHours = 0): LaborEntryFact =>
    ({ employeeGuid, firstName, jobName, businessDate, hours, overtimeHours, open: hours === null });
  const entries = [
    e("a", "Ana", "2026-10-07", 8), e("a", "Ana", "2026-10-07", 3, "Catering"), // 11 h in the day
    e("l", "Luis", "2026-10-07", 6.5, "Cashier"),
    e("k", "Kim", "2026-10-07", null), // still clocked in
    // Sun 2026-10-04 starts the payroll week of Wed 2026-10-07, so it counts: 12 + 10 + 12 + 6.5 = 40.5 h.
    // (Under the old Monday rule it was "not this week" and Luis stood at 28.5 h.)
    e("l", "Luis", "2026-10-05", 10), e("l", "Luis", "2026-10-06", 12), e("l", "Luis", "2026-10-04", 12),
    e("p", "Pat", "2026-10-06", 41), // over 40 but did not work D: still flagged week-to-date
  ];
  const s = summarizeLabor("2026-10-07", entries, 250_000);

  it("hours by job and by person; open entries are counted apart, never as zero", () => {
    expect(s.totalHours).toBe(17.5);
    expect(s.openEntries).toBe(1);
    expect(s.byJob).toEqual([{ job: "Line Cook", hours: 8 }, { job: "Cashier", hours: 6.5 }, { job: "Catering", hours: 3 }]);
    expect(s.people).toEqual([{ employeeGuid: "a", firstName: "Ana", hours: 11, unknownShifts: 0 }, { employeeGuid: "l", firstName: "Luis", hours: 6.5, unknownShifts: 0 }]);
  });
  it("sales per labor hour = net pre-tax / clocked hours; unknown sales or zero hours = null", () => {
    expect(s.salesPerLaborHourCents).toBeNull(); // Kim is still clocked in.
    expect(summarizeLabor("2026-10-07", entries.filter((e) => !e.open), 250_000).salesPerLaborHourCents).toBe(14286);
    expect(summarizeLabor("2026-10-07", entries, null).salesPerLaborHourCents).toBeNull();
    expect(summarizeLabor("2026-10-07", [], 1000).salesPerLaborHourCents).toBeNull();
  });
  it("overtime: over 10 h in the day; over 40 h payroll-week-to-date (Sun..D, a lower bound) or Toast's own OT", () => {
    expect(s.dayOvertime).toEqual([{ firstName: "Ana", hours: 11 }]);
    expect(s.weekOvertime).toEqual([{ firstName: "Pat", hours: 41 }, { firstName: "Luis", hours: 40.5 }]);
    const toastOt = summarizeLabor("2026-10-07", [e("z", "Zed", "2026-10-07", 9, "Line Cook", 1)], null);
    expect(toastOt.weekOvertime).toEqual([{ firstName: "Zed", hours: 9 }]);
  });

  it("Sunday hours count: a Sunday that pushes someone past 40 by D flags them; the Saturday before does not", () => {
    // Under the old Monday rule the Sunday 12 h were not counted (29 h, no flag).
    const week = [e("x", "Alex", "2026-10-04", 12), e("x", "Alex", "2026-10-05", 10), e("x", "Alex", "2026-10-06", 10), e("x", "Alex", "2026-10-07", 9)];
    expect(summarizeLabor("2026-10-07", week, null)).toMatchObject({ overtimeAssessed: true, weekOvertime: [{ firstName: "Alex", hours: 41 }] });
    // The same 12 h on Saturday 2026-10-03 belong to the previous payroll week: 29 h, not flagged.
    const shifted = [e("x", "Alex", "2026-10-03", 12), ...week.slice(1)];
    expect(summarizeLabor("2026-10-07", shifted, null)).toMatchObject({ overtimeAssessed: true, weekOvertime: [] });
  });

  it("a Monday-to-Saturday week with no Sunday hours is unchanged (numbers pinned)", () => {
    const monSat = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    const entries = [
      ...monSat.map((d) => e("b", "Blair", d, 8)), e("b", "Blair", "2026-10-10", 2), // 42 h
      ...[...monSat, "2026-10-10"].map((d) => e("c", "Casey", d, 6)), // 36 h
    ];
    const sat = summarizeLabor("2026-10-10", entries, null);
    expect(sat.weekOvertime).toEqual([{ firstName: "Blair", hours: 42 }]);
    expect(sat.dayOvertime).toEqual([]);
    expect(sat.totalHours).toBe(8);
    // Same week read on Friday: Blair at exactly 40 h is not over.
    expect(summarizeLabor("2026-10-09", entries, null).weekOvertime).toEqual([]);
  });

  it("Toast's own overtime marker on D flags the person whatever the 40 h count; a marker on another day does not", () => {
    const entries = [e("z", "Zed", "2026-10-04", 5, "Line Cook", 2), e("z", "Zed", "2026-10-07", 4, "Line Cook", 0.5)];
    expect(summarizeLabor("2026-10-07", entries, null).weekOvertime).toEqual([{ firstName: "Zed", hours: 9 }]);
    // The Sunday marker alone (D carries none) flags nothing: 5 + 4 = 9 h.
    const sundayOnly = [e("z", "Zed", "2026-10-04", 5, "Line Cook", 2), e("z", "Zed", "2026-10-07", 4)];
    expect(summarizeLabor("2026-10-07", sundayOnly, null).weekOvertime).toEqual([]);
  });

  it("loadLabor reads the payroll week from SUNDAY through D", async () => {
    const { loadLabor } = await import("@/lib/report-digests-v2");
    const { unavailable } = await import("@/lib/report-digests-v2-shared");
    const rows = [
      { employee_guid: "x", employee_first_name: "Alex", job_name: "Line Cook", business_date: "2026-10-03", hours: 12, overtime_hours: 0, out_at: "t" },
      { employee_guid: "x", employee_first_name: "Alex", job_name: "Line Cook", business_date: "2026-10-04", hours: 12, overtime_hours: 0, out_at: "t" },
      { employee_guid: "x", employee_first_name: "Alex", job_name: "Line Cook", business_date: "2026-10-05", hours: 10, overtime_hours: 0, out_at: "t" },
      { employee_guid: "x", employee_first_name: "Alex", job_name: "Line Cook", business_date: "2026-10-06", hours: 10, overtime_hours: 0, out_at: "t" },
      { employee_guid: "x", employee_first_name: "Alex", job_name: "Line Cook", business_date: "2026-10-07", hours: 9, overtime_hours: 0, out_at: "t" },
    ];
    const filters: Record<string, unknown> = {};
    let gte = "", lte = "", gteCol = "", lteCol = "";
    const q = {
      select: () => q, order: () => q,
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      gte: (k: string, v: string) => { gteCol = k; gte = v; return q; },
      lte: (k: string, v: string) => { lteCol = k; lte = v; return q; },
      range: async () => ({ data: rows.filter((r) => r.business_date >= gte && r.business_date <= lte), error: null }),
    };
    const sb = { from: (table: string) => { filters.table = table; return q; } } as unknown as Parameters<typeof loadLabor>[0];
    const out = await loadLabor(sb, LOC, "2026-10-07", unavailable("no_sales"));
    expect(filters).toMatchObject({ table: "toast_time_entries", location_id: LOC, deleted: false });
    expect([gte, lte]).toEqual(["2026-10-04", "2026-10-07"]);
    // Both bounds are on the Toast business date, never on a clock column (Astra W P3).
    expect([gteCol, lteCol]).toEqual(["business_date", "business_date"]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.value.weekOvertime).toEqual([{ firstName: "Alex", hours: 41 }]);
  });
});

describe("the nightly digest's Labor section", () => {
  it("renders hours, sales per labor hour, who worked and overtime; absent labor adds no section", async () => {
    const { composeShopSections } = await import("@/lib/report-digests-compose");
    const { ok, unavailable } = await import("@/lib/report-digests-v2-shared");
    const { v2Fixture } = await import("./fixtures/digest-v2");
    const base = { location: { id: LOC, name: "Shop A" }, day: "2026-10-07", reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null };
    const labor = summarizeLabor("2026-10-07", [
      { employeeGuid: "a", firstName: "Ana", jobName: "Line Cook", businessDate: "2026-10-07", hours: 11, overtimeHours: 0, open: false },
      { employeeGuid: "l", firstName: "Lu", jobName: "Cashier", businessDate: "2026-10-07", hours: 6.5, overtimeHours: 0, open: false },
    ], 175_000);
    const sections = composeShopSections({ ...base, v2: v2Fixture({ labor: ok(labor) }) }, "en", "https://x.test", false);
    const s = sections.find((x) => x.title === "Labor")!;
    // Digests round 3, fix round 1 (F9): the issue line sorts first; the rest keep the composer's order.
    expect(s.lines.map((l) => `${l.tone}|${l.label}|${l.text}`)).toEqual([
      "issue|Overtime|Ana 11 h today (over 10 h)",
      "info|Labor (Toast)|17.5 h clocked · $100.00 sales per labor hour",
      "info|Hours by job|Line Cook 11 h, Cashier 6.5 h",
      "info|Who worked|Ana 11 h, Lu 6.5 h",
    ]);
    const none = composeShopSections({ ...base, v2: v2Fixture({ labor: unavailable("no_labor") }) }, "en", "https://x.test", false);
    expect(none.find((x) => x.title === "Labor")!.lines[0]!.text).toBe("Labor not available yet");
    expect(composeShopSections({ ...base, v2: v2Fixture() }, "en", "https://x.test", false).some((x) => x.title === "Labor")).toBe(false);
  });
});

describe("unknown labor hours survive aggregation and rendering (Astra r3)", () => {
  const e = (employeeGuid: string, firstName: string, hours: number | null, open = false, businessDate = "2026-10-07"): LaborEntryFact =>
    ({ employeeGuid, firstName, jobName: "Line Cook", businessDate, hours, overtimeHours: 0, open });

  it("an unknown-hours shift is counted, the totals are partial, and rates/overtime are withheld", () => {
    const s = summarizeLabor("2026-10-07", [e("a", "Ana", 8), e("l", "Lu", null), e("k", "Kim", null, true)], 100_000);
    expect(s).toMatchObject({ totalHours: 8, unknownHoursEntries: 1, openEntries: 1, partial: true, salesPerLaborHourCents: null, overtimeAssessed: false, dayOvertime: [], weekOvertime: [] });
    expect(s.people).toEqual([
      { employeeGuid: "a", firstName: "Ana", hours: 8, unknownShifts: 0 },
      { employeeGuid: "l", firstName: "Lu", hours: 0, unknownShifts: 1 },
    ]);
  });

  it("an unknown shift earlier in the week withholds the 40 h week figure but neither today's rate nor today's over-10 h alert", () => {
    const s = summarizeLabor("2026-10-07", [e("a", "Ana", 11), e("a", "Ana", null, false, "2026-10-06")], 110_000);
    expect(s).toMatchObject({
      partial: true, overtimeAssessed: false, dayOvertimeAssessed: true, weekOvertimeAssessed: false,
      dayOvertime: [{ firstName: "Ana", hours: 11 }], weekOvertime: [], salesPerLaborHourCents: 10_000,
    });
  });

  it("CC ruling (b): an unknown on Sunday or Monday plus a valid 10.5 h on D shows the daily alert and a partial week", () => {
    for (const earlier of ["2026-10-04", "2026-10-05"]) { // Sunday, Monday of D's payroll week
      const s = summarizeLabor("2026-10-07", [e("a", "Ana", 10.5), e("l", "Lu", null, false, earlier)], null);
      expect(s).toMatchObject({ partial: true, dayOvertimeAssessed: true, weekOvertimeAssessed: false, dayOvertime: [{ firstName: "Ana", hours: 10.5 }], weekOvertime: [] });
    }
  });

  it("an unknown ON D itself still withholds D's daily alert", () => {
    const s = summarizeLabor("2026-10-07", [e("a", "Ana", 10.5), e("l", "Lu", null)], null);
    expect(s).toMatchObject({ partial: true, dayOvertimeAssessed: false, weekOvertimeAssessed: false, dayOvertime: [], weekOvertime: [] });
  });

  it("the Sunday edge: an unknown on Sunday marks D's week partial; the same unknown on the Saturday before does not", () => {
    const known = [e("a", "Ana", 8)];
    expect(summarizeLabor("2026-10-07", [...known, e("l", "Lu", null, false, "2026-10-04")], null))
      .toMatchObject({ overtimeAssessed: false, weekOvertimeAssessed: false, dayOvertimeAssessed: true });
    expect(summarizeLabor("2026-10-07", [...known, e("l", "Lu", null, false, "2026-10-03")], null))
      .toMatchObject({ partial: false, overtimeAssessed: true, weekOvertimeAssessed: true, dayOvertimeAssessed: true });
  });

  it("all known = assessed as before", () => {
    expect(summarizeLabor("2026-10-07", [e("a", "Ana", 11)], 110_000)).toMatchObject({ partial: false, overtimeAssessed: true, dayOvertime: [{ firstName: "Ana", hours: 11 }] });
  });

  it("renders the unknown count and says partial, never 'No one clocked in' — en + es", async () => {
    const { composeShopSections } = await import("@/lib/report-digests-compose");
    const { ok } = await import("@/lib/report-digests-v2-shared");
    const { v2Fixture } = await import("./fixtures/digest-v2");
    const base = { location: { id: LOC, name: "Shop A" }, day: "2026-10-07", reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null };
    const mixed = summarizeLabor("2026-10-07", [e("a", "Ana", 8), e("l", "Lu", null)], 100_000);
    const lines = (lang: "en" | "es", s = mixed) => composeShopSections({ ...base, v2: v2Fixture({ labor: ok(s) }) }, lang, "https://x.test", false)
      .find((x) => x.title === (lang === "en" ? "Labor" : "Mano de obra"))!.lines.map((l) => `${l.tone}|${l.label}|${l.text}`);
    // Fix round 1 (F9): the unknown overtime line sorts before the routine lines.
    expect(lines("en")).toEqual([
      "info|Overtime|Not assessed — partial hours",
      "info|Labor (Toast)|8 h clocked · 1 shift with unknown hours · sales per labor hour not available (partial hours)",
      "info|Hours by job|Line Cook 8 h",
      "info|Who worked|Ana 8 h, Lu 0 h (+1 shift, hours unknown)",
    ]);
    expect(lines("es")).toEqual([
      "info|Horas extra|Sin evaluar — horas parciales",
      "info|Mano de obra (Toast)|8 h trabajadas · 1 turno con horas desconocidas · ventas por hora de trabajo no disponibles (horas parciales)",
      "info|Horas por puesto|Line Cook 8 h",
      "info|Quién trabajó|Ana 8 h, Lu 0 h (+1 turno, horas desconocidas)",
    ]);
    // An unknown earlier in the week: D's own over-10 h alert still prints; only the 40 h week is withheld.
    const earlierUnknown = summarizeLabor("2026-10-07", [e("a", "Ana", 10.5), e("l", "Lu", null, false, "2026-10-04")], 100_000);
    expect(lines("en", earlierUnknown).at(-1)).toBe("issue|Overtime|Ana 10.5 h today (over 10 h) · 40 h week not assessed (hours unknown earlier this week)");
    expect(lines("es", earlierUnknown).at(-1)).toBe("issue|Horas extra|Ana 10.5 h hoy (más de 10 h) · semana de 40 h sin evaluar (horas desconocidas antes esta semana)");
    const earlierUnknownNoAlert = summarizeLabor("2026-10-07", [e("a", "Ana", 8), e("l", "Lu", null, false, "2026-10-04")], 100_000);
    expect(lines("en", earlierUnknownNoAlert).at(-1)).toBe("info|Overtime|No one over 10 h today · 40 h week not assessed (hours unknown earlier this week)");
    // Only unknown-hour shifts: still not "No one clocked in".
    const onlyUnknown = summarizeLabor("2026-10-07", [e("l", "Lu", null), e("m", "Mo", null)], 100_000);
    expect(lines("en", onlyUnknown)[1]).toBe("info|Labor (Toast)|0 h clocked · 2 shifts with unknown hours · sales per labor hour not available (partial hours)");
    expect(lines("en", onlyUnknown).join("\n")).not.toContain("No one clocked in");
  });
});
