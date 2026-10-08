/**
 * Toast labor — PURE (client-safe, zero I/O). Juan, 2026-10-08: the nightly digest gets a LABOR
 * section from Toast time entries (who worked, hours by job, sales per labor hour, overtime).
 *
 * MINIMAL BY CONSTRUCTION: the normalizer keeps the time-entry guid, the employee guid and FIRST
 * name (chosen name when set), the job guid + title, in / out, hours, break time and Toast's own
 * overtime hours. Wages, tips, cash / non-cash sales and every other field are DROPPED here,
 * before anything is stored — no code path downstream can leak what was never kept.
 *
 * Toast references (Labor API v1; CC's read-only probe 10-08 confirmed timeEntries + jobs return
 * rows for both shops; /labor/v1/shifts returns 0 rows — they do not schedule in Toast, so it is
 * not used):
 *   GET /labor/v1/timeEntries?businessDate=YYYYMMDD → TimeEntry[]
 *     guid, deleted, businessDate ("yyyyMMdd"), inDate / outDate (ISO, "+0000" offsets),
 *     employeeReference.guid, jobReference.guid, regularHours, overtimeHours, unpaidBreakTime,
 *     autoClockedOut, modifiedDate — and hourlyWage / tips / sales, which are dropped.
 *   GET /labor/v1/jobs → Job[] (guid, title, deleted)
 *   GET /labor/v1/employees → Employee[] (guid, firstName, chosenName; nothing else is read)
 * UNSURE (noted for CC): whether regularHours excludes unpaid breaks in every config (we prefer
 * Toast's regular + overtime and fall back to (out − in) − unpaidBreakTime); whether timeEntries
 * paginates past a large day (CO days are ~8-9 rows per shop; no paging header is followed).
 */

export interface LaborEntryRow {
  location_id: string;
  time_entry_guid: string;
  business_date: string;
  employee_guid: string;
  employee_first_name: string | null;
  job_guid: string | null;
  job_name: string | null;
  in_at: string;
  out_at: string | null;
  hours: number | null;
  overtime_hours: number | null;
  auto_clocked_out: boolean;
  deleted: boolean;
  source_modified_at: string | null;
}

type Row = Record<string, unknown>;
const obj = (x: unknown): Row => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
const text = (x: unknown): string | null => typeof x === "string" && x.trim() ? x.trim() : null;
const num = (x: unknown): number | null => typeof x === "number" && Number.isFinite(x) ? x : null;

/** Toast instants carry "+0000" offsets; normalise to ISO (null when absent, throws when malformed). */
export function toastInstant(x: unknown): string | null {
  if (x == null || x === "") return null;
  if (typeof x !== "string") throw new Error("toast_labor_invalid_timestamp");
  const fixed = x.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(fixed);
  if (!Number.isFinite(t)) throw new Error("toast_labor_invalid_timestamp");
  return new Date(t).toISOString();
}

/** "20261008" or "2026-10-08" → "2026-10-08". */
export function laborBusinessDate(x: unknown): string | null {
  const s = String(x ?? "").replace(/-/g, "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
}

/** guid → title for the jobs list (deleted jobs keep their title: old entries still name them). */
export function jobTitles(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const j of raw.map(obj)) { const g = text(j.guid); const t = text(j.title); if (g && t) out.set(g, t); }
  return out;
}

/** guid → FIRST name only (chosen name wins). Last names, email, phone, wages: never read. */
export function employeeFirstNames(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const e of raw.map(obj)) {
    const g = text(e.guid);
    const name = text(e.chosenName) ?? text(e.firstName);
    if (g && name) out.set(g, name.split(/\s+/)[0]!);
  }
  return out;
}

/** Hours for one entry: Toast's regular + overtime, else (out − in) − unpaid break; open = null. */
export function entryHours(e: Row, inAt: string, outAt: string | null): number | null {
  const reg = num(e.regularHours); const ot = num(e.overtimeHours);
  if (reg !== null) return Math.round((reg + (ot ?? 0)) * 100) / 100;
  if (!outAt) return null;
  const h = (Date.parse(outAt) - Date.parse(inAt)) / 3_600_000 - (num(e.unpaidBreakTime) ?? 0);
  return h >= 0 ? Math.round(h * 100) / 100 : null;
}

/**
 * Raw timeEntries → the minimal rows we store. An entry on another business date is refused (the
 * endpoint was asked for one day); an entry with no guid / employee / in time is skipped and
 * counted, never guessed.
 */
