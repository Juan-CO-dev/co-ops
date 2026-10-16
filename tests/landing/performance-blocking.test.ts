import {it,expect} from 'vitest';
import {checkConsentRuns} from '../../scripts/landing/performance-report.mjs';
const blocked=()=>({finalUrl:'http://localhost:44170/',configSettings:{blockedUrlPatterns:['*://connect.facebook.net/*','*://www.facebook.com/tr/*']},audits:{'network-requests':{details:{items:[{url:'https://connect.facebook.net/en_US/fbevents.js',statusCode:0,finished:false,transferSize:0}]}}}});
it('requires opt-in AND recorded blocking evidence for first-party-only measurements',()=>{
 const reports=[blocked(),blocked(),blocked(),blocked(),blocked()];
 expect(checkConsentRuns(reports,'accepted')).toEqual(['pixel-transfer-unmeasured']);
 expect(checkConsentRuns(reports,'accepted',{blockPixel:true})).toEqual([]);
 reports[0]!.configSettings.blockedUrlPatterns=[];
 expect(checkConsentRuns(reports,'accepted',{blockPixel:true})).toContain('pixel-blocking-unverified');
});
it('refuses third-party bytes and unexpected third-party URLs in blocked runs',()=>{
 const report=blocked();
 report.audits['network-requests'].details.items[0]!.transferSize=100;
 expect(checkConsentRuns([report,report,report,report,report],'accepted',{blockPixel:true})).toContain('unexpected-third-party-transfer');
 report.audits['network-requests'].details.items[0]!.transferSize=0;
 report.audits['network-requests'].details.items[0]!.url='https://other.example/script.js';
 expect(checkConsentRuns([report,report,report,report,report],'accepted',{blockPixel:true})).toContain('unexpected-third-party-request');
});
it('still refuses an unset run requesting the Pixel',()=>{
 const report=blocked();
 expect(checkConsentRuns([report,report,report,report,report],'unset',{blockPixel:true})).toEqual(['unexpected-third-party-request']);
});

it('rejects pixel blocking outside the named measurement harness', async () => {
 const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const old={...process.env};
 try {
  process.env.LANDING_PERF_BLOCK_PIXEL='1';
  delete process.env.LANDING_PERF_HARNESS;
  delete require.cache[require.resolve('../../lighthouserc.cjs')];
  expect(()=>require('../../lighthouserc.cjs')).toThrow('measurement harness');
 } finally {process.env=old;delete require.cache[require.resolve('../../lighthouserc.cjs')];}
});

it('keeps the blocking switch outside all shipped application code', async () => {
 const {readdirSync,readFileSync}=await import('node:fs');
 for(const dir of ['app','components','lib']) {
  for(const file of readdirSync(dir,{recursive:true}) as string[]) {
   if(/\.(?:tsx?|[cm]?js)$/.test(file)) expect(readFileSync(`${dir}/${file}`,'utf8')).not.toContain('LANDING_PERF_BLOCK_PIXEL');
  }
 }
 for(const file of ['proxy.ts','next.config.ts','instrumentation.ts']) expect(readFileSync(file,'utf8')).not.toContain('LANDING_PERF_BLOCK_PIXEL');
});
