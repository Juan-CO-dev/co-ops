import {test,expect} from '@playwright/test';

for(const language of ['en','es']) for(const height of [667,812]) test(`static A geometry ${language} 375x${height}`,async({page})=>{
  await page.setViewportSize({width:375,height});
  await page.goto(`/?lang=${language}`);
  await page.evaluate(()=>document.querySelector<HTMLElement>('.landing-v2')!.style.setProperty('--landing-safe-bottom','34px'));
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','false');
  const boxes=await page.evaluate(()=>{
    const box=(s:string)=>document.querySelector(s)!.getBoundingClientRect().toJSON();
    return {header:box('.landing-v2-header'),copy:box('.landing-v2-hero-copy'),actions:box('[data-hero-actions]'),dock:box('.landing-v2-consent'),photo:box('#hero img'),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  expect(boxes.header.height).toBeLessThanOrEqual(52);
  expect(boxes.copy.height).toBeLessThanOrEqual(340);
  expect(boxes.actions.bottom).toBeLessThanOrEqual(392);
  expect(boxes.dock.height).toBeLessThanOrEqual(200);
  expect(boxes.dock.top).toBeGreaterThanOrEqual(height-234);
  expect(boxes.dock.top-boxes.actions.bottom).toBeGreaterThanOrEqual(41);
  expect(boxes.overflow).toBe(false);
  // Catering remains above the fold in the header; both shop links (+ v4's "find your shop") stay in hero.
  const links=page.locator('[data-hero-actions] a, .landing-v2-header .landing-v2-catering-link');
  await expect(links).toHaveCount(4);
  for(const link of await links.all()) {
    const b=(await link.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    await link.focus();await expect(link).toBeFocused();
  }
  await expect(page.locator('[data-sticky-order]')).toBeHidden();
  await expect(page.locator('#hero video,[data-playful-touch]')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath(`static-${language}-${height}.png`)});
});

for(const language of ['en','es']) test(`expanded consent follows actions and retains focus ${language}`,async({page})=>{
  await page.goto(`/?lang=${language}`);
  const accept=page.locator('[data-landing-consent] button').first();
  await accept.focus();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','true');
  await expect(accept).toBeFocused();
  const geometry=await page.evaluate(()=>{
    const actions=document.querySelector('[data-hero-actions]')!.getBoundingClientRect();
    const consent=document.querySelector('.landing-v2-consent')!.getBoundingClientRect();
    const photo=document.querySelector('#hero img')!.getBoundingClientRect();
    return {ordered:actions.bottom<=consent.top&&consent.bottom<=photo.top,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  expect(geometry).toEqual({ordered:true,overflow:false});
});

test('desktop static A screenshot',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  await expect(page.locator('#hero')).toHaveCSS('background-color','rgb(237, 51, 8)');
  await expect(page.locator('#hero img')).toHaveCSS('border-radius','0px');
  await page.screenshot({path:test.info().outputPath('static-1440.png')});
});

for(const consent of ['unset','accepted']) for(const dpr of [1,2,3]) test(`initial first-party bytes ${consent} DPR ${dpr}`,async({browser,baseURL},info)=>{
  const context=await browser.newContext({viewport:{width:375,height:667},deviceScaleFactor:dpr});
  try {
    if(consent==='accepted')await context.addCookies([{name:'landing_consent',value:'accepted',url:baseURL!}]);
    const page=await context.newPage();
    await page.route('https://connect.facebook.net/**',r=>r.fulfill({contentType:'application/javascript',body:'/* offline fixture; live Meta unmeasured */'}));
    await page.route('https://www.facebook.com/**',r=>r.fulfill({status:204}));
    const sizes:Promise<{url:string;bytes:number}>[]=[];
    page.on('requestfinished',r=>{
      if(new URL(r.url()).origin===new URL(baseURL!).origin)sizes.push(r.sizes().then(s=>({url:r.url(),bytes:s.responseBodySize+s.responseHeadersSize})));
    });
    await page.goto(baseURL!);await page.waitForLoadState('networkidle');
    const records=await Promise.all(sizes),bytes=records.reduce((n,r)=>n+r.bytes,0);
    await info.attach('initial-transfer.json',{body:JSON.stringify({consent,dpr,bytes,records},null,2),contentType:'application/json'});
    console.log(`INITIAL_FIRST_PARTY ${consent} DPR${dpr}: ${bytes} bytes`);
    expect(bytes).toBeGreaterThan(0);expect(bytes).toBeLessThanOrEqual(500000);
    expect(records.filter(r=>/\.(mp4|webm)(\?|$)/.test(r.url))).toEqual([]);
  } finally {await context.close();}
});


test('landing CSS remains absent from staff markup and loaded stylesheets',async({page,baseURL})=>{
  await page.goto(new URL('/login',baseURL!.replace('localhost','127.0.0.1')).href);
  await expect(page.locator('.landing-v2,#hero')).toHaveCount(0);
  const hrefs=await page.locator('link[rel="stylesheet"]').evaluateAll(links=>links.map(link=>(link as HTMLLinkElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  for(const href of hrefs) {
    const response=await page.request.get(href);
    expect(response.ok(),href).toBe(true);
    expect(await response.text(),href).not.toContain('.landing-v2');
  }
  await expect(page.locator('body')).toBeVisible();
});

for(const width of [375,187]) test(`no-JS footer and narrow zoom fallback at ${width}px`,async({browser,baseURL})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:667}});
  try {
    const page=await context.newPage();await page.goto(baseURL!);
    const notice=page.locator('.landing-v2-consent');
    if(width===187)await expect(notice).toHaveCSS('position','relative');
    const link=page.locator('#footer nav a').last();await link.scrollIntoViewIfNeeded();
    if(width===375)expect((await link.boundingBox())!.y+(await link.boundingBox())!.height).toBeLessThanOrEqual((await notice.boundingBox())!.y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {await context.close();}
});
