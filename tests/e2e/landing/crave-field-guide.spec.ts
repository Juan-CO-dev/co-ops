import {test,expect,type Page} from '@playwright/test';
import en from '../../../lib/i18n/en.json';
import es from '../../../lib/i18n/es.json';
import {mkdir} from 'node:fs/promises';

async function assertGuideGeometry(page:Page) {
  const geometry=await page.locator('#field-guide').evaluate(section=>{
    const area=(a:DOMRect,b:DOMRect)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    const photo=section.querySelector('[data-landing-photo]')!.getBoundingClientRect();
    const labels=[...section.querySelectorAll<HTMLElement>('[data-anatomy-label]')];
    return {
      foodIntersections:[...section.querySelectorAll('[data-anatomy-label],h2,h3,p,figcaption,[data-landing-placement]')].map(el=>area(el.getBoundingClientRect(),photo)),
      labelIntersections:labels.flatMap((el,index)=>labels.slice(index+1).map(other=>({first:el.dataset.anatomyLabel,second:other.dataset.anatomyLabel,area:area(el.getBoundingClientRect(),other.getBoundingClientRect())}))),
      readable:labels.map(el=>{const box=el.getBoundingClientRect();const style=getComputedStyle(el);const range=document.createRange();range.selectNodeContents(el);const textRects=[...range.getClientRects()];return {id:el.dataset.anatomyLabel,visible:style.visibility==='visible'&&style.display!=='none'&&box.width>0&&box.height>0,withinWidth:box.left>=0&&box.right<=innerWidth,unclipped:textRects.length>0&&textRects.every(text=>text.left>=box.left+parseFloat(style.paddingLeft)-1&&text.right<=box.right-parseFloat(style.paddingRight)+1&&text.top>=box.top-1&&text.bottom<=box.bottom+1)};}),
    };
  });
  expect(geometry.foodIntersections.every(area=>area===0)).toBe(true);
  expect(geometry.labelIntersections.filter(pair=>pair.area>0)).toEqual([]);
  expect(geometry.readable.filter(label=>!label.visible||!label.withinWidth||!label.unclipped)).toEqual([]);
}

