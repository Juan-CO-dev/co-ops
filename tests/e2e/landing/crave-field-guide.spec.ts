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

/** Scroll the pinned Field Guide's runway to a fraction of its travel (1 = the guide's end at the viewport's bottom). */
async function scrollGuide(page:Page,fraction:number) {
  await page.locator('.landing-v3-guide').evaluate((el,f)=>{const box=el.getBoundingClientRect();scrollTo(0,box.top+scrollY+Math.max(0,box.height-innerHeight)*f);},fraction);
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
      // The food a reader can see: each photo as clipped by the story window (overflow: hidden).
      const clip=section.querySelector('.landing-v2-crave-window')!.getBoundingClientRect();
      const photos=[...section.querySelectorAll('[data-texture-photo]')].map(el=>{const r=el.getBoundingClientRect(),left=Math.max(r.left,clip.left),top=Math.max(r.top,clip.top);return new DOMRect(left,top,Math.max(0,Math.min(r.right,clip.right)-left),Math.max(0,Math.min(r.bottom,clip.bottom)-top));});
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
      // The food a reader can see: each photo as clipped by the story window (overflow: hidden).
      const clip=section.querySelector('.landing-v2-crave-window')!.getBoundingClientRect();
      const photos=[...section.querySelectorAll('[data-texture-photo]')].map(el=>{const r=el.getBoundingClientRect(),left=Math.max(r.left,clip.left),top=Math.max(r.top,clip.top);return new DOMRect(left,top,Math.max(0,Math.min(r.right,clip.right)-left),Math.max(0,Math.min(r.bottom,clip.bottom)-top));});
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
    await expect(page.locator('#field-guide [data-landing-placement="guide"]')).toHaveCount(3);
  } else await expect(page.locator('#field-guide [data-landing-placement]')).toHaveCount(0);
  // The crunch story ends on its own order action, never over a photo.
  await expect(page.locator('#crave [data-landing-placement="crave"]')).toHaveCount(3);
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
  // The story is scroll-linked only once hydrated: wait for that state, never for a fixed time.
  await expect(stage).toHaveAttribute('data-motion','true');
  await stage.scrollIntoViewIfNeeded();
  await page.locator('#field-guide').scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute('data-active','false');
  const top=await stage.evaluate(el=>el.getBoundingClientRect().top+scrollY);
  const travel=await stage.evaluate(el=>el.getBoundingClientRect().height-innerHeight);
  // Read geometry only after the engine has run a rendering update for the new scroll position:
  // a scroll-driven animation updates in "update the rendering", so a read straight after
  // scrollTo can still see the PREVIOUS position's frame (Linux/Windows WebKit, seen 1 in 25).
  const settled=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const geometry=()=>stage.evaluate(el=>({photo:el.querySelector('[data-texture-photo]')!.getBoundingClientRect().left,window:el.querySelector('.landing-v2-crave-window')!.getBoundingClientRect()}));
  const scrollAndSettle=async(y:number)=>{await page.evaluate(y=>scrollTo(0,y),y);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(Math.round(y));await settled();};
  // Returning to the top of the runway: the first photo sits exactly in the window (progress 0).
  await scrollAndSettle(top);
  await expect.poll(async()=>{const g=await geometry();return Math.abs(g.photo-g.window.left);}).toBeLessThan(1);
  const start=(await geometry()).photo;
  // The end of the runway: the story has slid a full photo width (progress 1), scroll-linked.
  await scrollAndSettle(top+travel);
  await expect.poll(async()=>{const g=await geometry();return Math.abs(g.photo-(g.window.left-g.window.width));}).toBeLessThan(1);
  expect((await geometry()).photo).toBeLessThan(start-100);
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
  await scrollGuide(page,1);
  await expect.poll(async()=>{await page.clock.runFor(1200);return cta.getAttribute('data-ready');},{timeout:20000}).toBe('true');
  const button=cta.getByRole('button',{name:'Order Crunchy Boi'});
  await expect(button).toBeVisible();
  await button.click();
  const sheet=page.getByRole('dialog',{name:'Pick a shop for Crunchy Boi'});
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('a[data-landing-placement="guide"]')).toHaveCount(3);
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
    await scrollGuide(page,1);
    await expect.poll(async()=>{await page.clock.runFor(1200);return slot.getAttribute('data-ready');},{timeout:20000}).toBe('true');
    const action=slot.getByRole('button',{name:(language==='en'?en:es)['landing.lineup.order'].replace('{name}','Crunchy Boi')});
    await expect(action).toBeVisible();
    expect(await height()).toBeCloseTo(before,1);
    // The real action fills the twin's box exactly; nothing is clipped.
    const boxes=await slot.evaluate(el=>{const a=el.querySelector('button:not([data-guide-twin])')!.getBoundingClientRect(),t=el.querySelector('[data-guide-twin]')!.getBoundingClientRect(),b=el.getBoundingClientRect();return {action:a.height,twin:t.height,slot:b.height,overflow:el.scrollHeight-el.clientHeight};});
    expect(boxes.action).toBeCloseTo(boxes.twin,1);expect(boxes.overflow).toBeLessThanOrEqual(0);
  } finally {releaseScripts();}
});

