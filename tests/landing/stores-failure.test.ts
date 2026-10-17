import { afterEach, expect, it, vi } from 'vitest';
import { loadPublicLandingStores } from '@/lib/landing/stores';

const { query, client } = vi.hoisted(() => ({ query: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: client }));
afterEach(() => vi.restoreAllMocks());

it.each(['result', 'rejection', 'client'] as const)('uses verified fallback on %s with one PII-free class/message', async kind => {
  const sensitive = 'private@example.test secret-provider-detail';
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  client.mockImplementation(() => {
    if (kind === 'client') throw new TypeError(sensitive);
    return { from: () => ({ select: () => ({ eq: () => ({ in: query }) }) }) };
  });
  if (kind === 'rejection') query.mockRejectedValue(new Error(sensitive));
  else query.mockResolvedValue({ data: null, error: { message: sensitive } });
  await expect(loadPublicLandingStores()).resolves.toMatchObject([{key:"capitol-hill",phone:"+12026218645"},{key:"dupont",phone:"+12027944638"}]);
  expect(log).toHaveBeenCalledExactlyOnceWith('LandingStoreLoadError: Public shop information unavailable');
});

it("honors successful empty and partial active reads", async () => {
 client.mockReturnValue({from:()=>({select:()=>({eq:()=>({in:query})})})});
 query.mockResolvedValue({data:[],error:null});
 expect(await loadPublicLandingStores()).toEqual([]);
 query.mockResolvedValue({data:[{code:"EM",name:"old",address:null,phone:null}],error:null});
 expect((await loadPublicLandingStores()).map(s=>s.key)).toEqual(["dupont"]);
});
