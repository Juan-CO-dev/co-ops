import {test,expect} from '@playwright/test';
import {heroMedia,subdexMedia} from '../../../lib/landing/media';
import {simulateSubdex} from './media-simulation';

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
        if(attempts>1){Reflect.set(window,'subdexGesture',navigator.userActivation.isActive);return Promise.resolve();}
      }
      return Promise.reject(new DOMException('blocked','NotAllowedError'));
    };
  });
  await page.goto('/');await page.getByTestId('subdex-motion').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(1);
  const retry=page.getByTestId('subdex-motion').getByRole('button');
  await expect(retry).toBeVisible();await retry.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(2);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexGesture'))).toBe(true);
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
  await page.locator('#hero').scrollIntoViewIfNeeded();await root.scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  expect(await page.evaluate(()=>Reflect.get(window,'subdexAttempts'))).toBe(attempts);
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
