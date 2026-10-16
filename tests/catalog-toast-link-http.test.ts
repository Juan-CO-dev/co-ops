import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), step: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: m.session }));
vi.mock('@/lib/catalog/toast-link', () => ({ loadToastLinkChoices: m.load }));
vi.mock('@/lib/admin/step-up', () => ({ assertStepUp: m.step }));
import * as route from '../app/api/admin/catalog/menu-item/[id]/toast/route';
const id = '11111111-1111-4111-8111-111111111111', shop = '22222222-2222-4222-8222-222222222222';
const actor = { level: 7, user: { role: 'gm', language: 'en' }, locations: [shop] };
const call = (query = `location=${shop}`) => (route as unknown as {
    GET: Function;
}).GET(new NextRequest(`http://localhost/api/admin/catalog/menu-item/${id}/toast?${query}`), { params: Promise.resolve({ id }) });
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(actor); m.load.mockResolvedValue({ status: 'empty' }); });
it('GET uses explicit selected location with no origin or step-up', async () => { const response = await call(); expect(await response.json()).toEqual({ status: 'empty' }); expect(m.load).toHaveBeenCalledWith(actor, id, shop); expect(m.step).not.toHaveBeenCalled(); });
it('requires valid location', async () => { expect((await call('')).status).toBe(400); expect(m.load).not.toHaveBeenCalled(); });
it('requires session', async () => { m.session.mockResolvedValue(new Response(null, { status: 401 })); expect((await call()).status).toBe(401); expect(m.load).not.toHaveBeenCalled(); });
it('refuses SMM', async () => { m.session.mockResolvedValue({ ...actor, user: { role: 'social_media_mgr', language: 'en' } }); expect((await call()).status).toBe(403); expect(m.load).not.toHaveBeenCalled(); });
