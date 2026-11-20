/**
 * Item 4 PR 5: what the signals page shows, as pure rules (lib/demand-signals/signals-view-shared.ts) and who may
 * open it (access-shared.ts). The laws under test: an unknown is never a zero (a day with no forecast carries a
 * REASON, a missing chance of rain is null), "none" needs a read that finished whole, and a figure over part of a
 * day says it is over part of a day.
 */
import { describe, expect, it } from "vitest";
import { canEnterDemandEvent, canMarkSource, canViewDemandSignals, demandSignalShops } from "@/lib/demand-signals/access-shared";
import { parseDefinitionText, type SourceState } from "@/lib/demand-signals/sources-shared";
import { parseDemandEvent, parseSourceMark } from "@/lib/demand-signals/input-shared";
import {
  RUN_STALE_AFTER_MS, WEATHER_HOURS_PER_DAY, addDays, buildSignalsDays, dateRun, runStateOf, summarizeWeatherDay, weatherGapFor, weatherSourceStatus,
  type EventIn, type WeatherHourIn,
} from "@/lib/demand-signals/signals-view-shared";

const hour = (iso: string, t: number, p: number | null, condition = "Sunny", availableAt = "2026-11-19T10:00:00Z"): WeatherHourIn =>
  ({ sourceId: "nws", validHour: iso, availableAt, temperatureF: t, precipProbabilityPct: p, condition });
const event = (id: string, from: string, to: string, over: Partial<EventIn> = {}): EventIn =>
  ({ id, origin: "manual", sourceId: null, locationId: "shop-a", category: "sports_game", validFrom: from, validTo: to, startLocal: null, endLocal: null, title: id, expectedImpact: "up", severity: null, ...over });
const nws = (status: SourceState["status"]): SourceState[] => [{ sourceId: "nws", definitionHash: "h", gate: "allow_with_conditions", adapter: "nws@1", status }];
/** 16 service hours of one ET day in November (EST = UTC-5): 06:00 ET is 11:00Z. */
const fullDay = (ymd: string, temp = 50, precip: number | null = 10) =>
  Array.from({ length: 16 }, (_, i) => hour(new Date(Date.parse(`${ymd}T11:00:00Z`) + i * 3_600_000).toISOString(), temp + i, precip));

describe("calendar helpers", () => {
  it("adds days across a month, a year and a DST change without a zone", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");   // the fall-back day is still one calendar day
    expect(dateRun("2026-02-27", 3)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(() => addDays("tomorrow", 1)).toThrow("bad_date");
  });
});

describe("a day's weather", () => {
  it("is the high, the low and the greatest chance of rain over the hours held", () => {
    const w = summarizeWeatherDay([hour("2026-11-20T11:00:00Z", 41.4, 10), hour("2026-11-20T17:00:00Z", 58.6, 70, "Rain"), hour("2026-11-20T20:00:00Z", 50, 30, "Rain")]);
    expect(w).toMatchObject({ hours: 3, highF: 58.6, lowF: 41.4, precipMaxPct: 70, precipHours: 3, condition: "Rain", partial: true, sourceIds: ["nws"] });
  });
  it("a chance of rain nobody gave is null, never 0", () => {
    const w = summarizeWeatherDay([hour("2026-11-20T11:00:00Z", 40, null), hour("2026-11-20T12:00:00Z", 42, null)]);
    expect(w.precipMaxPct).toBeNull();
    expect(w.precipHours).toBe(0);
  });
  it("says for how many hours the chance of rain was given", () => {
    const w = summarizeWeatherDay([hour("2026-11-20T11:00:00Z", 40, null), hour("2026-11-20T12:00:00Z", 42, 0)]);
    expect(w).toMatchObject({ precipMaxPct: 0, precipHours: 1, hours: 2 });   // a GIVEN 0% is a value
  });
  it("is partial below the service day's sixteen hours and whole at sixteen", () => {
    expect(summarizeWeatherDay(fullDay("2026-11-20").slice(0, 15)).partial).toBe(true);
    const whole = summarizeWeatherDay(fullDay("2026-11-20"));
    expect(whole.hours).toBe(WEATHER_HOURS_PER_DAY);
    expect(whole.partial).toBe(false);
  });
  it("the condition does not depend on row order, and the newest receipt is reported", () => {
    const rows = [hour("2026-11-20T11:00:00Z", 40, 0, "Cloudy", "2026-11-19T04:00:00Z"), hour("2026-11-20T12:00:00Z", 41, 0, "Sunny", "2026-11-19T16:00:00Z")];
    expect(summarizeWeatherDay(rows).condition).toBe("Cloudy");
    expect(summarizeWeatherDay([...rows].reverse()).condition).toBe("Cloudy");
    expect(summarizeWeatherDay(rows).latestAvailableAt).toBe("2026-11-19T16:00:00Z");
  });
  it("refuses an empty day rather than inventing one", () => { expect(() => summarizeWeatherDay([])).toThrow("no_hours"); });
});

