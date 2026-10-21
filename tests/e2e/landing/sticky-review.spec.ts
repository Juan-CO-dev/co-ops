import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {pillState,revealPill} from './helpers/sticky';
const require=createRequire(process.cwd()+'/package.json');

// Isolate scroll cost from legitimate hydration/font-driven ResizeObserver work.
async function settleLayout(page:Page){
 // Short windows (landscape phones) get the static crunch story by design; either way it has settled.
 await expect(page.locator('[data-crave-stage]')).toHaveAttribute('data-motion',(page.viewportSize()?.height??812)<500?'false':'true');
 await page.evaluate(async()=>{
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
}

// Invariant (Astra v4.2 review): after the show dwell, at EVERY scroll position exactly one way to
// order is on offer — a usable in-page order control (at least half on screen) OR the pill, never
// both and never neither. Each control counts on its own: a card's heading or ingredients on screen
// is not a way to order. Includes 200% text and landscape phones.
const sweeps=[
  {width:375,height:667,text:1},{width:390,height:844,text:1},{width:390,height:844,text:2},{width:1440,height:900,text:1},
  {width:844,height:390,text:1},{width:667,height:375,text:1},{width:844,height:390,text:2},
] as const;
for(const sweep of sweeps)test(`a scroll sweep always offers exactly one way to order ${sweep.width}x${sweep.height}${sweep.text>1?' at 200% text':''}`,async({page,context,baseURL})=>{
  test.setTimeout(180000);
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize({width:sweep.width,height:sweep.height});await page.goto('/');await settleLayout(page);
  if(sweep.text>1)await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  let shown=0,checked=0;
  for(let y=0;y<=max;y+=Math.round(sweep.height/3)){
    await page.evaluate(v=>scrollTo(0,v),y);
    await page.waitForTimeout(650);
    const state=await pillState(page);
    if(state.visible)shown++;
    if(state.ambiguous)continue;
    checked++;
    expect(state.visible,`y=${y}: pill ${state.visible?'shown':'hidden'} with a usable control ${state.usable?'on':'off'} screen`).toBe(!state.usable);
  }
  expect(checked).toBeGreaterThan(5);
  // It does appear somewhere on the way down (between order controls).
  expect(shown).toBeGreaterThan(0);
});

// Astra (v4.2, BC-051/060): the header's "Catering" link is an outbound order control. In a short
// window or at 200% text the hero's shop buttons sit below the fold while it is on screen; the pill
// must still yield to it after its dwell ("never both").
// (At 100% text a landscape phone shows the hero's shop buttons on the same first screen as the
// header, so this header-only state only exists with enlarged text; the 100% sweeps cover the rest.)
for(const state of [{width:844,height:390,text:2},{width:667,height:375,text:2},{width:390,height:844,text:2}] as const)test(`the header Catering link alone holds the pill back ${state.width}x${state.height}${state.text>1?' at 200% text':''}`,async({page,context,baseURL})=>{
  await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
  await page.setViewportSize({width:state.width,height:state.height});await page.goto('/');await settleLayout(page);
  if(state.text>1)await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  // Park where the header link is fully on screen and every hero shop button is mostly off it.
  const parked=await page.evaluate(()=>{
    const header=document.querySelector('.landing-v2-header [data-landing-placement]')!.getBoundingClientRect();
    const firstHero=Math.min(...[...document.querySelectorAll('[data-hero-actions] [data-landing-placement]')].map(el=>el.getBoundingClientRect().top+scrollY));
    const y=Math.max(0,Math.min(header.top+scrollY,firstHero-innerHeight+20));
    scrollTo(0,y);return {y,headerFits:header.bottom-header.top<=innerHeight};
  });
  expect(parked.headerFits).toBe(true);
  await page.waitForTimeout(900);
  const facts=await page.evaluate(()=>{
    const frac=(el:Element)=>{const b=el.getBoundingClientRect();const w=Math.max(0,Math.min(b.right,innerWidth)-Math.max(b.left,0)),h=Math.max(0,Math.min(b.bottom,innerHeight)-Math.max(b.top,0));return b.width&&b.height?w*h/(b.width*b.height):0;};
    return {header:frac(document.querySelector('.landing-v2-header [data-landing-placement]')!),hero:Math.max(...[...document.querySelectorAll('[data-hero-actions] [data-landing-placement]')].map(frac))};
  });
  // The precondition this test exists for: the header link usable, the hero shop buttons not.
  expect(facts.header).toBeGreaterThanOrEqual(.55);
  expect(facts.hero).toBeLessThan(.5);
  const pill=await pillState(page);
  expect(pill.usable).toBe(true);
  expect(pill.visible).toBe(false);
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

test('footer takes over; reverse scroll and a short window recover without a latch',async({page,context,baseURL})=>{
 await context.addCookies([{name:'landing_consent',value:'rejected',url:baseURL!}]);
 await page.goto('/');
 const pill=await revealPill(page);
 const y=await page.evaluate(()=>scrollY);
 await page.locator('footer').scrollIntoViewIfNeeded();
 await expect(pill).toBeHidden();
 await page.evaluate(v=>scrollTo(0,v),y);
 await expect(pill).toBeVisible();
 // A short window keeps the (compact) pill under the same rule: it shows unless a control is usable.
 await page.setViewportSize({width:375,height:450});
 await expect.poll(async()=>{const state=await pillState(page);return state.ambiguous||state.visible===!state.usable;}).toBe(true);
 await page.setViewportSize({width:375,height:812});
 await expect.poll(async()=>{const state=await pillState(page);return state.ambiguous||state.visible===!state.usable;}).toBe(true);
});
