import {it,expect} from 'vitest';
import {checkTransferBudget,TRANSFER_LIMITS} from '../../scripts/check-transfer-budget.mjs';
import {checkFirstPartyRuns,checkConsentRuns,summarizeRun} from '../../scripts/landing/performance-report.mjs';
const fixture=(bytes=499999)=>({finalUrl:'http://localhost:44170/',categories:{performance:{score:0.9}},audits:{
  'largest-contentful-paint':{numericValue:2000},'total-blocking-time':{numericValue:150},
  'network-requests':{details:{items:[{url:'http://localhost:44170/a.js',transferSize:bytes},{url:'https://connect.facebook.net/pixel.js',transferSize:116000}]}}
}});
it('gates real first-party network bytes separately from the accepted Pixel',()=>{
  expect(summarizeRun(fixture())).toMatchObject({firstParty:499999,thirdParty:116000,total:615999});
  expect(checkFirstPartyRuns([fixture(),fixture(),fixture()])).toEqual([]);
  expect(checkFirstPartyRuns([fixture(500001),fixture(),fixture()])).toEqual(['first-party-bytes']);
  expect(checkFirstPartyRuns([fixture(),fixture()])).toEqual(['three-cold-runs-required']);
  expect(checkFirstPartyRuns([fixture(),fixture(),{}])).toEqual(['incomplete-run']);
});
it('refuses missing or oversized compressed transfer measurements for every budget',()=>{
  expect(checkTransferBudget({...TRANSFER_LIMITS})).toEqual([]);
  for(const key of (Object.keys(TRANSFER_LIMITS) as (keyof typeof TRANSFER_LIMITS)[]))expect(checkTransferBudget({...TRANSFER_LIMITS,[key]:TRANSFER_LIMITS[key]+1})).toEqual([key]);
  expect(checkTransferBudget({})).toHaveLength(5);
});
it('refuses an accepted benchmark with an unfinished or missing real Pixel',()=>{
  expect(checkConsentRuns([fixture(),fixture(),fixture()],'accepted')).toContain('pixel-transfer-unmeasured');
  expect(checkConsentRuns([fixture(),fixture(),fixture()],'unset')).toContain('unexpected-third-party-request');
  const measured=fixture();
  Object.assign(measured.audits['network-requests'].details.items[1]!,{url:'https://connect.facebook.net/en_US/fbevents.js',statusCode:200,finished:true});
  expect(checkConsentRuns([measured,measured,measured],'accepted')).toEqual([]);
  Object.assign(measured.audits['network-requests'].details.items[1]!,{finished:false});
  expect(checkConsentRuns([measured,measured,measured],'accepted')).toEqual(['pixel-transfer-unmeasured']);
});

it.each(['performance','lcp','tbt'])('rejects a first-party %s regression', metric => {
 const report=fixture();
 if(metric==='performance') report.categories.performance.score=0.84;
 if(metric==='lcp') report.audits['largest-contentful-paint'].numericValue=2500;
 if(metric==='tbt') report.audits['total-blocking-time'].numericValue=201;
 expect(checkFirstPartyRuns([report,report,report])).toContain(metric);
});

it('reports measured third-party blocking separately, never inventing a missing attribution', () => {
 const report=fixture();
 expect(summarizeRun(report).thirdPartyBlockingTime).toBeNull();
 const attributed={...report,audits:{...report.audits,'third-party-summary':{details:{summary:{wastedMs:158}}}}};
 expect(summarizeRun(attributed).thirdPartyBlockingTime).toBe(158);
});
