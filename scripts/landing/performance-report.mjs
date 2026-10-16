/** Summarize real LHCI network records; never substitute offline Pixel costs. */
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
    firstParty,thirdParty,total:firstParty+thirdParty};
}
export function checkFirstPartyRuns(reports) {
  if(reports.length!==3)return ['three-cold-runs-required'];
  try {
    const runs=reports.map(summarizeRun);
    return runs.some(run=>run.firstParty>500000)?['first-party-bytes']:[];
  } catch {return ['incomplete-run'];}
}
export function checkConsentRuns(reports,state) {
  if(reports.length!==3)return ['three-cold-runs-required'];
  for(const report of reports) {
    const origin=new URL(report.finalDisplayedUrl ?? report.finalUrl ?? report.requestedUrl).origin;
    const requests=report.audits['network-requests']?.details?.items ?? [];
    const external=requests.filter(item=>/^https?:/.test(item.url) && new URL(item.url).origin!==origin);
    if(state==='unset' && external.length)return ['unexpected-third-party-request'];
    if(state==='accepted') {
      const pixel=external.find(item=>new URL(item.url).hostname==='connect.facebook.net' && new URL(item.url).pathname.endsWith('/fbevents.js'));
      if(!pixel || pixel.statusCode!==200 || pixel.transferSize<=0 || external.some(item=>item.finished!==true))return ['pixel-transfer-unmeasured'];
    }
  }
  return [];
}
