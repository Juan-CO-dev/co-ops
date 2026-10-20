import { test, expect } from '@playwright/test';
import { landingTenantConfig } from '../../../config/tenant/landing';
import { spinMedia } from '../../../lib/landing/media';

for (const javaScriptEnabled of [true, false]) test(`select screen roster keeps the full menu with JS ${javaScriptEnabled}`, async ({browser,baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled,viewport:{width:375,height:812},reducedMotion:'reduce'});
  const page = await context.newPage();
  await page.goto(baseURL!);
  const strip = page.locator('[data-lineup]');
  await strip.scrollIntoViewIfNeeded();
  await expect(strip.locator('li')).toHaveCount(10);
  await expect(strip).not.toContainText('Marisa');
  await expect(strip.locator('li').first()).toContainText('Crunchy Boi');
  await expect(page.locator('.landing-v3-plate h3')).toHaveText('Crunchy Boi');
  for (const card of await strip.locator('li').all()) {
    await expect(card.locator('[data-ingredients]')).toContainText('sub roll');
    await card.scrollIntoViewIfNeeded();
    const img = card.locator('img:not(.landing-v3-cursor)');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('loading','lazy');
    expect(await img.getAttribute('src')).not.toContain('/_next/image');
    // Decoded, not just present in markup.
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await expect(page.locator('video')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('select-375.png')});
  await context.close();
});

test('selecting a fighter swaps the stage and the one CTA opens a two-shop sheet', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await page.locator('#lineup').scrollIntoViewIfNeeded();
  const frex = page.locator('[data-lineup] button', {hasText:'The Frex'});
  await frex.click();
  await expect(frex).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.landing-v3-plate h3')).toHaveText('The Frex');
  await expect(page.locator('.landing-v3-stage [data-spin-stage]')).toHaveCount(0);
  const cta = page.getByRole('button',{name:'Order The Frex'});
  await cta.click();
  const sheet = page.getByRole('dialog',{name:'Pick a shop for The Frex'});
  await expect(sheet).toBeVisible();
  const links = sheet.locator('a[data-landing-placement="lineup"]');
  await expect(links).toHaveCount(2);
  for (const [index,link] of (await links.all()).entries()) {
    await expect(link).toHaveAttribute('href',landingTenantConfig.stores[index]!.orderUrl);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(cta).toBeFocused();
});

test('roster auto-advances with a visible pause control and stops for good on a manual pick', async ({page}) => {
  await page.clock.install();
  await page.goto('/');
  await page.locator('[data-lineup]').scrollIntoViewIfNeeded();
  const auto = page.locator('.landing-v3-auto');
  await expect(auto).toHaveAttribute('aria-pressed','true');
  expect((await auto.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The roster must be observed in view before its timer runs: step fake time until it advances.
  await expect.poll(async()=>{await page.clock.runFor(1000);return page.locator('.landing-v3-plate h3').textContent();},{timeout:15000}).toBe('The Frex');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed','false');
  await page.clock.runFor(15000);
  await expect(page.locator('.landing-v3-plate h3')).toHaveText('The Frex');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-lineup] button',{hasText:'Vesuvio'}).click();
  await expect(auto).toHaveAttribute('aria-pressed','false');
  await page.clock.runFor(15000);
  await expect(page.locator('.landing-v3-plate h3')).toContainText('Vesuvio');
});

test('the Crunchy Boi stage is a keyboard-turnable spin with no video and lazy frames', async ({page}) => {
  const frameRequests:string[] = [];
  page.on('request',request=>{if(/crunchy-boi-spin-f\d\d/.test(request.url()))frameRequests.push(request.url());});
  await page.goto('/');
  // Only the lazy front still may load before the stage nears the viewport.
  expect(frameRequests.filter(url=>!/crunchy-boi-spin-f00-/.test(url))).toEqual([]);
  const spin = page.locator('[data-spin-stage]');
  await spin.scrollIntoViewIfNeeded();
  // Hold the roster on the Crunchy Boi while frames load (auto-advance runs every 5 s).
  await page.locator('.landing-v3-auto').click();
  await expect(page.locator('.landing-v3-auto')).toHaveAttribute('aria-pressed','false');
  await expect(spin).toHaveAttribute('data-spin-ready','true');
  await expect(page.getByRole('slider',{name:'Turn the Crunchy Boi'})).toBeVisible();
  await expect.poll(() => frameRequests.length).toBe(spinMedia.frames.length);
  const slider = page.getByRole('slider',{name:'Turn the Crunchy Boi'});
  await slider.focus();
  // Focus can scroll the page (WebKit), and scroll turns the spin: let it settle first.
  await expect.poll(async()=>{const a=await page.evaluate(()=>scrollY);await page.waitForTimeout(150);return a===await page.evaluate(()=>scrollY);}).toBe(true);
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow','0');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow','8');
  await expect(page.locator('video')).toHaveCount(0);
});

