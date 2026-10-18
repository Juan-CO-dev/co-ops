import {test,expect} from '@playwright/test';
import {heroMedia,subdexMedia} from '../../../lib/landing/media';
import {simulateSubdex} from './media-simulation';
import {playbackChunkPaths} from './playback-chunk';

for(const preference of ['reduce','save-data'] as const)test(`SUBDEX imports no playback chunk under ${preference}, then activates on preference change`,async({page})=>{
 const chunks=playbackChunkPaths(),requests:string[]=[];
 await simulateSubdex(page);
 if(preference==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
 else await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{configurable:true,value:Object.assign(new EventTarget(),{saveData:true})}));
 page.on('request',request=>{if(chunks.includes(new URL(request.url()).pathname))requests.push(request.url());});
 await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
 await page.waitForLoadState('networkidle');
 expect(requests).toEqual([]);await expect(root).toHaveAttribute('data-motion-state','idle');
 if(preference==='reduce')await page.emulateMedia({reducedMotion:'no-preference'});
 else await page.evaluate(()=>{const connection=(navigator as Navigator & {connection:EventTarget & {saveData:boolean}}).connection;connection.saveData=false;connection.dispatchEvent(new Event('change'));});
 await expect(root).toHaveAttribute('data-motion-state','ready');
 await expect.poll(()=>requests.length).toBe(1);
 await expect(root.locator('video')).toHaveCSS('opacity','1');
});

test('SUBDEX exposes cached lazy import failure, preserves its poster, and recovers on reload',async({page})=>{
 await simulateSubdex(page);const chunks=playbackChunkPaths();let requests=0;
 await page.route('**/_next/static/**/*.js',route=>{
  if(!chunks.includes(new URL(route.request().url()).pathname))return route.continue();
  requests++;return requests===1?route.abort():route.continue();
 });
 await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
 await expect(root).toHaveAttribute('data-motion-state','failed');
  await expect(root.locator('img')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  // Turbopack caches the rejected chunk promise. The unit test proves one
  // re-armed import attempt; do not claim it forces a second network request.
  await page.waitForTimeout(100);
  await expect(root).toHaveAttribute('data-motion-state','failed');
  expect(requests).toBe(1);
  await page.reload();await root.scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute('data-motion-state','ready');
 expect(requests).toBe(2);
});

test('SUBDEX fractional-DPR outside sliver does not re-arm replay',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:375,height:812},deviceScaleFactor:1.25});
 try {
  const page=await context.newPage();await simulateSubdex(page);await page.goto('/');
  const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  await expect(root.locator('video')).toHaveCSS('opacity','1');
  await root.locator('video').dispatchEvent('ended');
  const attempts=await page.evaluate(()=>Reflect.get(window,'subdexAttempts'));
  await page.evaluate(()=>{const section=document.querySelector('#subdex')!;scrollTo(0,section.getBoundingClientRect().bottom+scrollY+1.6);});
  await expect.poll(()=>page.locator('#subdex').evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(0);
  expect(await page.locator('#subdex').evaluate(el=>el.getBoundingClientRect().bottom)).toBeGreaterThan(-8);
  await root.scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts);
  // Continue gradually beyond the margin after the first inactive callback.
  await page.evaluate(()=>{const section=document.querySelector('#subdex')!;scrollTo(0,section.getBoundingClientRect().bottom+scrollY+2);});
  await page.waitForTimeout(100);await page.evaluate(()=>scrollBy(0,20));await page.waitForTimeout(100);
  await root.scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts+1);
 } finally {await context.close();}
});