// v4.1 (Juan): the Field Guide's find game is scroll-driven, forward only; a tap finds a word at once.
test('scrolling through the Field Guide finds the six one by one, never backwards, and reveals the action',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  // Words in view, photo still below the fold: nothing found yet.
  await page.locator('#field-guide h3').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-8));
  await page.waitForTimeout(400);
  const found=async()=>Number(await guide.getAttribute('data-guide-found'));
  const start=await found();
  expect(start).toBeLessThan(6);
  const seen:number[]=[start];
  for(let fraction=0;fraction<=1.0001;fraction+=.05){
    await scrollGuide(page,fraction);await page.waitForTimeout(150);
    seen.push(await found());
  }
  await expect.poll(found,{timeout:5000}).toBe(6);
  seen.push(6);
  // Forward only, in more than one step: the scroll walked the six, it did not jump.
  for(let i=1;i<seen.length;i++)expect(seen[i]!).toBeGreaterThanOrEqual(seen[i-1]!);
  expect(new Set(seen.filter(n=>n>0&&n<6)).size).toBeGreaterThan(0);
  const slot=page.locator('#field-guide [data-guide-cta]');
  await expect(slot).toHaveAttribute('data-ready','true');
  // Scrolling back up never un-finds.
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);
  expect(await found()).toBe(6);
  await expect(slot).toHaveAttribute('data-ready','true');
});

test('tapping an ingredient finds it at once; the scroll then finds the rest',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await page.locator('#field-guide h3').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-8));
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  const pickles=page.locator('[data-anatomy-label="pickles"]');
  await expect(pickles).toHaveAttribute('data-found','false');
  const word=pickles.getByRole('button');
  expect((await word.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await word.click();
  await expect(pickles).toHaveAttribute('data-found','true');
  await expect(pickles).toHaveAttribute('data-active','true');
  await expect(pickles).toHaveAttribute('data-collected','true',{timeout:3000});
  await scrollGuide(page,1);
  await expect(guide).toHaveAttribute('data-guide-found','6',{timeout:5000});
  await expect(page.locator('#field-guide [data-guide-cta]')).toHaveAttribute('data-ready','true',{timeout:4000});
});

