import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/session';

const h = vi.hoisted(() => ({
  session: vi.fn(), db: vi.fn(), toast: vi.fn(), audit: vi.fn(), step: vi.fn(),
  update: vi.fn(), refresh: vi.fn(), fetch: vi.fn(),
  slots: [] as unknown[], cursor: 0,
}));
vi.mock('@/lib/session', () => ({ requireSession: h.session }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: h.db }));
vi.mock('@/lib/toast/menus', () => ({ fetchToastMenuItems: h.toast, fetchToastModifierOptions: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/admin/step-up', () => ({ assertStepUp: h.step }));
vi.mock('@/lib/menu-item-shop', () => ({ loadLiveMenuItemShopSettings: async () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock('@/lib/i18n/provider', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('@/components/auth/PasswordModal', () => ({ PasswordModal: () => null }));
// Bounded hook harness: execute the real click callback and re-render its report.
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = initial;
    return [h.slots[i], (value: unknown) => {
      h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = { current: initial };
    return h.slots[i];
  },
}));

import * as route from '@/app/api/admin/toast-map/drift/route';
import { ToastApiError } from '@/lib/toast/client';
import { ToastTab } from '@/components/admin/catering/menu/ToastTab';

const locationId = '11111111-1111-4111-8111-111111111111';
const otherShop = '22222222-2222-4222-8222-222222222222';
const actor = (): AuthContext => ({
  user: {
    id: 'manager', name: 'Manager', email: null, emailVerified: false, emailVerifiedAt: null,
    phone: null, role: 'gm', active: true, smsConsent: false, smsConsentAt: null,
    createdAt: '2026-01-01', createdBy: null, lastLoginAt: null, failedLoginCount: 0,
    lockedUntil: null, language: 'en', profileBlurb: null,
  },
  role: 'gm', level: 7, locations: [locationId],
  session: {
    id: 'session', userId: 'manager', tokenHash: 'test-only', authMethod: 'password',
    stepUpUnlocked: false, stepUpUnlockedAt: null, createdAt: '2026-01-01',
    lastActivityAt: '2026-01-01', expiresAt: '2026-01-02', revokedAt: null,
    ipAddress: null, userAgent: null,
  },
});
const mapping = (id = 'missing', modifier = false) => ({
  id, location_id: locationId, menu_item_id: 'menu', item_id: null, package_id: null, sku_id: null,
  toast_item_guid: id, toast_item_name: 'Original item', toast_price_cents: 1000,
  match_status: 'confirmed', match_score: 1, confirmed_at: '2026-01-01',
  is_modifier: modifier, disposition: 'deplete', portion_qty: null, portion_unit: null,
});
let rows: ReturnType<typeof mapping>[];
let updateCount: number;
let locationFound: boolean;
// Stateful offline DB double: enforces the actual conditional update predicates.
function query(table: string) {
  const filters = new Map<string, unknown>();
  let patch: Record<string, unknown> | undefined;
  const result = () => {
    if (table === 'locations') return { data: locationFound ? { id: locationId, toast_restaurant_guid: 'restaurant' } : null, error: null };
    if (table === 'toast_menu_map' && patch) {
      expect(Object.fromEntries(filters)).toEqual({ id: 'missing', active: true, match_status: 'confirmed' });
      const row = rows.find(r => r.id === filters.get('id') && r.match_status === filters.get('match_status'));
      const count = row ? updateCount : 0;
      if (row && count === 1) Object.assign(row, patch);
      return { count, error: null };
    }
    if (table === 'toast_menu_map') return { data: rows.map(r => ({ ...r })), error: null };
    return { data: [], error: null };
  };
  const q = {
    select: (_columns?: string) => q,
    eq: (key: string, value: unknown) => { filters.set(key, value); return q; },
    update: (value: Record<string, unknown>, options: unknown) => { h.update(value, options); patch = value; return q; },
    returns: async () => result(), maybeSingle: async () => result(),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return q;
}
function request(body = JSON.stringify({ locationId }), headers: Record<string, string> = { origin: 'http://localhost' }) {
  return new NextRequest('http://localhost/api/admin/toast-map/drift', { method: 'POST', headers, body });
}
beforeEach(() => {
  vi.clearAllMocks(); h.slots = []; h.cursor = 0;
  rows = [mapping(), mapping('modifier', true)]; updateCount = 1; locationFound = true;
  h.session.mockResolvedValue(actor()); h.db.mockReturnValue({ from: query });
  h.toast.mockResolvedValue([]); h.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('drift POST boundary', () => {
  it('exports only POST, leaving GET unsupported by the route framework', () => {
    expect(Object.keys(route)).toEqual(['POST']);
    expect(h.toast).not.toHaveBeenCalled(); expect(h.db).not.toHaveBeenCalled();
  });
  it.each([
    {}, { origin: 'https://attacker.invalid' }, { origin: 'null' }, { origin: 'not-a-url' },
    { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
  ])('rejects %j before parsing, auth, Toast, DB or audit', async headers => {
    const req = request('{', headers as Record<string, string>);
    const json = vi.spyOn(req, 'json'); const form = vi.spyOn(req, 'formData');
    const response = await route.POST(req);
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'bad_origin' });
    for (const spy of [json, form, h.session, h.toast, h.db, h.audit, h.step]) expect(spy).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', '[]', '"shop"', '{}', '{"locationId":12}', '{"locationId":"bad"}'])('rejects malformed payload %s', async body => {
    const response = await route.POST(request(body));
    expect(response.status).toBe(400);
    expect(h.db).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it('preserves the session gate', async () => {
    h.session.mockResolvedValue(Response.json({ error: 'unauthorized' }, { status: 401 }));
    expect((await route.POST(request())).status).toBe(401);
    expect(h.db).not.toHaveBeenCalled();
  });
  it.each(['level', 'shop'])('refuses invalid %s before I/O', async kind => {
    const ctx = actor();
    if (kind === 'level') ctx.user.role = 'agm'; else ctx.locations = [otherShop];
    h.session.mockResolvedValue(ctx);
    const response = await route.POST(request());
    expect(response.status).toBe(403); expect((await response.json()).code).toBe('forbidden');
    expect(h.db).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it('retains location-not-found and Toast error responses without writes', async () => {
    locationFound = false;
    expect((await route.POST(request())).status).toBe(404);
    locationFound = true; h.toast.mockRejectedValue(new ToastApiError(503, 'unavailable'));
    const response = await route.POST(request());
    expect(response.status).toBe(502); expect((await response.json()).code).toBe('unavailable');
    expect(h.update).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
  });
});

it('returns the report, flips missing confirmed items once, excludes modifiers and requires no step-up', async () => {
  const response = await route.POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).report).toMatchObject({
    missingOnToast: [{ id: 'missing', matchStatus: 'stale' }], priceChanged: [], renamed: [], newOnToast: [], unmappedCo: [],
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith({ match_status: 'stale' }, { count: 'exact' });
  expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'toast_map.stale', resourceId: 'missing', actorId: 'manager' }));
  expect(rows[1]!.match_status).toBe('confirmed');
  expect((await route.POST(request())).status).toBe(200);
  expect(h.update).toHaveBeenCalledOnce(); expect(h.audit).toHaveBeenCalledOnce(); expect(h.step).not.toHaveBeenCalled();
});
it('preserves the conditional no-op report without auditing a transition that did not happen', async () => {
  updateCount = 0;
  const response = await route.POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).report.missingOnToast).toHaveLength(1);
  expect(h.update).toHaveBeenCalledOnce(); expect(h.audit).not.toHaveBeenCalled();
});

type Element = { type: unknown; props: { children?: unknown; onClick?: () => void; d?: unknown } };
function find(node: unknown, predicate: (n: Element) => boolean): Element | undefined {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) { const found = find(child, predicate); if (found) return found; }
    return;
  }
  const element = node as Element;
  return predicate(element) ? element : find(element.props?.children, predicate);
}
it('Check drift posts the shop in JSON, displays its report and refreshes server mappings', async () => {
  const report = { priceChanged: [], renamed: [], missingOnToast: [], newOnToast: [], unmappedCo: [] };
  h.fetch.mockResolvedValue(Response.json({ report })); vi.stubGlobal('fetch', h.fetch);
  const render = () => {
    h.cursor = 0;
    return ToastTab({
      state: { configured: true, locations: [{ id: locationId, name: 'Shop', toastRestaurantGuid: null }], rows: [], entities: [] },
      ezcater: { locations: [], events: [], webhookConfigured: false, apiConfigured: false },
      payments: { defaultConfigured: false, defaultSecretKeyPresent: false, defaultWebhookSecretPresent: false, webhookUrl: null, locations: [], locationNames: {} }, canWrite: false,
    });
  };
  find(render(), n => n.type === 'button' && n.props.children === 'admin.toast.check_drift')!.props.onClick!();
  await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/toast-map/drift', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId }), redirect: 'manual',
  });
  const panel = find(render(), n => n.props?.d !== undefined)!;
  expect(panel.props.d).toEqual(report);
  const content = (panel.type as (props: Element['props']) => unknown)(panel.props);
  expect(find(content, n => n.type === 'p' && n.props.children === 'admin.toast.drift_empty')).toBeDefined();
});