describe("why a day has no weather", () => {
  const base = { today: "2026-11-19", read: "ok" as const };
  it("a source that is not verified is the reason, before anything else", () => {
    for (const status of ["unverified", "revoked"] as const) {
      expect(weatherGapFor({ ...base, date: "2026-11-19", status })).toBe("source_not_verified");
      expect(weatherGapFor({ ...base, date: "2026-11-30", status, read: "unreadable" })).toBe("source_not_verified");
    }
  });
  it("a failed read is 'unreadable', never 'not collected'", () => {
    expect(weatherGapFor({ today: "2026-11-19", date: "2026-11-20", read: "unreadable", status: "verified" })).toBe("unreadable");
  });
  it("past the forecast's reach is its own reason", () => {
    expect(weatherGapFor({ ...base, date: "2026-11-25", status: "verified" })).toBe("not_collected");   // day 6
    expect(weatherGapFor({ ...base, date: "2026-11-26", status: "verified" })).toBe("beyond_reach");    // day 7
  });
  it("the status is the register's answer for THIS render (revoked is not 'unverified', and an unlisted source is unverified)", () => {
    expect(weatherSourceStatus(nws("verified"), "nws")).toBe("verified");
    expect(weatherSourceStatus(nws("revoked"), "nws")).toBe("revoked");
    expect(weatherSourceStatus(nws("unverified"), "nws")).toBe("unverified");
    expect(weatherSourceStatus([], "nws")).toBe("unverified");
  });
});