test('finding all six by taps alone stops the scroll observer',async({page})=>{
  // Record whether the guide's scroll observer (on its step markers) is disconnected (Astra v4.1 nit).
  await page.addInitScript(()=>{
    const Native=window.IntersectionObserver;
    const w=window as unknown as {__guideObserverDisconnected:boolean};w.__guideObserverDisconnected=false;
    window.IntersectionObserver=class extends Native{
      private guide=false;
      observe(target:Element){if(target.hasAttribute('data-guide-step'))this.guide=true;super.observe(target);}
      disconnect(){if(this.guide)w.__guideObserverDisconnected=true;super.disconnect();}
    } as typeof IntersectionObserver;
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  // Wait for font metrics, then position the actual photo below the viewport with a margin.
  // Inferring its edge from the words was sensitive to late layout shifts and fractional pixels.
  await page.evaluate(()=>document.fonts.ready);
  const positionPhoto=()=>page.locator('.landing-v3-guide-figure').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight-24));
  await positionPhoto();
  // Approaching the guide enhances the preceding native order groups into sheet buttons.
  // Their height changes; wait for that real transition, prove nothing was found, then position again.
  await expect(page.locator('.landing-v3-direct-orders')).toHaveCount(0);
  await expect(guide).toHaveAttribute('data-guide-found','0');
  await positionPhoto();
  await page.waitForTimeout(600);
  expect(await page.locator('.landing-v3-guide-figure').evaluate(el=>el.getBoundingClientRect().top>=innerHeight)).toBe(true);
  expect(Number(await guide.getAttribute('data-guide-found'))).toBe(0);
  for(const word of await guide.locator('.landing-v4-guide-word').all())await word.click();
  await expect(guide).toHaveAttribute('data-guide-found','6');
  expect(await page.evaluate(()=>(window as unknown as {__guideObserverDisconnected:boolean}).__guideObserverDisconnected)).toBe(true);
});

for(const policy of ['reduce','save-data'] as const)test(`${policy}: no find animation, all six found and the action reachable`,async({page})=>{
  if(policy==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
  else await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveAttribute('data-guide-mode','static');
  await expect(guide).toHaveAttribute('data-guide-found','6');
  await expect(guide.locator('[data-line][data-state="drawing"]')).toHaveCount(0);
  await expect(guide.locator('.landing-v4-guide-word')).toHaveCount(0);
  const slot=page.locator('#field-guide [data-guide-cta]');
  await expect(slot).toHaveAttribute('data-ready','true');
  await slot.scrollIntoViewIfNeeded();
  await expect(slot.getByRole('button',{name:'Order Crunchy Boi'})).toBeVisible();
});

/** Put step marker `index`'s start `offset` px below (positive) or above (negative) the trigger line (top tenth). */
async function placeMarker(page:Page,index:number,offset:number) {
  await page.locator(`[data-guide-step="${index}"]`).evaluate((el,o)=>scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight*.1-o),offset);
}
// Astra PR #543: the trigger band is pixels of the viewport height; prove where each find actually fires.
for(const size of [{width:1366,height:768},{width:390,height:844}])test(`each Field Guide find fires as its marker crosses the top-tenth line (${size.width}x${size.height})`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize(size);
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  const found=async()=>Number(await guide.getAttribute('data-guide-found'));
  await guide.evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight+40));
  await page.waitForTimeout(300);
  expect(await found()).toBe(0);
  for(let index=0;index<6;index++){
    await placeMarker(page,index,24);await page.waitForTimeout(700);
    expect(await found(),`marker ${index} just below the line`).toBe(index);
    await placeMarker(page,index,-24);
    await expect.poll(found,{timeout:3000,message:`marker ${index} just above the line`}).toBe(index+1);
  }
  // A viewport-height change rebuilds the band; finds stay found and the next one keeps its line.
  await page.setViewportSize({width:size.width,height:size.height-120});await page.waitForTimeout(400);
  expect(await found()).toBe(6);
});

test('a resized window rebuilds the trigger band at the new height',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  await guide.evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight+40));
  await page.setViewportSize({width:1366,height:600});await page.waitForTimeout(500);
  const found=async()=>Number(await guide.getAttribute('data-guide-found'));
  for(const index of [0,1]){
    // 10px under the new line (60px) is still inside the OLD band (77px): only a rebuilt band waits.
    await placeMarker(page,index,10);await page.waitForTimeout(700);
    expect(await found()).toBe(index);
    await placeMarker(page,index,-24);
    await expect.poll(found,{timeout:3000}).toBe(index+1);
  }
});

