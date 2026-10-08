import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { selectSalesDepletion } from "@/lib/depletion-shared";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";

type Client = ReturnType<typeof getServiceRoleClient>;
interface Window { locationId?: string; fromDate: string; untilDateExclusive?: string | null; skuIds?: string[]; allowGaps?: boolean }
export interface EffectiveSalesRow {
  location_id: string; business_date: string; sku_id: string; direct_oz: number; flattened_oz: number;
}
interface Coverage { location_id: string; business_date: string; run_id: string; status: string;
  computed_at: string; aggregate_count: number; attribution_count: number }
interface Run { id: string; location_id: string; business_date: string; finished_at: string }
const key = (r: { location_id: string; business_date: string }) => `${r.location_id}:${r.business_date}`;
const numeric = (n: number | string | null): number => {
  if (n == null || !Number.isFinite(Number(n))) throw new Error("capture_depletion_invalid_quantity");
  return Number(n);
};

/** A success manifest is valid only for the latest completed full-day capture.
 * Empty successful days count; stale manifests and unmaterialized days do not. */
export async function loadEffectiveSalesCoverage(sb: Client, window: Window): Promise<Coverage[]> {
  const end = window.untilDateExclusive ?? etCalendarDate(new Date().toISOString());
  const [coverage, runs] = await Promise.all([
    selectAllRows<Coverage>(async (from, to) => {
      let q = sb.from("toast_depletion_day_coverage").select("location_id,business_date,run_id,status,computed_at,aggregate_count,attribution_count")
        .gte("business_date", window.fromDate).lt("business_date", end).eq("status", "success");
      if (window.locationId) q = q.eq("location_id", window.locationId);
      const { data, error } = await q.order("location_id").order("business_date").range(from, to).returns<Coverage[]>();
      if (error) throw new Error("capture_depletion_coverage_unavailable");
      return { data };
    }),
    selectAllRows<Run>(async (from, to) => {
      let q = sb.from("toast_capture_runs").select("id,location_id,business_date,finished_at")
        .gte("business_date", window.fromDate).lt("business_date", end).eq("status", "completed");
      if (window.locationId) q = q.eq("location_id", window.locationId);
      const { data, error } = await q.order("id").range(from, to).returns<Run[]>();
      if (error) throw new Error("capture_depletion_runs_unavailable");
      return { data };
    }),
  ]);
  const latest = new Map<string, Run>();
  for (const run of runs) {
    const previous = latest.get(key(run));
    if (!previous || run.finished_at > previous.finished_at ||
      (run.finished_at === previous.finished_at && run.id > previous.id)) latest.set(key(run), run);
  }
  return coverage.filter((row) => latest.get(key(row))?.id === row.run_id);
}

/** Sales fallback is selected against LIVE production by ET item/day. Production
 * input sums remain with callers and retain their existing timestamp windows. */
