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
for(const viewport of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}])test(`linear scroll covers 70 percent with no brief transition pairs and stationary consent ${viewport.width}x${viewport.height}`,async({page},info)=>{
  test.setTimeout(120000);
  await page.setViewportSize(viewport);await page.goto('/');
  await page.waitForTimeout(400);
  const samples=await page.evaluate(async()=>{
    const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
    const dock=document.querySelector('.landing-v2-consent')!;
    const samples:{y:number;now:number;eligible:boolean;visible:boolean;top:number;hint:string|null}[]=[];
    const max=document.documentElement.scrollHeight-innerHeight;
    for(let y=0;y<=max;y+=40){
      scrollTo(0,y);await new Promise(resolve=>setTimeout(resolve,100));
      samples.push({y:scrollY,now:performance.now(),eligible:document.querySelector('[data-hero-actions]')!.getBoundingClientRect().bottom<0,visible:rail.dataset.visible==='true',top:dock.getBoundingClientRect().top,hint:rail.querySelector('.landing-v2-sticky-heading')!.textContent});
    }
    return samples;
  });
  const transitions=samples.slice(1).filter((sample,index)=>sample.visible!==samples[index]!.visible);
  const eligible=samples.filter(sample=>sample.eligible);
  const coverage=eligible.filter(sample=>sample.visible).length/eligible.length;
  await mkdir('tmp/landing-v2/chunk6',{recursive:true});
  await writeFile(`tmp/landing-v2/chunk6/rail-${info.project.name}-${viewport.width}x${viewport.height}.json`,JSON.stringify({viewport,coverage,transitions,samples},null,2));
  expect(samples.some(sample=>sample.visible)).toBe(true);
  expect(coverage).toBeGreaterThanOrEqual(.7);
  for(let i=1;i<transitions.length;i++){
    expect(transitions[i]!.now-transitions[i-1]!.now).toBeGreaterThanOrEqual(400);
    expect(Math.abs(transitions[i]!.y-transitions[i-1]!.y)).toBeGreaterThanOrEqual(120);
  }
  expect(new Set(samples.map(sample=>sample.top)).size).toBe(1);
  expect(new Set(samples.map(sample=>sample.hint)).size).toBe(1);
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
  await page.goto('/');await page.waitForTimeout(500);
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
  expect(await page.evaluate(()=>scrollY)).toBe(y);
});

test('scroll does not measure or query inline order links',async({page})=>{
  await page.goto('/');await page.waitForTimeout(500);
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


test('mid-page collision moves rail focus to the section heading without scrolling',async({page})=>{
  await page.goto('/');await reveal(page);
  const rail=page.locator('[data-sticky-order]');
  const target=await page.evaluate(()=>{
    const bar=document.querySelector('[data-sticky-order]')!.getBoundingClientRect();
    const link=document.querySelector<HTMLElement>('#field-guide [data-landing-placement]')!;
    return {y:scrollY+link.getBoundingClientRect().top-bar.top-10,heading:'#field-guide-title'};
  });
  await rail.getByRole('button').focus();
  await page.evaluate(y=>scrollTo(0,y),target.y);
  await expect(rail).toBeHidden();
  await expect(page.locator(target.heading)).toBeFocused();
  expect(Math.abs(await page.evaluate(()=>scrollY)-target.y)).toBeLessThanOrEqual(1);
});
