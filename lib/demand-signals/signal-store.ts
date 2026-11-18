/**
 * Demand signals (item 4 PR 2): THE STORE. Server-only. The one module that talks to 0343: the register, the
 * verification mark, the manual-event writer, the gated readers and the real dependencies of the collection
 * pass. It writes no table directly: every write is one of 0343's definer functions (DEMAND_SIGNAL_RPCS).
 *
 * REVOCATION STOPS USE (contracts-shared.ts, Astra r2 P2 #3). Stored signals are read ONLY through
 * `loadUsableWeather` / `loadUsableDayEvents`: each reads the register as it is NOW, then the rows through
 * 0343's gated reader (which asks the register again in the same statement), then drops any row whose source
 * `signalUsable` refuses. A later consumer (the term builder, the page, a chip) calls these two and never reads
 * a signal table itself: tests/demand-signals-contracts.test.ts pins that no module does.
 * A register that cannot be read answers CLOSED (nothing usable, nothing collected).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withAbort } from "@/lib/pulse/abort";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canEnterDemandEvent, canMarkSource, demandEventShopAllowed } from "./access-shared";
import { runNwsCollection, type CollectDeps, type CollectionResult, type IngestResult } from "./collect";
import type { SignalUsePoint } from "./contracts-shared";
import { nwsGetJson } from "./nws-client";
import { NWS_DEFINITION, NWS_SOURCE_ID } from "./nws-shared";
import {
  collectDecision, keepUsable, type DemandEventInput, type SourceGate, type SourceMarkInput, type SourceState,
} from "./sources-shared";

/** Every function of 0343 this layer may call. */
export const DEMAND_SIGNAL_RPCS = ["demand_source_states", "demand_source_mark", "demand_event_save", "demand_usable_weather",
  "demand_usable_day_events", "demand_weather_ingest", "demand_events_ingest", "demand_signal_run_fail"] as const;
type Rpc = (typeof DEMAND_SIGNAL_RPCS)[number];

export class DemandSignalError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = "DemandSignalError"; }
}

/** 0343's refusals by name, and the status each is answered with. Anything else is a generic 500. */
const REFUSALS: Record<string, number> = {
  demand_source_forbidden: 403, demand_event_forbidden: 403, demand_event_shop_forbidden: 403,
  demand_source_invalid: 400, demand_event_invalid: 400, signal_window_invalid: 400,
  source_unknown: 404,
  source_definition_moved: 409, source_not_ingestible: 409, source_status_unchanged: 409, demand_event_moved: 409,
  source_unverified: 409, source_revoked: 409,
  rows_over_cap: 422, weather_rows_invalid: 422, events_invalid: 422,
};
type RpcError = { code?: string; message?: string };
const notInstalled = (e: RpcError) => e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");
/** The fixed name in a database error, or null. Never the message itself. */
function refusalName(e: RpcError): string | null {
  const message = e.message ?? "";
  return Object.keys(REFUSALS).find((name) => message === name || new RegExp(`(^|[^a-z_])${name}($|[^a-z_])`).test(message)) ?? null;
}
function toError(e: RpcError): DemandSignalError {
  if (notInstalled(e)) return new DemandSignalError(503, "demand_signals_unavailable");
  const name = refusalName(e);
  return name ? new DemandSignalError(REFUSALS[name]!, name) : new DemandSignalError(500, "generic");
}
async function call<T>(sb: SupabaseClient, name: Rpc, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const client = signal ? withAbort(sb, signal) : sb;
  const { data, error } = await client.rpc(name, args);
  if (error) throw toError(error);
  return data as T;
}

// ── the register ────────────────────────────────────────────────────────────────────────────────
interface StateRow { source_id: string; definition_hash: string; gate: string; adapter: string | null; status: string }

/** The register as it reads NOW (every source at its current definition). */
export async function readSourceStates(sb: SupabaseClient, signal?: AbortSignal): Promise<SourceState[]> {
  const rows = await call<StateRow[] | null>(sb, "demand_source_states", {}, signal);
  return (rows ?? []).map((r) => ({ sourceId: r.source_id, definitionHash: r.definition_hash, gate: r.gate as SourceGate, adapter: r.adapter,
    status: r.status === "verified" || r.status === "revoked" ? r.status : "unverified" }));
}

