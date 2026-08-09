/**
 * W4c-b LTO/discount action engine — SERVER-ONLY, service-role. A manager turns W4c-a perishable
 * surplus into a live LTO or discount (an lto_events artifact + a stubbed POS push). Module #17
 * later reads lto_events for performance. Gated ≥ LTO_MIN + Tier-A step-up (enforced at the route).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { pushLtoToPos } from "@/lib/catering/lto-pos-push";
import { etCalendarDate } from "@/lib/operational-day";

export const LTO_MIN = 6;        // catering_mgr+ writes (mirrors SURPLUS_READ_MIN)
export const LTO_READ_MIN = 5;   // staff can see the directive (list) at their location

export class LtoError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "LtoError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new LtoError(403, "forbidden", "Insufficient role level");
}

export type LtoKind = "lto" | "discount";

export interface LtoEventItemInput {
  itemId: string | null;
  menuItemId: string | null;
  nameSnapshot: string;
  qty: number;
  sourcePipelineId: string | null;
}
export interface CreateLtoEventInput {
  locationId: string;
  kind: LtoKind;
  name: string;
  discountBps: number | null;
  promoPriceCents: number | null;
  startsOn: string;
  endsOn: string;
  note: string | null;
  items: LtoEventItemInput[];
}
export interface LtoEventView {
  id: string;
  locationId: string;
  kind: LtoKind;
  name: string;
  discountBps: number | null;
  promoPriceCents: number | null;
  startsOn: string;
  endsOn: string;
  status: "active" | "cancelled" | "expired";
  posPushStatus: "not_pushed" | "pushed" | "failed";
  note: string | null;
  items: { name: string; qty: number }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Create an LTO/discount from surplus. ≥ LTO_MIN + Tier-A step-up (route). */
export async function createLtoEvent(actor: AuthContext, input: CreateLtoEventInput): Promise<{ id: string }> {
  requireLevel(actor, LTO_MIN);

  if (input.kind !== "lto" && input.kind !== "discount") throw new LtoError(400, "invalid_kind");
  const name = (input.name ?? "").trim();
  if (!name) throw new LtoError(400, "invalid_name", "A name is required");
  if (!DATE_RE.test(input.startsOn) || !DATE_RE.test(input.endsOn)) throw new LtoError(400, "invalid_window", "Valid dates required");
  if (input.endsOn < input.startsOn) throw new LtoError(400, "invalid_window", "End date must be on/after start date");

  const discountBps = input.discountBps;
  if (discountBps != null && (!Number.isInteger(discountBps) || discountBps <= 0 || discountBps > 10000)) {
    throw new LtoError(400, "invalid_discount", "Discount must be 1–10000 bps");
  }
  const promoPriceCents = input.promoPriceCents;
  if (promoPriceCents != null && (!Number.isInteger(promoPriceCents) || promoPriceCents < 0)) {
    throw new LtoError(400, "invalid_price", "Promo price must be a non-negative integer (cents)");
  }
  if (input.kind === "discount" && discountBps == null) {
    throw new LtoError(400, "discount_needs_bps", "A discount requires a percent");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) throw new LtoError(400, "no_items", "At least one item is required");
  for (const it of input.items) {
    const refs = (it.itemId ? 1 : 0) + (it.menuItemId ? 1 : 0);
    if (refs !== 1) throw new LtoError(400, "invalid_item_ref", "Each item needs exactly one ref");
    if (!(it.qty > 0)) throw new LtoError(400, "invalid_item_qty", "Item qty must be > 0");
    if (!it.nameSnapshot || !it.nameSnapshot.trim()) throw new LtoError(400, "invalid_item_name", "Item name required");
  }

  const sb = getServiceRoleClient();
  const { data: loc, error: locErr } = await sb
    .from("locations").select("id").eq("id", input.locationId).eq("active", true).maybeSingle<{ id: string }>();
  if (locErr) throw new Error(`createLtoEvent location: ${locErr.message}`);
  if (!loc) throw new LtoError(404, "location_not_found", "Location not found or inactive");

  const { data: ev, error: evErr } = await sb
    .from("lto_events")
    .insert({
      location_id: input.locationId, kind: input.kind, name,
      discount_bps: discountBps ?? null, promo_price_cents: promoPriceCents ?? null,
      starts_on: input.startsOn, ends_on: input.endsOn, status: "active",
      note: input.note?.trim() || null, created_by: actor.user.id,
    })
    .select("id").single<{ id: string }>();
  if (evErr) throw new Error(`createLtoEvent event: ${evErr.message}`);

  const itemRows = input.items.map((it) => ({
    event_id: ev.id, item_id: it.itemId, menu_item_id: it.menuItemId,
    name_snapshot: it.nameSnapshot.trim(), qty: it.qty, source_pipeline_id: it.sourcePipelineId,
  }));
  const { error: itErr } = await sb.from("lto_event_items").insert(itemRows);
  if (itErr) throw new Error(`createLtoEvent items: ${itErr.message}`);

  // Stubbed provider-agnostic POS push (never throws). Record the disposition when non-default.
  const push = await pushLtoToPos({ id: ev.id, kind: input.kind, locationId: input.locationId });
  if (push.status !== "not_pushed") {
    await sb.from("lto_events").update({ pos_push_status: push.status }).eq("id", ev.id);
  }

  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "lto.event.create",
    resourceTable: "lto_events", resourceId: ev.id,
    metadata: { kind: input.kind, location_id: input.locationId, items: input.items.length, discount_bps: discountBps ?? null, promo_price_cents: promoPriceCents ?? null, pos_push_status: push.status },
    ipAddress: null, userAgent: null,
  });
  return { id: ev.id };
}