for(const size of [{width:1536,height:730},{width:1366,height:768},{width:390,height:844}])test(`the crunch story shows one caption at a time (${size.width}x${size.height})`,async({page})=>{
  await page.setViewportSize(size);
  await page.goto('/');
  const stage=page.locator('[data-crave-stage]');
  await expect(stage).toHaveAttribute('data-motion','true');
  const bounds=await stage.evaluate(el=>({top:el.getBoundingClientRect().top+scrollY,travel:el.getBoundingClientRect().height-innerHeight}));
  const settled=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  for(let step=0;step<=20;step++){
    await page.evaluate(({top,travel,f})=>scrollTo(0,top+travel*f),{...bounds,f:step/20});
    await settled();await page.waitForTimeout(60);
    const opacities=await stage.locator('.landing-v3-crave-captions p').evaluateAll(els=>els.map(el=>Number(getComputedStyle(el).opacity)));
    // The two captions share one box: at most one is ever (even partly) visible.
    expect(opacities.filter(o=>o>0.01).length,`progress ${step/20}: ${opacities.join(',')}`).toBeLessThanOrEqual(1);
    if(step<=4)expect(opacities[0]).toBeGreaterThan(.99);
    if(step>=16)expect(opacities[1]).toBeGreaterThan(.99);
  }
});

