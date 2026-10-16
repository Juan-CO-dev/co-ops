import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
let failed=false;
for(const state of ['accepted','unset']) {
  // No shell interpolation; this changes this test process only.
  const child=spawn(process.platform==='win32'?'cmd.exe':'npx',process.platform==='win32'?['/d','/s','/c','npx --yes --package=@lhci/cli@0.15.1 lhci autorun']:['--yes','--package=@lhci/cli@0.15.1','lhci','autorun'],{stdio:'inherit',env:{...process.env,LANDING_PERF_CONSENT:state}});
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
  failed ||= code!==0;
  // Preserve every raw run even when assertions fail, before the next collect clears it.
  if(existsSync('.lighthouseci')){
    mkdirSync(`tmp/landing-performance/raw-${state}`,{recursive:true});
    for(const file of readdirSync('.lighthouseci'))if(/^(lhr-|assertion-results).*\.(json|html)$/.test(file))copyFileSync(`.lighthouseci/${file}`,`tmp/landing-performance/raw-${state}/${file}`);
  }
  // LHCI's parent termination alone does not terminate Next children on Windows.
  if(existsSync('tmp-landing-server-pids.json')){
    for(const pid of JSON.parse(readFileSync('tmp-landing-server-pids.json','utf8')))try{process.kill(pid);}catch{}
    unlinkSync('tmp-landing-server-pids.json');
  }
}
process.exitCode=failed?1:0;
