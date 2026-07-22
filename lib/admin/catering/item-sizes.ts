/**
 * Admin item_sizes CRUD (sub-project C). SERVER-ONLY, service-role (item_sizes is deny-all RLS →
 * the lib is the authority). GM+ (MENU_ADMIN_MIN), append-only (deactivate, never DELETE — a live
 * draft's catering_quote_item_options / resolveLines tolerates a retired size). Audit every write.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { AdminCateringMenuError, MENU_ADMIN_MIN, type AdminSize } from "@/lib/admin/catering/menu";

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminCateringMenuError(403, "forbidden", "Insufficient role level");
}
function normLabel(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new AdminCateringMenuError(400, "invalid_size", "Size label is required");
  return s;
}
function normPrice(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new AdminCateringMenuError(400, "invalid_size", "Price must be a non-negative integer (cents)");
  return v;
}
function normServes(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new AdminCateringMenuError(400, "invalid_size", "Serves must be a positive number or blank");
  return v;
}

export async function addItemSize(actor: AuthContext, itemId: string, input: { label: unknown; priceCents: unknown; serves: unknown }): Promise<AdminSize> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const label = normLabel(input.label);
  const priceCents = normPrice(input.priceCents);
  const serves = normServes(input.serves);
  const sb = getServiceRoleClient();

  const { data: item, error: itErr } = await sb.from("items").select("id").eq("id", itemId).is("location_id", null).eq("active", true).maybeSingle<{ id: string }>();
  if (itErr) throw new Error(`addItemSize item: ${itErr.message}`);
  if (!item) throw new AdminCateringMenuError(404, "not_found", "Item not found");

  // unique(item_id,label): active dup → reject; inactive dup → reactivate + overwrite.
  const { data: existing } = await sb.from("item_sizes").select("id, active").eq("item_id", itemId).eq("label", label).maybeSingle<{ id: string; active: boolean }>();
  if (existing) {
    if (existing.active) throw new AdminCateringMenuError(409, "size_exists", "A size with that label already exists");
    const { data: reac, error: rErr } = await sb.from("item_sizes")
      .update({ active: true, price_cents: priceCents, serves, updated_by: actor.user.id, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("id, label, price_cents, serves, display_order, active").single<{ id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>();
    if (rErr) throw new Error(`addItemSize reactivate: ${rErr.message}`);
    void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.create", resourceTable: "item_sizes", resourceId: reac.id, metadata: { item_id: itemId, label, price_cents: priceCents, reactivated: true }, ipAddress: null, userAgent: null });
    return { id: reac.id, label: reac.label, priceCents: reac.price_cents, serves: reac.serves == null ? null : Number(reac.serves), displayOrder: reac.display_order, active: reac.active };
  }

  const { data: maxRow } = await sb.from("item_sizes").select("display_order").eq("item_id", itemId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const displayOrder = (maxRow?.display_order ?? -1) + 1;
  const { data: ins, error: iErr } = await sb.from("item_sizes")
    .insert({ item_id: itemId, label, price_cents: priceCents, serves, display_order: displayOrder, active: true, created_by: actor.user.id })
    .select("id, label, price_cents, serves, display_order, active").single<{ id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>();
  if (iErr) throw new Error(`addItemSize insert: ${iErr.message}`);
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.create", resourceTable: "item_sizes", resourceId: ins.id, metadata: { item_id: itemId, label, price_cents: priceCents }, ipAddress: null, userAgent: null });
  return { id: ins.id, label: ins.label, priceCents: ins.price_cents, serves: ins.serves == null ? null : Number(ins.serves), displayOrder: ins.display_order, active: ins.active };
}

export async function updateItemSize(actor: AuthContext, sizeId: string, changes: { label?: unknown; priceCents?: unknown; serves?: unknown }): Promise<AdminSize> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const { data: cur, error: lErr } = await sb.from("item_sizes").select("id, item_id, label").eq("id", sizeId).maybeSingle<{ id: string; item_id: string; label: string }>();
  if (lErr) throw new Error(`updateItemSize load: ${lErr.message}`);
  if (!cur) throw new AdminCateringMenuError(404, "not_found", "Size not found");

  const update: Record<string, unknown> = {};
  if ("label" in changes) {
    const label = normLabel(changes.label);
    if (label !== cur.label) {
      const { data: collide } = await sb.from("item_sizes").select("id").eq("item_id", cur.item_id).eq("label", label).eq("active", true).neq("id", sizeId).maybeSingle<{ id: string }>();
      if (collide) throw new AdminCateringMenuError(409, "size_exists", "A size with that label already exists");
      update.label = label;
    }
  }
  if ("priceCents" in changes) update.price_cents = normPrice(changes.priceCents);
  if ("serves" in changes) update.serves = normServes(changes.serves);
  if (Object.keys(update).length === 0) throw new AdminCateringMenuError(400, "invalid_size", "Nothing to update");
  update.updated_by = actor.user.id; update.updated_at = new Date().toISOString();

  const { data: upd, error, count } = await sb.from("item_sizes").update(update, { count: "exact" }).eq("id", sizeId)
    .select("id, label, price_cents, serves, display_order, active").single<{ id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>();
  if (error) throw new Error(`updateItemSize update: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Size not found");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.update", resourceTable: "item_sizes", resourceId: sizeId, metadata: { fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at") }, ipAddress: null, userAgent: null });
  return { id: upd.id, label: upd.label, priceCents: upd.price_cents, serves: upd.serves == null ? null : Number(upd.serves), displayOrder: upd.display_order, active: upd.active };
}

export async function deactivateItemSize(actor: AuthContext, sizeId: string): Promise<void> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("item_sizes").update({ active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" }).eq("id", sizeId).eq("active", true);
  if (error) throw new Error(`deactivateItemSize: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Size not found or already removed");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.kb.item_size.deactivate", resourceTable: "item_sizes", resourceId: sizeId, metadata: {}, ipAddress: null, userAgent: null });
}