// Laptop polish (Juan 2026-11-13): "not resizing properly on the laptop screen".
const laptops=[{width:1280,height:720},{width:1366,height:768},{width:1536,height:730},{width:1536,height:864},{width:1440,height:900},{width:1920,height:1080}];
for(const size of laptops)test(`laptop hero keeps two columns that fit the first screen (${size.width}x${size.height})`,async({page})=>{
  await page.setViewportSize(size);
  await page.goto('/');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.landing-v2')).toHaveAttribute('data-consent-stack','false');
  const g=await page.evaluate(()=>{
    const box=(s:string)=>document.querySelector(s)!.getBoundingClientRect().toJSON() as DOMRect;
    return {grid:box('.landing-v2-hero-grid'),photo:box('#hero img'),consent:box('.landing-v2-consent'),blocks:[...document.querySelectorAll('.landing-v2-hero-copy > :not(#landing-consent-slot)')].map(el=>el.getBoundingClientRect().toJSON() as DOMRect),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const hit=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  expect(g.overflow).toBe(false);
  // Two columns: the photo is the right half and exactly the stage's height.
  expect(Math.abs(g.photo.width-size.width/2)).toBeLessThan(1);
  expect(Math.abs(g.photo.height-g.grid.height)).toBeLessThan(1);
  // The stage fills the first screen below the header (never past the 740px prototype stage).
  expect(g.grid.height).toBeGreaterThanOrEqual(Math.min(740,size.height-52)-1);
  expect(g.grid.height).toBeLessThanOrEqual(Math.max(740,size.height-52)+1);
  // The unanswered notice never covers the food or the copy.
  expect(hit(g.consent,g.photo)).toBe(false);
  for(const block of g.blocks)expect(hit(g.consent,block)).toBe(false);
});

for(const size of [...laptops,{width:390,height:844}])test(`the pinned crunch story fills its window with real photos (${size.width}x${size.height})`,async({page})=>{
  await page.setViewportSize(size);
  await page.goto('/');
  const stage=page.locator('[data-crave-stage]');
  await expect(stage).toHaveAttribute('data-motion','true');
  const top=await stage.evaluate(el=>el.getBoundingClientRect().top+scrollY);
  await page.evaluate(y=>scrollTo(0,y),top);
  const first=stage.locator('[data-texture-photo]').first().locator('img');
  await expect.poll(()=>first.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
  const g=await stage.evaluate(el=>{
    const win=el.querySelector('.landing-v2-crave-window')!.getBoundingClientRect();
    const img=el.querySelector<HTMLImageElement>('[data-texture-photo] img')!;const box=img.getBoundingClientRect();
    return {stage:el.getBoundingClientRect().width,win:{w:win.width,h:win.height,bottom:win.bottom},img:{w:box.width,h:box.height,fit:getComputedStyle(img).objectFit,natural:img.naturalWidth/img.naturalHeight}};
  });
  // The window spans the column and the screen height the control and captions leave.
  expect(Math.abs(g.win.w-g.stage)).toBeLessThan(1);
  expect(g.win.bottom).toBeLessThanOrEqual(size.height);
  expect(g.win.h).toBeGreaterThanOrEqual(size.height*.6);
  // Each photo covers the window: a uniform crop of the untouched 2:3 photo, never stretched or letterboxed.
  expect(Math.abs(g.img.w-g.win.w)).toBeLessThan(1);expect(Math.abs(g.img.h-g.win.h)).toBeLessThan(1);
  expect(g.img.fit).toBe('cover');
  expect(g.img.natural).toBeCloseTo(2/3,2);
});

// Laptop polish (Juan 2026-11-13): "the pointers don't all deploy before someone even gets to the full
// field guide photo" and "the last pointers are pointing once the full picture is in the screen".
// Measured, not modelled: walk the page down in wheel-sized steps with the live observer and, at every
// step where the found count rises, read where the photo and the pin actually are.
const guideSizes=[{width:1536,height:730},{width:1440,height:900},{width:1280,height:720},{width:1366,height:768},{width:1920,height:1080},{width:390,height:844},{width:375,height:667}];
for(const size of guideSizes)test(`no Field Guide pointer deploys before the whole photo is on screen, and the last points while it still is (${size.width}x${size.height})`,async({page})=>{
  // ~60 paced scroll steps with a settle each: slower engines need more than the default 30 s.
  test.setTimeout(120000);
  await page.setViewportSize(size);
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  await page.evaluate(()=>document.fonts.ready);
  const read=()=>page.evaluate(()=>{
    const r=(s:string)=>document.querySelector(s)!.getBoundingClientRect();
    const photo=r('.landing-v5-guide-photo');
    const guide=document.querySelector<HTMLElement>('.landing-v3-guide')!;
    // Runway progress from the live layout (content above the guide may still change height).
    const progress=(16-guide.getBoundingClientRect().top)/guide.querySelector('.landing-v5-guide-runway')!.getBoundingClientRect().height;
    return {y:scrollY,progress,found:Number(guide.dataset.guideFound),pinTop:r('.landing-v5-guide-pin').top,photoTop:photo.top,photoBottom:photo.bottom,photoHeight:photo.height,
      wordsTop:r('[data-guide-words="above"]').top,wordsBottom:r('[data-guide-words="below"]').bottom,slot:r('[data-guide-cta]').bottom,vh:innerHeight};
  });
  const geo=await guide.evaluate(el=>{const g=el.getBoundingClientRect(),photo=el.querySelector('.landing-v5-guide-photo')!.getBoundingClientRect();return {guideTop:g.top+scrollY,photoTop:photo.top+scrollY,photoHeight:photo.height,runway:el.querySelector('.landing-v5-guide-runway')!.getBoundingClientRect().height};});
  // (i) Half the photo in view, the rest below the fold: no pointer yet.
  await page.evaluate(y=>scrollTo(0,y),Math.round(geo.photoTop+geo.photoHeight/2-size.height));
  await page.waitForTimeout(700);
  // Approaching the guide enhances the order groups above it (their height changes): re-aim once.
  await page.locator('.landing-v5-guide-photo').evaluate(el=>{const r=el.getBoundingClientRect();scrollTo(0,Math.round(scrollY+r.top+r.height/2-innerHeight));});
  await page.waitForTimeout(500);
  const partly=await read();
  expect(partly.photoBottom).toBeGreaterThan(size.height);
  expect(partly.found).toBe(0);
  // (ii) Walk on: the pin sticks at 16px, then the runway; every rise in the count is measured.
  const rises:Awaited<ReturnType<typeof read>>[]=[];
  let last=0,fullFrom:number|null=null;
  for(let y=partly.y;;y+=30){
    await page.evaluate(v=>scrollTo(0,v),y);await page.waitForTimeout(220);
    const s=await read();
    if(fullFrom===null&&s.photoTop>=0&&s.photoBottom<=s.vh+.5)fullFrom=s.y;
    // Every rise is recorded, including one past the runway (which the checks below then refuse).
    if(s.found>last){rises.push(s);last=s.found;}
    if(s.progress>1.06)break;
  }
  // Astra review: EACH of the six finds, #6 included, was seen appearing at a recorded scroll
  // position, one at a time, inside the loop; nothing appears after it.
  expect(rises.map(s=>s.found)).toEqual([1,2,3,4,5,6]);
  await page.waitForTimeout(1500);
  expect((await read()).found).toBe(6);
  // The whole photo fits the pinned screen at this viewport (none of the six sizes needs the
  // "as fully visible as it gets" fallback), and it was whole on screen before the first find.
  expect(fullFrom).not.toBeNull();
  expect(rises[0]!.y).toBeGreaterThan(fullFrom!);
  for(const s of rises){
    // Pinned, with the whole photo, both rows of words and the action slot on screen.
    expect(Math.abs(s.pinTop-16),`pin at ${s.found}`).toBeLessThan(2);
    expect(s.photoTop,`photo top at ${s.found}`).toBeGreaterThanOrEqual(0);
    expect(s.photoBottom,`photo bottom at ${s.found}`).toBeLessThanOrEqual(s.vh+.5);
    expect(s.photoHeight).toBeGreaterThan(s.vh*.3);
    expect(s.wordsTop).toBeGreaterThanOrEqual(0);
    expect(s.wordsBottom).toBeLessThanOrEqual(s.vh+.5);
    expect(s.slot).toBeLessThanOrEqual(s.vh+.5);
    // Inside the runway, with room left: never at its very start or end.
    const progress=s.progress;
    expect(progress,`progress at ${s.found}`).toBeGreaterThanOrEqual(.09);
    expect(progress,`progress at ${s.found}`).toBeLessThanOrEqual(.86);
  }
  // Paced, not bunched: the first and last finds are most of the runway apart.
  expect(rises[rises.length-1]!.progress-rises[0]!.progress).toBeGreaterThanOrEqual(.5);
  await expect(page.locator('#field-guide [data-guide-cta]')).toHaveAttribute('data-ready','true');
  // (iii) Six of six: every line drawn; no two lines cross, none runs over another word, every
  // point sits on the photo clear of its edges.
  await guide.evaluate(el=>scrollTo(0,Math.round(el.getBoundingClientRect().top+scrollY-16+el.querySelector('.landing-v5-guide-runway')!.getBoundingClientRect().height*.9)));await page.waitForTimeout(900);
  const lines=await page.evaluate(()=>{
    const words=Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-anatomy-label]')].map(el=>[el.dataset.anatomyLabel!,el.getBoundingClientRect().toJSON() as DOMRect]));
    const photo=document.querySelector('.landing-v5-guide-photo')!.getBoundingClientRect();
    return [...document.querySelectorAll<SVGGElement>('.landing-v3-guide-lines [data-line]')].map(g=>{
      const path=g.querySelector('path')!,length=path.getTotalLength(),matrix=path.getScreenCTM()!;
      const points=Array.from({length:61},(_,i)=>{const p=path.getPointAtLength(length*i/60).matrixTransform(matrix);return {x:p.x,y:p.y};});
      const dot=g.querySelector('circle')!.getBoundingClientRect();
      return {id:g.dataset.line!,state:g.dataset.state,points,dot:{x:dot.left+dot.width/2,y:dot.top+dot.height/2},words,photo:photo.toJSON() as DOMRect};
    });
  });
  expect(lines).toHaveLength(6);
  const cross=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number},d:{x:number;y:number})=>{
    const o=(p:typeof a,q:typeof a,r:typeof a)=>Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));
    return o(a,b,c)*o(a,b,d)<0&&o(c,d,a)*o(c,d,b)<0;
  };
  for(const line of lines){
    expect(line.state).toBe('shown');
    const {photo}=line;
    expect(line.dot.x-photo.left,`${line.id} left`).toBeGreaterThan(20);expect(photo.right-line.dot.x,`${line.id} right`).toBeGreaterThan(20);
    expect(line.dot.y-photo.top,`${line.id} top`).toBeGreaterThan(20);expect(photo.bottom-line.dot.y,`${line.id} bottom`).toBeGreaterThan(20);
    for(const [id,word] of Object.entries(line.words))if(id!==line.id)
      expect(line.points.some(p=>p.x>word.left+1&&p.x<word.right-1&&p.y>word.top+1&&p.y<word.bottom-1),`${line.id} over ${id}`).toBe(false);
  }
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i]!.points,b=lines[j]!.points;let crossed=false;
    for(let p=1;p<a.length&&!crossed;p++)for(let q=1;q<b.length&&!crossed;q++)crossed=cross(a[p-1]!,a[p]!,b[q-1]!,b[q]!);
    expect(crossed,`${lines[i]!.id} crosses ${lines[j]!.id}`).toBe(false);
    expect(Math.hypot(lines[i]!.dot.x-lines[j]!.dot.x,lines[i]!.dot.y-lines[j]!.dot.y),`${lines[i]!.id}/${lines[j]!.id} apart`).toBeGreaterThan(24);
  }
});

