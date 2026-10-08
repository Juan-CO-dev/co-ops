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
    expect(weekStart("2026-10-07")).toBe("2026-10-05"); // Wed → Mon
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sun → Mon
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });
});

describe("the digest's labor math", () => {
  const e = (employeeGuid: string, firstName: string, businessDate: string, hours: number | null, jobName: string | null = "Line Cook", overtimeHours = 0): LaborEntryFact =>
    ({ employeeGuid, firstName, jobName, businessDate, hours, overtimeHours, open: hours === null });
  const entries = [
    e("a", "Ana", "2026-10-07", 8), e("a", "Ana", "2026-10-07", 3, "Catering"), // 11 h in the day
    e("l", "Luis", "2026-10-07", 6.5, "Cashier"),
    e("k", "Kim", "2026-10-07", null), // still clocked in
    e("l", "Luis", "2026-10-05", 10), e("l", "Luis", "2026-10-06", 12), e("l", "Luis", "2026-10-04", 12), // Sun before: not this week
    e("p", "Pat", "2026-10-06", 41), // over 40 but did not work D: still flagged week-to-date
  ];
  const s = summarizeLabor("2026-10-07", entries, 250_000);

  it("hours by job and by person; open entries are counted apart, never as zero", () => {
    expect(s.totalHours).toBe(17.5);
    expect(s.openEntries).toBe(1);
    expect(s.byJob).toEqual([{ job: "Line Cook", hours: 8 }, { job: "Cashier", hours: 6.5 }, { job: "Catering", hours: 3 }]);
    expect(s.people).toEqual([{ employeeGuid: "a", firstName: "Ana", hours: 11 }, { employeeGuid: "l", firstName: "Luis", hours: 6.5 }]);
  });
  it("sales per labor hour = net pre-tax / clocked hours; unknown sales or zero hours = null", () => {
    expect(s.salesPerLaborHourCents).toBe(14286);
    expect(summarizeLabor("2026-10-07", entries, null).salesPerLaborHourCents).toBeNull();
    expect(summarizeLabor("2026-10-07", [], 1000).salesPerLaborHourCents).toBeNull();
  });
  it("overtime: over 10 h in the day; over 40 h week-to-date (Mon..D, a lower bound) or Toast's own OT", () => {
    expect(s.dayOvertime).toEqual([{ firstName: "Ana", hours: 11 }]);
    expect(s.weekOvertime).toEqual([{ firstName: "Pat", hours: 41 }]);
    const toastOt = summarizeLabor("2026-10-07", [e("z", "Zed", "2026-10-07", 9, "Line Cook", 1)], null);
    expect(toastOt.weekOvertime).toEqual([{ firstName: "Zed", hours: 9 }]);
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
    expect(s.lines.map((l) => `${l.tone}|${l.label}|${l.text}`)).toEqual([
      "info|Labor (Toast)|17.5 h clocked · $100.00 sales per labor hour",
      "info|Hours by job|Line Cook 11 h, Cashier 6.5 h",
      "info|Who worked|Ana 11 h, Lu 6.5 h",
      "issue|Overtime|Ana 11 h today (over 10 h)",
    ]);
    const none = composeShopSections({ ...base, v2: v2Fixture({ labor: unavailable("no_labor") }) }, "en", "https://x.test", false);
    expect(none.find((x) => x.title === "Labor")!.lines[0]!.text).toBe("Labor not available yet");
    expect(composeShopSections({ ...base, v2: v2Fixture() }, "en", "https://x.test", false).some((x) => x.title === "Labor")).toBe(false);
  });
});
