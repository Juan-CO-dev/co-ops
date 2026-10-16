import {test,expect} from '@playwright/test';
import {checkTransferBudget} from '../../../scripts/check-transfer-budget.mjs';

for(const consent of ['accepted','unset'])test(`cold initial and full-scroll transfer budgets (${consent}; offline Meta)`,async({page,context},testInfo)=>{
  test.setTimeout(60000);
  // A new Playwright context is a cold cache. This fixture proves local costs only;
  // live Meta + three throttled Lighthouse runs remain a distinct activation gate.
  if(consent==='accepted')await context.addCookies([{name:'landing_consent',value:'accepted',url:'http://localhost:44170'}]);
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* landing-perf-offline-v1: NOT a representative Meta cost fixture */'}));
  await page.route('https://www.facebook.com/**',route=>route.fulfill({status:204}));
  const records:{url:string;type:string;bytes:number}[]=[];
  const pending:Promise<void>[]=[];
  page.on('requestfinished',request=>{pending.push(request.sizes().then(sizes=>{records.push({url:request.url(),type:request.resourceType(),bytes:sizes.responseBodySize+sizes.responseHeadersSize});}));});
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('#landing-meta-pixel')).toHaveCount(consent==='accepted'?1:0);
  await page.waitForLoadState('networkidle');
  await Promise.all(pending);
  const initial=[...records];
  expect(initial.filter(item=>/\.(glb|gltf)(\?|$)/.test(item.url))).toEqual([]);
  // Video is interaction-triggered; poster must be all that loads initially.
  expect(initial.filter(item=>/\.(mp4|webm)(\?|$)/.test(item.url))).toEqual([]);
  for(const section of await page.locator('main section').all()){
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }
  const strip=page.locator('[data-lineup]');await strip.scrollIntoViewIfNeeded();
  for(const card of await strip.locator('li').all()){
    await card.evaluate(el=>{const parent=el.parentElement!;parent.scrollLeft=(el as HTMLElement).offsetLeft-parent.offsetLeft;});
    await expect.poll(()=>card.locator('img').evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
  }
  await page.waitForLoadState('networkidle');await Promise.all(pending);
  const sum=(items:typeof records)=>items.reduce((total,item)=>total+item.bytes,0);
  const posterUrl=await page.locator('#hero img').evaluate(image=>(image as HTMLImageElement).currentSrc);
  const images=initial.filter(item=>item.url===posterUrl);
  expect(images.length,'the real hero poster must have a measured network response').toBeGreaterThan(0);
  const blockingScripts = await page.locator('script[src]:not([async]):not([defer]):not([type=module])').evaluateAll(nodes => nodes.map(node => (node as HTMLScriptElement).src));
  const measured={initial:sum(initial),javascript:sum(initial.filter(item=>item.type==='script')),
    critical:sum(initial.filter(item=>['document','stylesheet','font'].includes(item.type) || (item.type === 'script' && blockingScripts.includes(item.url))))+sum(images),
    poster:Math.max(0,...images.map(item=>item.bytes)),fullScroll:sum(records)};
  await testInfo.attach(`transfer-${consent}.json`,{body:JSON.stringify({scope:'local assets + offline Meta stub; live Meta costs unmeasured',measured,records},null,2),contentType:'application/json'});
  expect(checkTransferBudget(measured)).toEqual([]);
});
