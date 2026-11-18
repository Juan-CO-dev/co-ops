// Item 4 PR 2: the NWS adapter and the collection pass. No network, no database: every dependency is a fake.
//  - THE GATE: an unverified / revoked / redefined source = ZERO fetch calls and ZERO writes;
//  - a revocation between shops, and between the fetch and the write, stops the pass (Astra r2 P2 #3);
//  - the client: api.weather.gov only, GET only, a User-Agent or no request, 2 retries, Retry-After, the deadline;
//  - the normalizers keep an allow-list and refuse a payload that is not the documented shape.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, type Mock } from "vitest";
import { runNwsCollection, type CollectDeps, type IngestResult } from "@/lib/demand-signals/collect";
import { nwsGetJson, NWS_MAX_RETRIES, type NwsClientDeps } from "@/lib/demand-signals/nws-client";
import {
  NWS_DEFINITION, NWS_SOURCE, WEATHER_ROWS_PER_RUN_CAP, hourlyUrlFromPoint, normalizeAlerts, normalizeHourly, nwsAlertsUrl, nwsPointUrl,
} from "@/lib/demand-signals/nws-shared";
import { definitionProblem, type SourceState } from "@/lib/demand-signals/sources-shared";

vi.mock("server-only", () => ({}));

// 2026-11-18 16:00Z = 11:00 ET (EST). The live API's first period that day started 11:00-05:00.
const NOW = Date.parse("2026-11-18T16:00:00Z");
const HOUR = 3_600_000;
// The period shape read from the live API on 2026-11-18 (every key it returned).
const period = (i: number, over: Record<string, unknown> = {}) => {
  const start = new Date(NOW + i * HOUR), end = new Date(NOW + (i + 1) * HOUR);
  const et = (d: Date) => new Date(d.getTime() - 5 * HOUR).toISOString().replace(".000Z", "-05:00");
  return { number: i + 1, name: "", startTime: et(start), endTime: et(end), isDaytime: true, temperature: 57, temperatureUnit: "F", temperatureTrend: null,
    probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 0 }, dewpoint: { unitCode: "wmoUnit:degC", value: 0.5555555555555556 },
    relativeHumidity: { unitCode: "wmoUnit:percent", value: 40 }, windSpeed: "2 mph", windDirection: "W",
    icon: "https://api.weather.gov/icons/land/day/skc?size=small", shortForecast: "Sunny", detailedForecast: "", ...over };
};
const hourlyDoc = (periods: unknown[] = Array.from({ length: 156 }, (_, i) => period(i))) => ({
  "@context": [], type: "Feature", geometry: null,
  properties: { units: "us", forecastGenerator: "HourlyForecastGenerator", generatedAt: "2026-11-18T16:13:05+00:00", updateTime: "2026-11-18T14:52:38+00:00",
    validTimes: "2026-11-18T08:00:00+00:00/P7DT17H", elevation: { unitCode: "wmoUnit:m", value: 15.8496 }, periods } });
const pointDoc = { properties: { cwa: "LWX", gridId: "LWX", gridX: 98, gridY: 71, timeZone: "America/New_York",
  forecast: "https://api.weather.gov/gridpoints/LWX/98,71/forecast", forecastHourly: "https://api.weather.gov/gridpoints/LWX/98,71/forecast/hourly" } };
const alert = (over: Record<string, unknown> = {}) => ({ id: "x", type: "Feature", geometry: null, properties: {
  id: "urn:oid:2.49.0.1.840.0.b4d8.003.1", areaDesc: "District of Columbia", sent: "2026-11-18T09:06:00-05:00", effective: "2026-11-18T09:06:00-05:00",
  onset: "2026-11-18T11:00:00-05:00", expires: "2026-11-18T21:00:00-05:00", ends: "2026-11-19T21:00:00-05:00", status: "Actual", messageType: "Update",
  category: "Met", severity: "Severe", certainty: "Likely", urgency: "Expected", event: "High Wind Warning",
  headline: "High Wind Warning issued November 18", description: "LONG TEXT THAT IS NEVER KEPT", instruction: "Secure outdoor objects.", ...over } });
const alertsDoc = (features: unknown[] = []) => ({ "@context": [], type: "FeatureCollection", features, title: "Current watches", updated: "2026-11-18T16:10:53+00:00" });