for(const size of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}])for(const language of ['en','es'] as const)test(`texture waits for scroll and Field Guide keeps food clear (${size.width}x${size.height}; ${language})`,async({page},testInfo)=>{
  await page.setViewportSize(size);
  const textures:string[]=[];
  page.on('request',r=>{if(/v2-(p016|l083)-/.test(r.url()))textures.push(r.url());});
  await page.goto(`/?lang=${language}`);
  await page.waitForLoadState('networkidle');
  expect(textures).toEqual([]);
  const stage=page.locator('[data-crave-stage]');
  // Measure the reserved photo box BEFORE IntersectionObserver attaches its image.
  const beforePhotoHeight=await stage.locator('[data-texture-photo]').first().evaluate(el=>el.getBoundingClientRect().height);
  await stage.scrollIntoViewIfNeeded();
  await expect(stage.locator('img').first()).toBeVisible();
  await expect.poll(()=>stage.locator('img').first().evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
  expect(beforePhotoHeight).toBeGreaterThan(0);
  expect(await stage.locator('[data-texture-photo]').first().evaluate(el=>el.getBoundingClientRect().height)).toBeCloseTo(beforePhotoHeight,1);
  await page.locator('#field-guide').scrollIntoViewIfNeeded();
  await expect(page.locator('#field-guide h3')).toHaveText('Crunchy Boi');
  // v4: no duplicate ingredient paragraph; the six words carry them here.
  await expect(page.locator('[data-field-ingredients]')).toHaveCount(0);
  await expect(page.locator('[data-anatomy-label]')).toHaveCount(6);
  await expect(page.getByRole('group',{name:(language==='en'?en:es)['landing.field-guide.labels']})).toBeVisible();
  const intersections=await page.locator('#field-guide').evaluate(section=>{
    const photo=section.querySelector('[data-landing-photo]')!.getBoundingClientRect();
    return [...section.querySelectorAll('[data-anatomy-label],h3,.landing-v4-guide-cta button,[data-landing-placement]')].map(el=>{
      const b=el.getBoundingClientRect();return Math.max(0,Math.min(b.right,photo.right)-Math.max(b.left,photo.left))*Math.max(0,Math.min(b.bottom,photo.bottom)-Math.max(b.top,photo.top));
    });
  });
  expect(intersections.every(area=>area===0)).toBe(true);
  await assertGuideGeometry(page);
  const guidePhoto=page.locator('#field-guide [data-landing-photo] img');
  await expect(guidePhoto).toHaveCount(1);
  await expect.poll(()=>guidePhoto.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
  await mkdir('tmp/landing-v2/chunk5',{recursive:true});
  await page.locator('#field-guide h3').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
  await page.screenshot({path:`tmp/landing-v2/chunk5/${testInfo.project.name}-${size.width}x${size.height}-${language}-guide.png`});
  await expect(stage).toHaveAttribute('data-active','false');
  const top=await stage.evaluate(el=>el.getBoundingClientRect().top+scrollY);
  const travel=await stage.evaluate(el=>el.getBoundingClientRect().height-innerHeight);
  for(const progress of [0,.25,.5,.75,1]){
    await page.evaluate(({top,travel,progress})=>scrollTo(0,top+travel*progress),{top,travel,progress});
    await page.waitForTimeout(80);
    const overlaps=await page.locator('#crave').evaluate(section=>{
      const photos=[...section.querySelectorAll('[data-texture-photo]')].map(el=>el.getBoundingClientRect());
      return photos.flatMap(photo=>[...section.querySelectorAll('h2,p,button,[data-landing-placement]')].map(el=>{const b=el.getBoundingClientRect();return Math.max(0,Math.min(b.right,photo.right)-Math.max(b.left,photo.left))*Math.max(0,Math.min(b.bottom,photo.bottom)-Math.max(b.top,photo.top));}));
    });
    expect(overlaps.every(area=>area===0)).toBe(true);
    if(progress===0||progress===1){const endpointPhoto=stage.locator('[data-texture-photo]').nth(progress===0?0:1).locator('img');await expect(endpointPhoto).toHaveCount(1);await expect.poll(()=>endpointPhoto.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);}
    if(progress===.5)await page.screenshot({path:`tmp/landing-v2/chunk5/${testInfo.project.name}-${size.width}x${size.height}-${language}-texture.png`});
  }
  // Full-page capture resizes the viewport, which stalls Chromium scroll timelines; take it last.
  await page.screenshot({path:`tmp/landing-v2/chunk5/${testInfo.project.name}-${size.width}x${size.height}-${language}-full.png`,fullPage:true});

});

for(const size of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}])test(`hydration and photo attachment preserve reserved geometry (${size.width}x${size.height})`,async({page})=>{
  await page.setViewportSize(size);
  let releaseScripts!:()=>void;
  const scriptsReady=new Promise<void>(resolve=>{releaseScripts=resolve;});
  await page.route('**/_next/static/**/*.js',async route=>{await scriptsReady;await route.continue();});
  try {
    await page.goto('/',{waitUntil:'commit'});
    const stage=page.locator('[data-crave-stage]');
    await expect(stage).toHaveAttribute('data-motion','pending');
    await expect.poll(()=>stage.evaluate(el=>getComputedStyle(el).marginTop)).toBe('24px');
    // WebKit's FontFaceSet.ready waits for document load, which our held scripts
    // intentionally prevent. Load the CSS font faces directly before measuring.
    const fonts=await stage.evaluate(async el=>{
      // next/font also declares an optional local Arial fallback. CI Linux may
      // not have Arial; loading every declaration incorrectly rejects that case.
      const used=[...new Set([el,...el.querySelectorAll('*')].filter(node=>[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent?.trim())).map(node=>{
        const style=getComputedStyle(node);
        const primary=style.fontFamily.split(',')[0]!.trim();
        return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${primary}`;
      }))];
      const results=await Promise.allSettled(used.map(font=>document.fonts.load(font)));
      return used.map((font,index)=>{
        const result=results[index];
        return {font,loaded:document.fonts.check(font)&&result?.status==='fulfilled'&&result.value.length>0&&result.value.every(face=>face.status==='loaded')};
      });
    });
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter(font=>!font.loaded)).toEqual([]);
    await stage.scrollIntoViewIfNeeded();
    const geometry=()=>stage.evaluate(el=>({stage:el.getBoundingClientRect().height,control:el.querySelector('.landing-v2-crave-control-slot')!.getBoundingClientRect().height,photo:el.querySelector('[data-texture-photo]')!.getBoundingClientRect().height}));
    const before=await geometry();
    const scroll=await page.evaluate(()=>scrollY);
    expect(before.stage).toBeGreaterThan(0);
    expect(before.control).toBeGreaterThanOrEqual(44);
    expect(before.photo).toBeGreaterThan(0);
    await expect(stage.locator('img')).toHaveCount(0);
    releaseScripts();
    await expect(stage).toHaveAttribute('data-motion','true');
    await page.evaluate(y=>scrollTo(0,y),scroll);
    await expect(stage.locator('img').first()).toBeAttached();
    await expect.poll(()=>stage.locator('img').first().evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
    const after=await geometry();
    for(const key of ['stage','control','photo'] as const)expect(Math.abs(after[key]-before[key])).toBeLessThanOrEqual(1);
  } finally {releaseScripts();}
});

for(const language of ['en','es'] as const)test(`no-JS enlarged text has an independent readable legend (${language})`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:false,viewport:{width:1440,height:900}});
  const page=await context.newPage();
  await page.goto(`/?lang=${language}`);
  // Protocol evaluation simulates text enlargement without enabling page JS;
  // addStyleTag's completion event never arrives in the JS-disabled contexts.
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await expect(page.locator('html')).toHaveCSS('font-size','32px');
  await page.locator('#field-guide').scrollIntoViewIfNeeded();
  await assertGuideGeometry(page);
  await context.close();
});

for(const size of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}])for(const language of ['en','es'] as const)test(`enlarged text keeps Field Guide labels readable and food clear (${size.width}x${size.height}; ${language})`,async({page},testInfo)=>{
  await page.setViewportSize(size);
  await page.goto(`/?lang=${language}`);
  const stage=page.locator('[data-crave-stage]');
  await expect(stage).toHaveAttribute('data-motion','true');
  await mkdir('tmp/landing-v2/chunk5',{recursive:true});
  // Text-only 200% enlargement keeps the same viewport and honors the full-photo exclusion contract.
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await page.locator('#field-guide').scrollIntoViewIfNeeded();
  await page.screenshot({path:`tmp/landing-v2/chunk5/${testInfo.project.name}-${size.width}x${size.height}-${language}-guide-text200.png`});
  await assertGuideGeometry(page);
  const enlargedTop=await stage.evaluate(el=>el.getBoundingClientRect().top+scrollY);
  const enlargedTravel=await stage.evaluate(el=>el.getBoundingClientRect().height-innerHeight);
  for(const progress of [0,.25,.5,.75,1]){
    await page.evaluate(({top,travel,progress})=>scrollTo(0,top+travel*progress),{top:enlargedTop,travel:enlargedTravel,progress});
    await page.waitForTimeout(80);
    const overlaps=await page.locator('#crave').evaluate(section=>{
      const photos=[...section.querySelectorAll('[data-texture-photo]')].map(el=>el.getBoundingClientRect());
      return photos.flatMap(photo=>[...section.querySelectorAll('h2,p,button,[data-landing-placement]')].map(el=>{const b=el.getBoundingClientRect();return Math.max(0,Math.min(b.right,photo.right)-Math.max(b.left,photo.left))*Math.max(0,Math.min(b.bottom,photo.bottom)-Math.max(b.top,photo.top));}));
    });
    expect(overlaps.every(area=>area===0)).toBe(true);
  }
});

test('native scroll reverses, still removes runway, resize keeps both images available',async({page})=>{
  await page.goto('/');
  const stage=page.locator('[data-crave-stage]');
  const bounds=await stage.evaluate(el=>({top:el.getBoundingClientRect().top+scrollY,height:el.getBoundingClientRect().height}));
  await page.evaluate(top=>scrollTo(0,top),bounds.top);
  await expect(stage).toHaveAttribute('data-motion','true');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(stage).toHaveAttribute('data-active','false');
  await page.evaluate(()=>{delete (document as unknown as {hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await expect(stage).toHaveAttribute('data-active','true');
  const track=stage.locator('.landing-v2-crave-track');
  const getX=()=>track.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41);
  const travel=await stage.evaluate(el=>el.getBoundingClientRect().height-innerHeight);
  await page.evaluate(({top,travel})=>scrollTo(0,top+travel*.65),{top:bounds.top,travel});
  await expect.poll(getX).toBeLessThan(-20);
  const advanced=await getX();
  await page.evaluate(top=>scrollTo(0,top),bounds.top);
  await expect.poll(getX).toBeGreaterThan(advanced+10);
  await stage.locator('button').click();
  await expect(stage).toHaveAttribute('data-motion','false');
  await expect(stage.locator('button')).toHaveAttribute('aria-pressed','true');
  expect(await track.evaluate(el=>getComputedStyle(el).transform)).toBe('none');
  await page.setViewportSize({width:375,height:480});
  await expect(stage).toHaveAttribute('data-motion','false');
  await expect(stage.locator('[data-texture-photo]')).toHaveCount(2);
});

for(const mode of ['reduce','no-js','no-js-full-motion'] as const)test(`${mode} retains complete real photos and ingredients without a runway`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:mode==='reduce',reducedMotion:mode==='no-js-full-motion'?'no-preference':'reduce',viewport:{width:375,height:667}});
  const page=await context.newPage();
  await page.goto('/');
  await expect(page.locator('[data-crave-stage]')).toHaveAttribute('data-motion',mode==='reduce'?'false':'pending');
  await expect(page.locator('.landing-v2-crave-track')).toHaveCSS('display','grid');
  await expect(page.locator('.landing-v2-crave-track')).toHaveCSS('transform','none');
  await expect(page.locator('.landing-v2-crave-sticky')).toHaveCSS('position','static');
  await page.locator('#crave').scrollIntoViewIfNeeded();
  for(const photo of await page.locator('#crave [data-texture-photo]').all()){await photo.scrollIntoViewIfNeeded();await expect(photo.locator('img')).toHaveCount(1);}
  await expect(page.locator('#crave [data-landing-photo] img')).toHaveCount(2);
  await expect(page.locator('#crave img')).toHaveCount(2);
  await page.locator('#field-guide').scrollIntoViewIfNeeded();
  await expect(page.locator('#field-guide h3')).toHaveText('Crunchy Boi');
  await expect(page.locator('[data-field-ingredients]')).toHaveCount(0);
  if(mode==='reduce'){
    // The static equivalent of "all six found": the order action is there at once (its shop links sit in the closed sheet).
    await expect(page.locator('#field-guide .landing-v4-guide-cta')).toHaveAttribute('data-ready','true');
    await expect(page.locator('#field-guide').getByRole('button',{name:en['landing.lineup.order'].replace('{name}','Crunchy Boi')})).toBeVisible();
    await expect(page.locator('#field-guide [data-landing-placement="guide"]')).toHaveCount(2);
  } else await expect(page.locator('#field-guide [data-landing-placement]')).toHaveCount(0);
  // The crunch story ends on its own order action, never over a photo.
  await expect(page.locator('#crave [data-landing-placement="crave"]')).toHaveCount(2);
  await context.close();
});

for(const height of [667,812])for(const language of ['en','es'])for(const consent of ['accepted','rejected'] as const)test(`crave ViewContent remains reachable and consent-gated (${height}; ${language}; ${consent})`,async({page,context,baseURL})=>{
  await page.setViewportSize({width:375,height});
  await context.addCookies([{name:'landing_consent',value:consent,url:baseURL!}]);
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* Offline Pixel queue inspection; no external tracking. */'}));
  await page.route('https://www.facebook.com/**',route=>route.fulfill({status:204}));
  await page.goto(`/?lang=${language}`);
  await expect(page.locator('[data-crave-stage]')).toHaveAttribute('data-motion','true');
  const count=()=>page.evaluate(()=>window.fbq?.queue?.filter(args=>args[1]==='ViewContent'&&(args[2] as {content_name?:string}|undefined)?.content_name==='crave').length??0);
  const visitIntro=()=>page.locator('#crave-title').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-100));
  await visitIntro();
  if(consent==='rejected'){
    await page.waitForTimeout(1200);
    expect(await count()).toBe(0);
    await expect(page.locator('#landing-meta-pixel')).toHaveCount(0);
    return;
  }
  await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await count()).toBe(0);
  await page.evaluate(()=>scrollTo(0,0));
  await page.waitForTimeout(1100);
  expect(await count()).toBe(0);
  await visitIntro();
  await expect.poll(count,{timeout:4000}).toBe(1);
  await page.evaluate(()=>scrollTo(0,0));
  await page.waitForTimeout(100);
  await visitIntro();
  await page.waitForTimeout(1200);
  expect(await count()).toBe(1);
});

test('leaving and returning keeps the pinned crunch story scroll-linked',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  const stage=page.locator('[data-crave-stage]');
  await stage.scrollIntoViewIfNeeded();
  await page.locator('#field-guide').scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute('data-active','false');
  const top=await stage.evaluate(el=>el.getBoundingClientRect().top+scrollY);
  const travel=await stage.evaluate(el=>el.getBoundingClientRect().height-innerHeight);
  const offset=()=>stage.locator('[data-texture-photo]').first().evaluate(el=>el.getBoundingClientRect().left);
  await page.evaluate(y=>scrollTo(0,y),top);
  const start=await offset();
  await page.evaluate(y=>scrollTo(0,y),top+travel);
  await expect.poll(offset).toBeLessThan(start-100);
  await expect(stage.locator('[data-texture-photo]').nth(1).locator('img')).toHaveCount(1);
  // v4: the runway is 140svh (was 175svh) and the story ends on its order action, right after the stage.
  const runway=await stage.evaluate(el=>el.getBoundingClientRect().height/innerHeight);
  expect(runway).toBeGreaterThan(1.35);expect(runway).toBeLessThan(1.45);
  const after=await page.evaluate(()=>({stage:document.querySelector('[data-crave-stage]')!.getBoundingClientRect().bottom,cta:document.querySelector('.landing-v4-crave-cta')!.getBoundingClientRect().top}));
  expect(after.cta).toBeGreaterThanOrEqual(after.stage-1);
});

test('finding all six Field Guide ingredients turns into the Crunchy Boi order action',async({page})=>{
  await page.clock.install();
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  const cta=page.locator('#field-guide .landing-v4-guide-cta');
  await expect(cta).toHaveAttribute('data-ready','false');
  await expect(page.locator('#field-guide [data-landing-placement]')).toHaveCount(0);
  await page.locator('.landing-v3-guide-figure').scrollIntoViewIfNeeded();
  await expect.poll(async()=>{await page.clock.runFor(1200);return cta.getAttribute('data-ready');},{timeout:20000}).toBe('true');
  const button=cta.getByRole('button',{name:'Order Crunchy Boi'});
  await expect(button).toBeVisible();
  await button.click();
  const sheet=page.getByRole('dialog',{name:'Pick a shop for Crunchy Boi'});
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('a[data-landing-placement="guide"]')).toHaveCount(2);
});

for(const text of ['100%','200%'] as const)for(const language of ['en','es'] as const)test(`the Field Guide action slot keeps one height from first paint to six-of-six (${language}; text ${text})`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  let releaseScripts!:()=>void;
  const scriptsReady=new Promise<void>(resolve=>{releaseScripts=resolve;});
  await page.route('**/_next/static/**/*.js',async route=>{await scriptsReady;await route.continue();});
  await page.clock.install();
  try {
    await page.goto(`/?lang=${language}`,{waitUntil:'commit'});
    const slot=page.locator('#field-guide [data-guide-cta]');
    await expect(slot).toBeAttached();
    if(text==='200%')await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
    // Server render, before hydration: the action's invisible twin already holds the box (stylesheet applied).
    const twin=slot.locator('[data-guide-twin]');
    await expect(twin).toHaveCount(1);
    await expect.poll(()=>twin.evaluate(el=>getComputedStyle(el).visibility)).toBe('hidden');
    await expect(twin).toHaveAttribute('aria-hidden','true');
    await expect(twin).toBeDisabled();
    await expect(slot).toHaveAttribute('data-ready','false');
    const height=()=>slot.evaluate(el=>el.getBoundingClientRect().height);
    const before=await height();
    expect(before).toBeGreaterThanOrEqual(text==='200%'?80:52);
    releaseScripts();
    const guide=page.locator('.landing-v3-guide');
    await expect(guide).toHaveAttribute('data-guide-mode','motion');
    await expect(slot).toHaveAttribute('data-ready','false');
    expect(await height()).toBeCloseTo(before,1);
    await page.locator('.landing-v3-guide-figure').scrollIntoViewIfNeeded();
    await expect.poll(async()=>{await page.clock.runFor(1200);return slot.getAttribute('data-ready');},{timeout:20000}).toBe('true');
    const action=slot.getByRole('button',{name:(language==='en'?en:es)['landing.lineup.order'].replace('{name}','Crunchy Boi')});
    await expect(action).toBeVisible();
    expect(await height()).toBeCloseTo(before,1);
    // The real action fills the twin's box exactly; nothing is clipped.
    const boxes=await slot.evaluate(el=>{const a=el.querySelector('button:not([data-guide-twin])')!.getBoundingClientRect(),t=el.querySelector('[data-guide-twin]')!.getBoundingClientRect(),b=el.getBoundingClientRect();return {action:a.height,twin:t.height,slot:b.height,overflow:el.scrollHeight-el.clientHeight};});
    expect(boxes.action).toBeCloseTo(boxes.twin,1);expect(boxes.overflow).toBeLessThanOrEqual(0);
  } finally {releaseScripts();}
});
