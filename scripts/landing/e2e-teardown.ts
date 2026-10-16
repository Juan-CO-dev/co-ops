import { readFileSync, unlinkSync } from 'node:fs';
export default function teardown() {
  try {
    const pids=JSON.parse(readFileSync('tmp-landing-server-pids.json','utf8')) as number[];
    for(const pid of pids) { try { process.kill(pid); } catch {} }
    unlinkSync('tmp-landing-server-pids.json');
  } catch {}
}
