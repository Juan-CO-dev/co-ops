/**
 * THE 7SHIFTS SYNC HEALTH RULE — what the heartbeat says about a run. Pure.
 *
 * (2026-11-17) The hourly sync wrote `cron.failure` every hour because a few availability rows were
 * refused by the normalizer. That made a run that mirrored everything else indistinguishable from a
 * run that mirrored nothing, and a permanently red signal alerts nobody.
 *
 * THE RULE. Each resource is `ok`, `warning` or `failed`:
 *   · no error code → ok;
 *   · `rejected_rows` on a NON-CRITICAL resource, with at least as many rows landed as refused → warning;
 *   · anything else → failed: any other code, a rejected row on a critical resource (however few), a
 *     non-critical resource with more rows refused than landed, or none landed at all (the 2026-11-11
 *     first sync, where the normalizer refused EVERY row, stays a failure).
 * The heartbeat is `cron.success` when no resource failed, whoami passed and every record of the run
 * persisted; with warnings its `outcome` is `ok_with_warnings`, never plain `ok`.
 *
 * NON-CRITICAL = availabilities and time off: mirrored for Phase 3, read by nothing today (availability
 * is assumed from Toast punches until then). Everything the people links, the reconciliation and labor
 * read — users, locations, departments, roles, assignments, wages, labor settings, shifts, punches — is
 * critical. When a consumer of availabilities or time off ships, take that resource out of this list.
 *
 * NOTHING IS DROPPED. A warning changes the heartbeat's action and nothing else: the ledger row keeps the
 * resource's `error_code: "rejected_rows"`, its `skipped` count and its `reasons` histogram, the run's
 * ledger status stays `partial`, the resource's watermark holds and its `last_error_code` is written. The
 * heartbeat itself carries the per-resource rejected-row count and reasons (reason → count over the
 * closed vocabulary; never an index, a value or a payload) and, when a DATE was refused, `date_shapes`:
 * the spelling of the refused values per date field, digits masked (`cleanDateShapes` is the gate).
 */
import { cleanDateShapes, REJECT_REASONS, type RejectionReasons } from "@/lib/sevenshifts/normalize-shared";

export const NON_CRITICAL_RESOURCES = ["availabilities", "time_off"] as const;

export type ResourceHealth = "ok" | "warning" | "failed";
export type SyncHealthOutcome = "ok" | "ok_with_warnings" | "failed";

/** The part of a resource's ledger result the rule reads. */
export interface HealthInput {
  rows: number;
  skipped: number;
  error_code: string | null;
  reasons?: RejectionReasons;
}

export interface SyncHealth {
  outcome: SyncHealthOutcome;
  /** True = `cron.success`. */
  healthy: boolean;
  /** `resource:code` for every real failure (whoami first, persistence last). */
  errors: string[];
  /** `resource:code` for every warning. */
  warnings: string[];
  /** Rows the normalizer refused, per resource (failed and warning alike); only resources with any. */
  rejectedRows: Record<string, number>;
  /** Which rule refused them, per resource. */
  rejectedReasons: Record<string, RejectionReasons>;
}

export function classifyResource(resource: string, result: HealthInput): ResourceHealth {
  if (result.error_code === null) return "ok";
  if (result.error_code !== "rejected_rows") return "failed";
  if (!(NON_CRITICAL_RESOURCES as readonly string[]).includes(resource)) return "failed";
  return result.rows >= 1 && result.skipped <= result.rows ? "warning" : "failed";
}

/** Reason → positive integer over the closed vocabulary; anything else in the blob is left behind. */
function cleanReasons(reasons: unknown): RejectionReasons {
  const out: RejectionReasons = {};
  if (!reasons || typeof reasons !== "object") return out;
  for (const reason of REJECT_REASONS) {
    const n = (reasons as Record<string, unknown>)[reason];
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out[reason] = n;
  }
  const shapes = cleanDateShapes((reasons as Record<string, unknown>).date_shapes);
  if (Object.keys(shapes).length > 0) out.date_shapes = shapes;
  return out;
}

export function summarizeHealth(
  order: readonly string[],
  results: Readonly<Record<string, HealthInput | undefined>>,
  run: { whoamiError: string | null; persistenceErrors: readonly string[] },
): SyncHealth {
  const errors: string[] = run.whoamiError ? [`whoami:${run.whoamiError}`] : [];
  const warnings: string[] = [];
  const rejectedRows: Record<string, number> = {};
  const rejectedReasons: Record<string, RejectionReasons> = {};
  for (const resource of order) {
    const result = results[resource];
    if (!result) continue;
    const health = classifyResource(resource, result);
    if (health === "failed") errors.push(`${resource}:${result.error_code}`);
    else if (health === "warning") warnings.push(`${resource}:${result.error_code}`);
    if (result.skipped > 0) {
      rejectedRows[resource] = result.skipped;
      const reasons = cleanReasons(result.reasons);
      if (Object.keys(reasons).length > 0) rejectedReasons[resource] = reasons;
    }
  }
  for (const code of run.persistenceErrors) errors.push(`persistence:${code}`);
  const healthy = errors.length === 0;
  return { outcome: !healthy ? "failed" : warnings.length > 0 ? "ok_with_warnings" : "ok", healthy, errors, warnings, rejectedRows, rejectedReasons };
}
