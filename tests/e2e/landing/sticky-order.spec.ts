import {test,expect,type Page} from '@playwright/test';

async function clearRailPosition(page:Page) {
  for(let y=1200;y<=3000;y+=100){
    await page.evaluate(y=>window.scrollTo(0,y),y);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(await page.locator('[data-sticky-order]').isVisible())return;
  }
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
}


for(const lang of ['en','es']) for(const height of [667,812]) test(`sticky threshold and consent ${lang} 375x${height}`,async({page})=>{
  await page.setViewportSize({width:375,height});await page.goto(`/?lang=${lang}`);
  await page.evaluate(()=>document.querySelector<HTMLElement>('.landing-v2')!.style.setProperty('--landing-safe-bottom','34px'));
  const bar=page.locator('[data-sticky-order]');
  await expect(bar).toBeHidden();
  expect(await bar.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(bar).toHaveAttribute('inert','');await expect(bar).toHaveAttribute('aria-hidden','true');
  await page.evaluate(()=>window.scrollTo(0,document.querySelector('[data-hero-actions]')!.getBoundingClientRect().bottom+scrollY-1));
  await expect(bar).toBeHidden();
  await page.evaluate(()=>window.scrollBy(0,3));
  const eligibility=await page.evaluate(()=>{
    const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
    const a=rail.getBoundingClientRect();
    const notice=document.querySelector('.landing-v2-consent')!.getBoundingClientRect();
    const top=a.top-notice.height-34;
    const obstructed=[...document.querySelectorAll('[data-landing-photo], [data-landing-placement]')].some(el=>{
      if(rail.contains(el))return false;const b=el.getBoundingClientRect();
      return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(top,b.top))>0;
    });
    return {heroBottom:document.querySelector('[data-hero-actions]')!.getBoundingClientRect().bottom,obstructed};
  });
  expect(eligibility.heroBottom).toBeLessThan(0);
  if(eligibility.obstructed)await expect(bar).toBeHidden();else await expect(bar).toBeVisible();
  await clearRailPosition(page);await expect(bar).toBeVisible();
  const rail=(await bar.boundingBox())!,consent=(await page.locator('.landing-v2-consent').boundingBox())!;
  expect(consent.y+consent.height).toBeLessThanOrEqual(rail.y+1);
  expect(rail.y-consent.y-consent.height).toBeGreaterThanOrEqual(33.9);
  await page.evaluate(()=>window.scrollTo(0,0));await expect(bar).toBeHidden();
});

test('minimization survives reverse scroll, reload and language navigation; restore retains focus',async({page})=>{
  await page.goto('/');await clearRailPosition(page);
  const bar=page.locator('[data-sticky-order]');await expect(bar).toBeVisible();
  const toggle=bar.getByRole('button');await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toBeFocused();
  await expect(bar).toHaveAttribute('data-minimized','true');await expect(bar.getByRole('link')).toHaveCount(2);
  await page.evaluate(()=>window.scrollTo(0,0));await clearRailPosition(page);
  await expect(bar).toHaveAttribute('data-minimized','true');await page.reload();
  await clearRailPosition(page);await expect(bar).toHaveAttribute('data-minimized','true');
  await page.goto('/?lang=es');await clearRailPosition(page);
  await expect(bar).toHaveAttribute('data-minimized','true');await bar.getByRole('button').focus();await page.keyboard.press('Enter');
  await expect(bar).toHaveAttribute('data-minimized','false');await expect(bar.getByRole('button')).toBeFocused();
});

for(const lang of ['en','es']) for(const viewport of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}]) test(`capture sticky ${lang} ${viewport.width}x${viewport.height}`,async({page},info)=>{
  await page.setViewportSize(viewport);await page.goto(`/?lang=${lang}`);
  await page.evaluate(()=>document.fonts.ready);await page.locator('#crave').scrollIntoViewIfNeeded();
  await clearRailPosition(page);
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
  await page.screenshot({path:`tmp/landing-v2/fixround/sticky/${info.project.name}-${lang}-${viewport.width}x${viewport.height}.png`});
  await expect(page.locator('[data-sticky-order]')).toBeVisible();
});

test('storage denial preserves minimize through scroll; safe inset and enlarged text remain usable',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('denied','SecurityError');}}));
  await page.goto('/');await page.evaluate(()=>document.querySelector<HTMLElement>('.landing-v2')!.style.setProperty('--landing-safe-bottom','34px'));
  await clearRailPosition(page);const bar=page.locator('[data-sticky-order]');await expect(bar).toBeVisible();
  await bar.getByRole('button').click();await page.evaluate(()=>window.scrollTo(0,0));await clearRailPosition(page);
  await expect(bar).toHaveAttribute('data-minimized','true');
  const links=await bar.getByRole('link').all();for(const link of links)expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const bottom=await bar.evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom));expect(bottom).toBe(34);
  await page.evaluate(()=>{window.scrollTo(0,0);document.documentElement.style.fontSize='200%';});
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','true');await expect(bar).toBeHidden();
  for(const button of await page.locator('[data-landing-consent] button').all()){await button.focus();await expect(button).toBeFocused();}
});

test('reduced motion is static and pageshow recomputes restored scroll',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await clearRailPosition(page);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  const bar=page.locator('[data-sticky-order]');await expect(bar).toBeVisible();
  expect(await bar.getByRole('link').first().evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.evaluate(()=>{window.scrollTo(0,0);window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await expect(bar).toBeHidden();
});

test('visible rail never intersects real photos or section CTAs during scroll and resize',async({page})=>{
  await page.goto('/');
  for(const width of [375,1440]){
    await page.setViewportSize({width,height:900});
    for(const y of [300,600,850,1100,1400,1800,2300]){
      await page.evaluate(y=>window.scrollTo(0,y),y);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const overlap=await page.evaluate(()=>{
        const rail=document.querySelector<HTMLElement>('[data-sticky-order]')!;
        if(rail.dataset.visible==='false')return false;
        const a=rail.getBoundingClientRect();
        return [...document.querySelectorAll('[data-landing-photo], [data-landing-placement]')].some(el=>{
          if(rail.contains(el))return false;
          const b=el.getBoundingClientRect();
          return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))>0;
        });
      });expect(overlap).toBe(false);
    }
  }
});

test('generated landing stylesheets load and supply fixed rail geometry',async({page})=>{
  await page.goto('/');
  const urls=await page.locator('link[rel="stylesheet"]').evaluateAll(links=>links.map(link=>(link as HTMLLinkElement).href));
  expect(urls.length).toBeGreaterThan(0);
  for(const url of urls){const response=await page.request.get(url);expect(response.status(),url).toBe(200);expect(response.headers()['content-type']).toContain('text/css');}
  expect(await page.locator('[data-sticky-order]').evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
});
