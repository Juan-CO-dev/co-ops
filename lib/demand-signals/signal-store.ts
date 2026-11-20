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
 *
 * EVERY SET IS READ TO COMPLETION OR REFUSED BY NAME (review r1 P2 #2). PostgREST cuts an unranged read of a
 * set-returning function at max-rows (1,000) with no error, so the two readers go through `callAll`: pages of
 * SIGNAL_READ_PAGE by `range` with an exact count, over 0343's total order (events: valid_from, id; weather:
 * source_id, valid_hour). A missing or moving count, an empty page before the count, more rows than counted or
 * more than SIGNAL_READ_MAX_PAGES pages is 503 `signal_reads_incomplete`. Never a partial list.
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
import { pickShopPoints, type ShopNodeRow } from "./shop-points-shared";
import {
  collectDecision, keepUsable, parseDefinitionText, type DemandEventInput, type SourceDefinitionView, type SourceGate, type SourceMarkInput, type SourceState,
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
  source_terms_evidence_missing: 409,
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

/** One page of a set read, and the most pages one read may take (20,000 rows). */
export const SIGNAL_READ_PAGE = 1_000;
export const SIGNAL_READ_MAX_PAGES = 20;
type Page = { data: unknown; error: RpcError | null; count: number | null };
type PagedRpc = { rpc: (name: string, args: Record<string, unknown>, options: { count: "exact" }) => { range: (from: number, to: number) => PromiseLike<Page> } };

/** A set-returning function of 0343, read to completion over its total order, or refused `signal_reads_incomplete`. */
async function callAll(sb: SupabaseClient, name: Extract<Rpc, "demand_usable_weather" | "demand_usable_day_events">, args: Record<string, unknown>, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const client = (signal ? withAbort(sb, signal) : sb) as unknown as PagedRpc;
  const incomplete = () => new DemandSignalError(503, "signal_reads_incomplete");
  const out: Array<Record<string, unknown>> = [];
  let expected: number | null = null;
  for (let page = 0; ; page++) {
    if (page >= SIGNAL_READ_MAX_PAGES) throw incomplete();
    const { data, error, count } = await client.rpc(name, args, { count: "exact" }).range(out.length, out.length + SIGNAL_READ_PAGE - 1);
    if (error) throw toError(error);
    const got = data ?? [];
    if (!Array.isArray(got) || typeof count !== "number" || (expected !== null && count !== expected)) throw incomplete();
    expected = count;
    out.push(...(got as Array<Record<string, unknown>>));
    if (out.length === expected) return out;
    if (got.length === 0 || out.length > expected) throw incomplete();
  }
}

// ── the register ────────────────────────────────────────────────────────────────────────────────
interface StateRow { source_id: string; definition_hash: string; gate: string; adapter: string | null; status: string }

/** The register as it reads NOW (every source at its current definition). */
export async function readSourceStates(sb: SupabaseClient, signal?: AbortSignal): Promise<SourceState[]> {
  const rows = await call<StateRow[] | null>(sb, "demand_source_states", {}, signal);
  return (rows ?? []).map((r) => ({ sourceId: r.source_id, definitionHash: r.definition_hash, gate: r.gate as SourceGate, adapter: r.adapter,
    status: r.status === "verified" || r.status === "revoked" ? r.status : "unverified" }));
}

/** One source as the pages show it: its state NOW plus what the register says about it. */
export interface SourceRow extends SourceState {
  sourceSeq: number; name: string; category: string; termsStatus: string; termsUrl: string | null; markedAt: string | null; markedBy: string | null;
}
interface FullStateRow extends StateRow { source_seq: number | string; name: string; category: string; terms_status: string; terms_url: string | null; marked_at: string | null; marked_by: string | null }

/**
 * The register for the pages (PR 5): every source at its current definition, by name. ONE unpaged call of a set
 * that is one row per source; a set at the response cap could be a cut one, so it is refused by name.
 */
export async function loadSourceRows(sb: SupabaseClient, signal?: AbortSignal): Promise<SourceRow[]> {
  const rows = (await call<FullStateRow[] | null>(sb, "demand_source_states", {}, signal)) ?? [];
  if (!Array.isArray(rows) || rows.length >= SIGNAL_READ_PAGE) throw new DemandSignalError(503, "signal_reads_incomplete");
  return rows.map((r) => ({ sourceId: r.source_id, definitionHash: r.definition_hash, gate: r.gate as SourceGate, adapter: r.adapter,
    status: r.status === "verified" || r.status === "revoked" ? r.status as "verified" | "revoked" : "unverified" as const,
    sourceSeq: Number(r.source_seq), name: r.name, category: r.category, termsStatus: r.terms_status, termsUrl: r.terms_url, markedAt: r.marked_at, markedBy: r.marked_by }))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.sourceId < b.sourceId ? -1 : 1));
}

export interface SourceRegisterEntry extends SourceRow { definition: SourceDefinitionView | null; registeredAt: string | null }
const DEFINITION_CHUNK = 50;
/**
 * The register WITH each current definition's stored text (the verification page, MoO+). The definitions are read
 * by their exact row ids, in chunks, and every id must come back: a short answer is `signal_reads_incomplete`,
 * never a page that shows some sources as having no definition.
 */