describe("the NWS definition", () => {
  it("is registrable, free, ingestible only with conditions, and names its own adapter version", () => {
    expect(definitionProblem(NWS_SOURCE)).toBeNull();
    expect(NWS_SOURCE).toMatchObject({ sourceId: "nws", cost: "free", gate: "allow_with_conditions", termsStatus: "verified", adapter: { key: "nws", version: 1 } });
    expect(NWS_SOURCE.endpoints.every((u) => u.startsWith("https://api.weather.gov/"))).toBe(true);
    expect(NWS_DEFINITION.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(NWS_DEFINITION.text)).toEqual(NWS_SOURCE);
  });
});

describe("normalizers", () => {
  it("URLs: four decimals at most, a real point, and only an api.weather.gov gridpoint hourly URL", () => {
    expect(nwsPointUrl(38.88994321, -77.00910001)).toBe("https://api.weather.gov/points/38.8899,-77.0091");
    expect(nwsAlertsUrl(38.9, -77)).toBe("https://api.weather.gov/alerts/active?point=38.9,-77");
    expect(nwsPointUrl(Number.NaN, 0)).toBeNull();
    expect(nwsPointUrl(91, 0)).toBeNull();
    expect(hourlyUrlFromPoint(pointDoc)).toBe("https://api.weather.gov/gridpoints/LWX/98,71/forecast/hourly");
    for (const bad of ["https://evil.test/gridpoints/LWX/98,71/forecast/hourly", "http://api.weather.gov/gridpoints/LWX/98,71/forecast/hourly",
      "https://api.weather.gov/gridpoints/LWX/98,71/forecast/hourly?x=https://evil.test", "https://api.weather.gov.evil.test/gridpoints/LWX/98,71/forecast/hourly"]) {
      expect(hourlyUrlFromPoint({ properties: { forecastHourly: bad } })).toBeNull();
    }
    expect(hourlyUrlFromPoint(null)).toBeNull();
  });
  it("hourly: keeps the allow-listed fields for service hours inside the horizon, at most 112 rows a shop", () => {
    const n = normalizeHourly(hourlyDoc(), NOW);
    if (!n.ok) throw new Error("expected ok");
    expect(n.issuedAt).toBe("2026-11-18T14:52:38.000Z");
    expect(n.rows.length).toBeGreaterThan(90);
    expect(n.rows.length).toBeLessThanOrEqual(WEATHER_ROWS_PER_RUN_CAP / 2);
    expect(n.rows[0]).toEqual({ valid_hour: "2026-11-18T16:00:00.000Z", temperature_f: 57, precip_probability_pct: 0, wind_speed_mph: 2,
      relative_humidity_pct: 40, is_daytime: true, condition: "Sunny" });
    // 06:00 through 21:00 ET only (EST: 11:00Z through 02:00Z).
    expect(new Set(n.rows.map((r) => (Number(r.valid_hour.slice(11, 13)) + 19) % 24)).size).toBe(16);
    expect(n.rows.every((r) => { const h = (Number(r.valid_hour.slice(11, 13)) + 19) % 24; return h >= 6 && h < 22; })).toBe(true);
    expect(JSON.stringify(n.rows)).not.toMatch(/icon|dewpoint|windDirection|detailedForecast/);
  });
  it("hourly: unknown optional values are null, a wind range takes the higher figure", () => {
    const n = normalizeHourly(hourlyDoc([period(0, { probabilityOfPrecipitation: { value: null }, relativeHumidity: undefined, windSpeed: "5 to 10 mph" })]), NOW);
    expect(n.ok && n.rows[0]).toMatchObject({ precip_probability_pct: null, relative_humidity_pct: null, wind_speed_mph: 10 });
  });
  it.each([
    ["no periods", hourlyDoc([])], ["not F", hourlyDoc([period(0, { temperatureUnit: "C" })])], ["a half hour", hourlyDoc([period(0, { startTime: "2026-11-18T11:30:00-05:00" })])],
    ["a zoneless time", hourlyDoc([period(0, { startTime: "2026-11-18T11:00:00" })])], ["a duplicate hour", hourlyDoc([period(0), period(0)])],
    ["a text temperature", hourlyDoc([period(0, { temperature: "57" })])], ["wind in knots", hourlyDoc([period(0, { windSpeed: "5 kt" })])],
    ["a chance of 140%", hourlyDoc([period(0, { probabilityOfPrecipitation: { value: 140 } })])], ["a condition of 200 characters", hourlyDoc([period(0, { shortForecast: "x".repeat(200) })])],
    ["no update time", { properties: { periods: [period(0)] } }], ["not an object", "<html>"],
  ])("hourly: %s is bad_payload as a whole", (_name, doc) => {
    expect(normalizeHourly(doc, NOW)).toEqual({ ok: false, code: "bad_payload" });
  });
  it("alerts: actual, uncancelled alerts as ET day events; no description is kept", () => {
    const n = normalizeAlerts(alertsDoc([alert(), alert({ id: "urn:test", status: "Test" }), alert({ id: "urn:cancel", messageType: "Cancel" }),
      alert({ id: "urn:noends", ends: null, severity: "Whatever", onset: null })]));
    if (!n.ok) throw new Error("expected ok");
    expect(n.rows).toEqual([
      { external_key: "urn:noends", category: "weather_alert", valid_from: "2026-11-18", valid_to: "2026-11-18", title: "High Wind Warning", expected_impact: "unknown", severity: "unknown", issued_at: "2026-11-18T14:06:00.000Z", ends_at: "2026-11-19T02:00:00.000Z" },
      { external_key: "urn:oid:2.49.0.1.840.0.b4d8.003.1", category: "weather_alert", valid_from: "2026-11-18", valid_to: "2026-11-19", title: "High Wind Warning", expected_impact: "unknown", severity: "severe", issued_at: "2026-11-18T14:06:00.000Z", ends_at: "2026-11-20T02:00:00.000Z" },
    ]);
    expect(JSON.stringify(n.rows)).not.toMatch(/LONG TEXT|Secure outdoor|headline/i);
    expect(normalizeAlerts(alertsDoc([]))).toEqual({ ok: true, rows: [] });
    expect(normalizeAlerts({ title: "no features" })).toEqual({ ok: false, code: "bad_payload" });
    expect(normalizeAlerts(alertsDoc([alert({ event: 7 })]))).toEqual({ ok: false, code: "bad_payload" });
  });
  it("alerts: a Cancel message takes the alerts it names out of the snapshot, wherever it sits in the feed (review r1 P2 #1)", () => {
    const cancel = (ids: unknown) => alert({ id: "urn:cancel", messageType: "Cancel", references: ids });
    const ref = (identifier: string) => ({ "@id": `https://api.weather.gov/alerts/${identifier}`, identifier, sender: "w-nws.webmaster@noaa.gov", sent: "2026-11-18T09:06:00-05:00" });
    const kept = (features: unknown[]) => { const n = normalizeAlerts(alertsDoc(features)); if (!n.ok) throw new Error("expected ok"); return n.rows.map((r) => r.external_key); };
    const watch = alert({ id: "urn:watch" }), other = alert({ id: "urn:other" });
    expect(kept([watch, other])).toEqual(["urn:other", "urn:watch"]);
    expect(kept([watch, other, cancel([ref("urn:watch")])])).toEqual(["urn:other"]);
    expect(kept([cancel([ref("urn:watch"), ref("urn:other")]), watch, other])).toEqual([]);
    // A test or exercise cancellation cancels nothing; a cancellation with no usable reference cancels nothing.
    expect(kept([watch, alert({ id: "urn:drill", status: "Exercise", messageType: "Cancel", references: [ref("urn:watch")] })])).toEqual(["urn:watch"]);
    expect(kept([watch, cancel(undefined), cancel("urn:watch"), cancel([{ identifier: 7 }, null])])).toEqual(["urn:watch"]);
  });
  it("alerts: each row carries the instant the alert ends (ends, else expires), so the store can tell a cancellation from an alert that ran its course", () => {
    const n = normalizeAlerts(alertsDoc([alert({ id: "urn:a" }), alert({ id: "urn:b", ends: null }), alert({ id: "urn:c", ends: "2026-11-18T10:00:00-05:00" })]));
    if (!n.ok) throw new Error("expected ok");
    expect(n.rows.map((r) => [r.external_key, r.ends_at])).toEqual([["urn:a", "2026-11-20T02:00:00.000Z"], ["urn:b", "2026-11-19T02:00:00.000Z"], ["urn:c", "2026-11-18T16:00:00.000Z"]]);
  });
});

