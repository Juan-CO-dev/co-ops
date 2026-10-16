import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const config = require('../../lighthouserc.cjs') as { ci:{assert:{assertions:Record<string,[string,{minScore?:number;maxNumericValue?:number}]>}} };
export interface LighthouseReport { categories: Record<string,{score:number|null}>; audits: Record<string,{numericValue?:number}> }
/** Reusable gate for exported Lighthouse reports; missing measurements fail, not skip. */
export function checkLandingReport(report:LighthouseReport):string[] {
  const failures:string[]=[];
  for(const [key,[,threshold]] of Object.entries(config.ci.assert.assertions)) {
    const value = key.startsWith('categories:') ? report.categories[key.slice(11)]?.score : report.audits[key]?.numericValue;
    if(typeof value !== 'number' || !Number.isFinite(value) || (threshold.minScore !== undefined && value < threshold.minScore) || (threshold.maxNumericValue !== undefined && value > threshold.maxNumericValue)) failures.push(key);
  }
  return failures;
}
export function checkColdRuns(reports:LighthouseReport[]):string[] {
  if(reports.length!==3)return ['three-cold-runs-required'];
  const median:LighthouseReport={categories:{},audits:{}};
  for(const key of Object.keys(config.ci.assert.assertions)){
    const values=reports.map(report=>key.startsWith('categories:')?report.categories[key.slice(11)]?.score:report.audits[key]?.numericValue);
    if(values.some(value=>typeof value!=='number'||!Number.isFinite(value)))return ['incomplete-run'];
    const value=(values as number[]).sort((a,b)=>a-b)[1]!;
    if(key.startsWith('categories:'))median.categories[key.slice(11)]={score:value};
    else median.audits[key]={numericValue:value};
  }
  return checkLandingReport(median);
}
