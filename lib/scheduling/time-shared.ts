/**
 * THE SCHEDULE TIME GRID — pure (Scheduling Phase 2, J5).
 *
 * Schedule time is ET WALL-CLOCK quarter-hours on a business date: `q` ∈ 0..96, where q = 0 is 00:00
 * and q = 96 is the end of the day (24:00). The shop day (7:00–21:00) never touches the 1–3 AM DST
 * hours, so wall time is exact; instants are derived only at the edges, through
 * `etWallMinutesInstant` (lib/operational-day). Today is ALWAYS a parameter — this module reads no
 * clock. Weekdays are ISO (1 = Monday … 7 = Sunday), through the pulse's `dowOf`.
 */
import { dowOf } from "@/lib/pulse/baseline-shared";
import { formatClockTime } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import { ScheduleError } from "./errors-shared";

export const Q_PER_DAY = 96;
export const Q_MINUTES = 15;
export const Q_PER_HOUR = 4;

const pad = (n: number) => String(n).padStart(2, "0");

export function isQuarter(q: unknown): q is number {
  return typeof q === "number" && Number.isInteger(q) && q >= 0 && q <= Q_PER_DAY;
}

/** "HH:MM" for a quarter; 96 → "24:00". Refuses anything off the grid. */
export function qToWall(q: number): string {
  if (!isQuarter(q)) throw new ScheduleError("edit_off_grid", { params: { q: String(q) } });
  return `${pad(Math.floor(q / Q_PER_HOUR))}:${pad((q % Q_PER_HOUR) * Q_MINUTES)}`;
}

/**
 * The quarter of an "HH:MM" (or "HH:MM:SS" with :00 seconds) wall time. A time between quarters is
 * REFUSED `edit_off_grid`, never rounded; "24:00" is the end of the day.
 */
export function wallToQ(wall: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall);
  if (!m) throw new ScheduleError("edit_off_grid", { params: { time: wall } });
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? "0");
  if (sec !== 0 || min > 59 || min % Q_MINUTES !== 0 || h > 24 || (h === 24 && min !== 0)) {
    throw new ScheduleError("edit_off_grid", { params: { time: wall } });
  }
  return h * Q_PER_HOUR + min / Q_MINUTES;
}

/** Minutes → whole quarters, rounded UP (a 50-minute checklist needs 4 quarters). */
export function ceil15Q(minutes: number): number {
  return Math.ceil(minutes / Q_MINUTES);
}

/** A quarter rendered for people, language-aware (lib/i18n/format); 96 renders as midnight. */
export function formatQ(q: number, language: Language): string {
  return formatClockTime(q === Q_PER_DAY ? "00:00" : qToWall(q), language);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date "YYYY-MM-DD" (2026-02-30 is not one). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
}

/** The calendar date `n` days after `ymd` (negative = before) — pure Date.UTC math, DST-immune. */
export function addDays(ymd: string, n: number): string {
  if (!isYmd(ymd)) throw new ScheduleError("horizon_invalid", { params: { date: ymd } });
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** ISO weekday 1 = Monday … 7 = Sunday (the pulse convention). */
export function isoDowOf(ymd: string): number {
  return dowOf(ymd);
}

/** The 7 business dates of the ISO week starting `weekStart` (which must be a Monday). */
export function weekDays(weekStart: string): string[] {
  if (!isYmd(weekStart) || isoDowOf(weekStart) !== 1) throw new ScheduleError("horizon_invalid", { params: { date: String(weekStart) } });
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The Monday of the ISO week holding `ymd`. */
export function isoWeekStart(ymd: string): string {
  return addDays(ymd, 1 - isoDowOf(ymd));
}