/** May the NWS adapter collect now? Asked by the cron BEFORE it claims its lease. Unreadable = closed. */
export async function collectionPrecheck(sb: SupabaseClient): Promise<"ready" | "not_installed" | "source_unverified" | "source_revoked"> {
  let states: SourceState[];
  try { states = await readSourceStates(sb, AbortSignal.timeout(5_000)); } catch (e) {
    return e instanceof DemandSignalError && e.code === "demand_signals_unavailable" ? "not_installed" : "source_unverified";
  }
  const decision = collectDecision(states, NWS_SOURCE_ID, NWS_DEFINITION.hash);
  return decision.ok ? "ready" : decision.code;
}

/** Mark a source verified or revoked (MoO+). 0343 re-reads the role and writes the audit row. */
export async function markSource(sb: SupabaseClient, actor: { userId: string; role: string }, input: SourceMarkInput): Promise<{ eventSeq: number; status: string }> {
  if (!canMarkSource(actor.role)) throw new DemandSignalError(403, "demand_source_forbidden");
  const out = await call<{ event_seq: number; status: string }>(sb, "demand_source_mark", {
    p_actor: actor.userId, p_source_id: input.sourceId, p_definition_hash: input.definitionHash, p_status: input.status, p_note: input.note });
  return { eventSeq: out.event_seq, status: out.status };
}

// ── manual events (the page is PR 5) ──────────────────────────────────────────────────────────────
export async function saveDemandEvent(sb: SupabaseClient, actor: { userId: string; role: string; locations: ReadonlyArray<string> }, input: DemandEventInput): Promise<{ id: string; retracted: boolean }> {
  if (!canEnterDemandEvent(actor.role)) throw new DemandSignalError(403, "demand_event_forbidden");
  // A retraction's shop is the entry's own; 0343 decides it on the locked row.
  if (!input.retract && !demandEventShopAllowed(actor.role, actor.locations, input.locationId)) throw new DemandSignalError(403, "demand_event_shop_forbidden");
  return call(sb, "demand_event_save", {
    p_actor: actor.userId, p_location_id: input.retract ? null : input.locationId, p_category: input.retract ? null : input.category,
    p_valid_from: input.retract ? null : input.validFrom, p_valid_to: input.retract ? null : input.validTo,
    p_start_local: input.startLocal, p_end_local: input.endLocal, p_title: input.retract ? null : input.title,
    p_impact: input.retract ? null : input.impact, p_note: input.note, p_supersedes: input.supersedesId, p_retract: input.retract });
}

// ── the gated readers (compute, render) ───────────────────────────────────────────────────────────
export interface UsableWeatherHour {
  sourceId: string; sourceIds: string[]; validHour: string; issuedAt: string; availableAt: string; vintageId: number;
  temperatureF: number; precipProbabilityPct: number | null; windSpeedMph: number | null; relativeHumidityPct: number | null; isDaytime: boolean; condition: string;
}
type ReadUse = Extract<SignalUsePoint, "compute" | "render">;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The latest forecast vintage per hour as of `asOfIso`, from sources verified NOW. Each row carries its source ids. */
export async function loadUsableWeather(sb: SupabaseClient, args: { locationId: string; fromIso: string; toIso: string; asOfIso: string; use: ReadUse }, signal?: AbortSignal): Promise<UsableWeatherHour[]> {
  const states = await readSourceStates(sb, signal);
  const rows = await call<Array<Record<string, unknown>> | null>(sb, "demand_usable_weather",
    { p_location_id: args.locationId, p_from: args.fromIso, p_to: args.toIso, p_as_of: args.asOfIso }, signal);
  const mapped = (rows ?? []).map((r) => ({
    sourceId: String(r.source_id), sourceIds: [String(r.source_id)], validHour: String(r.valid_hour), issuedAt: String(r.issued_at), availableAt: String(r.available_at),
    vintageId: Number(r.vintage_id), temperatureF: Number(r.temperature_f), precipProbabilityPct: num(r.precip_probability_pct), windSpeedMph: num(r.wind_speed_mph),
    relativeHumidityPct: num(r.relative_humidity_pct), isDaytime: r.is_daytime === true, condition: String(r.condition) }));
  return keepUsable(mapped, states, args.use);
}

