// Run against the production fixture server; saves browser evidence, not a perf gate.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const output=process.argv[2] ?? 'tmp/lcp-visibility';
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox']});
const results=[];
try {
 for(const javaScriptEnabled of [false,true]) {
  const context=await browser.newContext({javaScriptEnabled,viewport:{width:375,height:812},deviceScaleFactor:1});
  const page=await context.newPage();
  const session=await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled',{cacheDisabled:true});
  await session.send('Emulation.setCPUThrottlingRate',{rate:4});
  await session.send('Tracing.start',{categories:'devtools.timeline,loading,blink.user_timing,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});
  if(javaScriptEnabled)await page.addInitScript(()=>{
   window.__lcp=[];
   new PerformanceObserver(list=>window.__lcp.push(...list.getEntries().map(e=>({time:e.startTime,url:e.url,element:e.element?.outerHTML})))).observe({type:'largest-contentful-paint',buffered:true});
  });
  await page.goto('http://localhost:44170/',{waitUntil:'networkidle'});
  const evidence=await page.evaluate(()=>{
   const inspect=selector=>{
    const el=document.querySelector(selector),chain=[];
    for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);chain.push({tag:node.tagName,id:node.id,opacity:s.opacity,visibility:s.visibility,display:s.display,transform:s.transform,clip:s.clip,clipPath:s.clipPath,animation:s.animationName});}
    return {html:el.outerHTML,rect:el.getBoundingClientRect().toJSON(),chain};
   };
   return {title:inspect('#hero-title'),poster:inspect('#hero img'),lcp:window.__lcp,paint:performance.getEntriesByType('paint').map(e=>e.toJSON()),resources:performance.getEntriesByType('resource').filter(e=>/webp|woff/.test(e.name)).map(e=>e.toJSON())};
  });
  await page.screenshot({path:`${output}/${javaScriptEnabled?'js':'no-js'}.png`});
  const complete=new Promise(resolve=>session.once('Tracing.tracingComplete',resolve));
  await session.send('Tracing.end');
  const {stream}=await complete;let trace='';
  for(;;){const chunk=await session.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}
  await session.send('IO.close',{handle:stream});
  writeFileSync(`${output}/${javaScriptEnabled?'js':'no-js'}-trace.json`,trace);
  results.push({javaScriptEnabled,...evidence});await context.close();
 }
 writeFileSync(`${output}/evidence.json`,JSON.stringify(results,null,2));
} finally {await browser.close();}