test('SUBDEX loads its playback chunk only after scroll without replacing the poster',async({page})=>{
  await simulateSubdex(page);
  const playbackScripts:string[]=[];
  const reads:Promise<void>[]=[];
  page.on('response',response=>{
    if(response.request().resourceType()!=='script')return;
    reads.push(response.text().then(source=>{
      // Unique rendered marker belongs only to the lazy playback module.
      if(source.includes('data-hero-motion-playback'))playbackScripts.push(response.url());
    }));
  });
  await page.goto('/');await page.waitForLoadState('networkidle');
  await Promise.all(reads);
  expect(playbackScripts).toEqual([]);
  const root=page.getByTestId('subdex-motion');
  await expect(root).toHaveAttribute('data-motion-state','idle');
  const poster=await root.locator('img').elementHandle();
  const shell=await root.elementHandle();
  await root.scrollIntoViewIfNeeded();
  await expect(root.locator('video')).toHaveCSS('opacity','1');
  await expect(root).toHaveAttribute('data-motion-state','ready');
  await expect.poll(()=>playbackScripts.length).toBe(1);
  expect(await root.evaluate((node,original)=>node===original,shell)).toBe(true);
  expect(await root.locator('img').evaluate((node,original)=>node===original,poster)).toBe(true);
  expect(await poster!.evaluate(node=>node.isConnected)).toBe(true);
  // A late poster failure must not insert its fallback above the playing video.
  await root.locator('img').dispatchEvent('error');
  await expect(root.getByRole('img',{name:'Pixel hero catching a sub. Image unavailable.'})).toHaveCount(1);
  expect(await root.evaluate(node=>!!(node.querySelector('[role="img"]')!.compareDocumentPosition(node.querySelector('video')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

for(const lang of ['en','es'])for(const consent of ['unset','accepted','rejected'])test(`SUBDEX poster and ordering ${lang} ${consent}`,async({page,context,baseURL},info)=>{
  if(consent!=='unset')await context.addCookies([{name:'landing_consent',value:consent,url:baseURL!}]);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`/?lang=${lang}`);
  const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  const poster=root.locator('img');await expect(poster).toHaveAttribute('src',subdexMedia.poster);
  await expect.poll(()=>poster.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(720);
  expect((await poster.boundingBox())!.height).toBeGreaterThan(200);
  await expect(root.locator('video')).toHaveCount(0);
  await expect(page.locator('#subdex a[data-landing-placement]').first()).toHaveAttribute('href',/^https:/);
  await page.screenshot({path:`tmp/landing-v2/chunk7/partb-${info.project.name}-${lang}-${consent}.png`});
});

test('SUBDEX retries blocked autoplay inside the keyboard gesture',async({page})=>{
  await page.addInitScript(()=>{
    document.addEventListener('error',e=>{if(e.target instanceof HTMLMediaElement)e.stopImmediatePropagation();},true);
    HTMLMediaElement.prototype.play=function(){
      if(this.closest('[data-testid="subdex-motion"]')){
        const attempts=Number(Reflect.get(window,'subdexAttempts')??0)+1;
        Reflect.set(window,'subdexAttempts',attempts);
        if(attempts>1){Reflect.set(window,'subdexGesture',navigator.userActivation.isActive);Reflect.set(window,'subdexInsideHandler',Reflect.get(window,'subdexHandlerActive'));(Reflect.get(window,'subdexHandlerOrder') as string[]).push('play');return Promise.resolve();}
      }
      return Promise.reject(new DOMException('blocked','NotAllowedError'));
    };
  });
  await page.goto('/');await page.getByTestId('subdex-motion').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(1);
  const retry=page.getByTestId('subdex-motion').getByRole('button');
  await expect(retry).toBeVisible();
  // Wrap the actual React handler: capture/bubble or userActivation alone would
  // also allow an incorrectly deferred microtask call to pass.
  await retry.evaluate(button=>{
    const key=Object.keys(button).find(key=>key.startsWith('__reactProps$'))!;
    const props=Reflect.get(button,key) as {onClick:(event:unknown)=>void};
    const original=props.onClick;const order:string[]=[];Reflect.set(window,'subdexHandlerOrder',order);
    props.onClick=event=>{Reflect.set(window,'subdexHandlerActive',true);order.push('enter');try{original(event);}finally{order.push('exit');Reflect.set(window,'subdexHandlerActive',false);}};
  });
  await retry.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(2);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexGesture'))).toBe(true);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexInsideHandler'))).toBe(true);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexHandlerOrder'))).toEqual(['enter','play','exit']);
  await expect(retry).toBeFocused();
});

test('SUBDEX recovers visibility without IntersectionObserver or PerformanceObserver',async({page})=>{
  await simulateSubdex(page);
  await page.addInitScript(()=>{Reflect.set(window,'IntersectionObserver',undefined);Reflect.set(window,'PerformanceObserver',undefined);});
  await page.goto('/#subdex');
  const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  await expect(root.locator('video')).toHaveCSS('opacity','1');
  await page.locator('#hero').scrollIntoViewIfNeeded();await expect(root.locator('video')).toHaveCSS('opacity','0');
  await root.scrollIntoViewIfNeeded();await expect(root.locator('video')).toHaveCSS('opacity','1');
});

test('SUBDEX keeps its poster through pre-hydration scroll and document hide/show',async({page})=>{
  await simulateSubdex(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/_next/static/**/*.js',async route=>{await held;await route.continue();});
  await page.goto('/',{waitUntil:'commit'});
  const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  const poster=await root.locator('img').elementHandle();await expect(root.locator('img')).toBeVisible();release();
  await expect(root.locator('video')).toHaveCSS('opacity','1');
  expect(await poster!.evaluate(el=>el.isConnected)).toBe(true);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(root.locator('video')).toHaveCSS('opacity','0');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(root.locator('video')).toHaveCSS('opacity','1');
});

test('SUBDEX playing event without decoded progress stays still, then stalls and retries',async({page})=>{
  await simulateSubdex(page);await page.addInitScript(()=>Reflect.set(window,'subdexFreeze',true));
  await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(1);
  await expect(root.locator('video')).toHaveCSS('opacity','0');
  await expect(root).toHaveAttribute('data-media-failed','true',{timeout:10000});
  await expect(root.locator('img')).toBeVisible();
  await page.evaluate(()=>Reflect.set(window,'subdexFreeze',false));
  await root.getByRole('button').click();await expect(root.locator('video')).toHaveCSS('opacity','1');
  await root.locator('video').evaluate(el=>el.dispatchEvent(new Event('ended')));
  await expect(root.locator('video')).toHaveCSS('opacity','0');
  const attempts=await page.evaluate(()=>Reflect.get(window,'subdexAttempts'));
  // Completion rests in place, including still-intersecting edge jitter.
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts);
  await page.evaluate(async()=>{
    for(const hidden of [true,false]){
      Object.defineProperty(document,'hidden',{configurable:true,value:hidden});
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    }
    Reflect.deleteProperty(document,'hidden');
  });
  expect(await page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts);
  const element=await root.locator('video').elementHandle();
  await page.evaluate(async()=>{
    const el=document.querySelector('#subdex')!;
    const end=el.getBoundingClientRect().bottom+scrollY;
    for(const overlap of [8,2,6,1,5]){scrollTo(0,end-overlap);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));}
  });
  expect(await page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts);
  await page.locator('#hero').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.locator('#subdex').evaluate(el=>el.getBoundingClientRect().top>=innerHeight)).toBe(true);
  await root.scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts+1);
  expect(await root.locator('video').evaluate((el,original)=>el===original,element)).toBe(true);
  await expect(root.locator('video')).toHaveCSS('opacity','1');
  await root.locator('video').evaluate(el=>el.dispatchEvent(new Event('ended')));
  await expect(root.locator('video')).toHaveCSS('opacity','0');await page.waitForTimeout(250);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts+1);
});

