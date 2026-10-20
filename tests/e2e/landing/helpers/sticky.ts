import {expect,type Page} from '@playwright/test';
/** v4.2: the Order pill shows only where no other order control is on screen and consent is
 * answered. Walk down from the hero until it appears (after its show dwell). */
export async function revealPill(page:Page) {
  await expect(page.locator('.landing-v2-consent')).toBeHidden();
  const pill=page.locator('[data-sticky-order] .landing-v42-pill');
  const start=await page.locator('[data-hero-actions]').evaluate(el=>el.getBoundingClientRect().bottom+scrollY);
  const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  for(let y=start+40;y<=max;y+=120){
    await page.evaluate(v=>scrollTo(0,v),y);
    await page.waitForTimeout(450);
    if(await pill.isVisible())return pill;
  }
  await expect(pill).toBeVisible();
  return pill;
}
/** Answer consent through the notice's own buttons (accept = first, reject = second). */
export async function answerConsent(page:Page,choice:'accepted'|'rejected') {
  await page.locator('[data-landing-consent] button').nth(choice==='accepted'?0:1).click();
  await expect(page.locator('.landing-v2-consent')).toBeHidden();
}
