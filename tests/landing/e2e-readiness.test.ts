import {expect,it,vi} from 'vitest';
const path='../../scripts/landing/e2e-readiness.mjs';
it('waits for complete route bodies before declaring the production fixture ready',async()=>{
  const {warmRoutes}=await import(/* @vite-ignore */ path);
  let finish!:()=>void;
  const body=new Promise<void>(resolve=>{finish=resolve;});
  const fetcher=vi.fn().mockResolvedValue({status:200,text:()=>body});
  let ready=false;
  const warming=warmRoutes(['http://localhost:3000/'],fetcher).then(()=>{ready=true;});
  await Promise.resolve(); await Promise.resolve();
  expect(ready).toBe(false);
  finish(); await warming;
  expect(ready).toBe(true);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/',expect.objectContaining({redirect:'manual'}));
});
it('fails startup on a bad route without retrying or swallowing it',async()=>{
  const {warmRoutes}=await import(/* @vite-ignore */ path);
  for(const status of [307,404,500]) {
    const fetcher=vi.fn().mockResolvedValue({status,text:async()=>''});
    await expect(warmRoutes(['http://localhost:3000/'],fetcher)).rejects.toThrow(String(status));
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
