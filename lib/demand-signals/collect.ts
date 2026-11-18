/**
 * Demand signals (item 4 PR 2): THE COLLECTION PASS (NWS). Every read, request and write is injected, so this
 * file has no database and no network in it and is tested whole (tests/demand-signals-collect.test.ts). The
 * real dependencies are in signal-store.ts.
 *
 * THE GATE COMES FIRST, AND IT IS ASKED AGAIN (contracts-shared.ts: the register's CURRENT status, never one
 * remembered from an earlier step):
 *   1. before anything: the register is read and `collectDecision` decides. Not verified (or the register's
 *      definition is not the one this adapter was built for) = the pass returns `source_unverified` /
 *      `source_revoked` having made NO request and NO write. Not even a run row.
 *   2. before each shop: the register is read again. A revocation in the middle stops the pass there.
 *   3. inside each write: 0343's writer asks the register under the source's lock. A revocation between the
 *      fetch and the write is `source_revoked`, nothing is written, and the pass stops.
 * Limits: one absolute deadline (one signal, handed to every dependency, and every await raced against it);
 * at most WEATHER_ROWS_PER_RUN_CAP weather rows per run (a shop that would pass it is refused whole, never
 * cut); a failure is a fixed code and the other shops still run.
 */
import {
  NWS_DEFINITION, NWS_SOURCE_ID, WEATHER_ROWS_PER_RUN_CAP, hourlyUrlFromPoint, normalizeAlerts, normalizeHourly, nwsAlertsUrl, nwsPointUrl,
  type AlertEventRow, type WeatherRow,
} from "./nws-shared";
import { collectDecision, type SourceState } from "./sources-shared";
import type { SignalUseRefusal } from "./contracts-shared";

export type FetchResult = { ok: true; json: unknown } | { ok: false; code: string };
export type IngestResult = { ok: true; seen: number; written: number } | { ok: false; code: string };
export type SignalFeed = "weather_hourly" | "day_events";

