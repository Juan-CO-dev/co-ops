import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { POST as create } from '@/app/api/admin/marketing/ad-codes/route';
import { POST as retire } from '@/app/api/admin/marketing/ad-codes/[code]/retire/route';
import { requireSession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { getServiceRoleClient } from '@/lib/supabase-server';
import { createAdCodeResolver } from '@/lib/landing/ad-codes-server';
import { adCodeCopy, adCodeRefusal } from '@/lib/marketing/ad-code-copy';
import { AdCodesClient } from '@/app/admin/marketing/ad-codes/AdCodesClient';
import { loadAdCodes } from '@/lib/marketing/ad-codes';
import type { AuthContext } from '@/lib/session';
import { proxy } from '@/proxy';

vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/admin/StepUpProvider', () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
vi.mock('@/components/admin/useStepUpPost', () => ({ useStepUpPost: () => vi.fn() }));
const rpc = vi.fn();
const ctx = (role = 'owner', fresh = true, unlocked = true) => ({ user: { id: 'actor', role, language: 'en' }, session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: fresh ? new Date().toISOString() : null } }) as AuthContext;
function req(origin = 'https://staff.example.test', body: unknown = { code: 'campaign-new' }) {
  return new NextRequest('https://staff.example.test/api/admin/marketing/ad-codes', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const retireCode = () => retire(req(), { params: Promise.resolve({ code: 'campaign-new' }) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('MARKETING_SCORECARD', '1');
  vi.mocked(requireSession).mockResolvedValue(ctx());
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as never);
  rpc.mockResolvedValue({ data: 2, error: null });
});
afterEach(() => vi.unstubAllEnvs());

it('refuses origin before session and roles before database work', async () => {
  expect((await create(req('https://other.example.test'))).status).toBe(403);
  expect((await retire(req('https://other.example.test'), { params: Promise.resolve({ code: 'campaign-new' }) })).status).toBe(403);
  expect(requireSession).not.toHaveBeenCalled();
  vi.mocked(requireSession).mockResolvedValue(ctx('gm'));
  expect((await create(req())).status).toBe(403); expect((await retireCode()).status).toBe(403);
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
it('uses Tier A for create and fresh Tier B for retire', async () => {
  vi.mocked(requireSession).mockResolvedValue(ctx('owner', false));
  expect((await create(req())).status).toBe(201);
  expect((await retireCode()).status).toBe(403);
  vi.mocked(requireSession).mockResolvedValue(ctx('owner', true, false));
  expect((await create(req())).status).toBe(403);
  vi.mocked(requireSession).mockResolvedValue(ctx());
  expect((await retireCode()).status).toBe(200);
});
it('ships OFF without touching the database', async () => {
  vi.stubEnv('MARKETING_SCORECARD', '0');
  expect((await create(req())).status).toBe(503); expect((await retireCode()).status).toBe(503);
  expect(await loadAdCodes(ctx())).toEqual({ state: 'not_switched_on', rows: [] });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
it('checks reader role before I/O and treats an absent 0289 as unavailable', async () => {
  await expect(loadAdCodes(ctx('gm'))).rejects.toThrow('role_not_allowed');
  expect(getServiceRoleClient).not.toHaveBeenCalled();
  const limit = vi.fn().mockResolvedValue({ error: { code: '42P01' } });
  const from = vi.fn(() => ({ select: vi.fn(() => ({ limit })) }));
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as never);
  expect(await loadAdCodes(ctx())).toEqual({ state: 'unavailable', rows: [] });
  expect(from).toHaveBeenCalledTimes(1);
  expect(from).toHaveBeenCalledWith('marketing_milestones');
});
it('keeps every new marketing mutation inaccessible on the production landing host', async () => {
  vi.stubEnv('LANDING_HOSTS', 'complimentsonlyoperations.com');
  vi.stubEnv('SITE_ORIGIN', 'https://complimentsonlyoperations.com');
  vi.stubEnv('STAFF_ORIGIN', 'https://co-ops-ashy.vercel.app');
  vi.stubEnv('VERCEL_ENV', 'production');
  for (const path of ['milestones', 'milestones/record-id/correct', 'entries', 'entries/record-id/correct', 'baseline-snapshot', 'ad-codes', 'ad-codes/campaign-new/retire']) {
    const request = new NextRequest(`https://complimentsonlyoperations.com/api/admin/marketing/${path}`, { method: 'POST', headers: { host: 'complimentsonlyoperations.com' } });
    expect((await proxy(request)).status).toBe(404);
  }
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
it('loads every registry slot beyond the default 1000-row response ceiling', async () => {
  const rows = Array.from({ length: 1024 }, (_, slot) => ({ code: `code-${slot}`, slot, active: true }));
  const range = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
  const from = vi.fn((table: string) => table === 'marketing_milestones'
    ? { select: () => ({ limit: async () => ({ error: null }) }) }
    : { select: () => ({ order: () => ({ range }) }) });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as never);
  const result = await loadAdCodes(ctx());
  expect(result.rows).toHaveLength(1024); expect(range).toHaveBeenCalledTimes(3);
});
it('degrades a rejected database promise to unavailable', async () => {
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => ({ select: () => ({ limit: async () => { throw Error('offline'); } }) }) } as never);
  expect(await loadAdCodes(ctx())).toEqual({ state: 'unavailable', rows: [] });
});
it.each(['42P01', '42883', 'PGRST202'])('maps %s to unavailable without auditing', async code => {
  rpc.mockResolvedValue({ error: { code, message: 'private diagnostic' } });
  const response = await create(req()); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'marketing_unavailable' }); expect(audit).not.toHaveBeenCalled();
});
it.each(['code_invalid', 'code_reserved', 'code_taken', 'slots_exhausted', 'code_not_found', 'already_retired', 'actor_not_allowed'])('maps %s without auditing a refusal', async message => {
  rpc.mockResolvedValue({ error: { code: 'P0001', message } });
  expect(await (await retireCode()).json()).toMatchObject({ code: message }); expect(audit).not.toHaveBeenCalled();
  for (const language of ['en', 'es'] as const) expect(adCodeRefusal(language, message)).not.toBe(adCodeCopy[language].error);
});
it('writes only through the reviewed RPC and audits after success', async () => {
  expect((await create(req())).status).toBe(201);
  expect(rpc).toHaveBeenCalledWith('landing_ad_code_create', { p_actor: 'actor', p_code: 'campaign-new' });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'landing_ad_code.create', metadata: { code: 'campaign-new', slot: 2 } }));
  expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(audit).mock.invocationCallOrder[0]!);
  await retireCode();
  expect(rpc).toHaveBeenLastCalledWith('landing_ad_code_retire', { p_actor: 'actor', p_code: 'campaign-new' });
  expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'landing_ad_code.retire', metadata: { code: 'campaign-new' } }));
});
it('a retired registry entry resolves to unattributed on the next request', async () => {
  let active = true;
  const lookup = async () => active;
  expect(await createAdCodeResolver(lookup)('campaign-new')).toBe('campaign-new');
  rpc.mockImplementation(async () => { active = false; return { error: null }; });
  await retireCode();
  expect(await createAdCodeResolver(lookup)('campaign-new')).toBe('unattributed');
});
it('renders bilingual active/retired registry without retirement for reserved or retired codes', () => {
  expect(Object.keys(adCodeCopy.en).sort()).toEqual(Object.keys(adCodeCopy.es).sort());
  for (const language of ['en', 'es'] as const) {
    const html = renderToStaticMarkup(createElement(AdCodesClient, { language, rows: [{ code: 'unattributed', slot: 0, active: true }, { code: 'old-code', slot: 1, active: false }, { code: 'new-code', slot: 2, active: true }] }));
    expect(html).toContain(adCodeCopy[language].retired); expect(html).toContain(adCodeCopy[language].add);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).toContain('break-all'); expect(html).toContain('min-h-11');
  }
});