export interface UsableDayEvent {
  id: string; origin: "manual" | "feed"; sourceId: string | null; sourceIds: string[]; locationId: string | null; category: string;
  validFrom: string; validTo: string; startLocal: string | null; endLocal: string | null; title: string; expectedImpact: string; severity: string | null;
}
/** Day events for a shop (its own and the all-shop ones): manual heads, and feed events from sources verified NOW. */
export async function loadUsableDayEvents(sb: SupabaseClient, args: { locationId: string; from: string; to: string; asOfIso: string; use: ReadUse }, signal?: AbortSignal): Promise<UsableDayEvent[]> {
  const states = await readSourceStates(sb, signal);
  const rows = await call<Array<Record<string, unknown>> | null>(sb, "demand_usable_day_events",
    { p_location_id: args.locationId, p_from: args.from, p_to: args.to, p_as_of: args.asOfIso }, signal);
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const mapped = (rows ?? []).map((r) => ({
    id: String(r.id), origin: r.origin === "feed" ? "feed" as const : "manual" as const, sourceId: text(r.source_id), sourceIds: r.source_id ? [String(r.source_id)] : [],
    locationId: text(r.location_id), category: String(r.category), validFrom: String(r.valid_from), validTo: String(r.valid_to), startLocal: text(r.start_local),
    endLocal: text(r.end_local), title: String(r.title), expectedImpact: String(r.expected_impact), severity: text(r.severity) }));
  return keepUsable(mapped, states, args.use);
}

// ── the collection pass, with its real dependencies ───────────────────────────────────────────────
async function ingest(sb: SupabaseClient, name: "demand_weather_ingest" | "demand_events_ingest", args: Record<string, unknown>, signal: AbortSignal): Promise<IngestResult> {
  try {
    const out = await call<{ seen: number; written: number }>(sb, name, args, signal);
    return { ok: true, seen: Number(out.seen), written: Number(out.written) };
  } catch (e) {
    return { ok: false, code: e instanceof DemandSignalError && e.code !== "generic" ? e.code : "write_failed" };
  }
}

export function nwsCollectDeps(sb: SupabaseClient, opts: { userAgent: string | undefined; deadlineAt: number; counter: { requests: number } }): CollectDeps {
  return {
    loadSourceStates: async (signal) => {
      try { return await readSourceStates(sb, signal); } catch (e) {
        throw new Error(e instanceof DemandSignalError && e.code === "demand_signals_unavailable" ? "not_installed" : "register_unreadable");
      }
    },
    // A shop's point is its catering fulfilment node (the one place a shop's coordinates are stored).
    loadShopPoints: async (signal) => {
      const client = withAbort(sb, signal);
      const { data: shops, error: shopErr } = await client.from("locations").select("id").eq("active", true).returns<Array<{ id: string }>>();
      if (shopErr) throw new Error("shops_unreadable");
      const { data: nodes, error: nodeErr } = await client.from("catering_fulfillment_nodes").select("location_id, lat, lng").returns<Array<{ location_id: string; lat: number; lng: number }>>();
      if (nodeErr) throw new Error("shops_unreadable");
      const active = new Set((shops ?? []).map((s) => s.id));
      const byShop = new Map((nodes ?? []).filter((n) => active.has(n.location_id)).map((n) => [n.location_id, n]));
      return [...byShop.values()].map((n) => ({ locationId: n.location_id, lat: Number(n.lat), lon: Number(n.lng) }));
    },
    getJson: (url, signal) => nwsGetJson(url, { userAgent: opts.userAgent, signal, deadlineAt: opts.deadlineAt, now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), counter: opts.counter }),
    ingestWeather: (a, signal) => ingest(sb, "demand_weather_ingest", { p_source_id: NWS_SOURCE_ID, p_definition_hash: a.definitionHash, p_location_id: a.locationId,
      p_issued_at: a.issuedAt, p_started_at: a.startedAt, p_rows: a.rows }, signal),
    ingestEvents: (a, signal) => ingest(sb, "demand_events_ingest", { p_source_id: NWS_SOURCE_ID, p_definition_hash: a.definitionHash, p_location_id: a.locationId,
      p_started_at: a.startedAt, p_events: a.events }, signal),
    recordFailure: async (a, signal) => {
      await call(sb, "demand_signal_run_fail", { p_source_id: NWS_SOURCE_ID, p_location_id: a.locationId, p_feed: a.feed, p_started_at: a.startedAt,
        p_error_code: /^[a-z_]{1,40}$/.test(a.code) ? a.code : "failed" }, signal);
    },
    now: () => Date.now(),
  };
}

/** One bounded collection pass (the cron). NWS_USER_AGENT is read here and nowhere else. */
export async function runDemandSignalsCollection(opts: { deadlineAt: number }): Promise<CollectionResult & { requests: number }> {
  const counter = { requests: 0 };
  const userAgent = process.env.NWS_USER_AGENT;
  const result = await runNwsCollection(nwsCollectDeps(getServiceRoleClient(), { userAgent, deadlineAt: opts.deadlineAt, counter }), { deadlineAt: opts.deadlineAt, userAgent });
  return { ...result, requests: counter.requests };
}
