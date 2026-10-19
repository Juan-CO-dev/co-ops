import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import {test,expect,type Page} from '@playwright/test';
import {createServer,request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';

async function isolateMeta(page:Page) {
  const requests:string[]=[];
  page.on('request',request=>{if(/facebook\.net|facebook\.com/.test(request.url()))requests.push(request.url());});
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* Deliberately offline: inspect the real queued Pixel contract. */'}));
  await page.route('https://www.facebook.com/**',route=>route.fulfill({status:204}));
  return requests;
}

test('lineup native order click sends Pixel, CAPI request and independent counter', async ({page}) => {
  await isolateMeta(page);
  const events: Record<string,unknown>[] = [], counters: Record<string,unknown>[] = [];
  await page.route('**/api/landing/events', route => { events.push(route.request().postDataJSON()); return route.fulfill({status:204}); });
  await page.route('**/api/landing/order-click', route => { counters.push(route.request().postDataJSON()); return route.fulfill({status:204}); });
  await page.goto('/');
  await page.locator('[data-landing-consent]').getByRole('button').first().click();
  const link = page.locator('#hero').getByRole('link', {name:'Order Capitol Hill'});
  // Preserve the document for queued-pixel inspection; React's real click handler runs.
  await link.evaluate(el => el.addEventListener('click', event => event.preventDefault()));
  await link.click();
  await expect.poll(() => events.length).toBe(1);
  await expect.poll(() => counters.length).toBe(1);
  expect(events[0]).toMatchObject({event_name:'OrderClick',placement:'hero',store:'capitol-hill'});
  expect(counters[0]).toEqual({store:'capitol-hill',ad:'unattributed'});
  const queued = await page.evaluate(() => window.fbq?.queue?.find(args => args[1] === 'OrderClick'));
  expect(queued).toEqual(['trackCustom','OrderClick',{ad:'unattributed',placement:'hero',store:'capitol-hill'},{eventID:events[0]?.event_id}]);
});

test('selecting a fighter and opening the sheet are silent; the sheet link counts once as lineup', async ({page}) => {
  await isolateMeta(page);
  const events: Record<string,unknown>[] = [], counters: Record<string,unknown>[] = [];
  await page.route('**/api/landing/events', route => { events.push(route.request().postDataJSON()); return route.fulfill({status:204}); });
  await page.route('**/api/landing/order-click', route => { counters.push(route.request().postDataJSON()); return route.fulfill({status:204}); });
  await page.goto('/');
  await page.locator('[data-landing-consent]').getByRole('button').first().click();
  await page.locator('#lineup').scrollIntoViewIfNeeded();
  await page.locator('[data-lineup] button',{hasText:'The Frex'}).click();
  await page.getByRole('button',{name:'Order The Frex'}).click();
  const link = page.getByRole('dialog').getByRole('link',{name:'Order Dupont'});
  await expect(link).toBeVisible();
  await page.waitForTimeout(500);
  expect(events).toEqual([]);expect(counters).toEqual([]);
  await link.evaluate(el => el.addEventListener('click', event => event.preventDefault()));
  await link.click();
  await expect.poll(() => events.length).toBe(1);
  await expect.poll(() => counters.length).toBe(1);
  expect(events[0]).toMatchObject({event_name:'OrderClick',placement:'lineup',store:'dupont'});
  expect(counters[0]).toEqual({store:'dupont',ad:'unattributed'});
});

test('no Meta or attribution persistence before consent; equal keyboard consent choices',async({page})=>{
  const requests=await isolateMeta(page);
  await page.goto('/?ad=subsim-photo&fbclid=Valid_123&email=must-not-persist@example.com');
  const notice=page.locator('[data-landing-consent]'); await expect(notice).toBeVisible();
  expect(requests).toEqual([]);
  expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();
  const reject=notice.getByRole('button').nth(1); await reject.focus(); await page.keyboard.press('Enter');
  await expect(notice).toBeHidden(); expect(requests).toEqual([]);
  expect(await page.evaluate(()=>document.cookie)).toContain('landing_consent=rejected');
});

for(const signal of ['dnt','gpc'])test(`${signal} overrides accepted consent and clears marketing storage`,async({page,context})=>{
  await context.addCookies([{name:'landing_consent',value:'accepted',url:`http://localhost:${portBase}`}]);
  await page.addInitScript(kind=>{const key=kind==='dnt'?'doNotTrack':'globalPrivacyControl';Object.defineProperty(Navigator.prototype,key,{get:()=>kind==='dnt'?'1':true,configurable:true});sessionStorage.setItem('landing_attribution','{"ad":"subsim-photo","utm":{}}');},signal);
  const requests=await isolateMeta(page); await page.goto('/?ad=subsim-photo');
  await expect(page.locator('main')).toBeVisible();
  await expect.poll(()=>page.evaluate(kind=>kind==='dnt'?navigator.doNotTrack:(navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl,signal)).toBe(signal==='dnt'?'1':true);
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();
  expect(requests).toEqual([]); await expect(page.locator('#landing-meta-pixel')).toHaveCount(0);
});

test('accept initializes once and withdrawal prevents subsequent sends',async({page})=>{
  const requests=await isolateMeta(page); await page.goto('/?ad=subsim-photo&fbclid=Valid_123&email=must-not-leak@example.com#private');
  await page.locator('[data-landing-consent]').getByRole('button').first().click();
  await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
  await expect.poll(()=>requests.filter(url=>url.includes('fbevents.js')).length).toBe(1);
  expect(page.url()).not.toContain('email');expect(page.url()).not.toContain('#private');
  expect(new URL(page.url()).searchParams.get('fbclid')).toBe('Valid_123');
  const stored=await page.evaluate(()=>sessionStorage.getItem('landing_attribution'));expect(stored).toContain('Valid_123');expect(stored).not.toContain('email');
  expect(await page.evaluate(()=>window.fbq?.queue?.filter(args=>args[1]==='PageView').length)).toBe(1);
  await page.locator('aside').filter({has:page.locator('button[aria-expanded]')}).getByRole('button').first().click();
  await page.locator('[data-landing-consent]').getByRole('button').nth(1).click();
  expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();
  expect(await page.evaluate(()=>window.fbq?.queue?.at(-1))).toEqual(['consent','revoke']);
  expect(new URL(page.url()).searchParams.has('fbclid')).toBe(false);
});

test('secondary first-screen catering preserves CateringClick at hero placement',async({page})=>{
  await isolateMeta(page);
  const events:Record<string,unknown>[]=[];
  await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.goto('/');await page.locator('[data-landing-consent]').getByRole('button').first().click();
  const link=page.locator('header .landing-v2-catering-link');
  await link.evaluate(el=>el.addEventListener('click',event=>event.preventDefault()));
  await link.click();await expect.poll(()=>events.length).toBe(1);
  expect(events[0]).toMatchObject({event_name:'CateringClick',placement:'hero'});
});


test('registry lookup starts after consent, precedes Pixel, and admits a new code',async({page})=>{
 await isolateMeta(page);
 const events:Record<string,unknown>[]=[],counters:Record<string,unknown>[]=[];
 await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
 await page.route('**/api/landing/order-click',route=>{counters.push(route.request().postDataJSON());return route.fulfill({status:204});});
 let release:()=>void=()=>{}; const gate=new Promise<void>(resolve=>{release=resolve;}); let lookups=0;
 await page.route('**/api/landing/ad-code',async route=>{lookups++;expect(route.request().postDataJSON()).toEqual({candidate:'campaign-new'});await gate;await route.fulfill({json:{ad:'campaign-new'}});});
 await page.goto('/?ad=campaign-new&fbclid=Captured_Click&email=private@example.com');
 expect(lookups).toBe(0);expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();
 await page.locator('[data-landing-consent]').getByRole('button').first().click();
 await expect.poll(()=>lookups).toBe(1);expect(await page.evaluate(()=>!!window.fbq)).toBe(false);
 await page.locator('a[href$="catering-inquiry"]').evaluate(el=>{el.addEventListener('click',event=>event.preventDefault());(el as HTMLAnchorElement).click();});
 expect(events).toEqual([]);expect(counters).toEqual([]);
 expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();release();
 await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
 const stored=JSON.parse((await page.evaluate(()=>sessionStorage.getItem('landing_attribution')))!);
 expect(stored).toMatchObject({ad:'campaign-new',utm:{},fbclid:'Captured_Click'});
 expect(page.url()).not.toContain('email');
 await expect.poll(()=>events.length).toBe(1);expect(counters).toEqual([]);
 expect(events[0]).toMatchObject({event_name:'Lead',ad:'campaign-new',fbc:`fb.1.${stored.capturedAt}.Captured_Click`});
 const queued=await page.evaluate(()=>window.fbq?.queue?.filter(args=>args[1]==='Lead'));
 expect(queued).toHaveLength(1);expect(queued?.[0]?.[3]).toEqual({eventID:events[0]?.event_id});
});

test('withdrawal during registry lookup cannot persist attribution or initialize Pixel',async({page})=>{
 await isolateMeta(page);let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let started=false;
 const sends:string[]=[];
 await page.route(/\/api\/landing\/(events|order-click)$/,route=>{sends.push(route.request().url());return route.fulfill({status:204});});
 await page.route('**/api/landing/ad-code',async route=>{started=true;await gate;await route.fulfill({json:{ad:'campaign-new'}});});
 await page.goto('/?ad=campaign-new');await page.locator('[data-landing-consent]').getByRole('button').first().click();
 await expect.poll(()=>started).toBe(true);
 await page.locator('a[href$="catering-inquiry"]').evaluate(el=>{el.addEventListener('click',event=>event.preventDefault());(el as HTMLAnchorElement).click();});
 await page.locator('aside').filter({has:page.locator('button[aria-expanded]')}).getByRole('button').first().click();
 await page.locator('[data-landing-consent]').getByRole('button').nth(1).click();release();await page.waitForTimeout(1100);
 expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();expect(await page.evaluate(()=>!!window.fbq)).toBe(false);
 expect(sends).toEqual([]);
});

test('restored retired code is revalidated and lookup outage preserves native navigation',async({page,context})=>{
 await isolateMeta(page);await context.addCookies([{name:'landing_consent',value:'accepted',url:`http://localhost:${portBase}`}]);
 await page.addInitScript(()=>sessionStorage.setItem('landing_attribution',JSON.stringify({ad:'retired-code',utm:{}})));
 let candidate:unknown;await page.route('**/api/landing/ad-code',route=>{candidate=route.request().postDataJSON();return route.fulfill({status:503});});
 await page.goto('/');await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
 expect(candidate).toEqual({candidate:'retired-code'});expect(JSON.parse((await page.evaluate(()=>sessionStorage.getItem('landing_attribution')))! ).ad).toBe('unattributed');
 await page.route('https://complimentsonlysubs.appfront.app/**',route=>route.fulfill({body:'Native ordering'}));
 await page.getByRole('link',{name:'Order Capitol Hill',exact:true}).first().click();await expect(page).toHaveURL(/appfront/);
});

// Observe receipt at the HTTP server: browser response listeners can disappear on unload.
test('native navigation during held lookup delivers exactly one unattributed server event and counter',async({page,context,browserName})=>{
 // Linux WebKit (Playwright WPE) delivers a departing page's beacons unreliably: one of two
 // (CI f8771b21 / 699787f9), none, or a truncated empty body (CI bf4aae79). There, delivery is
 // best-effort: no duplicates, and every post that parses must be the valid one. Every other
 // engine must deliver both. Real iOS Safari: device gate.
 const oneBeaconEngine=browserName==='webkit'&&process.platform==='linux';
 const received:{path:string;body:Record<string,unknown>;status:number}[]=[];
 const meta:string[]=[];
 context.on('request',request=>{if(/facebook\.net|facebook\.com/.test(request.url()))meta.push(request.url());});
 let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let started=false;
 // Test-only reverse proxy models TLS termination for the HTTPS-configured Next
 // fixture. Analytics are forwarded, never fulfilled through browser routing.
 const relay=createServer(async(req,res)=>{
   const path=new URL(req.url!, 'http://localhost').pathname;
   if(path==='/api/landing/ad-code') {
     started=true;await gate;res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ad":"campaign-new"}');return;
   }
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const body=Buffer.concat(chunks);
   const headers={...req.headers,host:`localhost:${portBase}`};
   if(headers.origin)headers.origin=`https://localhost:${portBase}`;
   const upstream=httpRequest({hostname:'localhost',port:portBase,path:req.url,method:req.method,headers},response=>{
     if(['/api/landing/events','/api/landing/order-click'].includes(path)){let parsed:Record<string,unknown>|null=null;try{parsed=JSON.parse(body.toString());}catch{parsed=null;}received.push({path,body:parsed as Record<string,unknown>,status:response.statusCode!});}
     res.writeHead(response.statusCode!,response.headers);response.pipe(res);
   });
   upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end(body);
 });
 await new Promise<void>(resolve=>relay.listen(0,'127.0.0.1',resolve));
 const origin=`http://localhost:${(relay.address() as AddressInfo).port}`;
 // Context-level destination interception survives the source document's unload.
 await context.route('https://complimentsonlysubs.appfront.app/**',route=>route.fulfill({contentType:'text/html',body:'Native ordering destination'}));
 try {
   await page.goto(`${origin}/?ad=campaign-new&fbclid=Captured_Click`);
   await expect(page.locator('[data-landing-consent]')).toBeVisible();
   expect(started).toBe(false);expect(received).toEqual([]);
   await page.locator('[data-landing-consent]').getByRole('button').first().evaluate(el=>(el as HTMLButtonElement).click());
   await expect.poll(()=>started).toBe(true);
   // Returning-visitor first-party cookies, present at click time. Written after consent:
   // the provider clears marketing cookies while consent is unset (WebKit hydrates later).
   await page.evaluate(()=>{document.cookie='_fbc=fb.1.1730000000000.Cookie_Click; path=/';document.cookie='_fbp=fb.1.1730000000000.456; path=/';});
   // Native same-tab link: no preventDefault, no href replacement.
   expect(await page.locator('#hero').getByRole('link',{name:'Order Capitol Hill'}).evaluate(el=>{
     const pixel=!!window.fbq;(el as HTMLAnchorElement).click();return pixel;
   })).toBe(false);
   await expect(page).toHaveURL(/appfront/);
   if(!oneBeaconEngine)await expect.poll(()=>received.length).toBe(2);
   if(!oneBeaconEngine)expect(received.filter(item=>item.path==='/api/landing/events')).toEqual([{path:'/api/landing/events',status:204,body:expect.objectContaining({event_name:'OrderClick',ad:'unattributed',fbc:'fb.1.1730000000000.Cookie_Click',fbp:'fb.1.1730000000000.456'})}]);
   if(!oneBeaconEngine)expect(received.filter(item=>item.path==='/api/landing/order-click')).toEqual([{path:'/api/landing/order-click',status:204,body:{store:'capitol-hill',ad:'unattributed'}}]);
   expect(meta).toEqual([]);
   release();await page.waitForTimeout(1100);
   // Re-check after the wait: no duplicates, and every delivered post is the valid one.
   const counters=received.filter(item=>item.path==='/api/landing/order-click');
   const capi=received.filter(item=>item.path==='/api/landing/events');
   expect(counters.length).toBeLessThanOrEqual(1);expect(capi.length).toBeLessThanOrEqual(1);
   if(!oneBeaconEngine){expect(counters).toHaveLength(1);expect(capi).toHaveLength(1);}
   for(const item of counters)if(!(oneBeaconEngine&&item.body===null))expect(item).toEqual({path:'/api/landing/order-click',status:204,body:{store:'capitol-hill',ad:'unattributed'}});
   for(const item of capi)if(!(oneBeaconEngine&&item.body===null))expect(item).toEqual({path:'/api/landing/events',status:204,body:expect.objectContaining({event_name:'OrderClick',ad:'unattributed',fbc:'fb.1.1730000000000.Cookie_Click',fbp:'fb.1.1730000000000.456'})});
   expect(received).toHaveLength(counters.length+capi.length);expect(meta).toEqual([]);
 } finally {
   release();relay.closeAllConnections();await new Promise<void>((resolve,reject)=>relay.close(error=>error?reject(error):resolve()));
 }
});
