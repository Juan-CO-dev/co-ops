import { it, expect } from 'vitest';
import { checkLandingReport, type LighthouseReport } from '@/scripts/landing/performance-report';
const fixture = ():LighthouseReport => ({categories:{performance:{score:0.9},accessibility:{score:1}},audits:{'largest-contentful-paint':{numericValue:2000},'total-byte-weight':{numericValue:500000}}});
it('accepts measured scores and refuses deliberately over-budget or missing reports',()=> {
  expect(checkLandingReport(fixture())).toEqual([]);
  const tooLarge=fixture(); tooLarge.audits['total-byte-weight']={numericValue:600001};
  expect(checkLandingReport(tooLarge)).toEqual(['total-byte-weight']);
  const inaccessible=fixture(); inaccessible.categories.accessibility={score:0.94};
  expect(checkLandingReport(inaccessible)).toEqual(['categories:accessibility']);
  expect(checkLandingReport({categories:{},audits:{}})).toHaveLength(4);
});
