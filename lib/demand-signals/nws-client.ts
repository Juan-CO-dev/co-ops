/**
 * Demand signals (item 4 PR 2): THE NWS CLIENT. GET only, api.weather.gov only. The ONE module of this layer
 * that makes an outside request (pinned in tests/demand-signals-contracts.test.ts).
 *
 * It does not know the register. It is reached only from collect.ts, AFTER the collector has asked the
 * register and the answer was `verified`; an unverified source never gets as far as this file.
 *   · the URL must be https://api.weather.gov/... : anything else is `bad_url` and no request is sent;
 *   · no User-Agent, no request (`user_agent_missing`): NWS requires one that identifies the application;
 *   · redirects are not followed (a 3xx is `http_error`), so a request never leaves the host;
 *   · at most 2 retries (429, 5xx, a network failure), honouring Retry-After in full; a wait that cannot
 *     finish before the run's deadline is not started (`deadline`);
 *   · every request carries the run's abort signal and its own 15 s limit.
 * Errors are fixed codes: never a response body, never a URL.
 */
import "server-only";
import { NWS_HOST } from "./nws-shared";

export const NWS_ERROR_CODES = ["user_agent_missing", "bad_url", "not_found", "http_error", "server_error", "rate_limited", "network_error",
  "deadline", "bad_payload"] as const;
export type NwsErrorCode = (typeof NWS_ERROR_CODES)[number];
export type NwsResult = { ok: true; json: unknown } | { ok: false; code: NwsErrorCode };

export const NWS_MAX_RETRIES = 2;
export const NWS_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_MS = 2_000;

export interface NwsClientDeps {
  /** The global fetch by default; tests inject a fake. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  userAgent: string | undefined;
  /** The run's signal, fired at its deadline. */
  signal: AbortSignal;
  deadlineAt: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Incremented once per request actually sent (retries included). */
  counter: { requests: number };
}

function retryAfterMs(header: string | null, nowMs: number): number {
  if (header === null || header.trim() === "") return DEFAULT_RETRY_MS;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : DEFAULT_RETRY_MS;
}

export async function nwsGetJson(url: string, deps: NwsClientDeps): Promise<NwsResult> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, code: "bad_url" }; }
  if (parsed.protocol !== "https:" || parsed.hostname !== NWS_HOST || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") return { ok: false, code: "bad_url" };
  const userAgent = deps.userAgent?.trim();
  if (!userAgent) return { ok: false, code: "user_agent_missing" };
  let last: NwsErrorCode = "network_error";
  for (let attempt = 0; attempt <= NWS_MAX_RETRIES; attempt++) {
    if (deps.signal.aborted || deps.now() >= deps.deadlineAt) return { ok: false, code: "deadline" };
    let waitMs = DEFAULT_RETRY_MS;
    try {
      deps.counter.requests += 1;
      const res = await (deps.fetch ?? fetch)(parsed.toString(), {
        method: "GET", redirect: "manual", cache: "no-store",
        headers: { "User-Agent": userAgent, Accept: "application/geo+json" },
        signal: AbortSignal.any([deps.signal, AbortSignal.timeout(NWS_REQUEST_TIMEOUT_MS)]),
      });
      if (res.status === 200) {
        try { return { ok: true, json: await res.json() }; } catch { return { ok: false, code: "bad_payload" }; }
      }
      if (res.status === 404) return { ok: false, code: "not_found" };
      if (res.status === 429) { last = "rate_limited"; waitMs = retryAfterMs(res.headers.get("retry-after"), deps.now()); }
      else if (res.status >= 500) { last = "server_error"; waitMs = retryAfterMs(res.headers.get("retry-after"), deps.now()); }
      else return { ok: false, code: "http_error" };
    } catch {
      if (deps.signal.aborted) return { ok: false, code: "deadline" };
      last = "network_error";
    }
    if (attempt === NWS_MAX_RETRIES) break;
    if (deps.now() + waitMs >= deps.deadlineAt) return { ok: false, code: "deadline" };
    await deps.sleep(waitMs);
  }
  return { ok: false, code: last };
}
