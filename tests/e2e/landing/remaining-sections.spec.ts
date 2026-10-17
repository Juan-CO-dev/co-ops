import {test,expect} from '@playwright/test';
import {landingTenantConfig} from '../../../config/tenant/landing';
import {subdexMedia} from '../../../lib/landing/media';

test('remaining sections keep facts, destinations and translation honest',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/?lang=es',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#catering a').first()).toHaveAttribute('href',landingTenantConfig.cateringUrl);
  await expect(page.locator('#catering a').nth(1)).toHaveAttribute('href',landingTenantConfig.inquiryUrl);
  await expect(page.locator('#catering img,#catering form')).toHaveCount(0);
  await expect(page.locator('#footer')).toContainText('526 8th St SE Ste A');
  const footerDestinations=landingTenantConfig.footerLinks.filter(link=>link.key!=='uber-eats').map(link=>link.url).sort();
  expect((await page.locator('#footer nav a').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).sort()).toEqual(footerDestinations);
  const uber=landingTenantConfig.footerLinks.find(link=>link.key==='uber-eats')!;
  await expect(page.locator('#shops a[href="'+uber.url+'"]')).toHaveCount(1);
  await expect(page.locator('[data-shop="dupont"] a[href="'+uber.url+'"]')).toBeVisible();
  await expect(page.locator('#footer a[href="'+uber.url+'"]')).toHaveCount(0);
  await expect(page.locator('#footer a[href^="/privacy"]')).toHaveAttribute('href','/privacy?lang=es');
  await expect(page.locator('#subdex img')).toHaveAttribute('alt','Héroe de píxeles atrapando un sándwich');
  await expect(page.locator('#subdex img')).toHaveAttribute('src',subdexMedia.poster);
});

for(const preference of ['reduce','save-data'] as const)test(`SUBDEX ${preference} retains lazy still without video`,async({page})=>{
  if(preference==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
  else await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
  const requests:string[]=[];page.on('request',request=>{if(request.url().includes(subdexMedia.motion))requests.push(request.url());});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.locator('#subdex').scrollIntoViewIfNeeded();
  await expect(page.locator('#subdex img')).toBeVisible();
  await expect.poll(() => page.locator('#subdex img').evaluate((img:HTMLImageElement) => img.complete && img.naturalWidth === 720)).toBe(true);
  await expect(page.locator('#subdex img')).toHaveAttribute('loading','lazy');
  await expect(page.locator('#subdex video')).toHaveCount(0);expect(requests).toEqual([]);
});

test('SUBDEX rejected playback retains the still in both engines',async({page})=>{
  await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){if(this.closest('[data-testid="subdex-motion"]'))Reflect.set(window,'subdexPlayAttempted',true);return Promise.reject(new DOMException('blocked','NotAllowedError'));};});
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.locator('#subdex').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  await expect(page.locator('#subdex img')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexPlayAttempted'))).toBe(true);
  await expect(page.getByTestId('subdex-motion').locator('video,button')).toHaveCount(0);
  await expect(page.locator('.landing-v2-spin video')).toHaveCount(0);
  await expect(page.locator('.landing-v2-spin button')).toHaveCount(1);
  await expect(page.locator('#subdex button')).toHaveCount(1);
});

test('SUBDEX single muted excerpt pauses by keyboard and on viewport exit',async({page,browserName})=>{
  const decodeUnavailable = browserName === 'webkit' && process.platform !== 'darwin';
 if (decodeUnavailable) await page.addInitScript(() => {
   const paused = new WeakMap<HTMLMediaElement, boolean>();
   Object.defineProperty(HTMLMediaElement.prototype, 'paused', {get() { return paused.get(this) ?? true; }});
   HTMLMediaElement.prototype.play = function () { paused.set(this, false); this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
   HTMLMediaElement.prototype.pause = function () { paused.set(this, true); };
   document.addEventListener('error', event => { if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation(); }, true);
 });
  await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('#subdex video')).toHaveCount(0);
  await page.locator('#subdex').scrollIntoViewIfNeeded();await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  const video=page.locator('#subdex video');await expect(video).toHaveCSS('opacity','1');
  expect(await video.evaluate(v=>(v as HTMLVideoElement).muted)).toBe(true);
  const pause=page.getByRole('button',{name:'Pause the graphics update'});await pause.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Play the graphics update'})).toBeVisible();
  await page.getByRole('button',{name:'Play the graphics update'}).click();await expect(video).toHaveCSS('opacity','1');
  await page.locator('#footer').scrollIntoViewIfNeeded();await expect.poll(()=>video.evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
});
