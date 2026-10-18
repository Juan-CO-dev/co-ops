import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {checkTransferBudget,TRANSFER_LIMITS} from '../../scripts/check-transfer-budget.mjs';
import {checkFirstPartyRuns,checkConsentRuns,summarizeRun,collectionBlocks} from '../../scripts/landing/performance-report.mjs';
const fixture=(bytes=499999)=>({finalUrl:'http://localhost:44170/',categories:{performance:{score:0.9}},audits:{
  'largest-contentful-paint':{numericValue:2000},'total-blocking-time':{numericValue:150},
  'network-requests':{details:{items:[{url:'http://localhost:44170/a.js',transferSize:bytes},{url:'https://connect.facebook.net/pixel.js',transferSize:116000}]}}
}});
it('blocks applied mobile throttling at 2.5 s and keeps every simulated assertion report-only',()=>{
 const require=createRequire(import.meta.url),path=require.resolve('../../lighthouserc.cjs'),old={...process.env};
 try {
  process.env.LANDING_PERF_HARNESS='merge';process.env.LANDING_PERF_BLOCK_PIXEL='1';
  for(const collection of ['applied-blocking','simulated-report-only']){
   process.env.LANDING_PERF_COLLECTION=collection;delete require.cache[path];
   const {collect,assert}=require(path).ci;
   const simulated=collection==='simulated-report-only';
   expect(collect.numberOfRuns).toBe(5);
   expect(collect.settings.throttlingMethod).toBe(simulated?'simulate':'devtools');
   expect(collect.settings.throttling).toMatchObject({requestLatencyMs:562.5,downloadThroughputKbps:1474.56,uploadThroughputKbps:675,cpuSlowdownMultiplier:4});
   expect(assert.assertions['largest-contentful-paint']).toEqual([simulated?'warn':'error',{maxNumericValue:2499.999,aggregationMethod:'median'}]);
   for(const assertion of Object.values(assert.assertions) as [string,unknown][])expect(assertion[0]).toBe(simulated?'warn':'error');
   expect(collectionBlocks(collection,1,['lcp','performance','first-party-bytes'])).toBe(!simulated);
   expect(collectionBlocks(collection,null,['incomplete-run'])).toBe(!simulated);
   expect(collectionBlocks(collection,0,[])).toBe(false);
  }
 } finally {process.env=old;delete require.cache[path];}
});
it.each(['merge','launch'])('collects exactly five cold runs for %s', harness=>{
  const require=createRequire(import.meta.url);
  const configPath=require.resolve('../../lighthouserc.cjs');
  const old={...process.env};
  try {
    process.env.LANDING_PERF_HARNESS=harness;
    process.env.LANDING_PERF_URL='https://preview.example.test/';
    process.env.LANDING_PERF_BLOCK_PIXEL=harness==='merge'?'1':'0';
    delete require.cache[configPath];
    expect(require(configPath).ci.collect.numberOfRuns).toBe(5);
  } finally {process.env=old;delete require.cache[configPath];}
});
it.each([0,2,3,4,6])('rejects %i reports instead of exactly five', count=>{
  const reports=Array.from({length:count},()=>fixture());
  expect(checkFirstPartyRuns(reports)).toEqual(['five-cold-runs-required']);
  for(const state of ['unset','accepted']) for(const blockPixel of [false,true])
    expect(checkConsentRuns(reports,state,{blockPixel})).toEqual(['five-cold-runs-required']);
});
it.each(['performance','lcp','tbt'])('uses the third sorted sample for the %s median', metric=>{
  const bad=()=>{
    const report=fixture();
    if(metric==='performance')report.categories.performance.score=0.84;
    if(metric==='lcp')report.audits['largest-contentful-paint'].numericValue=2500;
    if(metric==='tbt')report.audits['total-blocking-time'].numericValue=201;
    return report;
  };
  expect(checkFirstPartyRuns([bad(),fixture(),bad(),fixture(),fixture()])).toEqual([]);
  expect(checkFirstPartyRuns([fixture(),bad(),bad(),fixture(),bad()])).toEqual([metric]);
});
it('gates real first-party network bytes separately from the accepted Pixel',()=>{
  expect(summarizeRun(fixture())).toMatchObject({firstParty:499999,thirdParty:116000,total:615999});
  expect(checkFirstPartyRuns([fixture(),fixture(),fixture(),fixture(),fixture()])).toEqual([]);
  expect(checkFirstPartyRuns([fixture(500001),fixture(),fixture(),fixture(),fixture()])).toEqual(['first-party-bytes']);
  expect(checkFirstPartyRuns([fixture(),fixture()])).toEqual(['five-cold-runs-required']);
  expect(checkFirstPartyRuns([fixture(),fixture(),fixture(),fixture(),{}])).toEqual(['incomplete-run']);
});
it('refuses missing or oversized compressed transfer measurements for every budget',()=>{
  expect(checkTransferBudget({...TRANSFER_LIMITS})).toEqual([]);
  for(const key of (Object.keys(TRANSFER_LIMITS) as (keyof typeof TRANSFER_LIMITS)[]))expect(checkTransferBudget({...TRANSFER_LIMITS,[key]:TRANSFER_LIMITS[key]+1})).toEqual([key]);
  expect(checkTransferBudget({})).toHaveLength(5);
});
it('refuses an accepted benchmark with an unfinished or missing real Pixel',()=>{
  expect(checkConsentRuns([fixture(),fixture(),fixture(),fixture(),fixture()],'accepted')).toContain('pixel-transfer-unmeasured');
  expect(checkConsentRuns([fixture(),fixture(),fixture(),fixture(),fixture()],'unset')).toContain('unexpected-third-party-request');
  const measured=fixture();
  Object.assign(measured.audits['network-requests'].details.items[1]!,{url:'https://connect.facebook.net/en_US/fbevents.js',statusCode:200,finished:true});
  expect(checkConsentRuns([measured,measured,measured,measured,measured],'accepted')).toEqual([]);
  Object.assign(measured.audits['network-requests'].details.items[1]!,{finished:false});
  expect(checkConsentRuns([measured,measured,measured,measured,measured],'accepted')).toEqual(['pixel-transfer-unmeasured']);
});

it.each(['performance','lcp','tbt'])('rejects a first-party %s regression', metric => {
 const report=fixture();
 if(metric==='performance') report.categories.performance.score=0.84;
 if(metric==='lcp') report.audits['largest-contentful-paint'].numericValue=2500;
 if(metric==='tbt') report.audits['total-blocking-time'].numericValue=201;
 expect(checkFirstPartyRuns([report,report,report,report,report])).toContain(metric);
});

it('reports measured third-party blocking separately, never inventing a missing attribution', () => {
 const report=fixture();
 expect(summarizeRun(report).thirdPartyBlockingTime).toBeNull();
 const attributed={...report,audits:{...report.audits,'third-party-summary':{details:{summary:{wastedMs:158}}}}};
 expect(summarizeRun(attributed).thirdPartyBlockingTime).toBe(158);
});
