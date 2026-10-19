/**
 * THE PLANNING HORIZON — pure (Scheduling Phase 2, Task 12; spec §5.8, plan "Horizon").
 *
 * `planHorizon({mode, n?, month?}, today)` → the ISO weeks touched, each with its `buildDays` (in range AND from
 * tomorrow on) and its `keptDays` (the rest of that week: inherited from the head, or empty). Modes: next week;
 * the next n weeks (2..6); the rest of this month (tomorrow → month end); a whole calendar month (this one or
 * the next). The cap is 6 weeks (`horizon_too_long`); anything else that cannot be planned is `horizon_invalid`.
 * A week two or more ahead carries `further_out` ("Forecast is the 4-week average; it gets weaker further out").
 *
 * `horizonActions` applies the never-silently-overwrite rule (J12): an edited week is rebuilt only when the
 * person confirmed THAT week (Tier B at the route); an unconfirmed edited week is SKIPPED and named.
 */
import { ScheduleError } from "./errors-shared";
import { addDays, isoWeekStart, isYmd, weekDays } from "./time-shared";

export const HORIZON_MAX_WEEKS = 6;

export type HorizonRequest =
  | { mode: "next_week" }
  | { mode: "next_weeks"; n: number }
  | { mode: "rest_of_month" }
  | { mode: "month"; month: string };

export interface HorizonWeek {
  weekStart: string;
  buildDays: string[];
  keptDays: string[];
  /** Whole ISO weeks ahead of today's week (1 = next week). */
  weeksAhead: number;
  confidence: "normal" | "further_out";
}

const invalid = (params: Record<string, string | number> = {}) => new ScheduleError("horizon_invalid", { params });
const monthOf = (ymd: string) => ymd.slice(0, 7);

function monthDates(month: string): string[] {
  const out: string[] = [];
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) out.push(d);
  return out;
}

function nextMonth(month: string): string {
  return monthOf(addDays(`${month}-01`, 32));
}

export function planHorizon(req: HorizonRequest, today: string): HorizonWeek[] {
  if (!isYmd(today)) throw invalid({ today: String(today) });
  const tomorrow = addDays(today, 1);
  const thisWeek = isoWeekStart(today);
  let range: string[];
  switch (req.mode) {
    case "next_week":
      range = weekDays(addDays(thisWeek, 7));
      break;
    case "next_weeks": {
      if (!Number.isInteger(req.n) || req.n < 2) throw invalid({ n: String(req.n) });
      if (req.n > HORIZON_MAX_WEEKS) throw new ScheduleError("horizon_too_long", { params: { n: req.n, max: HORIZON_MAX_WEEKS } });
      range = [];
      for (let i = 1; i <= req.n; i++) range.push(...weekDays(addDays(thisWeek, 7 * i)));
      break;
    }
    case "rest_of_month": {
      if (monthOf(tomorrow) !== monthOf(today)) throw invalid({ reason: "month_over" });
      range = monthDates(monthOf(today)).filter((d) => d >= tomorrow);
      break;
    }
    case "month": {
      const m = req.month;
      if (typeof m !== "string" || !/^\d{4}-\d{2}$/.test(m) || !isYmd(`${m}-01`)) throw invalid({ month: String(m) });
      if (m !== monthOf(today) && m !== nextMonth(monthOf(today))) throw invalid({ month: m });
      range = monthDates(m).filter((d) => d >= tomorrow);
      break;
    }
    default:
      throw invalid();
  }
  range = range.filter((d) => d >= tomorrow);
  if (range.length === 0) throw invalid({ reason: "empty" });
  const starts = [...new Set(range.map(isoWeekStart))].sort();
  if (starts.length > HORIZON_MAX_WEEKS) throw new ScheduleError("horizon_too_long", { params: { n: starts.length, max: HORIZON_MAX_WEEKS } });
  return starts.map((weekStart) => {
    const days = weekDays(weekStart);
    let weeksAhead = 0;
    for (let w = thisWeek; w < weekStart; w = addDays(w, 7)) weeksAhead++;
    return {
      weekStart, buildDays: days.filter((d) => range.includes(d)), keptDays: days.filter((d) => !range.includes(d)), weeksAhead,
      confidence: weeksAhead >= 2 ? "further_out" : "normal",
    };
  });
}

export interface HorizonActions {
  build: HorizonWeek[];
  skipped: Array<{ weekStart: string; code: "edited_week_unconfirmed" }>;
  /** Some confirmed week overwrites manager edits: the route asks Tier B (J12). */
  overwritesEdits: boolean;
}

/** Split a plan into the weeks to build and the edited weeks skipped because the person did not confirm them. */
export function horizonActions(weeks: readonly HorizonWeek[], heads: Readonly<Record<string, { edited: boolean } | undefined>>, confirmedWeekStarts: readonly string[]): HorizonActions {
  const build: HorizonWeek[] = [];
  const skipped: HorizonActions["skipped"] = [];
  let overwritesEdits = false;
  for (const w of weeks) {
    if (heads[w.weekStart]?.edited) {
      if (!confirmedWeekStarts.includes(w.weekStart)) { skipped.push({ weekStart: w.weekStart, code: "edited_week_unconfirmed" }); continue; }
      overwritesEdits = true;
    }
    build.push(w);
  }
  return { build, skipped, overwritesEdits };
}
