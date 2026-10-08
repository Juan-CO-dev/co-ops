import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { etYmdMinusDays } from "@/lib/operational-day";
import { captureBudget } from "@/lib/toast/capture-runner";
import { ezcaterConfigured } from "./client";
import { syncEzcaterOrder } from "./sync";

/** A bounded best-effort phase. Its failure never gates elapsed-event completion. */
export async function refreshKnownEzcaterOrders(todayEt: string, deadlineAt = Date.now() + 20_000, parent?: AbortSignal) {
  const result = { attempted: 0, failed: 0, deferred: false, disabled: false };
  const budget = captureBudget(Math.max(1, Math.min(20_000, deadlineAt - Date.now())), parent);
  try {
    if (!ezcaterConfigured() || process.env.EZCATER_FIXTURES === "1") {
      result.disabled = true;
      return result;
    }
    const sb = getServiceRoleClient();
    // Oldest observations first: a bounded run must not always starve its tail.
    const rows = await budget.wait(() => sb.from("ezcater_orders")
      .select("provider_uuid, caterer_uuid, pending_event_key")
      .or(`last_sync_error.not.is.null,and(event_date.gte.${etYmdMinusDays(todayEt, 2)},event_date.lte.${etYmdMinusDays(todayEt, -14)})`)
      .order("last_attempt_at", { ascending: true }).order("provider_uuid")
      .limit(100).abortSignal(budget.signal));
    if (rows.error) throw new Error("refresh_read_failed");
    const candidates = (rows.data ?? []) as Array<{ provider_uuid: string; caterer_uuid: string; pending_event_key: string | null }>;
    for (const row of candidates) {
      if (Date.now() >= deadlineAt || budget.signal.aborted) { result.deferred = true; break; }
      result.attempted++;
      try {
        const synced = await budget.wait(() => syncEzcaterOrder(row.provider_uuid, row.caterer_uuid,
          { eventKey: row.pending_event_key, deadlineMs: deadlineAt, signal: budget.signal }));
        if (synced.result.startsWith("error:")) result.failed++;
      } catch { result.failed++; }
    }
    if (candidates.length === 100 || result.attempted < candidates.length) result.deferred = true;
  } catch { result.failed++; result.deferred = true; }
  finally {
    budget.close();
    const heartbeat = audit({ actorId: null, actorRole: null,
      action: result.failed || result.deferred ? "cron.failure" : "cron.success",
      resourceTable: "cron", resourceId: null,
      metadata: { job: "ezcater-refresh", business_date: todayEt, ...result }, ipAddress: null, userAgent: null });
    // Heartbeat failure is fail-open too; reserve no provider time from completion.
    const heartbeatBudget = captureBudget(1_000);
    try { await heartbeatBudget.wait(() => heartbeat); } catch { /* audit() owns logging */ }
    finally { heartbeatBudget.close(); }
  }
  return result;
}
