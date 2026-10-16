import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { catalogShopAllowed, catalogWriteRoleAllowed } from "@/lib/sku-versions-shared";
import { ownerVisible } from "@/lib/catalog/shop-owned-shared";
import { AdminToastMapError, loadSandwichToastChoices } from "@/lib/admin/toast-map";
import { toastConfigured } from "@/lib/toast/client";
import { matchCandidates } from "@/lib/toast/matcher";
import { loadLiveMenuItemShopSettings } from "@/lib/menu-item-shop";
import { resolveMenuItemForShop } from "@/lib/menu-item-shop-shared";
import type { ToastLinkChoice, ToastLinkChoices } from "@/lib/catalog/jobs-shared";
type Menu = {
    id: string;
    name: string;
    name_es: string | null;
    menu_price: number | string | null;
    location_id: string | null;
};
type Mapping = {
    menu_item_id: string | null;
    toast_item_guid: string;
    toast_item_name: string;
    toast_price_cents: number | null;
    match_status: string;
    disposition: string;
};
const price = (v: number | string | null): number | null => v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null;
/** Read-only, selected-shop projection. Never persists matcher candidates. */
export async function loadToastLinkChoices(actor: AuthContext, menuItemId: string, shopId: string): Promise<ToastLinkChoices> {
    if (actor.level < 7 || !catalogWriteRoleAllowed(actor.user.role, actor.level) || !catalogShopAllowed(actor, shopId))
        throw new AdminToastMapError(403, 'forbidden');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(menuItemId) || !uuid.test(shopId))
        throw new AdminToastMapError(400, 'invalid_payload');
    const sb = getServiceRoleClient();
    const { data: item, error: itemError } = await sb.from('menu_items').select('id,name,name_es,menu_price,location_id').eq('id', menuItemId).eq('active', true).maybeSingle<Menu>();
    if (itemError)
        throw new Error(`Toast menu item: ${itemError.message}`);
    if (!item || !ownerVisible(item.location_id, shopId))
        throw new AdminToastMapError(404, 'not_found');
    const { data: shop, error: shopError } = await sb.from('locations').select('id,toast_restaurant_guid').eq('id', shopId).eq('active', true).maybeSingle<{
        id: string;
        toast_restaurant_guid: string | null;
    }>();
    if (shopError)
        throw new Error(`Toast shop: ${shopError.message}`);
    if (!shop)
        throw new AdminToastMapError(404, 'not_found');
    const base: ToastLinkChoices = { menuItemId, shopId, status: 'unavailable', choices: [], suggestion: null, linked: [] };
    if (!toastConfigured() || !shop.toast_restaurant_guid)
        return base;
    const [menu, settings, maps] = await Promise.all([
        loadSandwichToastChoices(actor, shopId), loadLiveMenuItemShopSettings(shopId),
        selectAllRows<Mapping>(async (from, to) => {
            const { data, error } = await sb.from('toast_menu_map').select('menu_item_id,toast_item_guid,toast_item_name,toast_price_cents,match_status,disposition').eq('location_id', shopId).eq('active', true).eq('is_modifier', false).order('id').range(from, to).returns<Mapping[]>();
            if (error)
                throw new Error(`Toast links: ${error.message}`);
            return { data };
        }),
    ]);
    const linked = maps.filter(r => r.menu_item_id === menuItemId && r.match_status === 'confirmed').map((r): ToastLinkChoice => ({ guid: r.toast_item_guid, name: r.toast_item_name, price: r.toast_price_cents === null ? null : r.toast_price_cents / 100 }));
    const blocked = new Set(maps.filter(r => r.disposition === 'open_item' || (r.menu_item_id === menuItemId ? r.match_status === 'rejected' || r.match_status === 'confirmed' : r.match_status !== 'rejected')).map(r => r.toast_item_guid));
    const available = menu.filter(r => !blocked.has(r.itemGuid));
    const toChoice = (r: typeof menu[number]): ToastLinkChoice => ({ guid: r.itemGuid, name: r.name, price: r.priceCents === null ? null : r.priceCents / 100 });
    const here = resolveMenuItemForShop({ id: item.id, name: item.name, nameEs: item.name_es, menuPrice: price(item.menu_price) }, settings.get(menuItemId));
    const match = matchCandidates([{ kind: 'menu_item', id: menuItemId, name: here.name, priceCents: here.typedPrice === null ? null : Math.round(here.typedPrice * 100) }], available)[0];
    return { ...base, status: linked.length ? 'linked' : !available.length ? 'empty' : match ? 'suggested' : 'choices', choices: available.map(toChoice), suggestion: match ? toChoice(match.toast) : null, linked };
}
