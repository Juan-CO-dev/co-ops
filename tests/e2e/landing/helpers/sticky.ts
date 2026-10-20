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
/** Every way to order that is ON the page itself (the pill's own sheet excluded): each control
 * on its own, never its card. Mirrors STATIC_ORDER_CONTROL_SELECTOR + the registered sheet triggers. */
export const ORDER_CONTROLS='[data-hero-actions] [data-landing-placement], [data-order-control], [data-guide-cta][data-ready="true"], #shops [data-landing-placement], .landing-v4-catering-act [data-landing-placement], footer [data-landing-placement]';
/** The pill vs the usable controls at this scroll position. A control is usable when at least half
 * of it is on screen; `ambiguous` = none usable but one sits right at that boundary (±5%). */
export async function pillState(page:Page) {
  return page.evaluate(selector=>{
    const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
    const fractions=[...document.querySelectorAll<HTMLElement>(selector)].filter(el=>!rail.contains(el)&&!el.closest('dialog')).map(el=>{
      const b=el.getBoundingClientRect();if(!b.width||!b.height)return 0;
      const w=Math.max(0,Math.min(b.right,innerWidth)-Math.max(b.left,0)),h=Math.max(0,Math.min(b.bottom,innerHeight)-Math.max(b.top,0));
      return w*h/(b.width*b.height);
    });
    const usable=fractions.some(f=>f>=.55);
    return {visible:rail.dataset.visible==='true',usable,ambiguous:!usable&&fractions.some(f=>f>=.45)};
  },ORDER_CONTROLS);
}