export interface CollectDeps {
  /** The register as it reads NOW. Throwing `not_installed` = 0343 is not applied. */
  loadSourceStates: (signal: AbortSignal) => Promise<SourceState[]>;
  loadShopPoints: (signal: AbortSignal) => Promise<Array<{ locationId: string; lat: number; lon: number }>>;
  getJson: (url: string, signal: AbortSignal) => Promise<FetchResult>;
  ingestWeather: (args: { definitionHash: string; locationId: string; issuedAt: string; startedAt: string; rows: WeatherRow[] }, signal: AbortSignal) => Promise<IngestResult>;
  ingestEvents: (args: { definitionHash: string; locationId: string; startedAt: string; events: AlertEventRow[] }, signal: AbortSignal) => Promise<IngestResult>;
  recordFailure: (args: { locationId: string; feed: SignalFeed; startedAt: string; code: string }, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

export type FeedOutcome = { seen: number; written: number } | { error: string };
export interface ShopCollection { locationId: string; weather: FeedOutcome; alerts: FeedOutcome }
export type CollectionResult =
  | { status: "not_installed" | "user_agent_missing" | SignalUseRefusal; shops: ShopCollection[]; weatherRows: number }
  | { status: "ran"; shops: ShopCollection[]; weatherRows: number; failed: number };

const DEADLINE = "deadline";
const REFUSALS: ReadonlyArray<string> = ["source_unverified", "source_revoked"];
const isRefusal = (code: string): code is SignalUseRefusal => REFUSALS.includes(code);

export async function runNwsCollection(deps: CollectDeps, opts: { deadlineAt: number; userAgent: string | undefined }): Promise<CollectionResult> {
  const controller = new AbortController();
  const left = opts.deadlineAt - deps.now();
  const timer = left > 0 ? setTimeout(() => controller.abort(), left) : null;
  if (left <= 0) controller.abort();
  const signal = controller.signal;
  const within = <T>(work: (s: AbortSignal) => PromiseLike<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new Error(DEADLINE)); return; }
    const cut = () => reject(new Error(DEADLINE));
    signal.addEventListener("abort", cut, { once: true });
    Promise.resolve().then(() => work(signal)).then(resolve, reject).finally(() => signal.removeEventListener("abort", cut));
  });
  const codeOf = (e: unknown) => (e instanceof Error && /^[a-z_]{1,40}$/.test(e.message) ? e.message : "failed");
  const shops: ShopCollection[] = [];
  let weatherRows = 0;
  /** The register NOW: may this adapter collect? */
  const gate = async () => collectDecision(await within((s) => deps.loadSourceStates(s)), NWS_SOURCE_ID, NWS_DEFINITION.hash);

  try {
    // 1. THE GATE, before any request or write.
    let decision;
    try { decision = await gate(); } catch (e) {
      return { status: codeOf(e) === "not_installed" ? "not_installed" : "source_unverified", shops, weatherRows };
    }
    if (!decision.ok) return { status: decision.code, shops, weatherRows };
    if (!opts.userAgent?.trim()) return { status: "user_agent_missing", shops, weatherRows };

    const points = await within((s) => deps.loadShopPoints(s));
    for (const point of [...points].sort((a, b) => (a.locationId < b.locationId ? -1 : 1))) {
      const shop: ShopCollection = { locationId: point.locationId, weather: { error: DEADLINE }, alerts: { error: DEADLINE } };
      shops.push(shop);
      if (signal.aborted || deps.now() >= opts.deadlineAt) continue;
      const startedAt = new Date(deps.now()).toISOString();
      const fail = async (feed: SignalFeed, code: string): Promise<FeedOutcome> => {
        if (code !== DEADLINE) { try { await within((s) => deps.recordFailure({ locationId: point.locationId, feed, startedAt, code }, s)); } catch { /* the outcome already says it failed */ } }
        return { error: code };
      };
      try {
        // 2. THE GATE AGAIN, before this shop's requests.
        const again = await gate();
        if (!again.ok) { shop.weather = { error: again.code }; shop.alerts = { error: again.code }; return { status: again.code, shops, weatherRows }; }

        // The hourly forecast.
        const pointUrl = nwsPointUrl(point.lat, point.lon), alertsUrl = nwsAlertsUrl(point.lat, point.lon);
        if (!pointUrl || !alertsUrl) { shop.weather = await fail("weather_hourly", "bad_shop_point"); shop.alerts = { error: "bad_shop_point" }; continue; }
        const pointJson = await within((s) => deps.getJson(pointUrl, s));
        const hourlyUrl = pointJson.ok ? hourlyUrlFromPoint(pointJson.json) : null;
        if (!pointJson.ok) shop.weather = await fail("weather_hourly", pointJson.code);
        else if (!hourlyUrl) shop.weather = await fail("weather_hourly", "bad_payload");
        else {
          const hourly = await within((s) => deps.getJson(hourlyUrl, s));
          const normal = hourly.ok ? normalizeHourly(hourly.json, deps.now()) : null;
          if (!hourly.ok) shop.weather = await fail("weather_hourly", hourly.code);
          else if (!normal || !normal.ok) shop.weather = await fail("weather_hourly", "bad_payload");
          else if (weatherRows + normal.rows.length > WEATHER_ROWS_PER_RUN_CAP) shop.weather = await fail("weather_hourly", "rows_over_cap");
          else {
            // 3. The writer asks the register again, under the source's lock.
            const wrote = await within((s) => deps.ingestWeather({ definitionHash: NWS_DEFINITION.hash, locationId: point.locationId, issuedAt: normal.issuedAt, startedAt, rows: normal.rows }, s));
            if (!wrote.ok && isRefusal(wrote.code)) { shop.weather = { error: wrote.code }; shop.alerts = { error: wrote.code }; return { status: wrote.code, shops, weatherRows }; }
            if (wrote.ok) { weatherRows += normal.rows.length; shop.weather = { seen: wrote.seen, written: wrote.written }; }
            else shop.weather = await fail("weather_hourly", wrote.code);
          }
        }

        // The active alerts.
        const alerts = await within((s) => deps.getJson(alertsUrl, s));
        const events = alerts.ok ? normalizeAlerts(alerts.json) : null;
        if (!alerts.ok) shop.alerts = await fail("day_events", alerts.code);
        else if (!events || !events.ok) shop.alerts = await fail("day_events", "bad_payload");
        else {
          const wrote = await within((s) => deps.ingestEvents({ definitionHash: NWS_DEFINITION.hash, locationId: point.locationId, startedAt, events: events.rows }, s));
          if (!wrote.ok && isRefusal(wrote.code)) { shop.alerts = { error: wrote.code }; return { status: wrote.code, shops, weatherRows }; }
          shop.alerts = wrote.ok ? { seen: wrote.seen, written: wrote.written } : await fail("day_events", wrote.code);
        }
      } catch (e) {
        const code = codeOf(e);
        if ("error" in shop.weather && shop.weather.error === DEADLINE && code !== DEADLINE) shop.weather = { error: code };
        if ("error" in shop.alerts && shop.alerts.error === DEADLINE && code !== DEADLINE) shop.alerts = { error: code };
      }
    }
    const failed = shops.reduce((n, s) => n + ("error" in s.weather ? 1 : 0) + ("error" in s.alerts ? 1 : 0), 0);
    return { status: "ran", shops, weatherRows, failed };
  } catch (e) {
    // The shop-point read failed or was cut at the deadline: nothing was requested.
    void e;
    return { status: "ran", shops, weatherRows, failed: 1 };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
