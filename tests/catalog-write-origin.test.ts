import { readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Explicit inventory: additions require a deliberate read/write classification.
const mutations = {
  'item-type/[id]': 'PATCH',
  'menu-item/[id]/apply': 'POST',
  'menu-item/[id]/shop': 'POST',
  'menu-item/[id]/shop/restore': 'POST',
  'menu-item/[id]/shop/back-to-default': 'POST',
  'recipe/[id]/apply': 'POST',
  'recipe/[id]/back-to-default': 'POST',
  'recipe/[id]/lines': 'POST',
  'recipe/[id]/restore': 'POST',
  'sku/[id]/pack': 'POST',
  'sku/[id]/pack/apply': 'POST',
  'sku/[id]/pack/restore': 'POST',
  'sku/[id]/pack/back-to-default': 'POST',
  'sku/[id]/price': 'POST',
  'sku/[id]/price/apply': 'POST',
  'sku/[id]/price/back-to-default': 'POST',
  'sku/[id]/price-basis': 'POST',
  'sku/[id]/pack-requests/[requestId]/dismiss': 'POST',
  'jobs/new-item': 'POST',
  'jobs/new-sandwich': 'POST',
  'menu-item/[id]/share': 'POST',
  'menu-item/[id]/toast': 'POST',
  'recipe/[id]/share': 'POST',
  'recipe/[id]/notices/dismiss': 'POST',
  'sku/[id]/setup': 'POST',
  'sku/[id]/share': 'POST',
  'sku/[id]/swap': 'POST',
  'swaps/[swapId]/back-to-normal': 'POST',
} as const;
const readOnly = {
  'jobs/new-sandwich/preview': 'POST',
  'menu-item/[id]/preview': 'POST',
  'menu-item/[id]/share/preview': 'POST',
  'recipe/[id]/preview': 'POST',
  'recipe/[id]/share/preview': 'POST',
  'sku/[id]/preview': 'POST',
  'sku/[id]/share/preview': 'POST',
  'sku/[id]/swap/preview': 'POST',
  'swaps/[swapId]/back-to-normal/preview': 'POST',
  'pack-requests/[requestId]/photo': 'GET',
  'pack-requests/[requestId]/additions/[additionId]/photo': 'GET',
} as const;
const mixedReads = { 'sku/[id]/swap': 'GET' } as const;
const mocks = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: mocks.session }));
vi.mock('@/lib/admin/step-up', () => ({ assertStepUp: mocks.step }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: mocks.db }));
const id = '11111111-1111-4111-8111-111111111111';
const params = { params: Promise.resolve({ id, requestId: id, additionId: id, swapId: id }) };
type Handler = (req: NextRequest, context: typeof params) => Promise<Response>;
const load = async (path: string): Promise<Record<string, Handler>> => import(/* @vite-ignore */ `../app/api/admin/catalog/${path}/route`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(Response.json({ code: 'unauthorized' }, { status: 401 }));
  mocks.db.mockImplementation(() => { throw new Error('Unexpected database access'); });
});
it('classifies every route file exactly once and pins 39 files / 40 handlers', async () => {
  const files = readdirSync('app/api/admin/catalog', { recursive: true }).map(String)
    .map(p => p.replaceAll('\\', '/')).filter(p => p === 'route.ts' || p.endsWith('/route.ts')).sort();
  const listed = [...Object.keys(mutations), ...Object.keys(readOnly)];
  expect(new Set(listed).size).toBe(listed.length);
  expect(files).toEqual(listed.map(p => `${p}/route.ts`).sort());
  expect(files).toHaveLength(39);
  expect(Object.keys(mutations)).toHaveLength(28);
  expect(Object.keys(readOnly)).toHaveLength(11);
  let handlers = 0;
  for (const path of listed) {
    const route = await load(path);
    const expected = [mutations[path as keyof typeof mutations] ?? readOnly[path as keyof typeof readOnly], mixedReads[path as keyof typeof mixedReads]].filter(Boolean).sort();
    const actual = Object.keys(route).filter(key => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(key)).sort();
    expect(actual, path).toEqual(expected);
    handlers += actual.length;
  }
  expect(handlers).toBe(40);
});
describe.each(Object.entries(mutations))('%s %s origin boundary', (path, method) => {
  it.each([undefined, 'https://attacker.invalid', 'null', 'not-a-url'])('refuses origin %s before session, body, or database', async origin => {
    const route = await load(path);
    const request = new NextRequest(`http://localhost/api/admin/catalog/${path}`, {
      method, body: '{', headers: origin === undefined ? {} : { origin },
    });
    const body = vi.spyOn(request, 'json');
    const response = await route[method]!(request, params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'bad_origin' });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(mocks.step).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('allows same-origin to reach the existing session gate', async () => {
    const route = await load(path);
    const response = await route[method]!(new NextRequest(`http://localhost/api/admin/catalog/${path}`, {
      method, body: '{}', headers: { origin: 'http://localhost' },
    }), params);
    expect(response.status).toBe(401);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.step).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
describe.each(Object.entries({ ...readOnly, ...mixedReads }))('%s %s read authorization', (path, method) => {
  it('requires a session without an origin or step-up gate', async () => {
    const route = await load(path);
    const response = await route[method]!(new NextRequest(`http://localhost/api/admin/catalog/${path}`, {
      method, ...(method === 'POST' ? { body: '{}' } : {}),
    }), params);
    expect(response.status).toBe(401);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.step).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
