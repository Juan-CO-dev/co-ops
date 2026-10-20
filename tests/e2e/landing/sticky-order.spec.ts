import {test,expect} from '@playwright/test';
import {landingTenantConfig} from '../../../config/tenant/landing';
import {answerConsent,revealPill} from './helpers/sticky';

// v4.2 (Juan): one slim "Order" pill instead of the two-button bar; nothing else at the bottom.
const pillLocator='[data-sticky-order] .landing-v42-pill';

for(const lang of ['en','es'])test(`consent showing: the bottom chrome is only the notice, never the pill (${lang} 390x844)`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(`/?lang=${lang}`);
  const notice=page.locator('.landing-v2-consent');
  await expect(notice).toHaveAttribute('data-flow','false');
  // The notice is exactly as before: wording plus its four controls.
  await expect(notice.locator(':scope > button[aria-expanded="true"]')).toHaveCount(1);
  await expect(notice.locator('[data-landing-consent] a')).toHaveCount(1);
  await expect(notice.locator('[data-landing-consent] button')).toHaveCount(2);
  const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  for(const y of [0,900,1800,2700,3600,max]){
    await page.evaluate(v=>scrollTo(0,v),y);await page.waitForTimeout(450);
    await expect(page.locator(pillLocator)).toBeHidden();
    const chrome=await page.evaluate(()=>innerHeight-document.querySelector('.landing-v2-consent')!.getBoundingClientRect().top);
    // v3: 176 px (en) / 199 px (es) of bar + notice; v4 compact: ≤ 150; v4.2: the notice alone (97 px measured).
    expect(chrome).toBeLessThanOrEqual(100);
  }
});

for(const lang of ['en','es'])test(`consent answered: only the slim pill when it shows, nothing when hidden (${lang} 390x844)`,async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize({width:390,height:844});await page.goto(`/?lang=${lang}`);
  await expect(page.locator('.landing-v2-consent')).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.locator(pillLocator)).toBeHidden(); // the hero's buttons are on screen
  const pill=await revealPill(page);
  const box=(await pill.boundingBox())!;
  const viewport=page.viewportSize()!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeLessThanOrEqual(52);
  expect(box.width).toBeLessThanOrEqual(viewport.width*.35); // not full width
  expect(Math.round(viewport.width-box.x-box.width)).toBe(16);
  expect(Math.round(viewport.height-box.y-box.height)).toBe(16);
  // The whole bottom chrome: the pill and its 16 px inset (64 px measured), nothing full-width.
  expect(viewport.height-box.y).toBeLessThanOrEqual(68);
  await expect(pill).toHaveText(lang==='en'?'Order':'Pide');
});

test('the pill hides while any in-content order surface is on screen',async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await revealPill(page);
  for(const selector of ['[data-hero-actions]','.landing-v3-plate','.landing-v4-crave-cta','.landing-v4-shop-order','.landing-v4-catering-act','footer']){
    await page.locator(selector).first().evaluate(el=>el.scrollIntoView({block:'center'}));
    await expect(page.locator('[data-sticky-order]'),selector).toHaveAttribute('data-visible','false');
    await expect(page.locator(pillLocator),selector).toBeHidden();
  }
  // Back between surfaces it returns (after its short dwell), with no latch.
  await revealPill(page);
});

test('the pill opens the shop chooser: both shops with street + closing, sticky placement; Escape returns focus',async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.goto('/');
  const pill=await revealPill(page);
  await pill.click();
  const sheet=page.getByRole('dialog',{name:'Pick your shop'});
  await expect(sheet).toBeVisible();
  const links=sheet.locator('a[data-landing-placement="sticky"]');
  await expect(links).toHaveCount(2);
  for(const [index,link] of (await links.all()).entries()){
    const store=landingTenantConfig.stores[index]!;
    await expect(link).toHaveAttribute('href',store.orderUrl);
    await expect(link).toContainText(store.street);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // Open sheet: the pill stays put under it.
  await expect(page.locator('[data-sticky-order]')).toHaveAttribute('data-visible','true');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(pill).toBeFocused();
});

test('short viewport hides the pill and recovers; no storage is written',async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize({width:375,height:812});await page.goto('/');
  const pill=await revealPill(page);
  await page.setViewportSize({width:375,height:450});
  await expect(pill).toBeHidden();
  await page.setViewportSize({width:375,height:812});
  await expect(pill).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key!=='landing_attribution'))).toEqual([]);
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
});

test('reduced motion: the pill appears and hides with no transition',async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  const pill=await revealPill(page);
  expect(await pill.evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('generated landing stylesheets load and keep the pill fixed',async({page})=>{
  await page.goto('/');
  const urls=await page.locator('link[rel="stylesheet"]').evaluateAll(links=>links.map(link=>(link as HTMLLinkElement).href));
  expect(urls.length).toBeGreaterThan(0);
  for(const url of urls){const response=await page.request.get(url);expect(response.status(),url).toBe(200);expect(response.headers()['content-type']).toContain('text/css');}
  expect(await page.locator('[data-sticky-order]').evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
});

test('answering consent removes the notice; it is reachable again from the footer',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await answerConsent(page,'rejected');
  const settings=page.locator('footer [data-privacy-settings]');
  await expect(settings).toHaveText('Privacy settings');
  await expect(settings).toHaveAttribute('aria-expanded','false');
  await settings.scrollIntoViewIfNeeded();await settings.click();
  const notice=page.locator('.landing-v2-consent');
  await expect(notice).toBeVisible();
  await expect(settings).toHaveAttribute('aria-expanded','true');
  await expect(notice.locator(':scope > button')).toBeFocused();
  await expect(page.locator(pillLocator)).toBeHidden();
  // Collapsing it again hands focus back to the footer control.
  await notice.locator(':scope > button').click();
  await expect(notice).toBeHidden();
  await expect(settings).toBeFocused();
});