export function normalizeTimeEntries(
  raw: unknown, ctx: { locationId: string; businessDate: string; jobs: ReadonlyMap<string, string>; employees: ReadonlyMap<string, string> },
): { rows: LaborEntryRow[]; skipped: number } {
  if (!Array.isArray(raw)) throw new Error("toast_labor_bad_payload");
  const rows: LaborEntryRow[] = [];
  let skipped = 0;
  for (const e of raw.map(obj)) {
    const guid = text(e.guid);
    const employee = text(obj(e.employeeReference).guid);
    const inAt = toastInstant(e.inDate);
    const day = laborBusinessDate(e.businessDate) ?? ctx.businessDate;
    if (!guid || !employee || !inAt) { skipped += 1; continue; }
    if (day !== ctx.businessDate) throw new Error("toast_labor_business_date_mismatch");
    const outAt = toastInstant(e.outDate);
    const job = text(obj(e.jobReference).guid);
    rows.push({
      location_id: ctx.locationId, time_entry_guid: guid, business_date: day,
      employee_guid: employee, employee_first_name: ctx.employees.get(employee) ?? null,
      job_guid: job, job_name: job ? ctx.jobs.get(job) ?? null : null,
      in_at: inAt, out_at: outAt, hours: entryHours(e, inAt, outAt), overtime_hours: num(e.overtimeHours),
      auto_clocked_out: e.autoClockedOut === true, deleted: e.deleted === true,
      source_modified_at: toastInstant(e.modifiedDate),
    });
  }
  return { rows, skipped };
}

// ── The digest's LABOR section (read side) ───────────────────────────────────────────────────

export interface LaborEntryFact {
  employeeGuid: string; firstName: string | null; jobName: string | null; businessDate: string;
  hours: number | null; overtimeHours: number | null; open: boolean;
}

export const DAY_OVERTIME_HOURS = 10;
export const WEEK_OVERTIME_HOURS = 40;

export interface LaborSummary {
  totalHours: number;
  /** Entries still clocked in (no out time) — their hours are not in the total. */
  openEntries: number;
  byJob: Array<{ job: string | null; hours: number }>;
  people: Array<{ employeeGuid: string; firstName: string | null; hours: number }>;
  /** Net sales pre-tax / clocked hours; null when either side is unknown or hours are 0. */
  salesPerLaborHourCents: number | null;
  /** More than 10 h in the day. */
  dayOvertime: Array<{ firstName: string | null; hours: number }>;
  /** More than 40 h week-to-date (Mon..D, a LOWER bound: only what was pulled), or Toast's own OT. */
  weekOvertime: Array<{ firstName: string | null; hours: number }>;
}

/** Monday of the ISO week containing `day` (ET calendar date). */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  const back = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Day D's labor from its entries, plus the week-to-date entries for the 40 h flag. */
export function summarizeLabor(day: string, entries: readonly LaborEntryFact[], netSalesCents: number | null): LaborSummary {
  const today = entries.filter((e) => e.businessDate === day);
  const closed = today.filter((e) => !e.open && e.hours !== null);
  const totalHours = round2(closed.reduce((a, e) => a + e.hours!, 0));
  const byJob = new Map<string | null, number>();
  const byPerson = new Map<string, { firstName: string | null; hours: number }>();
  for (const e of closed) {
    byJob.set(e.jobName, (byJob.get(e.jobName) ?? 0) + e.hours!);
    const p = byPerson.get(e.employeeGuid) ?? { firstName: e.firstName, hours: 0 };
    p.hours += e.hours!;
    byPerson.set(e.employeeGuid, p);
  }
  const ws = weekStart(day);
  const week = new Map<string, { firstName: string | null; hours: number; toastOt: boolean }>();
  for (const e of entries) {
    if (e.businessDate < ws || e.businessDate > day || e.hours === null) continue;
    const w = week.get(e.employeeGuid) ?? { firstName: e.firstName, hours: 0, toastOt: false };
    w.hours += e.hours;
    if ((e.overtimeHours ?? 0) > 0 && e.businessDate === day) w.toastOt = true;
    week.set(e.employeeGuid, w);
  }
  const people = [...byPerson].map(([employeeGuid, p]) => ({ employeeGuid, firstName: p.firstName, hours: round2(p.hours) }))
    .sort((a, b) => b.hours - a.hours || String(a.firstName).localeCompare(String(b.firstName)));
  return {
    totalHours,
    openEntries: today.filter((e) => e.open).length,
    byJob: [...byJob].map(([job, hours]) => ({ job, hours: round2(hours) })).sort((a, b) => b.hours - a.hours || String(a.job).localeCompare(String(b.job))),
    people,
    salesPerLaborHourCents: netSalesCents === null || totalHours <= 0 ? null : Math.round(netSalesCents / totalHours),
    dayOvertime: people.filter((p) => p.hours > DAY_OVERTIME_HOURS).map((p) => ({ firstName: p.firstName, hours: p.hours })),
    weekOvertime: [...week.values()].filter((w) => w.hours > WEEK_OVERTIME_HOURS || w.toastOt)
      .map((w) => ({ firstName: w.firstName, hours: round2(w.hours) })).sort((a, b) => b.hours - a.hours),
  };
}
