/**
 * Demand signals (item 4 PR 5): THE PAGE'S LOADER. It composes the store's gated readers and the pure view
 * rules; it reads no table itself and takes its clock as an argument.
 *
 * REVOCATION STOPS USE (contracts-shared.ts): every sourced row here comes from `loadUsableDayEvents` /
 * `loadUsableWeather` at the `render` use point (each reads the register NOW, and 0343's readers ask it again in
 * the same statement), and the weather line's reason is decided by `usableNow` over the register read for THIS
 * render (`weatherSourceStatus`). A source revoked a second ago shows "not verified", never a forecast.
 *
 * NOTHING PARTIAL: a section whose read did not finish whole is `unreadable` and the page says so. A register
 * that cannot be read closes the whole page (`unreadable`); 0343 not applied is `unavailable`.
 * WHO: the caller has already decided the actor may see this shop (`demandSignalShops`); the flags returned here
 * say what the actor may DO, by trusted role, and the writers decide again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";
import { canEnterDemandEvent, canMarkSource, demandEventShopAllowed } from "./access-shared";
import type { SourceStatus } from "./contracts-shared";
import { NWS_SOURCE_ID } from "./nws-shared";
import {
  DemandSignalError, loadLatestRun, loadSourceRows, loadUsableDayEvents, loadUsableWeather, type SignalFeed, type SignalRun, type SourceRow,
} from "./signal-store";
import { usableNow } from "./sources-shared";
import {
  SIGNALS_EVENT_WINDOW_DAYS, SIGNALS_HORIZON_DAYS, WEATHER_REACH_DAYS, addDays, buildSignalsDays, runStateOf, weatherSourceStatus,
  type EventIn, type RunState, type SectionRead, type SignalsDay, type WeatherHourIn,
} from "./signals-view-shared";

export interface SignalsEvent extends EventIn { canEdit: boolean }
export interface FeedHealth { feed: SignalFeed; state: RunState; last: SignalRun | null; lastGoodAt: string | null }
export interface AdapterHealth { sourceId: string; name: string; status: SourceStatus; feeds: FeedHealth[] | null }

export type SignalsPageData =
  | { state: "unavailable" }
  | { state: "unreadable" }
  | {
    state: "ok";
    today: string;
    shop: { id: string; name: string };
    days: SignalsDay[];
    /** The event list (today and the next SIGNALS_EVENT_WINDOW_DAYS days). null = its read did not finish whole. */
    events: SignalsEvent[] | null;
    weatherStatus: SourceStatus;
    /**
     * How the hourly-forecast feed of each adapter source last ran for this shop. A stored forecast is only as
     * current as its feed: an unchanged hour writes no row, so a row's own time says when it last CHANGED, and
     * only the run ledger says the feed is still running. Anything but "fresh" is shown on every day's line.
     */
    weatherFeeds: Record<string, RunState | "unreadable">;
    sources: { registered: number; verified: number; revoked: number };
    /** Sources with an adapter in code, and how their collection last went for this shop. */
    adapters: AdapterHealth[];
    can: { enter: boolean; enterAllShops: boolean; mark: boolean };
  };

const FEEDS: ReadonlyArray<SignalFeed> = ["weather_hourly", "day_events"];

async function section<T>(read: () => Promise<T[]>): Promise<SectionRead<T>> {
  try { return { read: "ok", rows: await read() }; } catch (e) {
    if (e instanceof DemandSignalError && e.code === "demand_signals_unavailable") throw e;
    return { read: "unreadable" };
  }
}

