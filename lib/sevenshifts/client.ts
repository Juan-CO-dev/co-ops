/**
 * THE 7SHIFTS CLIENT — SERVER-ONLY, GET ONLY (Scheduling Phase 1, Task 6).
 *
 * Phase 1 has no write path to 7shifts: this module issues `GET` and nothing else (pinned by a source
 * scan in tests/sevenshifts-client.test.ts). Every request:
 *   · waits for the shared limiter (8/s, 500/min — 80% of the published limits);
 *   · sends `Authorization: Bearer <token>` and `x-api-version` (SEVENSHIFTS_API_VERSION), `cache: no-store`;
 *   · is bounded by the run's ONE AbortSignal;
 *   · on 429 honours Retry-After IN FULL (no cap) on the SHARED limiter and retries ONCE; a second 429 is
 *     `rate_limited` and its Retry-After lands on the limiter too. A cooldown that cannot fit before the
 *     run's deadline ends that resource at once (`rate_limited`), and any later wait that cannot fit ends
 *     its resource as `deadline` without sending, so the next resource honours the cooldown too
 *     (chunk B review #5).
 * It dispatches on the endpoint's declared shape: only `paginated` follows cursors (through
 * paginate-shared); a `singleton` / `list-unpaginated` is ONE request run through its validator.
 *
 * ERRORS are SevenShiftsApiError with a FIXED code as the whole message — never the response body, the
 * URL or the token. The token reaches this module only through `createSevenShiftsClient({ token })`;
 * lib/sevenshifts/config.ts is the only reader of the env.
 *
 * THE DIGEST'S BOUNDED READ (digest PR 2, S6 + A2-3). A client built with `maxResponseBytes` reads every
 * body under that byte ceiling (a stream counted chunk by chunk, never `res.json()`), decodes it as strict
 * UTF-8 and parses it with `parseJsonWithIdSource`, so an id is checked in its WRITTEN form. Without the
 * field every byte of the sync's path is what it was. `getOnePage` is the digest's one GET of the
 * published-shifts listing: it never follows a cursor and never judges the page (the digest's pure check
 * does that).
 */
import "server-only";
import {
  PUBLISHED_SHIFTS_ENDPOINT, SEVENSHIFTS_API_BASE, SEVENSHIFTS_API_VERSION, SEVENSHIFTS_ENDPOINTS, requestPasses,
  type PublishedShiftsQuery, type SevenShiftsResource, type SyncWindow,
} from "@/lib/sevenshifts/endpoints-shared";
import {
  assignmentsSnapshot, followPages, laborSettingsSnapshot, listUnpaginatedSnapshot, wagesSnapshot, whoamiSnapshot,
  type PaginationError, type SnapshotResult,
} from "@/lib/sevenshifts/paginate-shared";
import type { Limiter } from "@/lib/sevenshifts/rate-limit-shared";

export const SEVENSHIFTS_ERROR_CODES = [
  "auth_failed", "plan_forbidden", "not_found", "server_error", "http_error", "rate_limited",
  "deadline", "network_error", "bad_payload", "bad_snapshot",
] as const;
export type SevenShiftsErrorCode = (typeof SEVENSHIFTS_ERROR_CODES)[number];

export class SevenShiftsApiError extends Error {
  constructor(readonly code: SevenShiftsErrorCode) {
    super(code);
    this.name = "SevenShiftsApiError";
  }
}

export type SevenShiftsFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SevenShiftsClientDeps {
  token: string;
  limiter: Limiter;
  /** The run's deadline: every request and every wait honours it. */
  signal: AbortSignal;
  /** Incremented once per HTTP request sent (retries included). */
  counter: { requests: number };
  fetch?: SevenShiftsFetch;
  /** Real time by default; tests inject a fake clock. */
  sleep?: (ms: number) => Promise<void>;
  /** The limiter's clock (ms); Date.now by default. Retry-After dates and the deadline are read on it. */
  now?: () => number;
  /** The run's deadline on `now`'s clock. A wait that cannot finish before it is not started. */
  deadlineAt?: number;
  /** Digest only. Set = every response body is read under this byte ceiling and parsed with source-checked ids. Not set = today's path, unchanged. */
  maxResponseBytes?: number;
}

export type GetResult =
  | { kind: "list"; rows: unknown[]; pages: number; complete: boolean; error: PaginationError | null }
  | { kind: "snapshot"; value: unknown };

export interface GetArgs {
  /** null only for whoami (it names the company). */
  companyId: string | null;
  userId?: string;
  window: SyncWindow;
}

const DEFAULT_RETRY_AFTER_MS = 1_000;

/** The server's cooldown, in full (chunk B review #5: no cap; the run's deadline bounds the wait). */
function retryAfterMs(h: string | null, nowMs: number): number {
  if (h === null || h.trim() === "") return DEFAULT_RETRY_AFTER_MS;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(h);
  if (Number.isFinite(at)) return Math.max(0, at - nowMs);
  return DEFAULT_RETRY_AFTER_MS;
}

