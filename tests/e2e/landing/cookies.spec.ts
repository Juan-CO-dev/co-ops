import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';
test('valid staff JWT still cannot enter landing staff routes',async ({request})=>{
  const token=await new SignJWT({user_id:'fixture',app_role:'owner',role_level:9,session_id:'fixture',locations:[],role:'authenticated'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(Buffer.from('aa'.repeat(32),'hex'));
  const result=await request.get('/admin',{headers:{cookie:`co_ops_session=${token}`},maxRedirects:0});
  expect(result.status()).toBe(404); expect(result.headers()['set-cookie']).toBeUndefined();
});
test('all three staff cookies stay off landing requests',async ({context,page})=>{
  await context.addCookies(['co_ops_session','co_ops_portal','co_shop'].map(name=>({name,value:'fixture',url:`http://127.0.0.1:${portBase}`,sameSite:'Lax' as const})));
  const seen:string[]=[];
  page.on('request',r=>{if(new URL(r.url()).hostname==='localhost') seen.push(r.headers().cookie??'');});
  await page.goto('/');
  expect(seen.length).toBeGreaterThan(0); expect(seen.every(c=>!c.includes('co_ops_')&&!c.includes('co_shop'))).toBe(true);
  expect((await context.cookies(`http://localhost:${portBase}`)).some(c=>c.name.startsWith('co_ops_')||c.name==='co_shop')).toBe(false);
});
