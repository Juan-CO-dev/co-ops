import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { CaptureSelection } from "./capture-reconciliation-shared";

export interface CapturedToastCheck {
  checkGuid: string; amountCents: number | null; voided: boolean; deleted: boolean;
}
export interface CapturedToastOrder {
  snapshotId: string; orderGuid: string; modifiedAt: string | null;
  diningOptionGuid: string | null; diningOption: string | null; salesChannel: string | null;
  deleted: boolean; voided: boolean; excessFood: boolean;
  selections: CaptureSelection[]; checks: CapturedToastCheck[];
}
export interface CapturedToastDay {
  coverage: { runId: string; finishedAt: string; orderCount: number; missingPointerCount: number;
    absenceRemovalApplied: boolean; configDegraded: boolean };
  orders: CapturedToastOrder[];
}
type Run = { id: string; finished_at: string; orders: number };
type Pointer = { snapshot_id: string; order_guid: string };
type OrderRow = { id: string; order_guid: string; modified_at: string | null; dining_option_guid: string | null;
  deleted: boolean; voided: boolean; excess_food: boolean; selection_units: CaptureSelection[] };
type CheckRow = { snapshot_id: string; check_guid: string; amount_cents: number | string | null; voided: boolean; deleted: boolean };

/** Latest pointers own source-version precedence. Run membership proves full-day coverage,
 * and only the reviewed absence flag removes pointers absent from that completed run.
 * Re-read publication identities after paging; retry once instead of returning a mixed day. */
export async function loadCapturedToastDay(locationId: string, businessDate: string): Promise<CapturedToastDay | null> {
  for (let attempt = 0; ; attempt++) {
    try { return await readDay(locationId, businessDate); }
    catch (error) {
      if (attempt === 0 && error instanceof Error && error.message === "capture_read_changed") continue;
      throw error;
    }
  }
}

async function readDay(locationId: string, businessDate: string): Promise<CapturedToastDay | null> {
  const sb = getServiceRoleClient();
  async function latestRun() {
    const result = await sb.from("toast_capture_runs").select("id,finished_at,orders")
      .eq("location_id", locationId).eq("business_date", businessDate).eq("status", "completed")
      .order("finished_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle<Run>();
    if (result.error) throw new Error("capture_read_run_failed");
    return result.data;
  }
  const readPointers = () => selectAllRows<Pointer>((from, to) => sb.from("toast_order_latest_pointers")
    .select("snapshot_id,order_guid").eq("location_id", locationId).eq("business_date", businessDate)
    .order("order_guid").range(from, to));
  const run = await latestRun();
  if (!run) return null;
  const [members, pointers] = await Promise.all([
    selectAllRows<Pointer>((from, to) => sb.from("toast_capture_run_orders").select("snapshot_id,order_guid")
      .eq("run_id", run.id).eq("location_id", locationId).eq("business_date", businessDate)
      .order("order_guid").range(from, to)),
    readPointers(),
  ]);
  if (members.length !== run.orders) throw new Error("capture_read_membership_incomplete");
  const memberGuids = new Set(members.map((row) => row.order_guid));
  const missingPointerCount = pointers.filter((row) => !memberGuids.has(row.order_guid)).length;
  const absenceRemovalApplied = process.env.TOAST_CAPTURE_ABSENCE_REMOVAL === "1";
  const selected = absenceRemovalApplied ? pointers.filter((row) => memberGuids.has(row.order_guid)) : pointers;
  const orderRows: OrderRow[] = [], checkRows: CheckRow[] = [];
  for (let start = 0; start < selected.length; start += 100) {
    const ids = selected.slice(start, start + 100).map((row) => row.snapshot_id);
    const [orders, checks] = await Promise.all([
      selectAllRows<OrderRow>((from, to) => sb.from("toast_orders")
        .select("id,order_guid,modified_at,dining_option_guid,deleted,voided,excess_food,selection_units")
        .eq("location_id", locationId).eq("business_date", businessDate).in("id", ids).order("id").range(from, to)),
      selectAllRows<CheckRow>((from, to) => sb.from("toast_order_checks")
        .select("snapshot_id,check_guid,amount_cents,voided,deleted").in("snapshot_id", ids)
        .order("snapshot_id").order("check_guid").range(from, to)),
    ]);
    if (orders.length !== ids.length) throw new Error("capture_read_snapshot_missing");
    orderRows.push(...orders); checkRows.push(...checks);
  }
  // Config is small but still paged; labels only join cache to reviewed map, never fuzzy comparisons.
  const [options, channels] = await Promise.all([
    selectAllRows<{ guid: string; name: string; updated_at: string }>((from, to) => sb.from("toast_dining_options")
      .select("guid,name,updated_at").eq("location_id", locationId).order("guid").range(from, to)),
    selectAllRows<{ dining_option_label: string; channel: string; provider: string | null; reviewed_at: string | null }>((from, to) => sb.from("sales_channel_map")
      .select("dining_option_label,channel,provider,reviewed_at").order("dining_option_label").range(from, to)),
  ]);
  const optionByGuid = new Map(options.map((row) => [row.guid, row]));
  const channelByLabel = new Map(channels.map((row) => [row.dining_option_label, row]));
  let configDegraded = false;
  const checksBySnapshot = new Map<string, CapturedToastCheck[]>();
  for (const row of checkRows) {
    const list = checksBySnapshot.get(row.snapshot_id) ?? [];
    const amount = row.amount_cents == null ? null : Number(row.amount_cents);
    if (amount !== null && !Number.isSafeInteger(amount)) throw new Error("capture_read_amount_invalid");
    list.push({ checkGuid: row.check_guid, amountCents: amount, voided: row.voided, deleted: row.deleted });
    checksBySnapshot.set(row.snapshot_id, list);
  }
  const orders = orderRows.map((row): CapturedToastOrder => {
    const option = row.dining_option_guid ? optionByGuid.get(row.dining_option_guid) : undefined;
    const mapped = option ? channelByLabel.get(option.name) : undefined;
    if (row.dining_option_guid && (!option || !mapped?.reviewed_at || mapped.channel === "Unknown")) configDegraded = true;
    const checks = checksBySnapshot.get(row.id) ?? [];
    const checkIds = new Set(checks.map((check) => check.checkGuid));
    if (row.selection_units.some((selection) => !checkIds.has(selection.check_guid))) throw new Error("capture_read_check_missing");
    return { snapshotId: row.id, orderGuid: row.order_guid, modifiedAt: row.modified_at,
      diningOptionGuid: row.dining_option_guid, diningOption: option?.name ?? null,
      salesChannel: mapped?.reviewed_at ? (mapped.provider === "gift_card" ? "gift_card" : mapped.channel) : null,
      deleted: row.deleted, voided: row.voided, excessFood: row.excess_food,
      selections: row.selection_units, checks };
  });
  const [runAfter, pointersAfter] = await Promise.all([latestRun(), readPointers()]);
  if (runAfter?.id !== run.id || JSON.stringify(pointersAfter) !== JSON.stringify(pointers)) throw new Error("capture_read_changed");
  return { coverage: { runId: run.id, finishedAt: run.finished_at, orderCount: run.orders,
    missingPointerCount, absenceRemovalApplied, configDegraded }, orders };
}