test('reduced motion keeps the front still, never autoplays, never loads the turntable', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const frameRequests:string[] = [];
  page.on('request',request=>{if(/crunchy-boi-spin-f(?!00)\d\d/.test(request.url()))frameRequests.push(request.url());});
  await page.goto('/');
  await page.locator('[data-spin-stage]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-spin-stage]')).toHaveAttribute('role','img');
  await expect(page.locator('[data-spin-stage]')).toHaveAttribute('aria-label','Crunchy Boi sub');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.locator('.landing-v3-auto')).toHaveAttribute('aria-pressed','false');
  await page.waitForTimeout(500);
  expect(frameRequests).toEqual([]);
});

test('without JavaScript every menu is visible and each shop is a native order link', async ({browser,baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:812}});
  const page = await context.newPage();
  await page.goto(baseURL!);
  const select = page.locator('.landing-v3-select');
  await select.scrollIntoViewIfNeeded();
  for (const card of await select.locator('[data-lineup] li').all()) await expect(card.locator('[data-ingredients]')).toBeVisible();
  const links = select.locator('.landing-v3-direct-orders a[data-landing-placement="lineup"]');
  await expect(links).toHaveCount(2);
  for (const [index,link] of (await links.all()).entries()) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href',landingTenantConfig.stores[index]!.orderUrl);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(select.locator('.landing-v3-auto')).toBeHidden();
  await context.close();
});

test('Save-Data gets the static screen: no auto-advance, no turntable frames', async ({page}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
  const frameRequests:string[] = [];
  page.on('request',request=>{if(/crunchy-boi-spin-f(?!00)\d\d/.test(request.url()))frameRequests.push(request.url());});
  await page.clock.install();
  await page.goto('/');
  await page.locator('[data-spin-stage]').scrollIntoViewIfNeeded();
  await expect(page.locator('.landing-v3-select')).toHaveAttribute('data-calm','true');
  await expect(page.locator('.landing-v3-auto')).toHaveAttribute('aria-pressed','false');
  await page.clock.runFor(15000);
  await expect(page.locator('.landing-v3-plate h3')).toHaveText('Crunchy Boi');
  await expect(page.locator('[data-spin-stage]')).toHaveAttribute('role','img');
  expect(frameRequests).toEqual([]);
});

test('dragging the Crunchy Boi sideways turns it', async ({page}) => {
  test.skip(test.info().project.name==='iphone-webkit','Playwright cannot synthesize a touch drag; desktop engines cover pointer drag, the physical-device checklist covers touch.');
  await page.goto('/');
  const spin = page.locator('[data-spin-stage]');
  await spin.scrollIntoViewIfNeeded();
  await page.locator('.landing-v3-auto').click();
  await expect(spin).toHaveAttribute('data-spin-ready','true');
  const slider = page.getByRole('slider',{name:'Turn the Crunchy Boi'});
  await expect.poll(async()=>{const a=await page.evaluate(()=>scrollY);await page.waitForTimeout(150);return a===await page.evaluate(()=>scrollY);}).toBe(true);
  const before = Number(await slider.getAttribute('aria-valuenow'));
  const box = (await spin.boundingBox())!;
  await page.mouse.move(box.x+box.width*.7,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height/2,{steps:8});
  await page.mouse.up();
  await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).not.toBe(before);
});

test('keyboard users can walk the roster and select with Enter', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  const first = page.locator('[data-lineup] button').first();
  await first.scrollIntoViewIfNeeded();
  await first.focus();
  await page.keyboard.press('Tab');
  const second = page.locator('[data-lineup] button').nth(1);
  await expect(second).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.landing-v3-plate h3')).toHaveText('The Frex');
  // Tab through to the last card: the strip scrolls it into view, the page width holds.
  const cards = page.locator('[data-lineup] button');
  const count = await cards.count();
  for (let i = 2; i < count; i++) await page.keyboard.press('Tab');
  await expect(cards.last()).toBeFocused();
  await expect.poll(() => cards.last().evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
});

