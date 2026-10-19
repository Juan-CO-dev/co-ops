import { expect, it, vi } from 'vitest';
import { createAdCodeResolver, handleAdCode, SSR_AD_CODE_TIMEOUT_MS } from '@/lib/landing/ad-codes-server';
import { lookupAdCode } from '@/lib/landing/tracking-client';
import { queryAdCandidate, validAdCandidate } from '@/lib/landing/ad-codes-shared';
const env={LANDING_HOSTS:'eat.example.test',SITE_ORIGIN:'https://eat.example.test',STAFF_ORIGIN:'https://staff.example.test'};
const request=(body:unknown={candidate:'campaign-new'},headers:Record<string,string>={})=>new Request(`${env.SITE_ORIGIN}/api/landing/ad-code`,{method:'POST',headers:{host:'eat.example.test',origin:env.SITE_ORIGIN,cookie:'landing_consent=accepted','content-type':'application/json',...headers},body:JSON.stringify(body)});
it.each([['refused',429],['unavailable',503]] as const)('honors WAF %s before lookup',async(state,status)=>{
 const resolve=vi.fn();const response=await handleAdCode(request(),{env:{...env,LANDING_WAF_STATE:state},resolve});
 expect(response.status).toBe(status);expect(resolve).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store');
});
it('SSR timeout is 300 ms with abort and fallback; default CAPI budget stays 750 ms',async()=>{
 vi.useFakeTimers();
 try {
  expect(SSR_AD_CODE_TIMEOUT_MS).toBe(300);
  let signal:AbortSignal|undefined;
  const lookup=vi.fn((_candidate:string,s:AbortSignal)=>{signal=s;return new Promise<boolean>(()=>{});});
  const result=createAdCodeResolver(lookup,SSR_AD_CODE_TIMEOUT_MS)('new-code');
  await vi.advanceTimersByTimeAsync(299);expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(await result).toBe('unattributed');expect(signal?.aborted).toBe(true);
  const normal=createAdCodeResolver(lookup)('new-code');await vi.advanceTimersByTimeAsync(300);expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(450);expect(await normal).toBe('unattributed');
 } finally {vi.useRealTimers();}
});
it('accepts opaque bounded campaign/send syntax, never identities or ambiguous query keys',()=>{
 for(const code of ['a','a'.repeat(64),'campaign-2026','send_oct_18',...Array.from({length:12},(_,i)=>`family-${i}`)]) expect(validAdCandidate(code)).toBe(true);
 for(const code of ['',null,'a'.repeat(65),'PERSON','person@example.com','a b','a/b','-bad','code\n','code\r','code\r\n']) expect(validAdCandidate(code)).toBe(false);
 expect(queryAdCandidate('?ad=one&ad=two')).toBeUndefined();
});
it('reuses one bounded read within a request and never caches retirement across requests',async()=>{
 let active=true; const lookup=vi.fn(async()=>active); const resolve=createAdCodeResolver(lookup);
 expect(await Promise.all([resolve('new-code'),resolve('new-code')])).toEqual(['new-code','new-code']); expect(lookup).toHaveBeenCalledTimes(1);
 active=false; expect(await createAdCodeResolver(lookup)('new-code')).toBe('unattributed');
 expect(await resolve('person@example.com')).toBe('unattributed'); expect(lookup).toHaveBeenCalledTimes(2);
});
it('degrades missing table, provider failure and bounded timeout without exposing diagnostics',async()=>{
 for(const lookup of [async()=>false,async()=>{throw Error('private provider details');},()=>new Promise<boolean>(()=>{})]) {
  expect(await createAdCodeResolver(lookup,10)('new-code')).toBe('unattributed');
 }
});
it('returns only the exact accepted code, supports new codes without a rebuild, and never lists the registry',async()=>{
 const resolve=vi.fn(async(value:unknown)=>String(value));
 for(const candidate of ['new-campaign','send-october',...Array.from({length:12},(_,i)=>`family-${i}`)]) {
  const response=await handleAdCode(request({candidate}),{env,resolve});
  expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(await response.json()).toEqual({ad:candidate});
 }
 expect(await (await handleAdCode(request(),{env,resolve:async()=>{throw Error('private');}})).json()).toEqual({ad:'unattributed'});
});
it('guards before registry access: consent, privacy signals, host/origin, exact body and size',async()=>{
 const resolve=vi.fn(async()=> 'new-code');
 for(const headers of [{cookie:''},{cookie:'landing_consent=rejected'},{dnt:'1'},{'sec-gpc':'1'},{host:'staff.example.test'},{origin:'https://evil.test'}] as Record<string,string>[]) expect((await handleAdCode(request(undefined,headers),{env,resolve})).status).toBeGreaterThanOrEqual(400);
 for(const body of [{candidate:'a',extra:true},{candidate:['a','b']},{candidate:'email@example.com'},{candidate:'code\n'},{candidate:'a'.repeat(65)},{}]) expect((await handleAdCode(request(body),{env,resolve})).status).toBe(400);
 expect((await handleAdCode(request({candidate:'a'.repeat(513)}),{env,resolve})).status).toBe(413);
 expect((await handleAdCode(request(undefined,{'content-type':'text/plain'}),{env,resolve})).status).toBe(415);
 expect(resolve).not.toHaveBeenCalled();
});
it('client accepts only its candidate or fallback and never a list, error or substituted code',async()=>{
 for(const body of [{ad:'new-code'},{ad:'another-code'},['new-code'],{ad:'new-code',codes:['secret']},{}]) {
  const send=vi.fn(async()=>Response.json(body)) as unknown as typeof fetch;
  expect(await lookupAdCode('new-code',send)).toBe(JSON.stringify(body)==='{"ad":"new-code"}'?'new-code':'unattributed');
 }
 expect(await lookupAdCode('new-code',vi.fn().mockRejectedValue(Error('offline')))).toBe('unattributed');
});
