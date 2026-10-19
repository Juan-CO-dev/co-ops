/** Summarize real LHCI network records; never substitute offline Pixel costs. */
export function collectionBlocks(collection,code,failures) {
  return collection!=='simulated-report-only' && (code!==0 || failures.length>0);
}
export function summarizeRun(report) {
  const origin=new URL(report.finalDisplayedUrl ?? report.finalUrl ?? report.requestedUrl).origin;
  const requests=report.audits['network-requests']?.details?.items;
  if(!Array.isArray(requests) || !requests.length) throw Error('Missing network measurements');
  let firstParty=0,thirdParty=0;
  for(const item of requests) {
    if(!Number.isFinite(item.transferSize)) throw Error('Missing transfer size');
    if(new URL(item.url).origin===origin)firstParty+=item.transferSize;
    else thirdParty+=item.transferSize;
  }
  return {performance:report.categories.performance.score,
    lcp:report.audits['largest-contentful-paint'].numericValue,
    tbt:report.audits['total-blocking-time'].numericValue,
    // Lighthouse's entity-attributed blocking, distinct from page-wide TBT.
    thirdPartyBlockingTime:report.audits['third-party-summary']?.details?.summary?.wastedMs ?? null,
    firstParty,thirdParty,total:firstParty+thirdParty};
}
export function checkFirstPartyRuns(reports) {
  if(reports.length!==5)return ['five-cold-runs-required'];
  try {
    const runs=reports.map(summarizeRun);
    const failures=runs.some(run=>run.firstParty>500000)?['first-party-bytes']:[];
    const median=key=>runs.map(run=>run[key]).sort((a,b)=>a-b)[2];
    for(const key of ['performance','lcp','tbt']) if(runs.some(run=>!Number.isFinite(run[key]))) return ['incomplete-run'];
    if(median('performance')<0.85)failures.push('performance');
    if(median('lcp')>=2500)failures.push('lcp');
    if(median('tbt')>200)failures.push('tbt');
    return failures;
  } catch {return ['incomplete-run'];}
}
export function checkConsentRuns(reports,state,{blockPixel=false}={}) {
  if(reports.length!==5)return ['five-cold-runs-required'];
  for(const report of reports) {
    const origin=new URL(report.finalDisplayedUrl ?? report.finalUrl ?? report.requestedUrl).origin;
    const requests=report.audits['network-requests']?.details?.items ?? [];
    const external=requests.filter(item=>/^https?:/.test(item.url) && new URL(item.url).origin!==origin);
    if(state==='unset' && external.length)return ['unexpected-third-party-request'];
    if(blockPixel) {
      const patterns=report.configSettings?.blockedUrlPatterns ?? [];
      if(!['*://connect.facebook.net/*','*://www.facebook.com/tr/*'].every(pattern=>patterns.includes(pattern)))return ['pixel-blocking-unverified'];
      if(external.some(item=>!Number.isFinite(item.transferSize)||item.transferSize!==0||item.statusCode===200))return ['unexpected-third-party-transfer'];
      if(external.some(item=>{
        const url=new URL(item.url);
        return url.hostname!=='connect.facebook.net' && !(url.hostname==='www.facebook.com' && url.pathname.startsWith('/tr/'));
      }))return ['unexpected-third-party-request'];
      continue;
    }
    if(state==='accepted') {
      const pixel=external.find(item=>new URL(item.url).hostname==='connect.facebook.net' && new URL(item.url).pathname.endsWith('/fbevents.js'));
      if(!pixel || pixel.statusCode!==200 || pixel.transferSize<=0 || external.some(item=>item.finished!==true))return ['pixel-transfer-unmeasured'];
    }
  }
  return [];
}