export async function loadSourceRegister(sb: SupabaseClient, signal?: AbortSignal): Promise<SourceRegisterEntry[]> {
  const rows = await loadSourceRows(sb, signal);
  const client = signal ? withAbort(sb, signal) : sb;
  const bySeq = new Map<number, { definition: string; registered_at: string | null }>();
  const seqs = rows.map((r) => r.sourceSeq);
  for (let i = 0; i < seqs.length; i += DEFINITION_CHUNK) {
    const chunk = seqs.slice(i, i + DEFINITION_CHUNK);
    const { data, error } = await client.from("demand_sources").select("seq, definition, registered_at").in("seq", chunk).order("seq")
      .returns<Array<{ seq: number | string; definition: string; registered_at: string | null }>>();
    if (error) throw toError(error);
    if (!data || data.length !== chunk.length) throw new DemandSignalError(503, "signal_reads_incomplete");
    for (const d of data) bySeq.set(Number(d.seq), d);
  }
  return rows.map((r) => {
    const d = bySeq.get(r.sourceSeq);
    if (!d) throw new DemandSignalError(503, "signal_reads_incomplete");
    return { ...r, definition: parseDefinitionText(d.definition), registeredAt: d.registered_at };
  });
}

export type SignalFeed = "weather_hourly" | "day_events";
export interface SignalRun { feed: SignalFeed; outcome: "written" | "unchanged" | "failed"; errorCode: string | null; rowsSeen: number; rowsWritten: number; rowsWithdrawn: number; finishedAt: string }
/**
 * The run ledger's newest row for one source, feed and shop (`goodOnly` = the newest that did not fail): the
 * freshness line of the page. One row by a total order, so there is no set to cut. null = no such run recorded.
 */
export async function loadLatestRun(sb: SupabaseClient, args: { sourceId: string; locationId: string; feed: SignalFeed; goodOnly: boolean }, signal?: AbortSignal): Promise<SignalRun | null> {
  const client = signal ? withAbort(sb, signal) : sb;
  let q = client.from("demand_signal_runs").select("id, feed, outcome, error_code, rows_seen, rows_written, rows_withdrawn, finished_at")
    .eq("source_id", args.sourceId).eq("feed", args.feed).eq("location_id", args.locationId);
  if (args.goodOnly) q = q.neq("outcome", "failed");
  const { data, error } = await q.order("finished_at", { ascending: false }).order("id", { ascending: false }).limit(1)
    .returns<Array<{ feed: SignalFeed; outcome: SignalRun["outcome"]; error_code: string | null; rows_seen: number; rows_written: number; rows_withdrawn: number; finished_at: string }>>();
  if (error) throw toError(error);
  const r = data?.[0];
  return r ? { feed: r.feed, outcome: r.outcome, errorCode: r.error_code, rowsSeen: Number(r.rows_seen), rowsWritten: Number(r.rows_written),
    rowsWithdrawn: Number(r.rows_withdrawn), finishedAt: r.finished_at } : null;
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
  const rows = await callAll(sb, "demand_usable_weather",
    { p_location_id: args.locationId, p_from: args.fromIso, p_to: args.toIso, p_as_of: args.asOfIso }, signal);
  const mapped = rows.map((r) => ({
    sourceId: String(r.source_id), sourceIds: [String(r.source_id)], validHour: String(r.valid_hour), issuedAt: String(r.issued_at), availableAt: String(r.available_at),
    vintageId: Number(r.vintage_id), temperatureF: Number(r.temperature_f), precipProbabilityPct: num(r.precip_probability_pct), windSpeedMph: num(r.wind_speed_mph),
    relativeHumidityPct: num(r.relative_humidity_pct), isDaytime: r.is_daytime === true, condition: String(r.condition) }));
  return keepUsable(mapped, states, args.use);
}

export interface UsableDayEvent {
  id: string; origin: "manual" | "feed"; sourceId: string | null; sourceIds: string[]; locationId: string | null; category: string;
  validFrom: string; validTo: string; startLocal: string | null; endLocal: string | null; title: string; expectedImpact: string; severity: string | null;
}
/**
 * Day events for a shop (its own and the all-shop ones): manual heads, and feed events from sources verified NOW
 * that were not withdrawn (a cancelled alert is not returned from the collection that saw it gone). Every row of
 * the window, in 0343's order (valid_from, id), or `signal_reads_incomplete`.
 */
export async function loadUsableDayEvents(sb: SupabaseClient, args: { locationId: string; from: string; to: string; asOfIso: string; use: ReadUse }, signal?: AbortSignal): Promise<UsableDayEvent[]> {
  const states = await readSourceStates(sb, signal);
  const rows = await callAll(sb, "demand_usable_day_events",
    { p_location_id: args.locationId, p_from: args.from, p_to: args.to, p_as_of: args.asOfIso }, signal);
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const mapped = rows.map((r) => ({
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
    // A shop's point is its ACTIVE catering fulfilment node; the rule (one per shop, gaps listed) is pickShopPoints.
    loadShopPoints: async (signal) => {
      const client = withAbort(sb, signal);
      const { data: shops, error: shopErr } = await client.from("locations").select("id").eq("active", true).returns<Array<{ id: string }>>();
      if (shopErr) throw new Error("shops_unreadable");
      const { data: nodes, error: nodeErr } = await client.from("catering_fulfillment_nodes").select("location_id, lat, lng, active").returns<ShopNodeRow[]>();
      if (nodeErr) throw new Error("shops_unreadable");
      return pickShopPoints((shops ?? []).map((s) => s.id), nodes ?? []);
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
