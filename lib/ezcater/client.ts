/**
 * EZCater GraphQL client (spec #2c). SERVER-ONLY. Contract per ezCater's
 * Public API User Guide (May 2024 v5): POST https://api.ezcater.com/graphql,
 * `Authorization: <raw token>` (NOT Bearer), required apollo client headers,
 * every operation NAMED per their conventions. A non-empty `errors` key
 * poisons (their documented error contract).
 *
 * FIXTURE MODE (fixture-fiction rule — shapes cite the official guide): when
 * !ezcaterConfigured() OR EZCATER_FIXTURES=1, operations resolve from
 * tests/fixtures/ezcater/<operationName>.json. Everything builds, tests, and
 * demos before Juan's ezManage token errand; first-live re-verification pass
 * is mandatory.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Official May-2024 guide says api.ezcater.com; ezCater's live docs portal
// shows api.ezcater.io (review finding #5). Env-overridable. SETTLED at the
// first-live pass 2026-09-03: api.ezcater.com answers allCaterers/createSubscriber
// with the production token; .com stays the default.
const ENDPOINT = process.env.EZCATER_API_HOSTNAME
  ? `${process.env.EZCATER_API_HOSTNAME.replace(/\/$/, "")}/graphql`
  : "https://api.ezcater.com/graphql";

export class EzcaterApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "EzcaterApiError";
  }
}

export function ezcaterConfigured(): boolean {
  return Boolean(process.env.EZCATER_API_TOKEN);
}

function fixtureMode(): boolean {
  return !ezcaterConfigured() || process.env.EZCATER_FIXTURES === "1";
}

async function readFixture(operationName: string): Promise<unknown> {
  const p = path.join(process.cwd(), "tests", "fixtures", "ezcater", `${operationName}.json`);
  try {
    return JSON.parse(await readFile(p, "utf-8")) as unknown;
  } catch {
    throw new EzcaterApiError(500, "bad_payload", `ezCater fixture missing/unreadable: ${operationName}`);
  }
}

export async function ezcaterGraphql<T>(
  operationName: string,
  query: string,
  variables?: Record<string, unknown>,
  options: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const remaining = Math.min(10_000, (options.deadlineMs ?? Date.now() + 10_000) - Date.now());
  if (remaining <= 0 || options.signal?.aborted) throw new EzcaterApiError(504, "timeout");
  if (fixtureMode()) return (await readFixture(operationName)) as T;

  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(remaining)));
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let res: Response;
  try { res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.EZCATER_API_TOKEN as string,
      "Apollographql-client-name": "co-ops",
      "Apollographql-client-version": "1.0",
    },
    body: JSON.stringify({ operationName, query, variables: variables ?? {} }),
    cache: "no-store",
    signal,
  }); } catch {
    throw new EzcaterApiError(502, signal.aborted ? "timeout" : "network_error");
  }
  if (res.status === 401 || res.status === 403) {
    throw new EzcaterApiError(res.status, "auth_failed", `ezCater auth failed (${res.status})`);
  }
  if (!res.ok) throw new EzcaterApiError(res.status, `http_${res.status}`, `ezCater ${operationName} failed`);
  let body: { data?: unknown; errors?: unknown[] };
  try {
    body = (await res.json()) as { data?: unknown; errors?: unknown[] };
  } catch {
    throw new EzcaterApiError(502, "bad_payload", `ezCater ${operationName}: non-JSON body`);
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) throw new EzcaterApiError(502, "bad_payload");
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    // Provider error messages can echo contact values and arguments. Persist codes only.
    throw new EzcaterApiError(502, "graphql_error");
  }
  return body as T;
}
