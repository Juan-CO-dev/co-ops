/**
 * Admin catering-menu flags data layer (identity arc PR-2).
 *
 * SERVER-ONLY. Service-role; admin authz is app-layer at the calling route
 * (requireSession → level floor → assertStepUp Tier A) AND re-checked here per-action.
 *
 * Marks items on the shared registry as catering-available (offered à la carte) and/or
 * catering-only (hidden from the regular menu). The DB enforces only-implies-available;
 * this lib mirrors that so a toggle never lands an illegal combination.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const MENU_ADMIN_MIN = 7; // GM+ — menu-availability config (mirrors zones)

export class AdminCateringMenuError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCateringMenuError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminCateringMenuError(403, "forbidden", "Insufficient role level");
}

export interface AdminSize {
  id: string;
  label: string;
  priceCents: number;
  serves: number | null;
  displayOrder: number;
  active: boolean;
}
export interface AdminMenuItem {
  id: string;
  kind: "item" | "menu_item";
  name: string;
  nameEs: string | null;
  section: string | null;
  menuPriceCents: number | null;
  cateringAvailable: boolean;
  cateringOnly: boolean;
  cateringPortionable: boolean | null; // subs only; null for items
  /** People covered per ONE whole unit (0154; null → 1 in coverage). */
  serves: number | null;
  sizes: AdminSize[];                   // items only; [] for subs
}

/** Load the whole catering-manageable menu: global active items (with their catering sizes) +
 *  active menu_items (subs/resale, with catering_portionable). Both tagged by kind. */
export async function loadAdminCateringMenu(actor: AuthContext): Promise<AdminMenuItem[]> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const [{ data: itemRows, error: iErr }, { data: subRows, error: sErr }] = await Promise.all([
    sb.from("items").select("id, name, name_es, section, menu_price, catering_available, catering_only, serves")
      .eq("active", true).is("location_id", null)
      .order("section", { ascending: true, nullsFirst: false }).order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_available: boolean; catering_only: boolean; serves: number | string | null }>>(),
    sb.from("menu_items").select("id, name, name_es, section, menu_price, catering_available, catering_only, catering_portionable, serves")
      .eq("active", true)
      .order("section", { ascending: true, nullsFirst: false }).order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_available: boolean; catering_only: boolean; catering_portionable: boolean; serves: number | string | null }>>(),
  ]);
  if (iErr) throw new Error(`loadAdminCateringMenu items: ${iErr.message}`);
  if (sErr) throw new Error(`loadAdminCateringMenu menu_items: ${sErr.message}`);

  const itemIds = (itemRows ?? []).map((r) => r.id);
  const sizesByItem = new Map<string, AdminSize[]>();
  if (itemIds.length > 0) {
    const { data: szRows, error: szErr } = await sb.from("item_sizes")
      .select("id, item_id, label, price_cents, serves, display_order, active")
      .in("item_id", itemIds).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; item_id: string; label: string; price_cents: number; serves: number | string | null; display_order: number; active: boolean }>>();
    if (szErr) throw new Error(`loadAdminCateringMenu sizes: ${szErr.message}`);
    for (const s of szRows ?? []) {
      const arr = sizesByItem.get(s.item_id) ?? [];
      arr.push({ id: s.id, label: s.label, priceCents: s.price_cents, serves: s.serves == null ? null : Number(s.serves), displayOrder: s.display_order, active: s.active });
      sizesByItem.set(s.item_id, arr);
    }
  }
  const toCents = (v: number | string | null) => (v != null ? Math.round(Number(v) * 100) : null);
  const items: AdminMenuItem[] = (itemRows ?? []).map((r) => ({
    id: r.id, kind: "item", name: r.name, nameEs: r.name_es, section: r.section,
    menuPriceCents: toCents(r.menu_price), cateringAvailable: r.catering_available, cateringOnly: r.catering_only,
    cateringPortionable: null, serves: r.serves == null ? null : Number(r.serves), sizes: sizesByItem.get(r.id) ?? [],
  }));
  const subs: AdminMenuItem[] = (subRows ?? []).map((r) => ({
    id: r.id, kind: "menu_item", name: r.name, nameEs: r.name_es, section: r.section,
    menuPriceCents: toCents(r.menu_price), cateringAvailable: r.catering_available, cateringOnly: r.catering_only,
    cateringPortionable: r.catering_portionable, serves: r.serves == null ? null : Number(r.serves), sizes: [],
  }));
  return [...items, ...subs];
}

/** Toggle catering flags on an item or a menu_item (kind-aware). Enforces only⇒available (matches
 *  the DB CHECK). catering_portionable applies to menu_items (subs) only. */
export async function setCateringFlags(
  actor: AuthContext,
  kind: "item" | "menu_item",
  id: string,
  changes: { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean; serves?: number | null },
): Promise<{ cateringAvailable: boolean; cateringOnly: boolean; cateringPortionable: boolean | null }> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const table = kind === "menu_item" ? "menu_items" : "items";
  const cols = kind === "menu_item" ? "catering_available, catering_only, catering_portionable" : "catering_available, catering_only";
  const { data: cur, error: lErr } = await sb.from(table).select(cols)
    .eq("id", id).maybeSingle<{ catering_available: boolean; catering_only: boolean; catering_portionable?: boolean }>();
  if (lErr) throw new Error(`setCateringFlags load: ${lErr.message}`);
  if (!cur) throw new AdminCateringMenuError(404, "not_found", "Not found");

  let available = changes.cateringAvailable ?? cur.catering_available;
  let only = changes.cateringOnly ?? cur.catering_only;
  if (only) available = true; // catering-only implies available
  if (!available) only = false; // dropping availability drops only

  const update: Record<string, unknown> = { catering_available: available, catering_only: only, updated_by: actor.user.id, updated_at: new Date().toISOString() };
  if (changes.serves !== undefined) {
    if (changes.serves !== null && (!Number.isFinite(changes.serves) || changes.serves <= 0 || changes.serves > 500)) {
      throw new AdminCateringMenuError(400, "invalid_serves", "Serves must be a positive number (≤500)");
    }
    update.serves = changes.serves;
  }
  let portionable: boolean | null = kind === "menu_item" ? (cur.catering_portionable ?? false) : null;
  if (kind === "menu_item" && changes.cateringPortionable !== undefined) {
    portionable = changes.cateringPortionable;
    update.catering_portionable = portionable;
  }

  const { error, count } = await sb.from(table).update(update, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`setCateringFlags update: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.menu.set_flags",
    resourceTable: table,
    resourceId: id,
    metadata: { kind, catering_available: available, catering_only: only, ...(changes.serves !== undefined ? { serves: changes.serves } : {}), ...(kind === "menu_item" ? { catering_portionable: portionable } : {}) },
    ipAddress: null,
    userAgent: null,
  });
  return { cateringAvailable: available, cateringOnly: only, cateringPortionable: portionable };
}