for(const failed of ['poster','motion'])test(`SUBDEX ${failed} 404 preserves geometry and accessible fallback`,async({page})=>{
  await page.route(`**${failed==='poster'?subdexMedia.poster:subdexMedia.motion}`,route=>route.fulfill({status:404,body:''}));
  if(failed==='poster')await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  if(failed==='poster')await expect(root.getByRole('img',{name:'Pixel hero catching a sub. Image unavailable.'})).toBeVisible();
  else {await expect(root.locator('video')).toHaveCount(1);await expect(root.locator('img')).toBeVisible();await expect(root.getByRole('button')).toBeEnabled();}
  expect((await root.boundingBox())!.height).toBeGreaterThan(300);
  if(failed==='motion')await expect(root.locator('video')).toHaveCSS('opacity','0');
});

test('SUBDEX native decoded dimensions and progressing time, without a play shim',async({page,browserName},info)=>{
  test.skip(browserName==='webkit'&&process.platform!=='darwin','Windows WebKit H.264 decoding remains unresolved; physical iOS Safari release gate required.');
  await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  const video=root.locator('video');
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>({ready:v.readyState>=2,width:v.videoWidth>0,progress:v.currentTime>0}))).toEqual({ready:true,width:true,progress:true});
  await expect(video).not.toHaveAttribute('loop','');
  await info.attach('native-subdex-decoder.json',{body:JSON.stringify(await video.evaluate((v:HTMLVideoElement)=>({readyState:v.readyState,videoWidth:v.videoWidth,currentTime:v.currentTime}))),contentType:'application/json'});
});

test('SUBDEX readiness is bounded when supported LCP emits no entries',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/media/v2-p013-*',async route=>{await held;await route.continue();});
  await page.addInitScript(()=>{
    const Original=PerformanceObserver;
    window.PerformanceObserver=class extends Original {
      static get supportedEntryTypes(){return [...new Set([...Original.supportedEntryTypes,'largest-contentful-paint'])];}
      observe(options:PerformanceObserverInit){if(options.type!=='largest-contentful-paint')super.observe(options);}
    };
    HTMLMediaElement.prototype.play=function(){Reflect.set(window,'subdexAttempt',true);return Promise.reject(new DOMException('blocked','NotAllowedError'));};
  });
  try{
    await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByTestId('subdex-motion').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.readyState)).not.toBe('complete');
    await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempt')),{timeout:4000}).toBe(true);
    await expect(page.getByTestId('subdex-motion').locator('img')).toBeVisible();
  }finally{release();}
});

test('SUBDEX save-data keeps the decoded poster without a media request',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
  const requests:string[]=[];page.on('request',r=>{if(r.url().includes(subdexMedia.motion))requests.push(r.url());});
  await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
  await expect.poll(()=>root.locator('img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(720);
  await expect(root.locator('video')).toHaveCount(0);expect(requests).toEqual([]);
});

test.describe('SUBDEX without JavaScript',()=>{
  test.use({javaScriptEnabled:false});
  test('reserved poster decodes and order anchors remain usable',async({page})=>{
    await page.goto('/');const root=page.getByTestId('subdex-motion');await root.scrollIntoViewIfNeeded();
    await expect.poll(()=>root.locator('img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(720);
    await expect(root.locator('video')).toHaveCount(0);
    await expect(page.locator('#subdex a[data-landing-placement]').first()).toHaveAttribute('href',/^https:/);
    await expect(page.locator('#hero img')).toHaveAttribute('src',heroMedia.poster);
  });
});