/** List LTO/discount events for a location. activeOnly = the staff directive (active + not past-window). */
export async function listLtoEvents(actor: AuthContext, args: { locationId: string; activeOnly: boolean }): Promise<LtoEventView[]> {
  requireLevel(actor, LTO_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb
    .from("lto_events")
    .select("id, location_id, kind, name, discount_bps, promo_price_cents, starts_on, ends_on, status, pos_push_status, note")
    .eq("location_id", args.locationId)
    .order("starts_on", { ascending: false });
  if (args.activeOnly) {
    const today = etCalendarDate(new Date().toISOString());
    q = q.eq("status", "active").gte("ends_on", today);
  }
  const { data: events, error } = await q.returns<Array<{ id: string; location_id: string; kind: LtoKind; name: string; discount_bps: number | null; promo_price_cents: number | null; starts_on: string; ends_on: string; status: "active" | "cancelled" | "expired"; pos_push_status: "not_pushed" | "pushed" | "failed"; note: string | null }>>();
  if (error) throw new Error(`listLtoEvents: ${error.message}`);
  const evs = events ?? [];
  if (evs.length === 0) return [];

  const ids = evs.map((e) => e.id);
  const { data: items, error: itErr } = await sb
    .from("lto_event_items").select("event_id, name_snapshot, qty").in("event_id", ids)
    .returns<Array<{ event_id: string; name_snapshot: string; qty: number | string }>>();
  if (itErr) throw new Error(`listLtoEvents items: ${itErr.message}`);
  const byEvent = new Map<string, { name: string; qty: number }[]>();
  for (const it of items ?? []) {
    const arr = byEvent.get(it.event_id) ?? [];
    arr.push({ name: it.name_snapshot, qty: typeof it.qty === "string" ? Number(it.qty) : it.qty });
    byEvent.set(it.event_id, arr);
  }
  return evs.map((e) => ({
    id: e.id, locationId: e.location_id, kind: e.kind, name: e.name,
    discountBps: e.discount_bps, promoPriceCents: e.promo_price_cents,
    startsOn: e.starts_on, endsOn: e.ends_on, status: e.status, posPushStatus: e.pos_push_status,
    note: e.note, items: byEvent.get(e.id) ?? [],
  }));
}

/** Cancel an active event (status → cancelled). ≥ LTO_MIN + step-up (route). */
export async function cancelLtoEvent(actor: AuthContext, id: string): Promise<void> {
  requireLevel(actor, LTO_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("lto_events")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: actor.user.id })
    .eq("id", id).eq("status", "active").select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`cancelLtoEvent: ${error.message}`);
  if (!data) throw new LtoError(404, "not_found", "Active event not found");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "lto.event.cancel", resourceTable: "lto_events", resourceId: id, metadata: {}, ipAddress: null, userAgent: null });
}