function statusCode(status: number): SevenShiftsErrorCode {
  if (status === 401) return "auth_failed";
  if (status === 403) return "plan_forbidden";
  if (status === 404) return "not_found";
  if (status >= 500) return "server_error";
  return "http_error";
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new SevenShiftsApiError("deadline"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new SevenShiftsApiError("deadline")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The id keys whose numeric tokens are checked against their source text on a bounded read. */
export const SOURCE_CHECKED_ID_KEYS = ["id", "location_id", "company_id", "user_id", "role_id"] as const;

/** The one canonical spelling of a numeric id: `0`, or a nonzero digit and up to 17 more (1–18 digits). */
const CANONICAL_ID_TOKEN = /^(?:0|[1-9]\d{0,17})$/;

/** TypeScript's reviver type has no third parameter; V8 (Node 22) passes `{ source }` for primitives. */
type SourceReviver = (this: unknown, key: string, value: unknown, context?: { source?: unknown }) => unknown;

/**
 * JSON.parse with a reviver that reads each number's source text (`context.source`). For a key in `idKeys`, a numeric
 * token spelled exactly `0` or `[1-9]` + up to 17 digits becomes that STRING (the one canonical id spelling). Any other
 * numeric token under an id key (a fraction, an exponent, a sign, `42.0000000000000001`), and EVERY numeric id when the
 * runtime gives no source text, becomes NaN, which no id validator in this codebase accepts (fail closed).
 * Strings and every other key are left exactly as written.
 *
 * A2-3: `JSON.parse` alone turns `42.0000000000000001` into the integer 42 and a 19-digit id into a
 * rounded one, so the digest could name the wrong person. NaN, not a throw: a nested object the digest
 * never reads may carry an odd numeric `id`, and that must not refuse the whole answer; the digest's raw
 * check refuses any id that is not a canonical digit string under a key it reads.
 */
export function parseJsonWithIdSource(text: string, idKeys: readonly string[] = SOURCE_CHECKED_ID_KEYS): unknown {
  const keys = new Set(idKeys);
  const reviver: SourceReviver = (key, value, context) => {
    if (typeof value !== "number" || !keys.has(key)) return value;
    const source = context?.source;
    if (typeof source === "string" && CANONICAL_ID_TOKEN.test(source)) return source;
    return Number.NaN;
  };
  return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);
}

/** A ceiling is a positive whole byte count; anything else is refused (never read as "no ceiling"). */
function validCeiling(max: number): boolean {
  return Number.isSafeInteger(max) && max > 0;
}

async function cancelQuietly(cancel: () => Promise<void>): Promise<void> {
  try { await cancel(); } catch { /* the body is being refused either way */ }
}

/**
 * S6: read a body under a byte ceiling. A declared length above it is refused unread; otherwise the
 * stream is counted chunk by chunk and cancelled the moment the count passes the ceiling, so a missing
 * or false `Content-Length` never lets more than one chunk past it into memory. Strict UTF-8, then the
 * source-checked parse. Every failure is `bad_payload` (an abort between chunks is `deadline`).
 */
async function readBounded(res: Response, max: number, signal: AbortSignal): Promise<unknown> {
  const declared = res.headers.get("content-length");
  if (declared !== null && declared.trim() !== "" && Number(declared) > max) {
    if (res.body) await cancelQuietly(() => res.body!.cancel());
    throw new SevenShiftsApiError("bad_payload");
  }
  if (!res.body) throw new SevenShiftsApiError("bad_payload");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal.aborted) {
      await cancelQuietly(() => reader.cancel());
      throw new SevenShiftsApiError("deadline");
    }
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch {
      throw new SevenShiftsApiError(signal.aborted ? "deadline" : "bad_payload");
    }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) {
      await cancelQuietly(() => reader.cancel());
      throw new SevenShiftsApiError("bad_payload");
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  try {
    return parseJsonWithIdSource(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SevenShiftsApiError("bad_payload");
  }
}

const VALIDATORS: Partial<Record<SevenShiftsResource, (json: unknown) => SnapshotResult<unknown>>> = {
  whoami: whoamiSnapshot,
  assignments: assignmentsSnapshot,
  wages: wagesSnapshot,
  labor_settings: laborSettingsSnapshot,
};

export function createSevenShiftsClient(deps: SevenShiftsClientDeps) {
  const doFetch: SevenShiftsFetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep = deps.sleep ?? ((ms: number) => sleepWithSignal(ms, deps.signal));
  const now = deps.now ?? Date.now;
  const fits = (ms: number) => deps.deadlineAt === undefined || now() + ms <= deps.deadlineAt;

  async function waitTurn(): Promise<void> {
    if (deps.signal.aborted) throw new SevenShiftsApiError("deadline");
    const wait = deps.limiter.reserve();
    // A wait (a shared cooldown, usually) that cannot end before the deadline is never started.
    if (!fits(wait)) throw new SevenShiftsApiError("deadline");
    await sleep(wait);
    if (deps.signal.aborted) throw new SevenShiftsApiError("deadline");
  }

  async function send(url: string): Promise<Response> {
    deps.counter.requests += 1;
    try {
      return await doFetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${deps.token}`, "x-api-version": SEVENSHIFTS_API_VERSION, Accept: "application/json" },
        signal: deps.signal,
      });
    } catch (e) {
      if (deps.signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))) {
        throw new SevenShiftsApiError("deadline");
      }
      throw new SevenShiftsApiError("network_error");
    }
  }

  /**
   * One GET with the limiter, the one 429 retry and the fixed error codes; returns parsed JSON.
   * `maxBytes` undefined = today's `res.json()`; set = the bounded, source-checked read (S6, A2-3).
   */
  async function getJson(url: string, maxBytes: number | undefined = deps.maxResponseBytes): Promise<unknown> {
    // An unusable ceiling is refused before sending; it never falls back to an unbounded read.
    if (maxBytes !== undefined && !validCeiling(maxBytes)) throw new SevenShiftsApiError("bad_payload");
    await waitTurn();
    let res = await send(url);
    if (res.status === 429) {
      const cooldown = retryAfterMs(res.headers.get("retry-after"), now());
      // The cooldown always lands on the SHARED limiter, even when this resource gives up below.
      deps.limiter.penalize(cooldown);
      if (!fits(cooldown)) throw new SevenShiftsApiError("rate_limited");
      await waitTurn();
      res = await send(url);
      if (res.status === 429) {
        deps.limiter.penalize(retryAfterMs(res.headers.get("retry-after"), now()));
        throw new SevenShiftsApiError("rate_limited");
      }
    }
    if (!res.ok) throw new SevenShiftsApiError(statusCode(res.status));
    if (maxBytes !== undefined) return readBounded(res, maxBytes, deps.signal);
    try {
      return await res.json();
    } catch {
      if (deps.signal.aborted) throw new SevenShiftsApiError("deadline");
      throw new SevenShiftsApiError("bad_payload");
    }
  }

  async function get(resource: SevenShiftsResource, args: GetArgs): Promise<GetResult> {
    const spec = SEVENSHIFTS_ENDPOINTS[resource];
    if (args.companyId === null && resource !== "whoami") throw new Error("bad_id");
    const companyId = args.companyId ?? "0"; // whoami's path takes no company
    // Path and params validate every id BEFORE any request (throw bad_id / bad_window).
    const path = spec.path(companyId, { userId: args.userId });
    const passes = requestPasses(resource, args.window, companyId);
    const urlFor = (qs: URLSearchParams) => {
      const s = qs.toString();
      return `${SEVENSHIFTS_API_BASE}${path}${s ? `?${s}` : ""}`;
    };

    if (spec.shape === "paginated") {
      const out: GetResult = { kind: "list", rows: [], pages: 0, complete: true, error: null };
      for (const qs of passes) {
        const r = await followPages((cursor) => {
          const q = new URLSearchParams(qs);
          if (cursor !== null) q.set("cursor", cursor);
          return getJson(urlFor(q));
        });
        out.rows.push(...r.rows);
        out.pages += r.pages;
        if (!r.complete) {
          out.complete = false;
          out.error ??= r.error;
          break; // a failed pass ends the resource; it is marked failed either way
        }
      }
      return out;
    }

    const json = await getJson(urlFor(passes[0]!));
    const validate = spec.shape === "list-unpaginated" ? listUnpaginatedSnapshot : VALIDATORS[resource];
    if (!validate) throw new SevenShiftsApiError("bad_snapshot");
    const v = validate(json);
    if (!v.ok) throw new SevenShiftsApiError("bad_snapshot");
    return { kind: "snapshot", value: v.value };
  }

  /**
   * ONE GET of the published-shifts default listing. Never follows a cursor. Returns the parsed JSON as it arrived.
   * It is only ever a bounded read: `opts.maxBytes` (this request) or the client's `maxResponseBytes`;
   * with neither it throws `bad_payload` without sending. It does not judge the page (terminal or not,
   * `object` tag, rows): the digest's pure check does, so `pageStep` stays the sync's.
   */
  async function getOnePage(q: PublishedShiftsQuery, opts?: { maxBytes?: number }): Promise<unknown> {
    // Path and params validate the id and both instants BEFORE any request (throw bad_id / bad_window).
    const path = PUBLISHED_SHIFTS_ENDPOINT.path(q.companyId);
    const qs = PUBLISHED_SHIFTS_ENDPOINT.params(q).toString();
    const maxBytes = opts?.maxBytes ?? deps.maxResponseBytes;
    if (maxBytes === undefined) throw new SevenShiftsApiError("bad_payload");
    return getJson(`${SEVENSHIFTS_API_BASE}${path}?${qs}`, maxBytes);
  }

  return { get, getOnePage };
}

export type SevenShiftsClient = ReturnType<typeof createSevenShiftsClient>;
