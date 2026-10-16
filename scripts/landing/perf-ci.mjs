import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import {checkFirstPartyRuns,checkConsentRuns,summarizeRun} from './performance-report.mjs';
let failed=false;
for(const state of ['accepted','unset']) {
  // A failed collect must never report a previous state's cached measurements.
  if(existsSync('.lighthouseci')) for(const file of readdirSync('.lighthouseci'))
    if(/^(lhr-|assertion-results).*\.(json|html)$/.test(file))unlinkSync(`.lighthouseci/${file}`);
  // No shell interpolation; this changes this test process only.
  // Optional installed 0.15.1 CLI for offline local runs; CI uses pinned npx.
  const local=process.env.LHCI_CLI_PATH;
  const child=spawn(local?process.execPath:process.platform==='win32'?'cmd.exe':'npx',local?[local,'autorun']:process.platform==='win32'?['/d','/s','/c','npx --yes --cache .npm-cache --package=@lhci/cli@0.15.1 lhci autorun']:['--yes','--cache','.npm-cache','--package=@lhci/cli@0.15.1','lhci','autorun'],{stdio:'inherit',env:{...process.env,LANDING_PERF_CONSENT:state}});
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
  failed ||= code!==0;
  // Preserve every raw run even when assertions fail, before the next collect clears it.
  if(existsSync('.lighthouseci')){
    mkdirSync(`tmp/landing-performance/raw-${state}`,{recursive:true});
    for(const file of readdirSync('.lighthouseci'))if(/^(lhr-|assertion-results).*\.(json|html)$/.test(file))copyFileSync(`.lighthouseci/${file}`,`tmp/landing-performance/raw-${state}/${file}`);
    const reports=readdirSync('.lighthouseci').filter(file=>/^lhr-.*\.json$/.test(file)).map(file=>JSON.parse(readFileSync(`.lighthouseci/${file}`,'utf8')));
    const failures=checkFirstPartyRuns(reports);
    if(!failures.includes('incomplete-run'))failures.push(...checkConsentRuns(reports,state));
    failed ||= failures.length>0;
    const summary={state,failures,runs:failures.includes('incomplete-run')?[]:reports.map(summarizeRun)};
    writeFileSync(`tmp/landing-performance/${state}.json`,JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary));
  }
  // LHCI's parent termination alone does not terminate Next children on Windows.
  if(existsSync('tmp-landing-server-pids.json')){
    for(const pid of JSON.parse(readFileSync('tmp-landing-server-pids.json','utf8')))try{process.kill(pid);}catch{}
    unlinkSync('tmp-landing-server-pids.json');
  }
}
process.exitCode=failed?1:0;
