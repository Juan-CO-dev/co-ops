import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {revealPill} from './helpers/sticky';
const require=createRequire(process.cwd()+'/package.json');

// Isolate scroll cost from legitimate hydration/font-driven ResizeObserver work.
async function settleLayout(page:Page){
 await expect(page.locator('[data-crave-stage]')).toHaveAttribute('data-motion','true');
 await page.evaluate(async()=>{
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
}

for(const viewport of [{width:375,height:667},{width:390,height:844},{width:1440,height:900}])test(`a scroll sweep never shows the pill beside another order control ${viewport.width}x${viewport.height}`,async({page,context,baseURL})=>{
  test.setTimeout(90000);
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize(viewport);await page.goto('/');await settleLayout(page);
  const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  let shown=0;
  for(let y=0;y<=max;y+=Math.round(viewport.height/3)){
    await page.evaluate(v=>scrollTo(0,v),y);
    await page.waitForTimeout(500);
    const state=await page.evaluate(()=>{
      const visible=document.querySelector<HTMLElement>('[data-sticky-order]')!.dataset.visible==='true';
      const surfaces=[...document.querySelectorAll<HTMLElement>('[data-hero-actions], .landing-v3-plate, .landing-v4-crave-cta, [data-guide-cta][data-ready="true"], .landing-v4-shop-order, .landing-v4-catering-act, footer')];
      const inView=surfaces.some(el=>{const b=el.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.height>0;});
      return {visible,inView};
    });
    if(state.visible){shown++;expect(state.inView,`y=${y}`).toBe(false);}
  }
  // It does appear somewhere on the way down (between order surfaces).
  expect(shown).toBeGreaterThan(0);
});

test('visible pill and its open sheet pass axe',async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.goto('/');
  const pill=await revealPill(page);
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const run=()=>page.evaluate(async()=>{
    const axe=(window as unknown as {axe:{run(options:unknown):Promise<{violations:unknown[]}>}}).axe;
    return (await axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations;
  });
  expect(await run()).toEqual([]);
  await pill.click();await expect(page.getByRole('dialog',{name:'Pick your shop'})).toBeVisible();
  expect(await run()).toEqual([]);
});

for(const lang of ['en','es'])test(`the consent notice suppresses the pill: docked, in flow at 200% text, keyboard viewport ${lang}`,async({page})=>{
  await page.setViewportSize({width:375,height:667});await page.goto(`/?lang=${lang}`);
  await expect(page.locator('[data-landing-consent]')).toBeVisible();
  await page.evaluate(()=>scrollTo(0,2200));await page.waitForTimeout(500);
  await expect(page.locator('[data-sticky-order] .landing-v42-pill')).toBeHidden();
  // Collapsed but unanswered is still the notice: the pill stays away.
  await page.locator('.landing-v2-consent > button').click();
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-expanded','false');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-sticky-order] .landing-v42-pill')).toBeHidden();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','true');
  await expect(page.locator('[data-sticky-order] .landing-v42-pill')).toBeHidden();
  await page.setViewportSize({width:375,height:450});await page.evaluate(()=>scrollTo(0,1500));
  await expect(page.locator('[data-sticky-order] .landing-v42-pill')).toBeHidden();
});

test('scroll frames do not resolve computed styles for the landing root',async({page})=>{
  await page.goto('/');await settleLayout(page);
  const count=await page.evaluate(async()=>{
    const original=window.getComputedStyle;
    const root=document.querySelector('.landing-v2');let calls=0;
    window.getComputedStyle=function(element,pseudo){if(element===root)calls++;return original.call(window,element,pseudo);};
    for(const y of [40,80,120,160]){scrollTo(0,y);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
    window.getComputedStyle=original;return calls;
  });
  expect(count).toBe(0);
});

test('scroll does not measure or query inline order links',async({page})=>{
  await page.goto('/');await settleLayout(page);
  const counts=await page.evaluate(async()=>{
    const originalRect=Element.prototype.getBoundingClientRect;
    const originalQuery=Element.prototype.querySelectorAll;
    let rects=0,queries=0;
    Element.prototype.getBoundingClientRect=function(){if(this.hasAttribute('data-landing-placement')||this.closest('[data-sticky-order]'))rects++;return originalRect.call(this);};
    Element.prototype.querySelectorAll=function(this:Element,selector:string){if(selector.includes('data-landing-placement')||selector.includes('landing-v3-plate'))queries++;return originalQuery.call(this,selector);} as typeof originalQuery;
    for(const y of [40,800,1600,2400]){scrollTo(0,y);await new Promise(resolve=>setTimeout(resolve,150));}
    Element.prototype.getBoundingClientRect=originalRect;Element.prototype.querySelectorAll=originalQuery;
    return {rects,queries};
  });
  expect(counts).toEqual({rects:0,queries:0});
});

test('footer takes over; reverse scroll and short viewport recover without a latch',async({page,context,baseURL})=>{
 await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
 await page.goto('/');
 const pill=await revealPill(page);
 const y=await page.evaluate(()=>scrollY);
 await page.locator('footer').scrollIntoViewIfNeeded();
 await expect(pill).toBeHidden();
 await page.evaluate(v=>scrollTo(0,v),y);
 await expect(pill).toBeVisible();
 await page.setViewportSize({width:375,height:450});
 await expect(pill).toBeHidden();
 await page.setViewportSize({width:375,height:812});
 await expect(pill).toBeVisible();
});
