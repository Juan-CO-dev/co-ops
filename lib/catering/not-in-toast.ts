import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { loadCateringReader } from "./ezcater-detail";
import { canReadCateringContact } from "./ezcater-detail-shared";
import { CateringPipelineError, PIPELINE_READ_MIN } from "./pipeline";
import { etClock } from "@/lib/report-digests-shared";
import { toastRingTiming, type NotInToastOrder } from "./not-in-toast-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
const COLUMNS = "order_id,lead_id,location_id,event_date,order_number,handoff_time,event_timestamp,headcount,total_cents";

/** System digest seam. Every caller must provide explicit shop scope; [] means no reads.
 * One view statement observes current links and logistics together, avoiding transfer/link races. */
export async function readNotInToast(sb: Sb, locationIds: readonly string[], dates: { from?: string; through: string }): Promise<NotInToastOrder[]> {
  const rows: NotInToastOrder[] = [];
  for (const locationId of new Set(locationIds)) {
    rows.push(...await selectAllRows<NotInToastOrder>((from, to) => {
      let q = sb.from("ezcater_reconciliation_status").select(COLUMNS)
        .eq("location_id", locationId).eq("status", "not_rung_in_toast").lte("event_date", dates.through);
      if (dates.from) q = q.gte("event_date", dates.from);
      return q.order("event_date").order("order_id").range(from, to);
    }));
  }
  return rows;
}

export type PipelineToastOrder = NotInToastOrder & { overdue: boolean };

/** The pipeline's fresh reader policy, enforced BEFORE any order projection is read. */
export async function loadNotInToast(actor: AuthContext, now = new Date()): Promise<PipelineToastOrder[]> {
  const reader = await loadCateringReader(actor);
  if (!reader?.active || getRoleLevel(reader.role) < PIPELINE_READ_MIN) throw new CateringPipelineError(403, "forbidden");
  const sb = getServiceRoleClient();
  let ids = reader.locations;
  if (reader.role === "catering_mgr" || getRoleLevel(reader.role) >= 8) {
    ids = (await selectAllRows<{ id: string }>((from, to) => sb.from("locations").select("id").order("id").range(from, to))).map((l) => l.id);
  }
  const rows = await readNotInToast(sb, ids, { through: etClock(now).day });
  return rows.filter((row) => canReadCateringContact(reader, row.location_id))
    .map((row) => ({ ...row, overdue: toastRingTiming(row, now, null) === "overdue" }));
}
