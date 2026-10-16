import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
for (const state of ['initial','settings open','accepted','rejected','privacy'] as const) test(`landing passes axe WCAG AA at phone width: ${state}`, async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('https://connect.facebook.net/**', route => route.fulfill({contentType:'application/javascript',body:'/* offline axe fixture */'}));
  await page.route('https://www.facebook.com/**', route => route.fulfill({status:204}));
  await page.goto(state === 'privacy' ? '/privacy' : '/');
  const notice = page.locator('[data-landing-consent]');
  if (state === 'accepted' || state === 'settings open') {
    await notice.getByRole('button').first().click();
    await expect(notice).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.cookie)).toContain('landing_consent=accepted');
  } else if (state === 'rejected') {
    await notice.getByRole('button').nth(1).click();
    await expect(notice).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.cookie)).toContain('landing_consent=rejected');
  }
  if (state === 'settings open') {
    await page.locator('aside button[aria-expanded]').click();
    await expect(notice).toBeVisible();
    await expect(page.locator('aside button[aria-expanded]')).toHaveAttribute('aria-expanded','true');
  }
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as {axe:{run(options:unknown):Promise<{violations:unknown[]}>}}).axe;
    return (await axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations;
  });
  expect(violations).toEqual([]);
});
