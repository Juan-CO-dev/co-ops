// Vercel, four times a day at :50 (item 4 PR 2): the demand-signal collection (NWS hourly forecast + alerts).
// OFF, and INERT BEFORE ITS LEASE:
//   the secret -> DEMAND_SIGNALS=1 (else nothing is read) -> the register says THIS adapter's source is
//   verified NOW (else skipped by name: no lease, no request, no heartbeat) -> the lease -> one bounded pass.
// DEMAND_SIGNALS=1 is necessary, not sufficient: a person marks the source verified first (0343, MoO+,
// audited). The pass asks the register again before each shop and 0343's writers ask it inside each write.
// Needs 0343 applied BEFORE DEMAND_SIGNALS is set (it adds the 'demand-signals' lease); before it the
// precheck answers not_installed. Not in JOBS_REGISTRY: nothing emails. Runbook: docs/runbooks/demand-signals-sources.md
import { type NextRequest } from "next/server";
import { cronAuthStatus } from "@/lib/cron-auth";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { DEMAND_SIGNALS_PASS_BUDGET_MS, demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { collectionPrecheck, runDemandSignalsCollection } from "@/lib/demand-signals/signal-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = cronAuthStatus(req.headers);
  if (auth) return jsonError(auth, auth === 503 ? "cron_disabled" : "unauthorized");
  if (!demandSignalsEnabled(process.env.DEMAND_SIGNALS)) return jsonOk({ skipped: true, reason: "demand_signals_off" });
  try {
    const ready = await collectionPrecheck(getServiceRoleClient());
    if (ready !== "ready") return jsonOk({ skipped: true, reason: ready });
    if (!await claimCronRoute("demand-signals")) return jsonOk({ skipped: true, reason: "cron_route_busy" });
    const result = await runDemandSignalsCollection({ deadlineAt: startedAt + DEMAND_SIGNALS_PASS_BUDGET_MS });
    const failed = result.status === "ran" ? result.failed : 0;
    // A pass the register stopped (revoked meanwhile, no User-Agent) did what it should: not a failure.
    const healthy = failed === 0;
    await audit({
      actorId: null, actorRole: null, action: healthy ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: {
        job: "demand-signals", status: result.status, ...(healthy ? {} : { error: "signal_feeds_failed" }),
        weather_rows: result.weatherRows, failed, requests: result.requests,
        shops: result.shops.map((s) => ({ location_id: s.locationId, weather: s.weather, alerts: s.alerts })),
      },
      ipAddress: null, userAgent: null,
    });
    return jsonOk({ healthy, ...result });
  } catch {
    await audit({
      actorId: null, actorRole: null, action: "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "demand-signals", error: "demand_signals_failed" }, ipAddress: null, userAgent: null,
    });
    return jsonError(500, "demand_signals_failed");
  }
}
