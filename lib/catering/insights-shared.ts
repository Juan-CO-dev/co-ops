/**
 * Catering insights v2 — the PURE half (client-safe, zero I/O).
 *
 * Windows are Juan's ruling (2026-09-05): this week · this month · last 30 days · all time.
 * Money is counted by EVENT date (when the catering happens); lead flow by CREATED date
 * (when it arrives) — the RPC (0194) does that split; this module only names the windows,
 * builds the ET month grid the calendar renders, and groups the RPC's event list per day.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import { timeWindowMinutes } from "@/lib/midshift-shared";

export type WindowKey = "this_week" | "this_month" | "last_30" | "all_time";

export const INSIGHT_WINDOWS: ReadonlyArray<{ key: WindowKey; labelKey: TranslationKey }> = [
  { key: "this_week", labelKey: "catering.insights.window.this_week" as TranslationKey },
  { key: "this_month", labelKey: "catering.insights.window.this_month" as TranslationKey },
  { key: "last_30", labelKey: "catering.insights.window.last_30" as TranslationKey },
  { key: "all_time", labelKey: "catering.insights.window.all_time" as TranslationKey },
];

export type BookedStage = "confirmed" | "out" | "completed";

export interface CalendarEvent {
  id: string;
  eventDate: string;          // YYYY-MM-DD (ET calendar date, as stored)
  timeWindow: string | null;
  name: string;
  headcount: number | null;
  source: string | null;
  stage: BookedStage;
  locationId: string;
  valueCents: number;
}

export interface WindowStats {
  leadsNew: number;
  bySource: Record<string, number>;
  byStage: Record<string, number>;
  bookedEvents: number;
  bookedValueCents: number;
  lost: number;
  winRateBps: number | null;
  avgHeadcount: number | null;
  pipelineOpenValueCents: number;
}

export interface GridDay { date: string; inMonth: boolean; }
export interface MonthGrid { month: string; weeks: GridDay[][]; }

/** "YYYY-MM" of a "YYYY-MM-DD". */
export function monthKey(ymd: string): string { return ymd.slice(0, 7); }

/** Add n months to a "YYYY-MM" key with plain integer arithmetic (no Date, no TZ). */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

function ymd(y: number, m0: number, d: number): string {
  // UTC-anchored so no local TZ can shift a calendar day; only ever used for date arithmetic here.
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

/** Monday-start month grid of full weeks covering the month; days outside are flagged. */
export function monthGrid(month: string): MonthGrid {
  const y = Number(month.slice(0, 4)); const m0 = Number(month.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(y, m0, 1));
  const daysInMonth = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;           // Mon=0 … Sun=6
  const weeks: GridDay[][] = [];
  let day = 1 - lead;
  while (day <= daysInMonth) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++, day++) week.push({ date: ymd(y, m0, day), inMonth: day >= 1 && day <= daysInMonth });
    weeks.push(week);
  }
  return { month, weeks };
}

/** Events keyed by date (insertion order = ascending date), chronological within a day. */
export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const sorted = [...events].sort((a, b) =>
    a.eventDate.localeCompare(b.eventDate) ||
    timeWindowMinutes(a.timeWindow) - timeWindowMinutes(b.timeWindow) ||
    (a.timeWindow ?? "").localeCompare(b.timeWindow ?? ""));
  const out = new Map<string, CalendarEvent[]>();
  for (const e of sorted) (out.get(e.eventDate) ?? out.set(e.eventDate, []).get(e.eventDate)!).push(e);
  return out;
}

/** Dot fill per stage — FILL roles only (co-success is a fill/dot role, never text). */
export function stageDot(stage: BookedStage): string {
  return stage === "confirmed" ? "bg-co-gold" : stage === "out" ? "bg-co-text" : "bg-co-success";
}
