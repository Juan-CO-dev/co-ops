/**
 * Demand signals (item 4 PR 5): WHAT THE PAGE SHOWS, pure. No I/O, no clock (the caller passes `today`).
 *
 * The page is a READ of signals a person can plan by. It changes no order, no par and no schedule, and it
 * shows NO number we computed about demand: a signal is NAMED (an event, a forecast hour), never summed.
 *
 * THREE LAWS HELD HERE:
 *   · UNKNOWN IS NEVER ZERO. A day with no forecast row has no weather, and says WHY (`WeatherGap`): the source
 *     is not verified, the day is past the forecast's reach, nothing was collected, or the read failed. A
 *     missing chance of rain is null ("not given"), never 0%.
 *   · "NOTHING" IS A CLAIM. A section is `ok` only when its read finished whole; otherwise it is `unreadable`
 *     and the page says so. An empty list is shown as empty only under `ok`.
 *   · A DERIVED FIGURE INHERITS ITS INPUTS. A day's high / low is over the hours we hold; when fewer than the
 *     service day's hours are held it is marked `partial` with the count, and the same for the rain chance.
 *
 * REVOCATION (contracts-shared.ts): the rows given to this module were read through the gated readers at the
 * `render` use point, and `weatherGapFor` asks `usableNow` with the register read for THIS render, so a
 * revoked source shows as "not verified" and never as "no weather".
 */
import { etCalendarDate } from "@/lib/operational-day";
import type { SourceStatus } from "./contracts-shared";
import { usableNow, type SourceState } from "./sources-shared";

/** How far ahead the day strip looks, and how far the event list (0343's reader takes at most 62 days). */
export const SIGNALS_HORIZON_DAYS = 14;
export const SIGNALS_EVENT_WINDOW_DAYS = 60;
/** The NWS hourly forecast reaches about 7 days; the collector keeps service hours only (06:00 to 21:00 ET). */
export const WEATHER_REACH_DAYS = 7;
export const WEATHER_HOURS_PER_DAY = 16;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;
/** `ymd` plus `n` calendar days (pure calendar math; no zone). */
export function addDays(ymd: string, n: number): string {
  if (!YMD.test(ymd)) throw new Error("bad_date");
  return new Date((dayNumber(ymd) + n) * 86_400_000).toISOString().slice(0, 10);
}
/** `n` consecutive dates starting at `from`. */
export function dateRun(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

export interface WeatherHourIn {
  sourceId: string; validHour: string; availableAt: string;
  temperatureF: number; precipProbabilityPct: number | null; condition: string;
}
export interface EventIn {
  id: string; origin: "manual" | "feed"; sourceId: string | null; locationId: string | null; category: string;
  validFrom: string; validTo: string; startLocal: string | null; endLocal: string | null; title: string; expectedImpact: string; severity: string | null;
}

export interface WeatherDay {
  /** Hours held for this day, of WEATHER_HOURS_PER_DAY. */
  hours: number;
  partial: boolean;
  highF: number;
  lowF: number;
  /** The greatest chance of rain over the hours that gave one; null = no hour gave one. */
  precipMaxPct: number | null;
  /** How many of the held hours gave a chance of rain. */
  precipHours: number;
  /** The most frequent condition text of the day, as the source wrote it (English). */
  condition: string;
  /** When we last received any of these hours. */
  latestAvailableAt: string;
  sourceIds: string[];
}
/** Why a day has no weather. Never rendered as a number. */
export type WeatherGap = "source_not_verified" | "beyond_reach" | "not_collected" | "unreadable";

export interface SignalsDay {
  date: string;
  weather: WeatherDay | null;
  /** Set exactly when `weather` is null. */
  weatherGap: WeatherGap | null;
  /** Events in force on this date (ids into the event list), in the list's order. null = the event read failed. */
  eventIds: string[] | null;
}

/** One day's hours → its summary. `hours` must be non-empty and all of one ET date. */
export function summarizeWeatherDay(hours: ReadonlyArray<WeatherHourIn>): WeatherDay {
  if (hours.length === 0) throw new Error("no_hours");
  const temps = hours.map((h) => h.temperatureF);
  const precip = hours.map((h) => h.precipProbabilityPct).filter((p): p is number => p !== null && Number.isFinite(p));
  const counts = new Map<string, number>();
  for (const h of hours) counts.set(h.condition, (counts.get(h.condition) ?? 0) + 1);
  // Most frequent; a tie goes to the text that sorts first, so the answer never depends on row order.
  const condition = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  return {
    hours: hours.length, partial: hours.length < WEATHER_HOURS_PER_DAY,
    highF: Math.max(...temps), lowF: Math.min(...temps),
    precipMaxPct: precip.length === 0 ? null : Math.max(...precip), precipHours: precip.length,
    condition, latestAvailableAt: hours.map((h) => h.availableAt).sort().at(-1)!,
    sourceIds: [...new Set(hours.map((h) => h.sourceId))].sort(),
  };
}

/** The status of the weather feed for THIS render, from the register as it reads now. */
export function weatherSourceStatus(states: ReadonlyArray<SourceState>, sourceId: string): SourceStatus {
  const decision = usableNow(states, [sourceId], "render");
  if (decision.ok) return "verified";
  return decision.code === "source_revoked" ? "revoked" : "unverified";
}

/** Why a day with no forecast row has none. */
export function weatherGapFor(args: { date: string; today: string; read: "ok" | "unreadable"; status: SourceStatus }): WeatherGap {
  if (args.status !== "verified") return "source_not_verified";
  if (args.read === "unreadable") return "unreadable";
  return dayNumber(args.date) - dayNumber(args.today) >= WEATHER_REACH_DAYS ? "beyond_reach" : "not_collected";
}

export type SectionRead<T> = { read: "ok"; rows: ReadonlyArray<T> } | { read: "unreadable" };

/** The day strip: each date with its weather (or the reason there is none) and the events in force on it. */
export function buildSignalsDays(args: {
  today: string; horizonDays: number; weather: SectionRead<WeatherHourIn>; weatherStatus: SourceStatus; events: SectionRead<EventIn>;
}): SignalsDay[] {
  const byDate = new Map<string, WeatherHourIn[]>();
  if (args.weather.read === "ok") {
    for (const h of args.weather.rows) {
      const d = etCalendarDate(h.validHour);
      const list = byDate.get(d);
      if (list) list.push(h); else byDate.set(d, [h]);
    }
  }
  return dateRun(args.today, args.horizonDays).map((date) => {
    const hours = byDate.get(date);
    const weather = hours && hours.length > 0 ? summarizeWeatherDay(hours) : null;
    return {
      date, weather,
      weatherGap: weather ? null : weatherGapFor({ date, today: args.today, read: args.weather.read, status: args.weatherStatus }),
      eventIds: args.events.read === "ok" ? args.events.rows.filter((e) => e.validFrom <= date && e.validTo >= date).map((e) => e.id) : null,
    };
  });
}

/** How a collection run reads on the page. `never` = no run is recorded for this feed and shop. */
export type RunState = "fresh" | "stale" | "failed" | "never";
/** The cron runs every six hours; a feed whose last good run is older than two passes is stale. */
export const RUN_STALE_AFTER_MS = 13 * 3_600_000;
export function runStateOf(run: { outcome: string; finishedAt: string } | null, lastGoodAt: string | null, nowMs: number): RunState {
  if (!run) return "never";
  if (run.outcome === "failed") return "failed";
  const at = Date.parse(lastGoodAt ?? run.finishedAt);
  return Number.isFinite(at) && nowMs - at <= RUN_STALE_AFTER_MS ? "fresh" : "stale";
}