// Astra review (PR #543): a fast scroll must not leave the one-per-beat stagger running after the
// photo has gone. At the flush line (still pinned) every queued find lands at once, collected.
for(const size of [{width:1536,height:730},{width:390,height:844}])for(const motion of ['flick','jump'] as const)test(`a fast ${motion} past the Field Guide lands every queued pointer at once (${size.width}x${size.height})`,async({page})=>{
  await page.setViewportSize(size);
  await page.goto('/');
  const guide=page.locator('.landing-v3-guide');
  await expect(guide).toHaveAttribute('data-guide-mode','motion');
  await page.evaluate(()=>document.fonts.ready);
  const found=async()=>Number(await guide.getAttribute('data-guide-found'));
  // Scroll to a runway fraction from the LIVE layout (content above the guide may change height).
  const toProgress=(p:number)=>guide.evaluate((el,f)=>{scrollTo(0,Math.round(el.getBoundingClientRect().top+scrollY-16+el.querySelector('.landing-v5-guide-runway')!.getBoundingClientRect().height*f));},p);
  // Approach: settle the order groups above the guide, then start a quarter into the runway.
  await page.locator('.landing-v5-guide-photo').evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-innerHeight+40));
  await page.waitForTimeout(600);
  expect(await found()).toBe(0);
  await toProgress(.25);
  await expect.poll(found,{timeout:3000}).toBe(2);
  const slot=page.locator('#field-guide [data-guide-cta]');
  await expect(slot).toHaveAttribute('data-ready','false');
  if(motion==='flick'){
    // A flick: three frames to just short of the pin's end (past the flush line, still pinned).
    for(const p of [.5,.75,.96]){await toProgress(p);await page.waitForTimeout(16);}
  } else await toProgress(1.6); // the whole guide (and its markers) jumps above the viewport
  // All four queued finds land together: the stagger would need ~1.4 s more, plus the line draws.
  await expect.poll(found,{timeout:500,intervals:[50]}).toBe(6);
  await expect(slot).toHaveAttribute('data-ready','true',{timeout:300});
  await expect(guide.locator('[data-anatomy-label][data-collected="true"]')).toHaveCount(6);
  await expect(guide.locator('[data-line][data-state="shown"]')).toHaveCount(6);
  if(motion==='flick'){
    // Landed while the page is still pinned with the whole photo on screen.
    const g=await page.evaluate(()=>{const r=(s:string)=>document.querySelector(s)!.getBoundingClientRect();return {pin:r('.landing-v5-guide-pin').top,photo:r('.landing-v5-guide-photo').toJSON() as DOMRect};});
    expect(Math.abs(g.pin-16)).toBeLessThan(2);
    expect(g.photo.top).toBeGreaterThanOrEqual(0);
    expect(g.photo.bottom).toBeLessThanOrEqual(size.height+.5);
  }
  // Nothing keeps walking afterwards.
  await page.waitForTimeout(800);
  expect(await found()).toBe(6);
  await expect(guide.locator('[data-line][data-state="drawing"]')).toHaveCount(0);
});
