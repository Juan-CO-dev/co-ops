import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import {test,expect,type Page} from '@playwright/test';

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
  const link = page.locator('#lineup').getByRole('link', {name:'Order Capitol Hill'});
  // Preserve the document for queued-pixel inspection; React's real click handler runs.
  await link.evaluate(el => el.addEventListener('click', event => event.preventDefault()));
  await link.click();
  await expect.poll(() => events.length).toBe(1);
  await expect.poll(() => counters.length).toBe(1);
  expect(events[0]).toMatchObject({event_name:'OrderClick',placement:'lineup',store:'capitol-hill'});
  expect(counters[0]).toEqual({store:'capitol-hill',ad:'unattributed'});
  const queued = await page.evaluate(() => window.fbq?.queue?.find(args => args[1] === 'OrderClick'));
  expect(queued).toEqual(['trackCustom','OrderClick',{ad:'unattributed',placement:'lineup',store:'capitol-hill'},{eventID:events[0]?.event_id}]);
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
 let release:()=>void=()=>{}; const gate=new Promise<void>(resolve=>{release=resolve;}); let lookups=0;
 await page.route('**/api/landing/ad-code',async route=>{lookups++;expect(route.request().postDataJSON()).toEqual({candidate:'campaign-new'});await gate;await route.fulfill({json:{ad:'campaign-new'}});});
 await page.goto('/?ad=campaign-new&email=private@example.com');
 expect(lookups).toBe(0);expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();
 await page.locator('[data-landing-consent]').getByRole('button').first().click();
 await expect.poll(()=>lookups).toBe(1);expect(await page.evaluate(()=>!!window.fbq)).toBe(false);
 expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();release();
 await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
 expect(JSON.parse((await page.evaluate(()=>sessionStorage.getItem('landing_attribution')))!)).toEqual({ad:'campaign-new',utm:{}});
 expect(page.url()).not.toContain('email');
});

test('withdrawal during registry lookup cannot persist attribution or initialize Pixel',async({page})=>{
 await isolateMeta(page);let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let started=false;
 await page.route('**/api/landing/ad-code',async route=>{started=true;await gate;await route.fulfill({json:{ad:'campaign-new'}});});
 await page.goto('/?ad=campaign-new');await page.locator('[data-landing-consent]').getByRole('button').first().click();
 await expect.poll(()=>started).toBe(true);
 await page.locator('aside').filter({has:page.locator('button[aria-expanded]')}).getByRole('button').first().click();
 await page.locator('[data-landing-consent]').getByRole('button').nth(1).click();release();await page.waitForTimeout(1100);
 expect(await page.evaluate(()=>sessionStorage.getItem('landing_attribution'))).toBeNull();expect(await page.evaluate(()=>!!window.fbq)).toBe(false);
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
