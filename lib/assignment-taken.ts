import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskType } from "./assignments-shared";
import { checklistTakenOwner, dedupeTakenTasks, takenDayRange, type TakenTask } from "./assignment-taken-shared";
import { selectAllRows } from "./supabase-paginate";

/** Metadata only. Caller authorizes the shop; these records grant no task access.
 * Prep/opening use the recorded instance opener, PM its creator. Cash, receiving
 * and counts have no persisted unsaved-form owner: attribution starts on save.
 * Assignments take precedence at the board integration layer.
 */
export async function loadTakenTasks(service: SupabaseClient, args: {
  locationId: string; date: string; includeHistory?: boolean;
}): Promise<TakenTask[]> {
  const { start, end } = takenDayRange(args.date);
  const [templates, instances, cash, pm, deliveries, counts, orders] = await Promise.all([
    selectAllRows<{ id: string; type: string; prep_subtype: string | null }>((from, to) =>
      service.from("checklist_templates").select("id,type,prep_subtype")
        .eq("location_id", args.locationId).in("type", ["opening", "prep"])
        .order("id").range(from, to)),
    selectAllRows<{ id: string; template_id: string; triggered_by_user_id: string | null; triggered_at: string | null; assigned_to: string | null; dropped_at: string | null }>((from, to) =>
      service.from("checklist_instances").select("id,template_id,triggered_by_user_id,triggered_at,assigned_to,dropped_at")
        .eq("location_id", args.locationId).eq("date", args.date).order("id").range(from, to)),
    selectAllRows<{ id: string; signed_by: string; signed_at: string }>((from, to) =>
      service.from("cash_reports").select("id,signed_by,signed_at").eq("location_id", args.locationId)
        .eq("report_date", args.date).is("superseded_at", null).order("id").range(from, to)),
    selectAllRows<{ id: string; created_by: string; created_at: string }>((from, to) =>
      service.from("pm_reports").select("id,created_by,created_at").eq("location_id", args.locationId)
        .eq("report_date", args.date).is("superseded_at", null).order("id").range(from, to)),
    selectAllRows<{ id: string; received_by: string | null; created_at: string }>((from, to) =>
      service.from("vendor_deliveries").select("id,received_by,created_at").eq("location_id", args.locationId)
        .eq("delivery_date", args.date).order("id").range(from, to)),
    selectAllRows<{ id: string; counted_by: string | null; counted_at: string }>((from, to) =>
      service.from("sku_count_events").select("id,counted_by,counted_at").eq("location_id", args.locationId)
        .eq("active", true).gte("counted_at", start).lt("counted_at", end).order("id").range(from, to)),
    selectAllRows<{ id: string; created_by: string; created_at: string }>((from, to) =>
      service.from("purchase_orders").select("id,created_by,created_at").eq("location_id", args.locationId)
        .gte("created_at", start).lt("created_at", end).order("id").range(from, to)),
  ]);
  const templateTasks = new Map<string, TaskType>();
  for (const template of templates) {
    if (template.type === "opening") templateTasks.set(template.id, "opening_report");
    else if (template.prep_subtype === "am_prep" || template.prep_subtype === "mid_day_prep")
      templateTasks.set(template.id, template.prep_subtype);
  }
  const rows: TakenTask[] = [];
  const add = (id: string, task: TaskType, userId: string | null, at: string | null) => {
    if (userId && at) rows.push({ id, task, userId, at });
  };
  for (const row of instances) {
    const task = templateTasks.get(row.template_id);
    const owner = checklistTakenOwner(row);
    if (task && owner) add(row.id, task, owner.userId, owner.at);
  }
  for (const row of cash) add(row.id, "cash_report", row.signed_by, row.signed_at);
  for (const row of pm) add(row.id, "pm_report", row.created_by, row.created_at);
  for (const row of deliveries) add(row.id, "receiving", row.received_by, row.created_at);
  for (const row of counts) add(row.id, "counts", row.counted_by, row.counted_at);
  for (const row of orders) add(row.id, "ordering", row.created_by, row.created_at);
  // Lifecycle callers filter departure boundaries BEFORE deduplication, so a
  // later start after re-clock-in isn't hidden by this user's first report.
  return args.includeHistory ? rows : dedupeTakenTasks(rows);
}
