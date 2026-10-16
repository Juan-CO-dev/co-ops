/**
 * THE 7SHIFTS CLIENT — SERVER-ONLY, GET ONLY (Scheduling Phase 1, Task 6).
 *
 * Phase 1 has no write path to 7shifts: this module issues `GET` and nothing else (pinned by a source
 * scan in tests/sevenshifts-client.test.ts). Every request:
 *   · waits for the shared limiter (8/s, 500/min — 80% of the published limits);
 *   · sends `Authorization: Bearer <token>` and `x-api-version` (SEVENSHIFTS_API_VERSION), `cache: no-store`;
 *   · is bounded by the run's ONE AbortSignal;
 *   · on 429 honours Retry-After, penalizes the limiter, and retries ONCE (a second 429 is `rate_limited`).
 * It dispatches on the endpoint's declared shape: only `paginated` follows cursors (through
 * paginate-shared); a `singleton` / `list-unpaginated` is ONE request run through its validator.
 *
 * ERRORS are SevenShiftsApiError with a FIXED code as the whole message — never the response body, the
 * URL or the token. The token reaches this module only through `createSevenShiftsClient({ token })`;
 * lib/sevenshifts/config.ts is the only reader of the env.
 */
import "server-only";
import {
  SEVENSHIFTS_API_BASE, SEVENSHIFTS_API_VERSION, SEVENSHIFTS_ENDPOINTS, requestPasses,
  type SevenShiftsResource, type SyncWindow,
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
const MAX_RETRY_AFTER_MS = 60_000;

function retryAfterMs(h: string | null, nowMs: number): number {
  if (h === null || h.trim() === "") return DEFAULT_RETRY_AFTER_MS;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(MAX_RETRY_AFTER_MS, secs * 1000);
  const at = Date.parse(h);
  if (Number.isFinite(at)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - nowMs));
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

const VALIDATORS: Partial<Record<SevenShiftsResource, (json: unknown) => SnapshotResult<unknown>>> = {
  whoami: whoamiSnapshot,
  assignments: assignmentsSnapshot,
  wages: wagesSnapshot,
  labor_settings: laborSettingsSnapshot,
};

export function createSevenShiftsClient(deps: SevenShiftsClientDeps) {
  const doFetch: SevenShiftsFetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep = deps.sleep ?? ((ms: number) => sleepWithSignal(ms, deps.signal));

  async function waitTurn(): Promise<void> {
    if (deps.signal.aborted) throw new SevenShiftsApiError("deadline");
    await sleep(deps.limiter.reserve());
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

  /** One GET with the limiter, the one 429 retry and the fixed error codes; returns parsed JSON. */
  async function getJson(url: string): Promise<unknown> {
    await waitTurn();
    let res = await send(url);
    if (res.status === 429) {
      deps.limiter.penalize(retryAfterMs(res.headers.get("retry-after"), Date.now()));
      await waitTurn();
      res = await send(url);
      if (res.status === 429) throw new SevenShiftsApiError("rate_limited");
    }
    if (!res.ok) throw new SevenShiftsApiError(statusCode(res.status));
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

  return { get };
}

export type SevenShiftsClient = ReturnType<typeof createSevenShiftsClient>;
