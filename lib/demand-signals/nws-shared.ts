/**
 * Demand signals (item 4 PR 2): THE NWS ADAPTER, pure half. No I/O, no clock (callers pass `nowMs`).
 * The National Weather Service API (api.weather.gov): the hourly forecast and the active alerts for a point.
 *
 * NWS_SOURCE is this adapter's DEFINITION. Its hash is what the collector sends with every write, and 0343
 * refuses the write unless that exact definition is the register's current one AND a person marked it
 * verified. So editing an endpoint, the adapter version or the terms fields here makes the source unverified
 * again until it is re-registered (scripts/seed-demand-sources.ts) and re-marked. That is the design.
 *
 * WHAT IS KEPT (an explicit allow-list; anything else the API returns is dropped before any write):
 *   hourly  the valid hour, temperature (F), chance of precipitation, wind speed (mph), relative humidity,
 *           day / night, the short condition text. Only service hours (ET) inside the horizon.
 *   alerts  the alert id, its event name, severity, and the ET dates it covers. No description text.
 * A payload that does not have the documented shape is `bad_payload` as a whole: never a partial read.
 * Payload shapes were read from the live API on 2026-11-18 (the fixtures in tests/demand-signals-nws.test.ts).
 */
import { etCalendarDate, etClockTime } from "@/lib/operational-day";
import { definitionAddress, type SourceDefinition } from "./sources-shared";

export const NWS_HOST = "api.weather.gov";
export const NWS_SOURCE_ID = "nws";

export const NWS_SOURCE: SourceDefinition = {
  sourceId: NWS_SOURCE_ID,
  name: "National Weather Service API (api.weather.gov)",
  category: "weather",
  cost: "free",
  homepageUrl: "https://www.weather.gov/documentation/services-web-api",
  endpoints: [
    "https://api.weather.gov/points/{lat},{lon}",
    "https://api.weather.gov/gridpoints/{office}/{x},{y}/forecast/hourly",
    "https://api.weather.gov/alerts/active?point={lat},{lon}",
  ],
  format: "GeoJSON",
  gives: "Hourly forecast for about seven days (temperature, chance of precipitation, wind, humidity, condition) and active watches, warnings and advisories for a point.",
  auth: "None. A User-Agent that identifies the application is required.",
  rateLimit: "Not published (\"allows a generous amount for typical use\"); retry after a few seconds on a rate error.",
  termsUrl: "https://www.weather.gov/documentation/services-web-api",
  termsQuote: "All of the information presented via the API is intended to be open data, free to use for any purpose.",
  termsStatus: "verified",
  termsCheckedOn: "2026-11-18",
  gate: "allow_with_conditions",
  conditions: [
    "Send an identifying User-Agent (env NWS_USER_AGENT); with none set the adapter makes no request.",
    "Back off on rate errors: at most 2 retries, honouring Retry-After.",
    "If NWS material is ever shown outside the app, identify NWS as its source (weather.gov/disclaimer).",
  ],
  caveats: "The hourly forecast reaches about 6.5 days, so it informs within-week decisions, not the Wednesday schedule draft (5 to 11 days out). The rate limit is undisclosed.",
  adapter: { key: "nws", version: 1 },
};
/** The definition's canonical text and hash: what the register stores and what every write names. */
export const NWS_DEFINITION = definitionAddress(NWS_SOURCE);

/** ET wall hours kept: 06:00 through 21:00, sixteen a day. */
export const WEATHER_SERVICE_HOURS = { from: 6, to: 22 } as const;
export const WEATHER_HORIZON_DAYS = 7;
/** 2 shops x 7 days x 16 service hours. A run that would write more refuses (0343 holds the same number). */
export const WEATHER_ROWS_PER_RUN_CAP = 224;
export const ALERTS_PER_SHOP_CAP = 50;
const HOUR_MS = 3_600_000;

const coord = (n: number) => String(Number(n.toFixed(4)));
const validPoint = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** The points lookup for a shop (four decimals at most: NWS redirects anything finer). Null = not a real point. */
export function nwsPointUrl(lat: number, lon: number): string | null {
  return validPoint(lat, lon) ? `https://${NWS_HOST}/points/${coord(lat)},${coord(lon)}` : null;
}
export function nwsAlertsUrl(lat: number, lon: number): string | null {
  return validPoint(lat, lon) ? `https://${NWS_HOST}/alerts/active?point=${coord(lat)},${coord(lon)}` : null;
}

const HOURLY_URL = /^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d{1,3},\d{1,3}\/forecast\/hourly$/;
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The hourly forecast URL a points answer names. Only an api.weather.gov gridpoint URL is accepted. */
export function hourlyUrlFromPoint(json: unknown): string | null {
  const url = obj(obj(json)?.properties)?.forecastHourly;
  return typeof url === "string" && HOURLY_URL.test(url) ? url : null;
}

export interface WeatherRow {
  valid_hour: string;
  temperature_f: number;
  precip_probability_pct: number | null;
  wind_speed_mph: number | null;
  relative_humidity_pct: number | null;
  is_daytime: boolean;
  condition: string;
}
export type Normalized<T> = { ok: true; rows: T[] } | { ok: false; code: "bad_payload" };
const BAD = { ok: false, code: "bad_payload" } as const;

