/** READ ONLY. CC runs with injected env; importing this file performs no I/O.
 * node --env-file=.env.local --conditions=react-server --import tsx scripts/reconcile-toast-cutover.ts
 * Optional positional from/through limit the report, never extend the comparison overlap.
 * No Toast calls, no RPCs, no mutations, no contacts or payloads in output. */
import { pathToFileURL } from "node:url";
import { selectAllRows } from "../lib/supabase-paginate";
import { reconcileCutoverKeys, OVERLAP_FROM, OVERLAP_THROUGH, type GateLegacyRow } from "../lib/toast/cutover-gate-shared";
import type { LedgerRow, SalesConsumption } from "../lib/catering/toast-sales";
import type { CapturedToastDay } from "../lib/toast/captured-day";

/** Config review is disclosed independently of the correctness verdict. */
export function channelReviewDiagnostics(day: CapturedToastDay | null) {
  const unresolved = day?.orders.filter((order) => order.diningOptionGuid !== null
    && (!order.salesChannel || order.salesChannel === "Unknown")) ?? [];
  return { config_degraded: day?.coverage.configDegraded ?? null,
    missing_option_orders: unresolved.filter((order) => order.diningOption === null).length,
    unreviewed_label_orders: unresolved.filter((order) => order.diningOption !== null).length };
}