async function adapterHealth(sb: SupabaseClient, row: SourceRow, rows: ReadonlyArray<SourceRow>, locationId: string, nowMs: number): Promise<AdapterHealth> {
  const decision = usableNow(rows, [row.sourceId], "render");
  const status: SourceStatus = decision.ok ? "verified" : decision.code === "source_revoked" ? "revoked" : "unverified";
  try {
    const feeds: FeedHealth[] = [];
    for (const feed of FEEDS) {
      const last = await loadLatestRun(sb, { sourceId: row.sourceId, locationId, feed, goodOnly: false });
      const good = last && last.outcome === "failed" ? await loadLatestRun(sb, { sourceId: row.sourceId, locationId, feed, goodOnly: true }) : last;
      const lastGoodAt = good?.finishedAt ?? null;
      feeds.push({ feed, last, lastGoodAt, state: runStateOf(last, lastGoodAt, nowMs) });
    }
    return { sourceId: row.sourceId, name: row.name, status, feeds };
  } catch {
    return { sourceId: row.sourceId, name: row.name, status, feeds: null };
  }
}

export async function loadSignalsPage(sb: SupabaseClient, args: {
  actor: { role: string; locations: ReadonlyArray<string> }; shop: { id: string; name: string }; nowIso: string;
}): Promise<SignalsPageData> {
  const { actor, shop, nowIso } = args;
  const today = etCalendarDate(nowIso);
  let rows: SourceRow[];
  try { rows = await loadSourceRows(sb); } catch (e) {
    return { state: e instanceof DemandSignalError && e.code === "demand_signals_unavailable" ? "unavailable" : "unreadable" };
  }
  try {
    const weatherStatus = weatherSourceStatus(rows, NWS_SOURCE_ID);
    const events = await section<EventIn>(() => loadUsableDayEvents(sb, { locationId: shop.id, from: today, to: addDays(today, SIGNALS_EVENT_WINDOW_DAYS), asOfIso: nowIso, use: "render" }));
    // A source that is not verified has no usable row by definition: nothing is read, and the days say why.
    const weather: SectionRead<WeatherHourIn> = weatherStatus !== "verified" ? { read: "ok", rows: [] }
      : await section<WeatherHourIn>(() => loadUsableWeather(sb, { locationId: shop.id, fromIso: operationalDayUtcRange(today).startIso,
        toIso: operationalDayUtcRange(addDays(today, WEATHER_REACH_DAYS + 1)).startIso, asOfIso: nowIso, use: "render" }));
    const adapters: AdapterHealth[] = [];
    for (const row of rows.filter((r) => r.adapter !== null)) adapters.push(await adapterHealth(sb, row, rows, shop.id, Date.parse(nowIso)));
    return {
      state: "ok", today, shop,
      days: buildSignalsDays({ today, horizonDays: SIGNALS_HORIZON_DAYS, weather, weatherStatus, events }),
      events: events.read === "ok" ? events.rows.map((e) => ({ id: e.id, origin: e.origin, sourceId: e.sourceId, locationId: e.locationId, category: e.category,
        validFrom: e.validFrom, validTo: e.validTo, startLocal: e.startLocal, endLocal: e.endLocal, title: e.title, expectedImpact: e.expectedImpact, severity: e.severity,
        canEdit: e.origin === "manual" && canEnterDemandEvent(actor.role) && demandEventShopAllowed(actor.role, actor.locations, e.locationId) })) : null,
      weatherStatus,
      weatherFeeds: Object.fromEntries(adapters.map((a) => [a.sourceId, a.feeds === null ? "unreadable" as const : a.feeds.find((f) => f.feed === "weather_hourly")?.state ?? "never"])),
      sources: { registered: rows.length, verified: rows.filter((r) => r.status === "verified").length, revoked: rows.filter((r) => r.status === "revoked").length },
      adapters,
      can: { enter: canEnterDemandEvent(actor.role) && demandEventShopAllowed(actor.role, actor.locations, shop.id),
        enterAllShops: canEnterDemandEvent(actor.role) && demandEventShopAllowed(actor.role, actor.locations, null), mark: canMarkSource(actor.role) },
    };
  } catch (e) {
    return { state: e instanceof DemandSignalError && e.code === "demand_signals_unavailable" ? "unavailable" : "unreadable" };
  }
}
