import {expect,type Page} from '@playwright/test';
/** Move beyond the hero's release buffer and wait for the real policy dwell. */
export async function clearRailPosition(page:Page) {
  // This attribute is written by consent's mounted measurement effect.
  await expect(page.locator('.landing-v2')).toHaveAttribute('data-consent-flow',/^(true|false)$/);
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const hero=document.querySelector('[data-hero-actions]')!;
    const notice=document.querySelector<HTMLElement>('.landing-v2-consent')!;
    const bottom=Math.max(hero.getBoundingClientRect().bottom,notice.dataset.flow==='true'?notice.getBoundingClientRect().bottom:-Infinity);
    scrollTo(0,scrollY+bottom+160);
  });
  await expect.poll(()=>page.locator('[data-hero-actions]').evaluate(el=>el.getBoundingClientRect().bottom),'hero actions clear the 120px release guard').toBeLessThan(-120);
  await expect.poll(()=>page.locator('.landing-v2-consent').evaluate(el=>el.getAttribute('data-flow')!=='true'||el.getBoundingClientRect().bottom<0),'in-flow consent is fully outside the viewport').toBe(true);
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
}
