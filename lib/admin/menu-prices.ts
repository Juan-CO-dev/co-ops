import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { isValidMenuPrice } from "@/lib/toast/in-store-prices-shared";

export const MENU_PRICE_WRITE_MIN = 8;
export class MenuPriceError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function updateMenuPrice(actor: AuthContext, id: string, value: unknown, expectedMenuPrice: unknown): Promise<void> {
  if (getRoleLevel(actor.user.role) < MENU_PRICE_WRITE_MIN) throw new MenuPriceError(403, "forbidden");
  if (!isValidMenuPrice(value) || !isValidMenuPrice(expectedMenuPrice)) throw new MenuPriceError(400, "invalid_menu_price");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new MenuPriceError(404, "not_found");
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("menu_items").select("menu_price, catering_available").eq("id", id).eq("active", true)
    .maybeSingle<{ menu_price: number | string | null; catering_available: boolean }>();
  if (error) throw new MenuPriceError(500, "internal_error");
  if (!data) throw new MenuPriceError(404, "not_found");
  const before = data.menu_price == null ? null : Number(data.menu_price);
  if (before !== expectedMenuPrice) throw new MenuPriceError(409, "menu_price_changed");
  if (value === null && data.catering_available) throw new MenuPriceError(409, "menu_price_catering_required");
  if (before === value) return;
  let query = sb.from("menu_items").update({ menu_price: value, updated_at: new Date().toISOString(), updated_by: actor.user.id })
    .eq("id", id).eq("active", true);
  query = before === null ? query.is("menu_price", null) : query.eq("menu_price", before);
  const result = await query.select("id");
  if (result.error) throw new MenuPriceError(500, "internal_error");
  if (!result.data?.length) throw new MenuPriceError(409, "menu_price_changed");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "menu_item.update",
    resourceTable: "menu_items", resourceId: id,
    metadata: { before: { menu_price: before }, after: { menu_price: value }, changed_fields: ["menu_price"] },
    ipAddress: null, userAgent: null });
}
