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

export interface AdminMenuItem {
  id: string;
  name: string;
  nameEs: string | null;
  section: string | null;
  menuPriceCents: number | null;
  cateringAvailable: boolean;
  cateringOnly: boolean;
}

export async function loadAdminMenuItems(actor: AuthContext): Promise<AdminMenuItem[]> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("items")
    .select("id, name, name_es, section, menu_price, catering_available, catering_only")
    .eq("active", true)
    .order("section", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_available: boolean; catering_only: boolean }>>();
  if (error) throw new Error(`loadAdminMenuItems: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    nameEs: r.name_es,
    section: r.section,
    menuPriceCents: r.menu_price != null ? Math.round(Number(r.menu_price) * 100) : null,
    cateringAvailable: r.catering_available,
    cateringOnly: r.catering_only,
  }));
}

/** Toggle an item's catering flags, enforcing only⇒available (matches the DB CHECK). */
export async function setCateringFlags(
  actor: AuthContext,
  itemId: string,
  changes: { cateringAvailable?: boolean; cateringOnly?: boolean },
): Promise<{ cateringAvailable: boolean; cateringOnly: boolean }> {
  requireLevel(actor, MENU_ADMIN_MIN);
  const sb = getServiceRoleClient();
  const { data: cur, error: lErr } = await sb
    .from("items")
    .select("catering_available, catering_only")
    .eq("id", itemId)
    .maybeSingle<{ catering_available: boolean; catering_only: boolean }>();
  if (lErr) throw new Error(`setCateringFlags load: ${lErr.message}`);
  if (!cur) throw new AdminCateringMenuError(404, "not_found", "Item not found");

  let available = changes.cateringAvailable ?? cur.catering_available;
  let only = changes.cateringOnly ?? cur.catering_only;
  if (only) available = true; // catering-only implies available
  if (!available) only = false; // dropping availability drops only

  const { error, count } = await sb
    .from("items")
    .update({ catering_available: available, catering_only: only, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", itemId);
  if (error) throw new Error(`setCateringFlags update: ${error.message}`);
  if (count === 0) throw new AdminCateringMenuError(404, "not_found", "Item not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.menu.set_flags",
    resourceTable: "items",
    resourceId: itemId,
    metadata: { catering_available: available, catering_only: only },
    ipAddress: null,
    userAgent: null,
  });
  return { cateringAvailable: available, cateringOnly: only };
}