test('Save-Data keeps the Field Guide static with every line shown', async ({page}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
  await page.goto('/');
  const guide = page.locator('.landing-v3-guide');
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveAttribute('data-guide-mode','static');
  await expect(guide.locator('[data-line][data-state="shown"]')).toHaveCount(6);
  await expect(page.locator('.landing-v2')).toHaveAttribute('data-calm','true');
});

test('turning on reduced motion mid-visit switches the Field Guide and roster to static', async ({page}) => {
  await page.goto('/');
  const guide = page.locator('.landing-v3-guide');
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(guide).toHaveAttribute('data-guide-mode','static');
  await expect(guide.locator('[data-line][data-state="shown"]')).toHaveCount(6);
  await expect(page.locator('.landing-v3-select')).toHaveAttribute('data-calm','true');
  await expect(page.locator('.landing-v3-auto')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.landing-v2')).toHaveAttribute('data-calm','true');
});

test('tapping the order action makes P1 hop onto it (decorative, CSS only, none under reduced motion); the sheet keeps the spin turning', async ({page}) => {
  await page.goto('/');
  await page.locator('.landing-v3-auto').click();
  const cta = page.locator('.landing-v3-plate').getByRole('button',{name:'Order Crunchy Boi'});
  await cta.scrollIntoViewIfNeeded();
  await cta.click();
  await expect(cta).toHaveAttribute('data-hop','');
  expect(await cta.evaluate(el=>getComputedStyle(el,'::after').backgroundImage)).toContain('pixel-p1-jump');
  const sheet = page.getByRole('dialog',{name:'Pick a shop for Crunchy Boi'});
  const spin = sheet.locator('[data-spin-stage]');
  await expect(spin).toHaveAttribute('aria-hidden','true');
  await expect(spin).toHaveAttribute('data-spin-ready','true');
  // Two shop links, each naming its street (and today's close when the shop opens today).
  await expect(sheet.locator('a[data-landing-placement="lineup"] [data-order-detail]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});
  await cta.click();
  expect(await cta.evaluate(el=>getComputedStyle(el,'::after').content)).toBe('none');
  await expect(sheet.locator('[data-spin-stage]')).toHaveAttribute('data-spin-ready','false');
});

/** Hold the page's idle callbacks so a test can fire enhancement at an exact moment. */
async function holdIdle(page:import('@playwright/test').Page) {
  await page.addInitScript(()=>{
    const queue:IdleRequestCallback[]=[];
    (window as unknown as {__idle:IdleRequestCallback[]}).__idle=queue;
    window.requestIdleCallback=((callback:IdleRequestCallback)=>{queue.push(callback);return queue.length;}) as typeof window.requestIdleCallback;
    window.cancelIdleCallback=()=>{};
  });
}
const runIdle=(page:import('@playwright/test').Page)=>page.evaluate(()=>{const queue=(window as unknown as {__idle:IdleRequestCallback[]}).__idle.splice(0);for(const callback of queue)callback({didTimeout:false,timeRemaining:()=>50});return queue.length;});
async function countOrders(page:import('@playwright/test').Page) {
  const orders:string[]=[];
  await page.route('https://complimentsonlysubs.appfront.app/**',route=>{orders.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<h1>Ordering destination fixture</h1>'});});
  return orders;
}
/** The select screen's own fallback links: readiness is bound to THIS sheet's enhancement state. */
const lineupFallback=(page:import('@playwright/test').Page)=>page.locator('.landing-v3-select .landing-v3-direct-orders');
/** Consent accepted, Meta offline; records every counter / CAPI post the network receives (context
 * level, survives the unload), and — written through to localStorage at call time, so no engine's
 * unload behaviour can hide or add one — every Pixel OrderClick and every counter / CAPI post the
 * page ISSUES (sendBeacon accepted, or fetch). */
async function measureOrders(context:import('@playwright/test').BrowserContext) {
  const counters:Record<string,unknown>[]=[],capi:Record<string,unknown>[]=[];
  await context.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* offline */'}));
  await context.route('https://www.facebook.com/**',route=>route.fulfill({status:204}));
  await context.route('**/api/landing/order-click',route=>{counters.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await context.route('**/api/landing/events',route=>{capi.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await context.addInitScript(()=>{
    const issue=(url:unknown,body:unknown)=>{
      const path=String(url).replace(/^https?:\/\/[^/]+/,'');
      if(path!=='/api/landing/order-click'&&path!=='/api/landing/events')return;
      const list=JSON.parse(localStorage.getItem('__issued')??'[]');list.push({path,body:typeof body==='string'?JSON.parse(body):null});localStorage.setItem('__issued',JSON.stringify(list));
    };
    // The tracker posts a JSON string wrapped in one Blob part: keep that text to read it back.
    const texts=new WeakMap<Blob,string>();
    const NativeBlob=window.Blob;
    window.Blob=class extends NativeBlob{constructor(parts?:BlobPart[],options?:BlobPropertyBag){super(parts,options);if(parts?.length===1&&typeof parts[0]==='string')texts.set(this,parts[0]);}};
    const beacon=navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=(url,data)=>{const accepted=beacon(url,data);if(accepted)issue(url,typeof data==='string'?data:data instanceof NativeBlob?texts.get(data):undefined);return accepted;};
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{issue(input instanceof Request?input.url:input,init?.body);return nativeFetch(input,init);};
    let real:unknown;
    Object.defineProperty(window,'fbq',{configurable:true,get:()=>real,set(value){
      real=typeof value==='function'?new Proxy(value,{apply(target,self,args){
        if(args[0]==='trackCustom'&&args[1]==='OrderClick'){const list=JSON.parse(localStorage.getItem('__pixel_orders')??'[]');list.push({params:args[2],id:args[3]?.eventID});localStorage.setItem('__pixel_orders',JSON.stringify(list));}
        return Reflect.apply(target,self,args);
      }}):value;
    }});
  });
  return {counters,capi};
}
async function acceptConsent(page:import('@playwright/test').Page) {
  await page.locator('[data-landing-consent]').getByRole('button').first().click();
  await expect.poll(()=>page.evaluate(()=>typeof window.fbq)).toBe('function');
}
/** Exactly one counter post, one CAPI OrderClick and one Pixel OrderClick per tap, the Meta pair
 * sharing its event id — asserted on what the page ISSUED, on every project, and on what the
 * network RECEIVED wherever the engine delivers a departing page's posts. */
async function expectOneOrderEvent(page:import('@playwright/test').Page,baseURL:string,sent:{counters:Record<string,unknown>[];capi:Record<string,unknown>[]},browserName:string) {
  await page.waitForTimeout(800);
  await page.goto(baseURL);
  const pixel=await page.evaluate(()=>JSON.parse(localStorage.getItem('__pixel_orders')??'[]') as {params:Record<string,string>;id:string}[]);
  expect(pixel).toHaveLength(1);
  expect(pixel[0]!.params).toMatchObject({placement:'lineup',store:'capitol-hill',item:'crunchy-boi'});
  const issued=await page.evaluate(()=>JSON.parse(localStorage.getItem('__issued')??'[]') as {path:string;body:Record<string,unknown>|null}[]);
  expect(issued.filter(post=>post.path==='/api/landing/order-click').map(post=>post.body)).toEqual([{store:'capitol-hill',ad:'unattributed'}]);
  const issuedEvents=issued.filter(post=>post.path==='/api/landing/events').map(post=>post.body);
  expect(issuedEvents).toHaveLength(1);
  expect(issuedEvents[0]).toMatchObject({event_name:'OrderClick',placement:'lineup',store:'capitol-hill',item:'crunchy-boi',event_id:pixel[0]!.id});
  // Delivery. The one narrow exception: Playwright's Linux WebKit (WPE) drops one of a departing
  // page's two beacons at random — an engine defect documented in tracking.spec, not ours. The
  // ISSUED pair above is still asserted exactly one of each there; only this network read is skipped.
  if(browserName==='webkit'&&process.platform==='linux')return;
  expect(sent.counters).toEqual([{store:'capitol-hill',ad:'unattributed'}]);
  const delivered=sent.capi.filter(event=>event.event_name==='OrderClick');
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({placement:'lineup',store:'capitol-hill',item:'crunchy-boi',event_id:pixel[0]!.id});
}

test('a press on a native shop link survives enhancement arriving mid-gesture (mouse; navigates and counts exactly once)',async({page,context,baseURL,browserName})=>{
  await holdIdle(page);
  const orders=await countOrders(page);
  const sent=await measureOrders(context);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await acceptConsent(page);
  const fallback=lineupFallback(page);
  const link=fallback.locator('a[data-landing-placement="lineup"]').first();
  await link.scrollIntoViewIfNeeded();
  // Near the viewport: THIS sheet's swap to the button is queued for idle.
  await expect(fallback).toHaveAttribute('data-enhance','pending');
  const box=(await link.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  try { await page.mouse.down(); } catch { test.skip(true,'This engine has no mouse press; the touch variant covers the gesture.'); }
  // Isolate the POINTER guard: Chromium also focuses a pressed link, and the keyboard-focus
  // guard would hold the swap on its own. The click still lands on the same link.
  await link.evaluate(el=>(el as HTMLElement).blur());
  // Enhancement fires between the press and the click: the link must stay under the pointer.
  expect(await runIdle(page)).toBeGreaterThan(0);
  await expect(fallback).toHaveAttribute('data-enhance','held');
  await page.waitForTimeout(150);
  await expect(link).toBeAttached();
  await expect(page.locator('.landing-v3-select .landing-v3-cta')).toHaveCount(0);
  await page.mouse.up();
  await expect(page).toHaveURL(landingTenantConfig.stores[0]!.orderUrl);
  expect(orders).toHaveLength(1);
  await expectOneOrderEvent(page,baseURL!,sent,browserName);
  expect(orders).toHaveLength(1);
});

test('a touch on a native shop link survives enhancement arriving mid-gesture (touch; navigates and counts exactly once)',async({browser,baseURL,browserName})=>{
  test.skip(browserName!=='chromium','Trusted split touch start/end needs the Chromium protocol; WebKit runs the mouse variant.');
  const context=await browser.newContext({baseURL,hasTouch:true,isMobile:true,viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();
  await holdIdle(page);
  const orders=await countOrders(page);
  const sent=await measureOrders(context);
  await page.goto('/');
  await acceptConsent(page);
  const fallback=lineupFallback(page);
  const link=fallback.locator('a[data-landing-placement="lineup"]').first();
  await link.scrollIntoViewIfNeeded();
  await expect(fallback).toHaveAttribute('data-enhance','pending');
  const box=(await link.boundingBox())!;
  const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  expect(await runIdle(page)).toBeGreaterThan(0);
  await expect(fallback).toHaveAttribute('data-enhance','held');
  await page.waitForTimeout(150);
  await expect(link).toBeAttached();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page).toHaveURL(landingTenantConfig.stores[0]!.orderUrl);
  expect(orders).toHaveLength(1);
  await expectOneOrderEvent(page,baseURL!,sent,browserName);
  expect(orders).toHaveLength(1);
  await context.close();
});

/** Press a link (synthetic pointerdown), fire THIS sheet's queued enhancement, prove it is held. */
async function holdWithPress(page:import('@playwright/test').Page) {
  await holdIdle(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  const fallback=lineupFallback(page);
  const link=fallback.locator('a[data-landing-placement="lineup"]').first();
  await link.scrollIntoViewIfNeeded();
  await expect(fallback).toHaveAttribute('data-enhance','pending');
  await link.dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',isPrimary:true});
  await runIdle(page);
  await expect(fallback).toHaveAttribute('data-enhance','held');
  await page.waitForTimeout(150);
  await expect(link).toBeAttached();
  await expect(page.locator('.landing-v3-select .landing-v3-cta')).toHaveCount(0);
  return link;
}

const lineupButton=(page:import('@playwright/test').Page)=>page.locator('.landing-v3-select .landing-v3-cta');
/** Released promptly: no idle callback or timer runs after the event, so a short window proves it. */
const PROMPT={timeout:500};

test('no timer releases a press: a press that never ends keeps its links, however long',async({page})=>{
  const link=await holdWithPress(page);
  await page.waitForTimeout(3000);
  await expect(lineupFallback(page)).toHaveAttribute('data-enhance','held');
  await expect(link).toBeAttached();
  await expect(lineupButton(page)).toHaveCount(0);
});

const releases:Record<string,(page:import('@playwright/test').Page)=>Promise<unknown>>={
  'pointercancel':page=>page.evaluate(()=>dispatchEvent(new PointerEvent('pointercancel',{pointerId:7,pointerType:'touch',isPrimary:true}))),
  'the page hidden':page=>page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'));}),
  'a window blur':page=>page.evaluate(()=>dispatchEvent(new FocusEvent('blur'))),
  // The next sign of life after a press that never reported its end:
  'the page shown again':page=>page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'));}),
  'a press elsewhere':page=>page.evaluate(()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{pointerId:8,pointerType:'touch',isPrimary:true,bubbles:true}))),
  'a release elsewhere':page=>page.evaluate(()=>document.body.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,pointerType:'touch',isPrimary:true,bubbles:true}))),
  'a page scroll':page=>page.evaluate(()=>scrollBy(0,2)),
  'focus moving elsewhere':page=>page.evaluate(()=>document.querySelector<HTMLElement>('.landing-v3-auto')!.focus({preventScroll:true})),
};
for(const [name,fire] of Object.entries(releases))test(`a held press is released promptly by ${name} on its own, and enhancement completes`,async({page})=>{
  await holdWithPress(page);
  await fire(page);
  await expect(lineupButton(page)).toHaveCount(1,PROMPT);
  await expect(lineupFallback(page)).toHaveCount(0);
  await page.evaluate(()=>{delete (document as unknown as {visibilityState?:string}).visibilityState;});
});

test('lostpointercapture ends the press at once; the links wait for its click, which navigates exactly once',async({page})=>{
  const orders=await countOrders(page);
  const link=await holdWithPress(page);
  await link.dispatchEvent('lostpointercapture',{pointerId:7,pointerType:'touch',isPrimary:true});
  // The press is over (no longer held), but a touch's click FOLLOWS its lostpointercapture, so
  // the link stays until that click has been dispatched.
  await expect(lineupFallback(page)).toHaveAttribute('data-enhance','ending',PROMPT);
  await expect(link).toBeAttached();
  await link.dispatchEvent('click');
  await expect(page).toHaveURL(landingTenantConfig.stores[0]!.orderUrl);
  expect(orders).toHaveLength(1);
});

test('lostpointercapture with no click after it: the next sign of life completes enhancement',async({page})=>{
  const link=await holdWithPress(page);
  await link.dispatchEvent('lostpointercapture',{pointerId:7,pointerType:'touch',isPrimary:true});
  await expect(lineupFallback(page)).toHaveAttribute('data-enhance','ending',PROMPT);
  await page.waitForTimeout(1000);
  await expect(link).toBeAttached();
  await page.evaluate(()=>scrollBy(0,2));
  await expect(lineupButton(page)).toHaveCount(1,PROMPT);
});

test('a long press (2.5 s) with enhancement arriving mid-press navigates exactly once (one counter, one CAPI, one Pixel)',async({page,context,baseURL,browserName})=>{
  await holdIdle(page);
  const orders=await countOrders(page);
  const sent=await measureOrders(context);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await acceptConsent(page);
  const fallback=lineupFallback(page);
  const link=fallback.locator('a[data-landing-placement="lineup"]').first();
  await link.scrollIntoViewIfNeeded();
  await expect(fallback).toHaveAttribute('data-enhance','pending');
  const box=(await link.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  try { await page.mouse.down(); } catch { test.skip(true,'This engine has no mouse press (iPhone WebKit); a touch long press there opens the system link preview, not a navigation.'); }
  // Isolate the pointer guard from the keyboard-focus guard (Chromium focuses a pressed link).
  await link.evaluate(el=>(el as HTMLElement).blur());
  expect(await runIdle(page)).toBeGreaterThan(0);
  await expect(fallback).toHaveAttribute('data-enhance','held');
  await page.waitForTimeout(2500);
  await expect(link).toBeAttached();
  await expect(lineupButton(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(page).toHaveURL(landingTenantConfig.stores[0]!.orderUrl);
  expect(orders).toHaveLength(1);
  await expectOneOrderEvent(page,baseURL!,sent,browserName);
  expect(orders).toHaveLength(1);
});
