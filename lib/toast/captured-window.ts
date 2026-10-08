import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { CaptureSelection } from "./capture-reconciliation-shared";
import type { CapturedToastDay, CapturedToastCheck } from "./captured-day";

type Client = ReturnType<typeof getServiceRoleClient>;
type Run = { id: string; business_date: string; finished_at: string; orders: number };
type Pointer = { business_date: string; snapshot_id: string; order_guid: string };
type Member = Pointer & { run_id: string };
type Order = { id: string; business_date: string; order_guid: string; modified_at: string | null;
  dining_option_guid: string | null; deleted: boolean; voided: boolean; excess_food: boolean; selection_units: CaptureSelection[] };
type Check = { snapshot_id: string; check_guid: string; amount_cents: number | string | null; voided: boolean; deleted: boolean };

/** Window counterpart of loadCapturedToastDay. Bounded indexed reads replace the
 * per-day query loop; publications are fenced across the entire window. Small
 * pages and 100-ID chunks bound individual statements and URL lengths. */
export async function loadCapturedToastWindow(sb: Client, locationId: string, fromDate: string, end: string): Promise<Map<string, CapturedToastDay>> {
  for (let attempt = 0; ; attempt++) {
    try { return await readWindow(sb, locationId, fromDate, end); }
    catch (error) {
      if (attempt === 0 && error instanceof Error && error.message === "capture_read_changed") continue;
      throw error;
    }
  }
}

