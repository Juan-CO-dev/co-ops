import { test, expect } from '@playwright/test';

for (const javaScriptEnabled of [true, false]) test(`lineup is usable with JS ${javaScriptEnabled}`, async ({browser,baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled,viewport:{width:375,height:812},reducedMotion:'reduce'});
  const page = await context.newPage();
  await page.goto(baseURL!);
  const strip = page.locator('[data-lineup]');
  await strip.scrollIntoViewIfNeeded();
  await expect(strip.locator('li')).toHaveCount(10);
  await expect(strip).not.toContainText('Marisa');
  for (const source of await strip.locator('source').all()) {
    await expect(source).toHaveAttribute('sizes','280px');
    await expect(source).toHaveAttribute('srcset', /480w, .*750w/);
  }
  for (const img of await strip.locator('img').all()) {
    await expect(img).toHaveAttribute('loading','lazy');
    expect(await img.getAttribute('src')).not.toContain('/_next/image');
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await strip.locator('li').first().scrollIntoViewIfNeeded();
  await strip.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  // Keyboard movement is pinned above. Reach the end without an actionability
  // stability wait racing native scroll snap in Chromium's JS-disabled context.
  await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect(strip.locator('li').last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await expect(page.locator('#lineup').getByRole('link',{name:'Order Capitol Hill'})).toHaveAttribute('href',/appfront/);
  await page.screenshot({path:test.info().outputPath('lineup-375.png')});
  await context.close();
});