describe("the client: GET only, api.weather.gov only", () => {
  const client = (over: Partial<NwsClientDeps> = {}) => {
    let t = 1_000_000;
    const deps: NwsClientDeps = { fetch: vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })), userAgent: "test-agent", signal: new AbortController().signal,
      deadlineAt: t + 60_000, now: () => t, sleep: vi.fn(async (ms: number) => { t += ms; }), counter: { requests: 0 }, ...over };
    return deps;
  };
  const URL_OK = "https://api.weather.gov/points/38.9,-77";
  it("sends one GET with the User-Agent, no redirect following, and the run's signal", async () => {
    const deps = client();
    expect(await nwsGetJson(URL_OK, deps)).toEqual({ ok: true, json: { ok: 1 } });
    const [url, init] = vi.mocked(deps.fetch!).mock.calls[0]!;
    expect(url).toBe(URL_OK);
    expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { "User-Agent": "test-agent" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(deps.counter.requests).toBe(1);
  });
  it.each(["https://evil.test/points/1,1", "http://api.weather.gov/points/1,1", "https://api.weather.gov:8443/points/1,1", "https://user@api.weather.gov/points/1,1", "not a url"])(
    "refuses %s without a request", async (url) => {
      const deps = client();
      expect(await nwsGetJson(url, deps)).toEqual({ ok: false, code: "bad_url" });
      expect(deps.fetch).not.toHaveBeenCalled();
    });
  it.each([undefined, "", "   "])("no User-Agent (%s) = no request", async (userAgent) => {
    const deps = client({ userAgent });
    expect(await nwsGetJson(URL_OK, deps)).toEqual({ ok: false, code: "user_agent_missing" });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("retries a 429 twice at most, waiting the full Retry-After each time", async () => {
    const deps = client({ fetch: vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "7" } })) });
    expect(await nwsGetJson(URL_OK, deps)).toEqual({ ok: false, code: "rate_limited" });
    expect(deps.fetch).toHaveBeenCalledTimes(1 + NWS_MAX_RETRIES);
    expect(vi.mocked(deps.sleep).mock.calls.map((c) => c[0])).toEqual([7000, 7000]);
  });
  it("a Retry-After that cannot fit before the deadline is not waited: deadline, one request", async () => {
    const deps = client({ fetch: vi.fn(async () => new Response("", { status: 503, headers: { "retry-after": "600" } })) });
    expect(await nwsGetJson(URL_OK, deps)).toEqual({ ok: false, code: "deadline" });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });
  it("a redirect, a 4xx and a body that is not JSON are fixed codes with no retry", async () => {
    for (const [res, code] of [[new Response("", { status: 301, headers: { location: "https://evil.test/" } }), "http_error"],
      [new Response("", { status: 403 }), "http_error"], [new Response("", { status: 404 }), "not_found"], [new Response("<html>", { status: 200 }), "bad_payload"]] as const) {
      const deps = client({ fetch: vi.fn(async () => res) });
      expect(await nwsGetJson(URL_OK, deps)).toEqual({ ok: false, code });
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("a network failure is retried, then network_error; an aborted run is deadline", async () => {
    const deps = client({ fetch: vi.fn(async () => { throw new Error("ECONNRESET https://api.weather.gov secret"); }) });
    expect(await nwsGetJson(URL_OK, deps)).toEqual({ ok: false, code: "network_error" });
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    const gone = new AbortController(); gone.abort();
    const cut = client({ signal: gone.signal });
    expect(await nwsGetJson(URL_OK, cut)).toEqual({ ok: false, code: "deadline" });
    expect(cut.fetch).not.toHaveBeenCalled();
  });
  it("the module issues GET and nothing else, and names no other host", () => {
    const src = readFileSync("lib/demand-signals/nws-client.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect([...src.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1])).toEqual(["GET"]);
    expect(src).not.toMatch(/"(POST|PUT|PATCH|DELETE)"|https?:\/\//);
  });
});

describe("the collection pass", () => {
  const SHOP_A = "00000000-0000-4000-8000-00000000000a", SHOP_B = "00000000-0000-4000-8000-00000000000b";
  const verified = (over: Partial<SourceState> = {}): SourceState => ({ sourceId: "nws", definitionHash: NWS_DEFINITION.hash, gate: "allow_with_conditions", adapter: "nws@1", status: "verified", ...over });
  type Mocked = { [K in keyof CollectDeps]: Mock<CollectDeps[K]> };
  function harness(states: () => SourceState[] | Promise<SourceState[]>, over: Partial<CollectDeps> = {}): Mocked {
    const base: CollectDeps = {
      loadSourceStates: async () => states(),
      loadShopPoints: async () => ({ points: [{ locationId: SHOP_B, lat: 38.9097, lon: -77.0433 }, { locationId: SHOP_A, lat: 38.8899, lon: -77.0091 }], unplaced: [] }),
      getJson: async (url) => url.includes("/points/") ? { ok: true, json: pointDoc } : url.includes("/alerts/") ? { ok: true, json: alertsDoc([alert()]) } : { ok: true, json: hourlyDoc() },
      ingestWeather: async (a): Promise<IngestResult> => ({ ok: true, seen: a.rows.length, written: a.rows.length }),
      ingestEvents: async (a): Promise<IngestResult> => ({ ok: true, seen: a.events.length, written: a.events.length }),
      recordFailure: async () => {},
      now: () => NOW,
    };
    const merged: Record<string, unknown> = { ...base, ...over };
    for (const key of Object.keys(merged)) if (!vi.isMockFunction(merged[key])) merged[key] = vi.fn(merged[key] as () => unknown);
    return merged as unknown as Mocked;
  }
  const writes = (d: Mocked) => d.ingestWeather.mock.calls.length + d.ingestEvents.mock.calls.length + d.recordFailure.mock.calls.length;
  const run = (d: CollectDeps, userAgent: string | undefined = "test-agent") => runNwsCollection(d, { deadlineAt: NOW + 60_000, userAgent });

  it.each([
    ["unverified (ship state)", [verified({ status: "unverified" })], "source_unverified"],
    ["not registered at all", [], "source_unverified"],
    ["revoked", [verified({ status: "revoked" })], "source_revoked"],
    ["verified under ANOTHER definition (the endpoint or adapter changed)", [verified({ definitionHash: "f".repeat(64) })], "source_unverified"],
    ["verified but its gate is not ingestible", [verified({ gate: "pending_terms" })], "source_unverified"],
  ])("THE GATE: %s = zero fetch calls, zero writes", async (_name, states, status) => {
    const d = harness(() => states);
    expect(await run(d)).toEqual({ status, shops: [], weatherRows: 0 });
    expect(d.getJson).not.toHaveBeenCalled();
    expect(d.loadShopPoints).not.toHaveBeenCalled();
    expect(writes(d)).toBe(0);
  });
  it("0343 not applied = not_installed, nothing requested", async () => {
    const d = harness(() => { throw new Error("not_installed"); });
    expect((await run(d)).status).toBe("not_installed");
    expect(d.getJson).not.toHaveBeenCalled();
  });
  it("a register that cannot be read fails CLOSED", async () => {
    const d = harness(() => { throw new Error("boom"); });
    expect((await run(d)).status).toBe("source_unverified");
    expect(d.getJson).not.toHaveBeenCalled();
  });
  it("verified but no User-Agent = no request", async () => {
    const d = harness(() => [verified()]);
    expect((await run(d, "   ")).status).toBe("user_agent_missing");
    expect(d.getJson).not.toHaveBeenCalled();
    expect(writes(d)).toBe(0);
  });
  it("verified: each shop's forecast and alerts are written with THIS adapter's definition hash, in shop order", async () => {
    const d = harness(() => [verified()]);
    const res = await run(d);
    expect(res.status).toBe("ran");
    expect(res.shops.map((s) => s.locationId)).toEqual([SHOP_A, SHOP_B]);
    expect(d.getJson).toHaveBeenCalledTimes(6);
    expect(d.ingestWeather.mock.calls.map((c) => [c[0].definitionHash, c[0].locationId, c[0].issuedAt])).toEqual([
      [NWS_DEFINITION.hash, SHOP_A, "2026-11-18T14:52:38.000Z"], [NWS_DEFINITION.hash, SHOP_B, "2026-11-18T14:52:38.000Z"]]);
    expect(d.ingestEvents.mock.calls[0]![0].events).toHaveLength(1);
    expect(res.weatherRows).toBeLessThanOrEqual(WEATHER_ROWS_PER_RUN_CAP);
    expect(res).toMatchObject({ failed: 0 });
  });
  it("the register is read again before EACH shop: revoked between shops stops the pass there", async () => {
    let reads = 0;
    const d = harness(() => [verified({ status: ++reads >= 3 ? "revoked" : "verified" })]);
    const res = await run(d);
    expect(res.status).toBe("source_revoked");
    expect(d.ingestWeather).toHaveBeenCalledTimes(1);      // shop A only
    expect(d.getJson).toHaveBeenCalledTimes(3);            // no request for shop B
    expect(res.shops[1]).toMatchObject({ locationId: SHOP_B, weather: { error: "source_revoked" } });
  });
  it("revoked between the fetch and the write: the WRITER refuses, nothing more is requested or written", async () => {
    const d = harness(() => [verified()], { ingestWeather: vi.fn(async (): Promise<IngestResult> => ({ ok: false, code: "source_revoked" })) });
    const res = await run(d);
    expect(res.status).toBe("source_revoked");
    expect(d.getJson).toHaveBeenCalledTimes(2);            // shop A's point and forecast; no alerts, no shop B
    expect(d.ingestEvents).not.toHaveBeenCalled();
    expect(d.recordFailure).not.toHaveBeenCalled();
  });
  it("a shop that would take the run past 224 rows is refused whole, never cut", async () => {
    const d = harness(() => [verified()]);
    d.loadShopPoints.mockResolvedValueOnce({ points: [SHOP_A, SHOP_B, "00000000-0000-4000-8000-00000000000c"].map((locationId) => ({ locationId, lat: 38.9, lon: -77 })), unplaced: [] });
    const res = await run(d);
    expect(d.ingestWeather).toHaveBeenCalledTimes(2);
    expect(res.shops[2]!.weather).toEqual({ error: "rows_over_cap" });
    expect(d.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ feed: "weather_hourly", code: "rows_over_cap" }), expect.anything());
  });
  it("a failed request or a bad payload is a fixed code on the run ledger, and the other shop still runs", async () => {
    const d = harness(() => [verified()]);
    d.getJson.mockImplementationOnce(async () => ({ ok: false as const, code: "server_error" }));
    const res = await run(d);
    expect(res.status).toBe("ran");
    expect(res.shops[0]!.weather).toEqual({ error: "server_error" });
    expect(res.shops[1]!.weather).toMatchObject({ written: expect.any(Number) });
    expect(d.recordFailure).toHaveBeenCalledTimes(1);
    const bad = harness(() => [verified()]);
    bad.getJson.mockImplementation(async (url: string) => url.includes("/points/") ? { ok: true as const, json: { properties: { forecastHourly: "https://evil.test/x" } } } : { ok: true as const, json: alertsDoc() });
    const out = await run(bad);
    expect(out.shops.every((s) => "error" in s.weather && s.weather.error === "bad_payload")).toBe(true);
    expect(bad.getJson.mock.calls.every((c) => c[0].startsWith("https://api.weather.gov/"))).toBe(true);
    expect(bad.ingestWeather).not.toHaveBeenCalled();
  });
  it("past its deadline it starts nothing; a dependency that never answers is cut at the deadline", async () => {
    const late = harness(() => [verified()]);
    const res = await runNwsCollection(late, { deadlineAt: NOW - 1, userAgent: "test-agent" });
    expect(res.status).toBe("source_unverified");           // the register could not be asked: closed
    expect(late.getJson).not.toHaveBeenCalled();
    let t = Date.now();
    const hung = harness(() => [verified()], { now: () => Date.now(), getJson: vi.fn(() => new Promise<never>(() => {})) as unknown as CollectDeps["getJson"] });
    t = Date.now();
    const out = await runNwsCollection(hung, { deadlineAt: t + 80, userAgent: "test-agent" });
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(out.status).toBe("ran");
    expect(hung.ingestWeather).not.toHaveBeenCalled();
  });
});