export async function loadEffectiveSalesRows(sb: Client, window: Window): Promise<EffectiveSalesRow[]> {
  const capture = process.env.DEPLETION_SOURCE === "capture";
  const end = window.untilDateExclusive ?? (capture ? etCalendarDate(new Date().toISOString()) : null);
  const before = capture ? await loadEffectiveSalesCoverage(sb, { ...window, untilDateExclusive: end }) : [];
  if (capture && !window.allowGaps) {
    let locationIds = window.locationId ? [window.locationId] : [];
    if (!window.locationId) {
      const { data, error } = await sb.from("locations").select("id").eq("active", true).not("toast_restaurant_guid", "is", null);
      if (error) throw new Error("capture_depletion_locations_unavailable");
      locationIds = (data ?? []).map((row: { id: string }) => row.id);
    }
    const covered = new Set(before.map(key));
    const cursor = new Date(`${window.fromDate}T12:00:00Z`);
    while (cursor.toISOString().slice(0, 10) < end!) {
      const date = cursor.toISOString().slice(0, 10);
      for (const locationId of locationIds) if (!covered.has(`${locationId}:${date}`)) throw new Error("capture_depletion_coverage_gap");
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  type Aggregate = Omit<EffectiveSalesRow, "direct_oz" | "flattened_oz"> & { direct_oz: number | string; flattened_oz: number | string };
  const aggregates = await selectAllRows<Aggregate>(async (from, to) => {
    let q = sb.from(capture ? "toast_capture_daily_depletion" : "toast_daily_depletion")
      .select("location_id,business_date,sku_id,direct_oz,flattened_oz").gte("business_date", window.fromDate);
    if (window.locationId) q = q.eq("location_id", window.locationId);
    if (end) q = q.lt("business_date", end);
    const { data, error } = await q.order("id").range(from, to).returns<Aggregate[]>();
    if (error) throw new Error("sales_depletion_unavailable");
    return { data };
  });
  const skuFilter = window.skuIds ? new Set(window.skuIds) : null;
  if (!capture) return aggregates.filter((r) => !skuFilter || skuFilter.has(r.sku_id))
    .map((r) => ({ ...r, direct_oz: numeric(r.direct_oz), flattened_oz: numeric(r.flattened_oz) }));
  interface Attribution { location_id: string; business_date: string; item_id: string; item_path: string[]; sku_id: string; sales_oz: number | string }
  interface Production { location_id: string; output_item_id: string | null; produced_at: string }
  const [attributions, productions] = await Promise.all([
    selectAllRows<Attribution>(async (from, to) => {
      let q = sb.from("toast_depletion_item_attribution").select("location_id,business_date,item_id,item_path,sku_id,sales_oz")
        .gte("business_date", window.fromDate).lt("business_date", end!);
      if (window.locationId) q = q.eq("location_id", window.locationId);
      const { data, error } = await q.order("location_id").order("business_date").order("item_id").order("sku_id").order("item_path")
        .range(from, to).returns<Attribution[]>();
      if (error) throw new Error("capture_depletion_attribution_unavailable");
      return { data };
    }),
    selectAllRows<Production>(async (from, to) => {
      let q = sb.from("productions").select("location_id,output_item_id,produced_at")
        .is("superseded_at", null).is("revoked_at", null)
        .gte("produced_at", operationalDayUtcRange(window.fromDate).startIso)
        .lt("produced_at", operationalDayUtcRange(end!).startIso);
      if (window.locationId) q = q.eq("location_id", window.locationId);
      const { data, error } = await q.order("id").range(from, to).returns<Production[]>();
      if (error) throw new Error("capture_depletion_production_unavailable");
      return { data };
    }),
  ]);
  const coverage = await loadEffectiveSalesCoverage(sb, { ...window, untilDateExclusive: end });
  const produced = new Map<string, Set<string>>();
  // Plain replacement is atomic in SQL, but several PostgREST reads are not one
  // snapshot. Refuse mixed runs when a concurrent replacement crosses this read.
  const signature = (rows: Coverage[]) => rows.map((r) => `${key(r)}:${r.run_id}:${r.computed_at}:${r.aggregate_count}:${r.attribution_count}`).sort().join("|");
  if (signature(before) !== signature(coverage)) throw new Error("capture_depletion_changed_during_read");
  for (const row of productions) {
    const k = `${row.location_id}:${etCalendarDate(row.produced_at)}`;
    const ids = produced.get(k) ?? new Set<string>();
    if (row.output_item_id) ids.add(row.output_item_id);
    produced.set(k, ids);
  }
  const out: EffectiveSalesRow[] = [];
  for (const day of coverage) {
    const direct = aggregates.filter((r) => key(r) === key(day));
    const attributed = attributions.filter((r) => key(r) === key(day));
    if (direct.length !== day.aggregate_count || attributed.length !== day.attribution_count) {
      throw new Error("capture_depletion_manifest_count_mismatch");
    }
    const selected = selectSalesDepletion(direct.map((r) => ({ skuId: r.sku_id, directOz: numeric(r.direct_oz) })),
      attributed.map((r) => ({ itemId: r.item_id, itemPath: r.item_path, skuId: r.sku_id, oz: numeric(r.sales_oz) })),
      produced.get(key(day)) ?? new Set());
    const flattened = new Map(direct.map((r) => [r.sku_id, numeric(r.flattened_oz)]));
    for (const [sku_id, direct_oz] of selected) if (!skuFilter || skuFilter.has(sku_id)) out.push({ location_id: day.location_id,
      business_date: day.business_date, sku_id, direct_oz, flattened_oz: flattened.get(sku_id) ?? 0 });
  }
  return out;
}
