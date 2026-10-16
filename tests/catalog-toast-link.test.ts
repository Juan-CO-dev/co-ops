import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
const m = vi.hoisted(() => ({ db: vi.fn(), choices: vi.fn(), configured: vi.fn(), overlay: vi.fn() }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: m.db }));
vi.mock('@/lib/admin/toast-map', async (original) => ({ ...await original<typeof import('@/lib/admin/toast-map')>(), loadSandwichToastChoices: m.choices }));
vi.mock('@/lib/toast/client', () => ({ toastConfigured: m.configured }));
vi.mock('@/lib/menu-item-shop', () => ({ loadLiveMenuItemShopSettings: m.overlay }));
import { loadToastLinkChoices } from '@/lib/catalog/toast-link';
const menuId = '11111111-1111-4111-8111-111111111111', shopId = '22222222-2222-4222-8222-222222222222', foreignId = '33333333-3333-4333-8333-333333333333';
const actor = { level: 7, locations: [shopId], user: { role: 'gm' } } as AuthContext;
let rows: Record<string, unknown>;
let calls: string[];
let filters: Array<[
    string,
    string,
    unknown
]>;
beforeEach(() => { vi.clearAllMocks(); calls = []; filters = []; rows = { menu_items: { id: menuId, name: 'Original', name_es: null, menu_price: 10, location_id: shopId }, locations: { id: shopId, toast_restaurant_guid: 'guid' }, toast_menu_map: [] }; m.configured.mockReturnValue(true); m.overlay.mockResolvedValue(new Map()); m.choices.mockResolvedValue([{ itemGuid: 'one', name: 'Original', priceCents: 1000, groupName: 'private' }]); m.db.mockReturnValue({ from: (table: string) => { calls.push(table); const q: any = {}; for (const key of ['select', 'eq', 'order', 'range'])
        q[key] = vi.fn((...args: unknown[]) => { if (key === "eq")
            filters.push([table, args[0] as string, args[1]]); return q; }); q.maybeSingle = async () => ({ data: rows[table], error: null }); q.returns = async () => ({ data: rows[table], error: null }); return q; } }); });
it('suggests a narrow choice without writes', async () => { expect(await loadToastLinkChoices(actor, menuId, shopId)).toEqual({ menuItemId: menuId, shopId: shopId, status: 'suggested', choices: [{ guid: 'one', name: 'Original', price: 10 }], suggestion: { guid: 'one', name: 'Original', price: 10 }, linked: [] }); });
it('refuses foreign shop before reads', async () => { await expect(loadToastLinkChoices(actor, menuId, foreignId)).rejects.toMatchObject({ code: 'forbidden' }); expect(m.db).not.toHaveBeenCalled(); });
it('refuses foreign owner', async () => { rows.menu_items = { ...(rows.menu_items as object), location_id: foreignId }; await expect(loadToastLinkChoices(actor, menuId, shopId)).rejects.toMatchObject({ code: 'not_found' }); });
it('returns unavailable without fixture choices when unconfigured', async () => { m.configured.mockReturnValue(false); expect((await loadToastLinkChoices(actor, menuId, shopId)).status).toBe('unavailable'); expect(m.choices).not.toHaveBeenCalled(); });
it('returns unavailable for missing restaurant GUID', async () => { rows.locations = { id: shopId, toast_restaurant_guid: null }; expect((await loadToastLinkChoices(actor, menuId, shopId)).status).toBe('unavailable'); });
it('reports empty real menu', async () => { m.choices.mockResolvedValue([]); expect((await loadToastLinkChoices(actor, menuId, shopId)).status).toBe('empty'); });
it('uses shop name and price', async () => { m.overlay.mockResolvedValue(new Map([[menuId, { name_override: 'Shop name', name_override_es: null, price: 12, sold_here: true }]])); m.choices.mockResolvedValue([{ itemGuid: 'two', name: 'Shop name', priceCents: 1200 }]); expect((await loadToastLinkChoices(actor, menuId, shopId)).suggestion?.guid).toBe('two'); });
it('excludes foreign claims and rejected pairs and retains multiple links', async () => { rows.toast_menu_map = [{ menu_item_id: 'other', toast_item_guid: 'one', match_status: 'confirmed' }, { menu_item_id: menuId, toast_item_guid: 'two', match_status: 'rejected' }, { menu_item_id: menuId, toast_item_guid: 'three', toast_item_name: 'Third', toast_price_cents: 1000, match_status: 'confirmed' }, { menu_item_id: menuId, toast_item_guid: 'four', toast_item_name: 'Fourth', toast_price_cents: 1100, match_status: 'confirmed' }]; m.choices.mockResolvedValue(['one', 'two', 'three', 'four'].map(itemGuid => ({ itemGuid, name: 'Original', priceCents: 1000 }))); const view = await loadToastLinkChoices(actor, menuId, shopId); expect(view.status).toBe('linked'); expect(view.choices).toEqual([]); expect(view.linked.map(x => x.guid)).toEqual(['three', 'four']); });
it('query failure is not empty', async () => { m.db.mockReturnValue({ from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: 'offline' } }) }; return q; } }); await expect(loadToastLinkChoices(actor, menuId, shopId)).rejects.toThrow('offline'); });
it('rejects malformed identity and shop even for MoO before reads', async () => { await expect(loadToastLinkChoices({ ...actor, level: 8, user: { ...actor.user, role: 'moo' } }, 'bad', 'bad')).rejects.toMatchObject({ code: 'invalid_payload' }); expect(m.db).not.toHaveBeenCalled(); });
it('binds active shop/menu/map and paginates scoped item-lane mappings', async () => { await loadToastLinkChoices(actor, menuId, shopId); expect(filters).toEqual(expect.arrayContaining([['menu_items', 'id', menuId], ['menu_items', 'active', true], ['locations', 'id', shopId], ['locations', 'active', true], ['toast_menu_map', 'location_id', shopId], ['toast_menu_map', 'active', true], ['toast_menu_map', 'is_modifier', false]])); expect(calls.filter(t => t === 'toast_menu_map')).toHaveLength(1); });
