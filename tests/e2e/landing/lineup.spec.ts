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
  await page.clock.runFor(5100);
  await expect(page.locator('.landing-v3-plate h3')).toHaveText('The Frex');
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
