/**
 * Catering delivery D3 fixtures: a shop day through the day loader's REAL reads on the recording client
 * (tests/helpers/fake-supabase.ts) — one booked delivery order ("lead") and one unlinked ezCater order ("ez") on the plan
 * date. Shared by the off-equivalence golden and the read-count test, so both count the same day.
 */
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import { PLAN_DATE } from "../day-plan/build";
import type { FakeCall } from "../../helpers/fake-supabase";

export type Answer = { data?: unknown; error?: unknown };
/** Every table the day loader reads on that day (the delivery tables are not answered here: `default` is an empty list). */
export function shopDay(c: FakeCall): Answer {
  const sel = String(c.arg("select") ?? "");
  const eq = (k: string) => c.ops.find((o) => o.op === "eq" && o.args[0] === k)?.args[1];
  switch (c.table) {
    case "schedule_structures": return { data: [{ id: "s1", structure: SCHEDULE_STRUCTURE_DEFAULTS, created_at: "x" }] };
    case "stations": return sel === "id, starts_mid_day, not_phase_station" ? { data: [{ id: "st-1", starts_mid_day: false, not_phase_station: true }] } : { data: null };
    case "checklist_templates":
      if (sel.startsWith("id, type")) return { data: [{ id: "tc", type: "closing", active: true, effective_from: null, created_at: "2026-01-01" }] };
      return { data: [{ id: eq("type") === "closing" ? "tc" : "to" }] };
    case "checklist_instances": {
      if (sel.includes("!inner")) return { data: [] };
      const ids = (c.arg("in", 1) as string[]) ?? [];
      if (ids.includes("tc") && eq("date") === PLAN_DATE) return { data: [{ id: "ic", template_id: "tc", status: "open", created_at: "x", confirmed_at: null, confirmed_by: null }] };
      if (ids.includes("to")) return { data: [{ id: "io", template_id: "to", status: "confirmed", created_at: "x", confirmed_at: "y", confirmed_by: "u-ana" }] };
      return { data: [] };
    }
    case "checklist_template_items": return { data: [{ id: "i1", station: "Expo", active: true, report_reference_type: null }] };
    case "checklist_submissions": return { data: [{ submitted_at: "z" }] };
    case "users": return c.has("maybeSingle") ? { data: { role: "key_holder" } } : { data: [{ id: "u-ana", name: "Ana Ruiz" }] };
    case "user_locations": return { data: { user_id: "u" } };
    case "cash_reports": case "pm_reports": return { data: null };
    case "schedule_weeks": return { data: [{ week_start: "2026-11-16", head_revision_id: "rev-1" }] };
    case "schedule_revision_days": return { data: [{ revision_id: "rev-1", business_date: PLAN_DATE, origin_revision_id: "rev-1" }] };
    case "schedule_revision_contexts": return { data: [{ revision_id: "rev-1", t0: 28, t1: null }] };
    case "catering_pipeline": return { data: [{ id: "lead", contact_name: "A", company: null, event_date: PLAN_DATE, time_window: "noon", headcount: 9, stage: "confirmed",
      delivery_address: "1 Way", estimated_revenue_cents: 100 }] };
    case "catering_quotes": return { data: [{ pipeline_id: "lead", total_cents: 100, is_delivery: true, version: 1 }] };
    case "ezcater_orders": return { data: [{ id: "ez", event_date: PLAN_DATE, event_timestamp: null, handoff_time: null, headcount: 3, total_cents: 100, status: null }] };
    default: return { data: [] };
  }
}
