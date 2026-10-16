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
 */
import "server-only";
import { audit } from "@/lib/audit";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { canSyncNow, type PeopleActor } from "@/lib/people/access-shared";
import { sevenShiftsStatus } from "@/lib/sevenshifts/config";
import { runSevenShiftsSync, type SyncStatus } from "@/lib/sevenshifts/sync";

export type SyncNowErrorCode = "forbidden" | "not_connected" | "sync_off" | "sync_busy";
export class SyncNowError extends Error {
  constructor(public status: 403 | 409, public code: SyncNowErrorCode) { super(code); }
}

/** The route's budget minus a margin, as the cron. */
export const SYNC_NOW_DEADLINE_MS = 110_000;

export async function requestSyncNow(
  actor: PeopleActor,
  opts: { deadlineMs?: number } = {},
): Promise<{ runId: string | null; status: SyncStatus; requests: number }> {
  if (!canSyncNow(actor)) throw new SyncNowError(403, "forbidden");
  const status = sevenShiftsStatus();
  if (status.reason === "token_missing") throw new SyncNowError(409, "not_connected");
  if (status.reason === "sync_off") throw new SyncNowError(409, "sync_off");
  if (!await claimCronRoute("sevenshifts-sync")) throw new SyncNowError(409, "sync_busy");
  await audit({
    actorId: actor.userId, actorRole: actor.role, action: "sevenshifts.sync_requested",
    resourceTable: "sevenshifts_sync_runs", resourceId: null, metadata: { trigger: "manual" },
    ipAddress: null, userAgent: null,
  });
  const outcome = await runSevenShiftsSync({ trigger: "manual", requestedBy: actor.userId, deadlineMs: opts.deadlineMs ?? SYNC_NOW_DEADLINE_MS });
  if (!outcome.ran) throw new SyncNowError(409, outcome.reason === "token_missing" ? "not_connected" : "sync_off");
  return { runId: outcome.runId, status: outcome.status, requests: outcome.requests };
}
