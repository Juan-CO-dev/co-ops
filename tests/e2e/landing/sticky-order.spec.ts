import {test,expect} from '@playwright/test';
import {landingTenantConfig} from '../../../config/tenant/landing';
import {answerConsent,pillState,revealPill} from './helpers/sticky';

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

test('the pill hides while any in-content order control is on screen',async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await revealPill(page);
  for(const selector of ['[data-hero-actions] [data-landing-placement]','.landing-v3-plate [data-order-control]','.landing-v4-crave-cta [data-order-control]','.landing-v4-shop-order','.landing-v4-catering-act [data-landing-placement]','footer [data-landing-placement]']){
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

for(const part of ['heading peeks in at the bottom','ingredients stay after the button scrolls off'] as const)test(`the fighter card: ${part} — the pill is the way to order until the button itself is on screen`,async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  // A short window for the first case: at 844 px the crunch story's own order button is still on screen there.
  await page.setViewportSize(part==='heading peeks in at the bottom'?{width:390,height:470}:{width:390,height:844});await page.goto('/');
  await revealPill(page);
  const pill=page.locator(pillLocator);
  const button=page.locator('.landing-v3-plate [data-order-control]');
  // Let the nearby sheet triggers finish enhancing (links → button) so nothing shifts under the measurement.
  await button.evaluate(el=>el.scrollIntoView({block:'center'}));
  await expect(page.locator('.landing-v3-plate button[data-order-control]')).toHaveCount(1);
  await expect(page.locator('.landing-v4-crave-cta button[data-order-control]')).toHaveCount(1);
  await expect(pill).toBeHidden();
  if(part==='heading peeks in at the bottom'){
    await page.locator('.landing-v3-plate h3').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight+8));
    expect(await button.evaluate(el=>el.getBoundingClientRect().top>=innerHeight)).toBe(true);
  } else {
    await button.evaluate(el=>scrollTo(0,el.getBoundingClientRect().bottom+scrollY+2));
    expect(await page.locator('.landing-v3-plate [data-stage-ingredients]').evaluate(el=>{const b=el.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight;})).toBe(true);
  }
  await page.waitForTimeout(650);
  // No order control is usable here, so the pill must be on offer (v4.2's card-level target hid it).
  expect((await pillState(page)).usable).toBe(false);
  await expect(pill).toBeVisible();
  // Back on the button itself: hidden at once.
  await button.evaluate(el=>el.scrollIntoView({block:'center'}));
  await expect(pill).toBeHidden();
});

for(const viewport of [{width:844,height:390},{width:667,height:375},{width:375,height:450}])test(`short / landscape ${viewport.width}x${viewport.height}: a compact pill stays, same rules; no storage is written`,async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize(viewport);await page.goto('/');
  const pill=await revealPill(page);
  const box=(await pill.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeLessThanOrEqual(46);
  expect(box.width).toBeLessThanOrEqual(Math.min(viewport.width*.35,140));
  expect(Math.round(viewport.width-box.x-box.width)).toBe(8);
  expect(Math.round(viewport.height-box.y-box.height)).toBe(8);
  // It opens the same chooser.
  await pill.click();
  await expect(page.getByRole('dialog',{name:'Pick your shop'}).locator('a[data-landing-placement="sticky"]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  // Growing back to a tall window: the full pill under the same rule.
  await page.setViewportSize({width:375,height:812});
  await expect.poll(async()=>{const state=await pillState(page);return state.ambiguous||state.visible===!state.usable;}).toBe(true);
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
