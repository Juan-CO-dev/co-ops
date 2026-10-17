import { afterEach, expect, it, vi } from 'vitest';
import { loadPublicLandingStores } from '@/lib/landing/stores';
import { loadLandingConfig } from '@/lib/landing/config';

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

it.each(['outage','live'] as const)('never advertises a config-inactive shop during %s', async mode=>{
 const config=loadLandingConfig({});
 const disabled={...config,stores:config.stores.map(store=>({...store,active:store.key!=='dupont'}))};
 vi.spyOn(console,'error').mockImplementation(()=>{});
 client.mockReturnValue({from:()=>({select:()=>({eq:()=>({in:query})})})});
 query.mockResolvedValue(mode==='outage'?{data:null,error:{message:'unavailable'}}:{data:[{code:'MEP',active:true},{code:'EM',active:true}],error:null});
 expect((await loadPublicLandingStores(disabled)).map(store=>store.key)).toEqual(['capitol-hill']);
 expect(query).toHaveBeenLastCalledWith('code',['MEP']);
});

it('selects active and rejects a deactivated database row on the loader path', async()=>{
 const select=vi.fn(),eq=vi.fn();
 select.mockReturnValue({eq});eq.mockReturnValue({in:query});
 client.mockReturnValue({from:()=>({select})});
 query.mockResolvedValue({data:[{code:'MEP',active:false},{code:'EM',active:true}],error:null});
 expect((await loadPublicLandingStores()).map(store=>store.key)).toEqual(['dupont']);
 expect(select).toHaveBeenCalledWith('code,name,address,phone,active');
 expect(eq).toHaveBeenCalledWith('active',true);
});