async function readWindow(sb: Client, locationId: string, fromDate: string, end: string) {
  const readRuns = async () => {
    const rows = await selectAllRows<Run>((from, to) => sb.from("toast_capture_runs")
      .select("id,business_date,finished_at,orders").eq("location_id", locationId).eq("status", "completed")
      .gte("business_date", fromDate).lt("business_date", end).order("business_date").order("id").range(from, to), 250);
    const latest = new Map<string, Run>();
    for (const row of rows) {
      const previous = latest.get(row.business_date);
      if (!previous || row.finished_at > previous.finished_at || (row.finished_at === previous.finished_at && row.id > previous.id)) latest.set(row.business_date, row);
    }
    return latest;
  };
  const readPointers = () => selectAllRows<Pointer>((from, to) => sb.from("toast_order_latest_pointers")
    .select("business_date,snapshot_id,order_guid").eq("location_id", locationId)
    .gte("business_date", fromDate).lt("business_date", end).order("business_date").order("order_guid").range(from, to), 250);
  const [runs, pointers] = await Promise.all([readRuns(), readPointers()]);
  const members: Member[] = [];
  const runIds = [...runs.values()].map((run) => run.id);
  for (let start = 0; start < runIds.length; start += 100) {
    members.push(...await selectAllRows<Member>((from, to) => sb.from("toast_capture_run_orders")
      .select("run_id,business_date,snapshot_id,order_guid").eq("location_id", locationId)
      .in("run_id", runIds.slice(start, start + 100)).order("run_id").order("order_guid").range(from, to), 250));
  }
  const membersByRun = Map.groupBy(members, (row) => row.run_id);
  const pointersByDate = Map.groupBy(pointers, (row) => row.business_date);
  const selected: Pointer[] = [];
  const absenceRemovalApplied = process.env.TOAST_CAPTURE_ABSENCE_REMOVAL === "1";
  const missing = new Map<string, number>();
  for (const [date, run] of runs) {
    const membership = membersByRun.get(run.id) ?? [];
    if (membership.length !== run.orders) throw new Error("capture_read_membership_incomplete");
    const guids = new Set(membership.map((row) => row.order_guid));
    const dayPointers = pointersByDate.get(date) ?? [];
    missing.set(date, dayPointers.filter((row) => !guids.has(row.order_guid)).length);
    selected.push(...dayPointers.filter((row) => !absenceRemovalApplied || guids.has(row.order_guid)));
  }
  const orderRows: Order[] = [], checkRows: Check[] = [];
  for (let start = 0; start < selected.length; start += 100) {
    const ids = selected.slice(start, start + 100).map((row) => row.snapshot_id);
    const [orders, checks] = await Promise.all([
      selectAllRows<Order>((from, to) => sb.from("toast_orders")
        .select("id,business_date,order_guid,modified_at,dining_option_guid,deleted,voided,excess_food,selection_units")
        .eq("location_id", locationId).gte("business_date", fromDate).lt("business_date", end)
        .in("id", ids).order("id").range(from, to), 250),
      selectAllRows<Check>((from, to) => sb.from("toast_order_checks")
        .select("snapshot_id,check_guid,amount_cents,voided,deleted").in("snapshot_id", ids)
        .order("snapshot_id").order("check_guid").range(from, to), 250),
    ]);
    if (orders.length !== ids.length) throw new Error("capture_read_snapshot_missing");
    orderRows.push(...orders); checkRows.push(...checks);
  }
  const [options, channels] = await Promise.all([
    selectAllRows<{ guid: string; name: string }>((from, to) => sb.from("toast_dining_options")
      .select("guid,name").eq("location_id", locationId).order("guid").range(from, to), 250),
    selectAllRows<{ dining_option_label: string; channel: string; provider: string | null; reviewed_at: string | null }>((from, to) => sb.from("sales_channel_map")
      .select("dining_option_label,channel,provider,reviewed_at").order("dining_option_label").range(from, to), 250),
  ]);
  const optionByGuid = new Map(options.map((row) => [row.guid, row]));
  const channelByLabel = new Map(channels.map((row) => [row.dining_option_label, row]));
  const checksBySnapshot = new Map<string, CapturedToastCheck[]>();
  for (const row of checkRows) {
    const amount = row.amount_cents == null ? null : Number(row.amount_cents);
    if (amount !== null && !Number.isSafeInteger(amount)) throw new Error("capture_read_amount_invalid");
    const list = checksBySnapshot.get(row.snapshot_id) ?? [];
    list.push({ checkGuid: row.check_guid, amountCents: amount, voided: row.voided, deleted: row.deleted });
    checksBySnapshot.set(row.snapshot_id, list);
  }
  const out = new Map<string, CapturedToastDay>();
  for (const [date, run] of runs) out.set(date, { coverage: { runId: run.id, finishedAt: run.finished_at,
    orderCount: run.orders, missingPointerCount: missing.get(date) ?? 0, absenceRemovalApplied, configDegraded: false }, orders: [] });
  for (const row of orderRows) {
    const day = out.get(row.business_date)!;
    const option = row.dining_option_guid ? optionByGuid.get(row.dining_option_guid) : undefined;
    const mapped = option ? channelByLabel.get(option.name) : undefined;
    if (row.dining_option_guid && (!option || !mapped?.reviewed_at || mapped.channel === "Unknown")) day.coverage.configDegraded = true;
    const checks = checksBySnapshot.get(row.id) ?? [];
    const checkIds = new Set(checks.map((check) => check.checkGuid));
    if (row.selection_units.some((selection) => !checkIds.has(selection.check_guid))) throw new Error("capture_read_check_missing");
    day.orders.push({ snapshotId: row.id, orderGuid: row.order_guid, modifiedAt: row.modified_at,
      diningOptionGuid: row.dining_option_guid, diningOption: option?.name ?? null,
      salesChannel: mapped?.reviewed_at ? (mapped.provider === "gift_card" ? "gift_card" : mapped.channel) : null,
      deleted: row.deleted, voided: row.voided, excessFood: row.excess_food, selections: row.selection_units, checks });
  }
  const [afterRuns, afterPointers] = await Promise.all([readRuns(), readPointers()]);
  if (JSON.stringify([...afterRuns]) !== JSON.stringify([...runs]) || JSON.stringify(afterPointers) !== JSON.stringify(pointers)) throw new Error("capture_read_changed");
  return out;
}