const instant = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
/** `{ value }` percent: absent or null value = unknown (null); anything else must be a whole 0..100. */
function percent(v: unknown): number | null | "bad" {
  if (v === undefined || v === null) return null;
  const value = obj(v)?.value;
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return "bad";
  return Math.round(value);
}
/** "2 mph" or "5 to 10 mph": the higher figure. Absent = unknown; any other text is a bad payload. */
function windMph(v: unknown): number | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "bad";
  const m = v.match(/^(\d{1,3})(?: to (\d{1,3}))? mph$/);
  if (!m) return "bad";
  const mph = Math.max(Number(m[1]), m[2] ? Number(m[2]) : 0);
  return mph <= 250 ? mph : "bad";
}

/**
 * The hourly forecast as rows for 0343's demand_weather_ingest, plus when the source issued it (`updateTime`).
 * Kept: hours from the current hour up to the horizon whose ET wall hour is a service hour.
 */
export function normalizeHourly(json: unknown, nowMs: number): (Normalized<WeatherRow> & { ok: true; issuedAt: string }) | { ok: false; code: "bad_payload" } {
  const props = obj(obj(json)?.properties);
  const issued = instant(props?.updateTime);
  const periods = props?.periods;
  if (!props || issued === null || !Array.isArray(periods) || periods.length === 0 || periods.length > 400) return BAD;
  const from = Math.floor(nowMs / HOUR_MS) * HOUR_MS, until = from + WEATHER_HORIZON_DAYS * 24 * HOUR_MS;
  const rows: WeatherRow[] = [];
  const seen = new Set<number>();
  for (const raw of periods) {
    const p = obj(raw);
    const start = instant(p?.startTime);
    if (!p || start === null || start % HOUR_MS !== 0 || seen.has(start)) return BAD;
    seen.add(start);
    const temperature = p.temperature, condition = p.shortForecast;
    if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < -80 || temperature > 140 || p.temperatureUnit !== "F") return BAD;
    if (typeof p.isDaytime !== "boolean" || typeof condition !== "string" || condition.trim().length < 1 || condition.length > 160) return BAD;
    const pop = percent(p.probabilityOfPrecipitation), humidity = percent(p.relativeHumidity), wind = windMph(p.windSpeed);
    if (pop === "bad" || humidity === "bad" || wind === "bad") return BAD;
    if (start < from || start >= until) continue;
    const iso = new Date(start).toISOString();
    const etHour = Number(etClockTime(iso).slice(0, 2));
    if (etHour < WEATHER_SERVICE_HOURS.from || etHour >= WEATHER_SERVICE_HOURS.to) continue;
    rows.push({ valid_hour: iso, temperature_f: Math.round(temperature * 10) / 10, precip_probability_pct: pop, wind_speed_mph: wind,
      relative_humidity_pct: humidity, is_daytime: p.isDaytime, condition: condition.trim() });
  }
  rows.sort((a, b) => (a.valid_hour < b.valid_hour ? -1 : 1));
  return { ok: true, rows, issuedAt: new Date(issued).toISOString() };
}

export interface AlertEventRow {
  external_key: string;
  category: "weather_alert";
  valid_from: string;
  valid_to: string;
  title: string;
  expected_impact: "unknown";
  severity: "minor" | "moderate" | "severe" | "extreme" | "unknown";
  issued_at: string;
}
const SEVERITIES = ["minor", "moderate", "severe", "extreme", "unknown"] as const;
const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

/**
 * Active alerts as day events for 0343's demand_events_ingest. Only `Actual` alerts that are not cancellations;
 * the dates are the ET days from onset (else effective) to ends (else expires). No description is kept.
 */
export function normalizeAlerts(json: unknown): Normalized<AlertEventRow> {
  const features = obj(json)?.features;
  if (!Array.isArray(features) || features.length > 500) return BAD;
  const rows: AlertEventRow[] = [];
  const seen = new Set<string>();
  for (const raw of features) {
    const p = obj(obj(raw)?.properties);
    if (!p) return BAD;
    const id = p.id, event = p.event;
    const sent = instant(p.sent), start = instant(p.onset) ?? instant(p.effective), end = instant(p.ends) ?? instant(p.expires);
    if (typeof id !== "string" || id.length < 1 || id.length > 200 || typeof event !== "string" || event.trim().length < 2 || event.length > 120) return BAD;
    if (sent === null || start === null || end === null || typeof p.status !== "string" || typeof p.messageType !== "string") return BAD;
    if (p.status !== "Actual" || p.messageType === "Cancel" || seen.has(id)) continue;
    seen.add(id);
    const from = etCalendarDate(new Date(start).toISOString());
    let to = etCalendarDate(new Date(Math.max(start, end)).toISOString());
    if (dayNumber(to) - dayNumber(from) > 60) to = new Date((dayNumber(from) + 60) * 86_400_000).toISOString().slice(0, 10);
    const severity = typeof p.severity === "string" ? p.severity.toLowerCase() : "unknown";
    rows.push({ external_key: id, category: "weather_alert", valid_from: from, valid_to: to, title: event.trim(), expected_impact: "unknown",
      severity: (SEVERITIES as ReadonlyArray<string>).includes(severity) ? (severity as AlertEventRow["severity"]) : "unknown",
      issued_at: new Date(sent).toISOString() });
  }
  if (rows.length > ALERTS_PER_SHOP_CAP) return BAD;
  rows.sort((a, b) => (a.external_key < b.external_key ? -1 : 1));
  return { ok: true, rows };
}
