/**
 * Digest LABOR MONEY, the loaders' factory (digests round 3, PR 4; plan §3.1, §15.2.3; CC addendum A4-4, O-N4, O-N8,
 * P3-7). Server-only. It builds the `LaborMoneyIO` the engine's pre-load runs, and NOTHING when the switch is off.
 *
 * THE ONE DOOR. This module is the ONLY importer of lib/business-labor-core.ts and the ONLY caller of
 * `createServiceRoleClientWithFetch` (two import censuses in tests/report-digests-labor-io.test.ts pin both). So the
 * pre-load's reads run on a client of their own, and no other code path ever goes through its transport.
 *
 * A4-4, THE FETCH BOUNDARY. supabase-js awaits its access token inside `fetchWithAuth` before it calls the transport
 * (node_modules/@supabase/supabase-js/src/lib/fetch.ts), so a request can pass its stage's `expired()` check just
 * before the stage ends and reach the network just after. The client's `fetch` closes that gap: immediately before it
 * calls the transport it refuses the attempt (an AbortError, NO HTTP) when `init.signal` is aborted OR the injected
 * clock has reached the deadline the runner registered for that signal (`signalDeadline`). postgrest-js hands
 * `.abortSignal(s)`'s `s` to the transport as `init.signal` (PostgrestBuilder `signal: this.signal`, and fetchWithAuth
 * spreads `init`), so the signal the wrapper sees is the stage's own object. A request with NO registered deadline
 * (a signal this pre-load did not make, or none) is refused too (O-N8): nothing on this client can reach the network
 * without a stage.
 * Aborting ends the HTTP request at the client; whether Postgres stops the query is not verified.
 *
 * Never logs a row, a name or a dollar.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hourlyLaborPiece, roleLaborPiece, type LaborCoreDeps } from "@/lib/business-labor-core";
import { readGmVisibility } from "@/lib/business-report";
import { laborWageFallback } from "@/lib/facts/labor-config-shared";
import { signalDeadline, type PieceHandle, type PreloadPiece, type PreloadTimers } from "@/lib/preload-runner";
import {
  LABOR_HOURLY_CAP_MS, LABOR_ROLE_CAP_MS, LABOR_SETTINGS_CAP_MS, LABOR_SETTINGS_KEY, digestLaborMoneyEnabled, laborHourlyKey, laborRolesKey,
  type GmSettingsResult, type HourlyLaborFacts, type LaborMoneyIO, type RoleLaborFacts,
} from "@/lib/report-digests-labor-shared";
import { createServiceRoleClientWithFetch } from "@/lib/supabase-server";

export interface LaborMoneyDeps {
  /** Default: `process.env` (the factory is called from buildIO, which is where the digest reads env). */
  env?: Readonly<Record<string, string | undefined>>;
  /** A REAL advancing clock in ms. Default: `performance.now()` (monotonic). */
  clock?: () => number;
  timers?: PreloadTimers;
  /** Tests: the transport under the guarded fetch. Default: the global `fetch`. */
  fetch?: typeof fetch;
}

function abortError(code: string): Error {
  const e = new Error(code);
  e.name = "AbortError";
  return e;
}

/**
 * A4-4: the pre-load client's `fetch`. Immediately before the transport: refuse (no HTTP) a request whose signal is
 * aborted, has no deadline registered by the runner (O-N8), or whose deadline the clock has reached. The refusal is
 * an AbortError, which postgrest-js never retries. Exported for the fetch-boundary tests.
 */
export function preloadFetch(transport: typeof fetch, clock: () => number): typeof fetch {
  return (input, init) => {
    const signal = init?.signal ?? null;
    if (!signal) return Promise.reject(abortError("preload_unstaged_request"));
    const deadline = signalDeadline(signal);
    if (deadline === undefined) return Promise.reject(abortError("preload_unstaged_request"));
    if (signal.aborted || clock() >= deadline) return Promise.reject(abortError("preload_stage_ended"));
    return transport(input, init);
  };
}

/** A piece whose real piece is built only when it starts, so a run with nothing to read builds no client. */
function lazyPiece<T>(key: string, capMs: number, make: () => PreloadPiece<T>): PreloadPiece<T> {
  return { key, capMs, start: (ctx) => make().start(ctx) };
}

/**
 * null when the switch is off (`digestLaborMoneyEnabled(env)` false): then NOTHING is built, no client, no read.
 * With it on, the client is created lazily, once, on the first piece that starts.
 */
export function buildLaborMoneyIO(deps: LaborMoneyDeps = {}): LaborMoneyIO | null {
  const env = deps.env ?? process.env;
  if (!digestLaborMoneyEnabled(env)) return null;
  const clock = deps.clock ?? (() => performance.now());
  // P3-7: the wage fallback is resolved ONCE per run; the day row and the people read use the same value.
  const wageFallback = laborWageFallback(env.LABOR_WAGE_FALLBACK);
  const transport: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  let sb: SupabaseClient | null = null;
  const client = (): SupabaseClient => (sb ??= createServiceRoleClientWithFetch(preloadFetch(transport, clock)));
  const core = (): LaborCoreDeps => ({ sb: client(), wageFallback });

  return {
    clock,
    ...(deps.timers ? { timers: deps.timers } : {}),

    /** Phase A: ONE read of the GM visibility settings on the piece's own (cutoff) stage. Never throws. */
    settings(): PreloadPiece<GmSettingsResult> {
      return {
        key: LABOR_SETTINGS_KEY,
        capMs: LABOR_SETTINGS_CAP_MS,
        start(ctx): PieceHandle<GmSettingsResult> {
          const stage = ctx.stage("cutoff");
          // The ledger: the one result, accepted only while the stage is live and the ledger open.
          let open = true;
          let accepted: GmSettingsResult | null = null;
          const done = (async () => {
            if (stage.expired()) return;
            // readGmVisibility with a signal applies `.abortSignal(signal)` AND `.retry(false)` (one call = one attempt).
            const read = await readGmVisibility(client(), stage.signal);
            if (!open || stage.expired()) return;
            // Not answered, failed, malformed, missing table: all `unavailable` (a GM then gets nothing).
            accepted = "unavailable" in read ? { kind: "unavailable" } : { kind: "settings", settings: read.settings };
          })().catch(() => { /* a throw (no client, a bad env) is `unavailable`; nothing is logged */ });
          return {
            done,
            snapshot(): GmSettingsResult {
              open = false;
              return accepted ?? { kind: "unavailable" };
            },
          };
        },
      };
    },

    hourly(locationId: string, day: string): PreloadPiece<HourlyLaborFacts> {
      return lazyPiece(laborHourlyKey(locationId, day), LABOR_HOURLY_CAP_MS, () => hourlyLaborPiece(core(), locationId, day));
    },

    roles(locationId: string, day: string, hourly: HourlyLaborFacts): PreloadPiece<RoleLaborFacts> {
      return lazyPiece(laborRolesKey(locationId, day), LABOR_ROLE_CAP_MS, () => roleLaborPiece(core(), locationId, day, hourly));
    },
  };
}
