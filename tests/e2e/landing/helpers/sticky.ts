import {expect,type Page} from '@playwright/test';
/** Move beyond the hero's release buffer and wait for the real policy dwell. */
export async function clearRailPosition(page:Page) {
  await page.evaluate(()=>scrollTo(0,document.querySelector('[data-hero-actions]')!.getBoundingClientRect().bottom+scrollY+160));
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
}
