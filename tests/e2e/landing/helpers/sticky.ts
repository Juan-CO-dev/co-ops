import {expect,type Page} from '@playwright/test';
/** Jump to measured gaps, then wait for real eligibility; never force visibility. */
export async function clearRailPosition(page:Page) {
  await page.evaluate(()=>scrollTo(0,0));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const candidates=await page.evaluate(()=>{
    const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
    const a=rail.getBoundingClientRect();
    const max=document.documentElement.scrollHeight-innerHeight;
    const blocked=[...document.querySelectorAll('[data-landing-placement]')].filter(el=>!rail.contains(el)).map(el=>el.getBoundingClientRect()).filter(b=>b.right>a.left&&b.left<a.right).map(b=>({start:b.top+scrollY-a.bottom-120,end:b.bottom+scrollY-a.top+120})).sort((a,b)=>a.start-b.start);
    let from=document.querySelector('[data-hero-actions]')!.getBoundingClientRect().bottom+scrollY+1;
    const targets:number[]=[];
    for(const interval of blocked){if(interval.start>from)targets.push((from+Math.min(interval.start,max))/2);from=Math.max(from,interval.end);}
    if(from<max)targets.push((from+max)/2);
    return targets.filter(y=>y>=0&&y<=max);
  });
  for(const y of candidates){
    await page.evaluate(y=>scrollTo(0,y),y);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const clear=await page.evaluate(()=>{
      const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
      const a=rail.getBoundingClientRect();
      return [...document.querySelectorAll('[data-landing-placement]')].every(el=>{
        if(rail.contains(el))return true;
        const b=el.getBoundingClientRect();
        return b.right<=a.left||b.left>=a.right||Math.max(b.top-a.bottom,a.top-b.bottom)>=120;
      });
    });
    if(clear){await page.waitForTimeout(500);if(await page.locator('[data-sticky-order]').isVisible())return;}
  }
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
}