export async function main(args = process.argv.slice(2)) {
  const [from = "2025-10-06", through = OVERLAP_THROUGH] = args;
  if (args.length > 2 || [from, through].some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)
    || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)
    || from > through || (Date.parse(through) - Date.parse(from)) / 86400000 > 366) throw new Error("cutover_invalid_range");
  const { getServiceRoleClient } = await import("../lib/supabase-server");
  const { loadCapturedToastDay } = await import("../lib/toast/captured-day");
  const { deriveSalesConsumptionFrom, deriveCapturedSalesConsumption } = await import("../lib/catering/toast-sales");
  const sb = getServiceRoleClient();
  const [locations, runs] = await Promise.all([
    selectAllRows<{ id: string }>((lo, hi) => sb.from("locations").select("id").eq("active", true)
      .not("toast_restaurant_guid", "is", null).order("id").range(lo, hi)),
    selectAllRows<{ location_id: string; business_date: string }>((lo, hi) => sb.from("toast_capture_runs")
      .select("location_id,business_date").eq("status", "completed").gte("business_date", from).lte("business_date", through)
      .order("id").range(lo, hi)),
  ]);
  const pairs = new Map<string, { locationId: string; date: string }>();
  for (const run of runs) pairs.set(`${run.location_id}:${run.business_date}`, { locationId: run.location_id, date: run.business_date });
  // Every overlap date must have coverage, including a true zero; row existence is no oracle.
  for (const { id } of locations) for (let t = Math.max(Date.parse(from), Date.parse(OVERLAP_FROM)); t <= Math.min(Date.parse(through), Date.parse(OVERLAP_THROUGH)); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10); pairs.set(`${id}:${date}`, { locationId: id, date });
  }
  let failed = 0, checked = 0;
  for (const { locationId, date } of [...pairs.values()].sort((a, b) => a.date.localeCompare(b.date) || a.locationId.localeCompare(b.locationId))) {
    checked++;
    try {
      const day = await loadCapturedToastDay(locationId, date);
      const comparable = date >= OVERLAP_FROM && date <= OVERLAP_THROUGH;
      if (!day || !comparable) {
        const gate = reconcileCutoverKeys(date, [], day);
        if (!gate.passed) failed++;
        console.log(JSON.stringify({ location_id: locationId, business_date: date, ...gate,
          channel_review: channelReviewDiagnostics(day),
          missing_pointer_count: day?.coverage.missingPointerCount ?? null, estimate: "current-recipe" }));
        continue;
      }
      type Legacy = GateLegacyRow & LedgerRow;
      const legacy = await selectAllRows<Legacy>((lo, hi) => sb.from("toast_sales_events")
        .select("check_guid,selection_guid,parent_selection_guid,toast_item_guid,item_name,quantity,price_cents,voided,dining_option,menu_group,snapshot_version,pulled_at")
        .eq("location_id", locationId).eq("business_date", date).order("id").range(lo, hi));
      const latest = new Map<string, LedgerRow>();
      for (const row of legacy) {
        const k = `${row.check_guid}:${row.selection_guid}`;
        if (!latest.has(k) || latest.get(k)!.snapshot_version < row.snapshot_version) latest.set(k, row);
      }
      // Link removed checks to their former order without assuming check GUID == order GUID.
      const snapshots = await selectAllRows<{ id: string; order_guid: string }>((lo, hi) => sb.from("toast_orders")
        .select("id,order_guid").eq("location_id", locationId).eq("business_date", date).order("id").range(lo, hi));
      const ownerBySnapshot = new Map(snapshots.map((r) => [r.id, r.order_guid]));
      const checkOrder = new Map<string, string>();
      for (let i = 0; i < snapshots.length; i += 100) {
        const ids = snapshots.slice(i, i + 100).map((r) => r.id);
        const checks = await selectAllRows<{ snapshot_id: string; check_guid: string }>((lo, hi) => sb.from("toast_order_checks")
          .select("snapshot_id,check_guid").in("snapshot_id", ids).order("snapshot_id").order("check_guid").range(lo, hi));
        for (const check of checks) checkOrder.set(check.check_guid, ownerBySnapshot.get(check.snapshot_id)!);
      }
      const removedOrders = new Set<string>();
      if (day.coverage.absenceRemovalApplied) {
        const pointers = await selectAllRows<{ order_guid: string }>((lo, hi) => sb.from("toast_order_latest_pointers")
          .select("order_guid").eq("location_id", locationId).eq("business_date", date).order("order_guid").range(lo, hi));
        const present = new Set(day.orders.map((order) => order.orderGuid));
        for (const row of pointers) if (!present.has(row.order_guid)) removedOrders.add(row.order_guid);
      }
      const gate = reconcileCutoverKeys(date, legacy, day, { checkOrder, removedOrders });
      // Same derivation engine and current mappings/recipes for BOTH sets of rows.
      const [oldConsumption, capturedConsumption] = await Promise.all([
        deriveSalesConsumptionFrom(locationId, date, latest),
        deriveCapturedSalesConsumption(locationId, date, day),
      ]);
      const summarize = (value: SalesConsumption) => ({
        direct_oz: value.skuConsumed.reduce((sum, row) => sum + row.directOz, 0),
        flattened_oz: value.skuConsumed.reduce((sum, row) => sum + row.flattenedOz, 0),
        unmapped_lines: value.unmappedToastItems.length, portion_needed: value.modifierStats.portionNeeded.length,
        package_issues: value.packageIssues.length,
      });
      // Mapping/config readiness is a separate review queue, not a parity failure.
      const passed = gate.passed;
      if (!passed) failed++;
      console.log(JSON.stringify({ location_id: locationId, business_date: date, ...gate, passed,
        run_id: day.coverage.runId, missing_pointer_count: day.coverage.missingPointerCount,
        absence_removal_applied: day.coverage.absenceRemovalApplied, config_degraded: day.coverage.configDegraded,
        channel_review: channelReviewDiagnostics(day),
        legacy: summarize(oldConsumption), capture: summarize(capturedConsumption), estimate: "current-recipe" }));
    } catch {
      failed++;
      console.log(JSON.stringify({ location_id: locationId, business_date: date, passed: false, error: "cutover_read_or_derivation_failed" }));
    }
  }
  console.log(JSON.stringify({ summary: true, checked, failed, passed: checked > 0 && failed === 0,
    comparable_from: OVERLAP_FROM, comparable_through: OVERLAP_THROUGH }));
  if (failed || checked === 0) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("cutover_gate_failed"); process.exitCode = 1; });
}
