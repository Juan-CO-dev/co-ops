/**
 * Who's here — the app-side steps that 0233 does NOT run from a database trigger (r1, Astra P1-4,
 * P1-5, P2-6, P2-8). SERVER-ONLY. Everything here is behind WHOS_HERE=1: with the flag off the
 * database never releases anything for a closing and never auto-links (rollback through the flag).
 *
 * 1. releaseAfterSettledClose: right after a closer confirm has SUCCEEDED (the route's after()),
 *    reconcile_shop_closed(p_settled=true). A confirm that was compensated back to 'open' never
 *    reaches this call, and the RPC re-reads the durable status anyway.
 * 2. runWhosHereTick (the 10-minute pinger, AFTER the labor pull, on its OWN budget):
 *    a. reconcile_shop_closed for today + yesterday per shop (catches opener release, system auto,
 *       and any confirm whose after() died; a fresh confirm waits 2 minutes to be durable);
 *    b. auto-links per Toast shop from a fresh /labor/v1/employees read. Every query and RPC carries
 *       the step's AbortSignal, so nothing outlives the budget and the labor pull never pays for it.
 * Fail-soft: each shop/step reports a fixed code; nothing throws to the caller.
 */
import "server-only";
import { audit } from "@/lib/audit";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "@/lib/toast/client";
import { runAutoLinks } from "@/lib/toast/employee-links";
import { whosHereEnabled } from "@/lib/whos-here";

export interface WhosHereTickResult {
  ran: boolean;
  results: Array<{ locationId: string; step: "shop_closed" | "autolink"; day?: string; ok: boolean; detail?: unknown; error?: string }>;
}

/** Settle `p` or reject with `code` when the signal fires — whichever comes first. */
function race<T>(p: PromiseLike<T>, signal: AbortSignal, code: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(code));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(code));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(p).then((v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); });
  });
}
const fixed = (e: unknown, fallback: string) => (e instanceof Error && /^whos_here_|^toast_autolink_/.test(e.message) ? e.message
  : e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError") ? "whos_here_deadline" : fallback);

export async function releaseAfterSettledClose(locationId: string, date: string): Promise<void> {
  if (!whosHereEnabled()) return;
  try {
    const signal = AbortSignal.timeout(5_000);
    const { error } = await race(getServiceRoleClient().rpc("reconcile_shop_closed", { p_location_id: locationId, p_day: date, p_settled: true })
      .abortSignal(signal), signal, "whos_here_deadline");
    if (error) console.error("[whos-here] settled shop-closed release failed (tick retries)");
  } catch { console.error("[whos-here] settled shop-closed release failed (tick retries)"); }
}

export async function runWhosHereTick(opts: { deadlineMs: number; now?: Date; autolink: boolean }): Promise<WhosHereTickResult> {
  if (!whosHereEnabled()) return { ran: false, results: [] };
  const signal = AbortSignal.timeout(Math.max(1_000, opts.deadlineMs));
  const today = etCalendarDate((opts.now ?? new Date()).toISOString());
  const days = [today, etYmdMinusDays(today, 1)];
  const out: WhosHereTickResult = { ran: true, results: [] };
  const sb = getServiceRoleClient();
  let locations: Array<{ id: string; toast_restaurant_guid: string | null }> = [];
  try {
    const res = await race(sb.from("locations").select("id,toast_restaurant_guid").eq("active", true).abortSignal(signal)
      .returns<Array<{ id: string; toast_restaurant_guid: string | null }>>(), signal, "whos_here_deadline");
    if (res.error) throw new Error("whos_here_locations_failed");
    locations = res.data ?? [];
  } catch (e) {
    out.results.push({ locationId: "*", step: "shop_closed", ok: false, error: fixed(e, "whos_here_locations_failed") });
  }
  // Shop close first: it is cheap and it is the safety net.
  for (const loc of locations) {
    for (const day of days) {
      try {
        const { data, error } = await race(sb.rpc("reconcile_shop_closed", { p_location_id: loc.id, p_day: day, p_settled: false })
          .abortSignal(signal), signal, "whos_here_deadline");
        if (error) throw new Error("whos_here_shop_closed_failed");
        out.results.push({ locationId: loc.id, step: "shop_closed", day, ok: (data as { ok?: boolean } | null)?.ok !== false, detail: data });
      } catch (e) {
        out.results.push({ locationId: loc.id, step: "shop_closed", day, ok: false, error: fixed(e, "whos_here_shop_closed_failed") });
      }
    }
  }
  if (opts.autolink) {
    for (const loc of locations) {
      if (!loc.toast_restaurant_guid) continue;
      try {
        const raw = await race(toastGet<unknown>("/labor/v1/employees", loc.toast_restaurant_guid, signal), signal, "toast_autolink_deadline");
        const detail = await race(runAutoLinks(sb, { locationId: loc.id, rawEmployees: raw, signal }), signal, "toast_autolink_deadline");
        out.results.push({ locationId: loc.id, step: "autolink", ok: true, detail });
      } catch (e) {
        out.results.push({ locationId: loc.id, step: "autolink", ok: false, error: fixed(e, "toast_autolink_failed") });
      }
    }
  }
  const failures = out.results.filter((r) => !r.ok && (r.detail as { skipped?: string } | undefined)?.skipped === undefined);
  try {
    await race(audit({ actorId: null, actorRole: null, action: failures.length === 0 ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: { job: "whos-here-tick", days, failures: failures.length,
        errors: failures.map((r) => `${r.locationId}:${r.step}:${r.day ?? ""}:${r.error ?? "skipped"}`) }, ipAddress: null, userAgent: null }),
    AbortSignal.timeout(3_000), "whos_here_deadline");
  } catch { /* heartbeat is fail-open and bounded */ }
  return out;
}
