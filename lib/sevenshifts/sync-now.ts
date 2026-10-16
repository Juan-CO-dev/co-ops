/**
 * SYNC NOW — SERVER-ONLY (Scheduling Phase 1, Task 8 Step 4). A manager asks for a 7shifts read
 * outside the hourly schedule.
 *
 * - MoO+ only (`canSyncNow`): it spends the shared 7shifts rate budget. Decided BEFORE any I/O.
 * - Dormant exactly like the cron: no token → `not_connected`, switch off → `sync_off` (409), nothing
 *   claimed, run or audited.
 * - The SAME lease as the cron (`claim_cron_route('sevenshifts-sync')`): busy → 409 `sync_busy`.
 * - Audited `sevenshifts.sync_requested` (non-destructive, ids only) once the lease is held, then ONE
 *   manual run naming its requester. The run writes its own ledger row and heartbeat
 *   (`sevenshifts-sync-manual`). No email, no notification.
 * - ONE absolute deadline (chunk C review, Astra P2): the route stamps its entry time and passes it in.
 *   Auth, the lease and a BOUNDED audit wait are deducted, and the sync's finalization window is
 *   reserved, so run + ledger + heartbeat end by route entry + 120 s − 10 s. No time left → 409 `deadline`.
 */
import "server-only";
import { audit } from "@/lib/audit";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { canSyncNow, type PeopleActor } from "@/lib/people/access-shared";
import { sevenShiftsStatus } from "@/lib/sevenshifts/config";
import { runSevenShiftsSync, SYNC_FINISH_BUDGET_MS, type PersistenceErrorCode, type SyncStatus } from "@/lib/sevenshifts/sync";

export type SyncNowErrorCode = "forbidden" | "not_connected" | "sync_off" | "sync_busy" | "deadline";
export class SyncNowError extends Error {
  constructor(public status: 403 | 409, public code: SyncNowErrorCode) { super(code); }
}

/** The admin route's `maxDuration` (app/api/admin/sevenshifts/route.ts), in ms. */
export const SYNC_ROUTE_LIMIT_MS = 120_000;
/** Headroom kept below the route limit, as the cron route keeps. */
export const SYNC_ROUTE_MARGIN_MS = 10_000;
/** The audit row is fail-open: Sync now waits for it at most this long. */
export const SYNC_NOW_AUDIT_WAIT_MS = 2_000;
/** Below this, a run could not even ask whoami; refuse rather than start one. */
const MIN_RUN_MS = 1_000;

/** Waits for `p` at most `ms`; never rejects (the audit is fail-open by law). */
async function boundedWait(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([p.catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function requestSyncNow(
  actor: PeopleActor,
  opts: { routeStartedAt?: number; clock?: () => number } = {},
): Promise<{ runId: string | null; status: SyncStatus; requests: number; persistenceErrors: PersistenceErrorCode[] }> {
  const clock = opts.clock ?? Date.now;
  const routeStartedAt = opts.routeStartedAt ?? clock();
  if (!canSyncNow(actor)) throw new SyncNowError(403, "forbidden");
  const status = sevenShiftsStatus();
  if (status.reason === "token_missing") throw new SyncNowError(409, "not_connected");
  if (status.reason === "sync_off") throw new SyncNowError(409, "sync_off");
  if (!await claimCronRoute("sevenshifts-sync")) throw new SyncNowError(409, "sync_busy");
  await boundedWait(audit({
    actorId: actor.userId, actorRole: actor.role, action: "sevenshifts.sync_requested",
    resourceTable: "sevenshifts_sync_runs", resourceId: null, metadata: { trigger: "manual" },
    ipAddress: null, userAgent: null,
  }), SYNC_NOW_AUDIT_WAIT_MS);
  const deadlineMs = routeStartedAt + SYNC_ROUTE_LIMIT_MS - SYNC_ROUTE_MARGIN_MS - SYNC_FINISH_BUDGET_MS - clock();
  if (deadlineMs < MIN_RUN_MS) throw new SyncNowError(409, "deadline");
  const outcome = await runSevenShiftsSync({ trigger: "manual", requestedBy: actor.userId, deadlineMs });
  if (!outcome.ran) throw new SyncNowError(409, outcome.reason === "token_missing" ? "not_connected" : "sync_off");
  return { runId: outcome.runId, status: outcome.status, requests: outcome.requests, persistenceErrors: outcome.persistenceErrors };
}
