import { it, expect } from 'vitest';
import {checkTransferBudget,TRANSFER_LIMITS} from '../../scripts/check-transfer-budget.mjs';
import { checkLandingReport, checkColdRuns, type LighthouseReport } from '@/scripts/landing/performance-report';
const fixture = ():LighthouseReport => ({categories:{performance:{score:0.9},accessibility:{score:1}},audits:{'largest-contentful-paint':{numericValue:2000},'total-byte-weight':{numericValue:500000},'cumulative-layout-shift':{numericValue:0.05},'total-blocking-time':{numericValue:150}}});
it('accepts measured scores and refuses deliberately over-budget or missing reports',()=> {
  expect(checkLandingReport(fixture())).toEqual([]);
  const tooLarge=fixture(); tooLarge.audits['total-byte-weight']={numericValue:500001};
  expect(checkLandingReport(tooLarge)).toEqual(['total-byte-weight']);
  const inaccessible=fixture(); inaccessible.categories.accessibility={score:0.94};
  expect(checkLandingReport(inaccessible)).toEqual(['categories:accessibility']);
  expect(checkLandingReport({categories:{},audits:{}})).toHaveLength(6);
});
it('refuses missing or oversized compressed transfer measurements for every budget',()=>{
  expect(checkTransferBudget({...TRANSFER_LIMITS})).toEqual([]);
  for(const key of (Object.keys(TRANSFER_LIMITS) as (keyof typeof TRANSFER_LIMITS)[]))expect(checkTransferBudget({...TRANSFER_LIMITS,[key]:TRANSFER_LIMITS[key]+1})).toEqual([key]);
  expect(checkTransferBudget({})).toHaveLength(5);
});
it('requires three complete cold runs and gates the median without hiding individual reports',()=>{
  expect(checkColdRuns([fixture(),fixture()])).toContain('three-cold-runs-required');
  const slow=fixture();slow.audits['largest-contentful-paint']={numericValue:2500};
  expect(checkColdRuns([slow,slow,fixture()])).toContain('largest-contentful-paint');
  expect(checkColdRuns([slow,fixture(),fixture()])).toEqual([]);
  expect(checkColdRuns([fixture(),fixture(),{categories:{},audits:{}}])).toContain('incomplete-run');
});