describe("the day strip", () => {
  const today = "2026-11-19";
  it("puts each hour on its ET date and each event on every day it is in force", () => {
    const days = buildSignalsDays({ today, horizonDays: 14, weatherStatus: "verified",
      // 02:00Z on the 21st is 9 PM ET on the 20th: it belongs to the 20th.
      weather: { read: "ok", rows: [hour("2026-11-20T11:00:00Z", 40, 20), hour("2026-11-21T02:00:00Z", 35, 60)] },
      events: { read: "ok", rows: [event("game", "2026-11-20", "2026-11-20"), event("festival", "2026-11-20", "2026-11-22"), event("ongoing", "2026-11-10", "2026-11-19")] } });
    expect(days).toHaveLength(14);
    expect(days.map((d) => d.date).slice(0, 3)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(days[1]!.weather).toMatchObject({ hours: 2, highF: 40, lowF: 35, precipMaxPct: 60 });
    expect(days[1]!.weatherGap).toBeNull();
    expect(days[0]!.eventIds).toEqual(["ongoing"]);
    expect(days[1]!.eventIds).toEqual(["game", "festival"]);
    expect(days[3]!.eventIds).toEqual(["festival"]);
    expect(days[4]!.eventIds).toEqual([]);
  });
  it("a day with no row has NO weather object and exactly one reason (never zeros)", () => {
    const days = buildSignalsDays({ today, horizonDays: 14, weatherStatus: "verified", weather: { read: "ok", rows: [] }, events: { read: "ok", rows: [] } });
    for (const d of days) { expect(d.weather).toBeNull(); expect(d.weatherGap).not.toBeNull(); }
    expect(days[0]!.weatherGap).toBe("not_collected");
    expect(days[13]!.weatherGap).toBe("beyond_reach");
    expect(JSON.stringify(days)).not.toMatch(/"highF":0|"precipMaxPct":0/);
  });
  it("a revoked source shows 'not verified' on every day, whatever rows are handed in for other days", () => {
    const days = buildSignalsDays({ today, horizonDays: 3, weatherStatus: "revoked", weather: { read: "ok", rows: [] }, events: { read: "ok", rows: [] } });
    expect(days.map((d) => d.weatherGap)).toEqual(["source_not_verified", "source_not_verified", "source_not_verified"]);
  });
  it("events that could not be read are null on every day, never an empty list", () => {
    const days = buildSignalsDays({ today, horizonDays: 2, weatherStatus: "verified", weather: { read: "unreadable" }, events: { read: "unreadable" } });
    expect(days.map((d) => d.eventIds)).toEqual([null, null]);
    expect(days.map((d) => d.weatherGap)).toEqual(["unreadable", "unreadable"]);
  });
});

describe("how a feed's last run reads", () => {
  const now = Date.parse("2026-11-19T22:00:00Z");
  it("no run is 'never', a failed last run is 'failed', an old good run is 'stale'", () => {
    expect(runStateOf(null, null, now)).toBe("never");
    expect(runStateOf({ outcome: "failed", finishedAt: "2026-11-19T21:50:00Z" }, "2026-11-19T15:50:00Z", now)).toBe("failed");
    expect(runStateOf({ outcome: "unchanged", finishedAt: "2026-11-19T21:50:00Z" }, "2026-11-19T21:50:00Z", now)).toBe("fresh");
    expect(runStateOf({ outcome: "written", finishedAt: new Date(now - RUN_STALE_AFTER_MS - 1).toISOString() }, null, now)).toBe("stale");
    expect(runStateOf({ outcome: "written", finishedAt: "not a time" }, null, now)).toBe("stale");   // an unreadable time is never 'fresh'
  });
});

describe("who may open the page (trusted role, never a level)", () => {
  const shops = [{ id: "a" }, { id: "b" }];
  it("a GM sees the shops they belong to; MoO, Owner and CGS see every shop; level-6 roles see none", () => {
    expect(demandSignalShops("gm", ["b"], shops)).toEqual([{ id: "b" }]);
    expect(demandSignalShops("gm", [], shops)).toEqual([]);
    for (const role of ["moo", "owner", "cgs"]) expect(demandSignalShops(role, [], shops)).toEqual(shops);
    for (const role of ["agm", "prep_mgr", "catering_mgr", "social_media_mgr", "shift_lead", "key_holder", "employee", ""]) {
      expect(canViewDemandSignals(role), role).toBe(false);
      expect(demandSignalShops(role, ["a", "b"], shops), role).toEqual([]);
      expect(canEnterDemandEvent(role), role).toBe(false);
      expect(canMarkSource(role), role).toBe(false);
    }
    expect(canViewDemandSignals("gm")).toBe(true);
    expect(canMarkSource("gm")).toBe(false);
  });
});

describe("what a person sends (one rule for the form and the route)", () => {
  it("the form's payload is parsed by the route's own parser", () => {
    const ok = { locationId: "1c000000-0000-4000-8000-000000000002", category: "sports_game", validFrom: "2026-11-21", validTo: "2026-11-21", startLocal: "19:00", endLocal: null,
      title: "Home game", impact: "up", supersedesId: null, retract: false };
    expect(parseDemandEvent(ok)).toMatchObject({ title: "Home game", note: null, retract: false });
    expect(parseDemandEvent({ ...ok, title: "x" })).toBeNull();
    expect(parseDemandEvent({ ...ok, validTo: "2026-11-20" })).toBeNull();
    expect(parseDemandEvent({ ...ok, startLocal: "19:00", endLocal: "18:00" })).toBeNull();
    expect(parseDemandEvent({ supersedesId: "1c000000-0000-4000-8000-000000000009", retract: true })).toMatchObject({ retract: true });
    expect(parseSourceMark({ sourceId: "nws", definitionHash: "a".repeat(64), status: "verified", note: "ok" })).toBeNull();   // a note under 3 characters
  });
  it("a stored definition is read back for display, and anything else answers null", () => {
    const d = parseDefinitionText(JSON.stringify({ sourceId: "nws", endpoints: ["https://api.weather.gov/points"], gives: "Hourly forecast", termsQuote: "public domain", conditions: ["Send a User-Agent"], caveats: "" }));
    expect(d).toEqual({ homepageUrl: null, endpoints: ["https://api.weather.gov/points"], format: null, gives: "Hourly forecast", auth: null, rateLimit: null,
      termsQuote: "public domain", termsCheckedOn: null, conditions: ["Send a User-Agent"], caveats: null });
    for (const bad of ["", "not json", "[]", "null", "3"]) expect(parseDefinitionText(bad)).toBeNull();
  });
});
