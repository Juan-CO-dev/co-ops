import {mkdir,writeFile} from 'node:fs/promises';
import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json');

async function reveal(page:Page) {
  const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  for(let y=600;y<=max;y+=120){
    await page.evaluate(y=>scrollTo(0,y),y);
    await page.waitForTimeout(300);
    if(await page.locator('[data-sticky-order]').isVisible())return;
  }
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
}
// Isolate scroll cost from legitimate hydration/font-driven ResizeObserver work.
async function settleLayout(page:Page){
 await expect(page.locator('[data-crave-stage]')).toHaveAttribute('data-motion','true');
 await page.evaluate(async()=>{
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
}
const sweepProfiles=[
  {name:'reading',step:40,interval:150},
  {name:'steady-600',speed:600},
  {name:'steady-1200',speed:1200},
  {name:'fling-2400-decay',speed:2400,fling:true},
];
for(const viewport of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}])test(`representative rail coverage and strict transition spacing ${viewport.width}x${viewport.height}`,async({page},info)=>{
  test.setTimeout(120000);
  await page.setViewportSize(viewport);
  const results=[];
  for(const profile of sweepProfiles){
    await page.goto('/');await settleLayout(page);await page.evaluate(()=>scrollTo(0,0));
    const result=await page.evaluate(async profile=>{
      const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
      const dock=document.querySelector('.landing-v2-consent')!;
      const hero=document.querySelector('[data-hero-actions]')!;
      const footer=document.querySelector('footer .landing-v2-orders')!;
      const rangeStart=hero.getBoundingClientRect().bottom+scrollY;
      const rangeEnd=footer.getBoundingClientRect().top+scrollY-innerHeight;
      const samples:{y:number;now:number;eligible:boolean;visible:boolean;top:number;hint:string|null}[]=[];
      const transitions:{y:number;now:number;visible:boolean}[]=[];
      const record=()=>transitions.push({y:scrollY,now:performance.now(),visible:rail.dataset.visible==='true'});
      const observer=new MutationObserver(records=>{if(records.some(r=>r.attributeName==='data-visible')){
        if(transitions.at(-1)?.visible!==(rail.dataset.visible==='true'))record();
      }});
      record();observer.observe(rail,{attributes:true,attributeFilter:['data-visible']});
      const max=document.documentElement.scrollHeight-innerHeight;
      const start=performance.now();let target=0;
      while(target<max){
        if(profile.speed){
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          const elapsed=(performance.now()-start)/1000;
          // Repeated phone-like flicks: 800 ms linear deceleration, 400 ms rest.
          const phase=Math.min(.8,elapsed%1.2);
          const distance=profile.fling?Math.floor(elapsed/1.2)*profile.speed*.4+profile.speed*(phase-phase*phase/1.6):elapsed*profile.speed;
          target=Math.min(max,distance);
        }
        else {target=Math.min(max,target+profile.step!);await new Promise(resolve=>setTimeout(resolve,profile.interval));}
        scrollTo(0,target);
        samples.push({y:scrollY,now:performance.now(),eligible:hero.getBoundingClientRect().bottom<0&&footer.getBoundingClientRect().top>=innerHeight,visible:rail.dataset.visible==='true',top:dock.getBoundingClientRect().top,hint:rail.querySelector('.landing-v2-sticky-heading')!.textContent});
      }
      await new Promise(resolve=>setTimeout(resolve,500));
      observer.disconnect();
      // Integrate distance so fling rests cannot inflate coverage.
      let visibleDistance=0;
      for(let i=1;i<samples.length;i++){
        const before=samples[i-1]!,after=samples[i]!;
        const distance=Math.max(0,Math.min(after.y,rangeEnd)-Math.max(before.y,rangeStart));
        if(before.visible)visibleDistance+=distance;
      }
      return {profile,samples,transitions:transitions.slice(1),coverage:visibleDistance/(rangeEnd-rangeStart)};
    },profile);
    results.push(result);
  }
  await mkdir('tmp/landing-v2/chunk7',{recursive:true});
  await writeFile(`tmp/landing-v2/chunk7/rail-${info.project.name}-${viewport.width}x${viewport.height}-${info.repeatEachIndex}.json`,JSON.stringify({viewport,results},null,2));
  for(const {profile,coverage,transitions,samples} of results){
    expect.soft(coverage,profile.name).toBeGreaterThanOrEqual(.8);
    expect.soft(transitions.length,profile.name).toBeLessThanOrEqual(4);
    for(let i=1;i<transitions.length;i++){
      expect.soft(transitions[i]!.now-transitions[i-1]!.now,profile.name).toBeGreaterThanOrEqual(400);
      expect.soft(Math.abs(transitions[i]!.y-transitions[i-1]!.y),profile.name).toBeGreaterThanOrEqual(120);
    }
    expect.soft(new Set(samples.map(sample=>sample.top)).size).toBe(1);
    expect.soft(new Set(samples.map(sample=>sample.hint)).size).toBe(1);
  }
});
test('hiding a focused rail returns focus to the visible section heading and visible rail passes axe',async({page})=>{
  await page.goto('/');await reveal(page);
  const bar=page.locator('[data-sticky-order]');

  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  expect(await page.evaluate(async()=>{
    const axe=(window as unknown as {axe:{run(options:unknown):Promise<{violations:unknown[]}>}}).axe;
    return (await axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations;
  })).toEqual([]);
  await bar.getByRole('button').focus();await page.evaluate(()=>scrollTo(0,0));
  await expect(bar).toBeHidden();await expect(page.locator('#hero-title')).toBeFocused();
});
for(const lang of ['en','es'])test(`open and expanded notice suppresses rail; keyboard viewport ${lang}`,async({page})=>{
  await page.setViewportSize({width:375,height:667});await page.goto(`/?lang=${lang}`);
  await expect(page.locator('[data-landing-consent]')).toBeVisible();
  await expect(page.locator('[data-sticky-order]')).toBeHidden();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','true');
  await page.locator('.landing-v2-consent').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-sticky-order]')).toBeHidden();
  await page.setViewportSize({width:375,height:450});await page.evaluate(()=>scrollTo(0,1500));
  await expect(page.locator('[data-sticky-order]')).toBeHidden();
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

test('privacy expansion and collapse returns the rail without scrolling',async({page})=>{
  await page.goto('/');
  const settings=page.locator('.landing-v2-consent > button');
  await settings.click(); // Collapse the initially unset notice.
  await reveal(page);
  const y=await page.evaluate(()=>scrollY);
  await settings.click();
  await expect(page.locator('[data-sticky-order]')).toBeHidden();
  await settings.click();
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
  expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThanOrEqual(1);
 });

test('scroll does not measure or query inline order links',async({page})=>{
  await page.goto('/');await settleLayout(page);
  const counts=await page.evaluate(async()=>{
    const originalRect=Element.prototype.getBoundingClientRect;
    const originalQuery=Element.prototype.querySelectorAll;
    let rects=0,queries=0;
    Element.prototype.getBoundingClientRect=function(){if(this.hasAttribute('data-landing-placement'))rects++;return originalRect.call(this);};
    Element.prototype.querySelectorAll=function(this:Element,selector:string){if(selector.includes('data-landing-placement'))queries++;return originalQuery.call(this,selector);} as typeof originalQuery;
    for(const y of [40,80,120,160]){scrollTo(0,y);await new Promise(resolve=>setTimeout(resolve,100));}
    Element.prototype.getBoundingClientRect=originalRect;Element.prototype.querySelectorAll=originalQuery;
    return {rects,queries};
  });
  expect(counts).toEqual({rects:0,queries:0});
});


test('inline links pass beneath the rail without hiding it or evacuating focus',async({page})=>{
  await page.goto('/');await reveal(page);
  const rail=page.locator('[data-sticky-order]');
  const target=await page.evaluate(()=>{
    const bar=document.querySelector('[data-sticky-order]')!.getBoundingClientRect();
    const link=document.querySelector<HTMLElement>('#field-guide [data-landing-placement]')!;
    return {y:scrollY+link.getBoundingClientRect().top-bar.top-10,heading:'#field-guide-title'};
  });
  await rail.getByRole('button').focus();
  await page.evaluate(y=>scrollTo(0,y),target.y);
  await page.waitForTimeout(500);
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('button')).toBeFocused();
  expect(Math.abs(await page.evaluate(()=>scrollY)-target.y)).toBeLessThanOrEqual(1);
});

test('expanded in-flow privacy notice stops suppressing after it leaves view',async({page})=>{
 await page.setViewportSize({width:375,height:667});await page.goto('/');
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 const notice=page.locator('.landing-v2-consent');
 await notice.locator(':scope > button').click();
 await notice.locator(':scope > button').click();
 await expect(notice).toHaveAttribute('data-expanded','true');
 await expect(notice).toHaveAttribute('data-flow','true');
 await reveal(page);
 await expect(page.locator('[data-sticky-order]')).toBeVisible();
 expect(await notice.evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(0);
});

test('footer takes over; reverse scroll and short viewport recover without a latch',async({page})=>{
 await page.goto('/');await reveal(page);
 const rail=page.locator('[data-sticky-order]');
 await page.locator('footer .landing-v2-orders').scrollIntoViewIfNeeded();
 await expect(rail).toBeHidden();
 await page.evaluate(()=>scrollBy(0,-innerHeight));
 await expect(rail).toBeVisible();
 // Exercise keyboard recovery away from the footer: consent flow changes can
 // legitimately anchor the page and bring the footer into view near the end.
 await page.evaluate(()=>scrollTo(0,1500));
 await expect(rail).toBeVisible();
 await page.setViewportSize({width:375,height:450});
 await expect(rail).toBeHidden();
 await page.setViewportSize({width:375,height:812});
 await expect(rail).toBeVisible();
});
