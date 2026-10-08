import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { machineNotesMarkers } from "./machine-notes-shared";

/** Once structured detail exists, hide its obsolete machine summary, retaining human text. */
export function humanEzcaterNotes(notes: string | null): string | null {
  if (!notes) return notes;
  const { begin, end } = machineNotesMarkers("ezCater order", "ezCater");
  const start = notes.indexOf(begin);
  const finish = start < 0 ? -1 : notes.indexOf(end, start + begin.length);
  if (finish < 0) return notes;
  return notes.slice(0, start) + notes.slice(finish + end.length);
}

/** The existing catering contact policy; operational writes keep their own scope. */
export function canReadCateringContact(actor: { role: RoleCode; active: boolean; locations: string[] }, locationId: string | null): boolean {
  // CC confirmed: catering manager and level 8+ read every shop across the pipeline.
  return actor.active && getRoleLevel(actor.role) >= 5 &&
    (actor.role === "catering_mgr" || getRoleLevel(actor.role) >= 8 || locationId == null || actor.locations.includes(locationId));
}

export interface EzcaterOrderDetail {
  order_number: string | null;
  event_date: string | null;
  event_timestamp: string | null;
  handoff_time: string | null;
  status: string | null;
  headcount: number | null;
  fulfillment: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  fees_cents: number | null;
  discounts_cents: number | null;
  total_cents: number | null;
  payment_status: string | null;
  fetched_at: string | null;
  items: Array<{
    ordinal: number; name: string; quantity: number; unit_price_cents: number | null;
    total_cents: number | null; pos_item_id: string | null;
    options: Array<{ name: string; quantity: number | null; typeName: string | null }>;
    special_instructions: string | null; note_to_caterer: string | null;
  }>;
  contact: { name: string | null; email: string | null; phone: string | null; address: string | null } | null;
}
