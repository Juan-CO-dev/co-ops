import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import {checkFirstPartyRuns,checkConsentRuns,summarizeRun} from './performance-report.mjs';
let failed=false;
const launch=process.argv.includes('--launch');
if(process.argv.slice(2).some(arg=>arg!=='--launch'))throw Error('Unknown measurement mode');
const url=launch?process.env.LANDING_PERF_URL:'http://localhost:44170/';
if(launch && (!url || new URL(url).protocol!=='https:'))throw Error('Launch measurement requires LANDING_PERF_URL: real HTTPS preview');
const blockPixel=!launch;
const runDir=`tmp/landing-performance/${new Date().toISOString().replaceAll(':','-')}-${launch?'launch':'merge'}-${randomUUID().slice(0,8)}`;
mkdirSync(runDir,{recursive:true});
console.log(`Measurement evidence: ${runDir}`);
const measurement=blockPixel?'first-party-only-pixel-blocked':'real-pixel';
for(const state of (launch?['accepted']:['unset','accepted'])) {
  // A failed collect must never report a previous state's cached measurements.
  if(existsSync('.lighthouseci')) for(const file of readdirSync('.lighthouseci'))
    if(/^(lhr-|assertion-results).*\.(json|html)$/.test(file))unlinkSync(`.lighthouseci/${file}`);
  // No shell interpolation; this changes this test process only.
  // Optional installed 0.15.1 CLI for offline local runs; CI uses pinned npx.
  const local=process.env.LHCI_CLI_PATH;
  const child=spawn(local?process.execPath:process.platform==='win32'?'cmd.exe':'npx',local?[local,'autorun']:process.platform==='win32'?['/d','/s','/c','npx --yes --cache .npm-cache --package=@lhci/cli@0.15.1 lhci autorun']:['--yes','--cache','.npm-cache','--package=@lhci/cli@0.15.1','lhci','autorun'],{stdio:'inherit',env:{...process.env,LANDING_PERF_CONSENT:state,LANDING_PERF_HARNESS:launch?'launch':'merge',LANDING_PERF_BLOCK_PIXEL:blockPixel?'1':'0',LANDING_PERF_URL:url}});
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
  failed ||= code!==0;
  // Preserve every raw run even when assertions fail, before the next collect clears it.
  if(existsSync('.lighthouseci')){
    mkdirSync(`${runDir}/raw-${state}`,{recursive:true});
    for(const file of readdirSync('.lighthouseci'))if(/^(lhr-|assertion-results).*\.(json|html)$/.test(file))copyFileSync(`.lighthouseci/${file}`,`${runDir}/raw-${state}/${file}`);
    const reports=readdirSync('.lighthouseci').filter(file=>/^lhr-.*\.json$/.test(file)).map(file=>JSON.parse(readFileSync(`.lighthouseci/${file}`,'utf8')));
    const budgetFailures=checkFirstPartyRuns(reports);
    const consentFailures=checkConsentRuns(reports,state,{blockPixel});
    const failures=[...budgetFailures,...consentFailures];
    failed ||= failures.length>0;
    const summary={state,measurement,thirdPartyCostMeasured:!blockPixel&&state==='accepted'&&reports.length===3&&consentFailures.length===0,failures,runs:failures.includes('incomplete-run')?[]:reports.map(summarizeRun)};
    writeFileSync(`${runDir}/${state}.json`,JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary));
  }
  // LHCI's parent termination alone does not terminate Next children on Windows.
  if(existsSync('tmp-landing-server-pids.json')){
    for(const pid of JSON.parse(readFileSync('tmp-landing-server-pids.json','utf8')))try{process.kill(pid);}catch{}
    unlinkSync('tmp-landing-server-pids.json');
  }
}
process.exitCode=failed?1:0;
