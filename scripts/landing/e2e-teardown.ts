import { pidFile } from './e2e-ports.cjs';
import { readFileSync, unlinkSync } from 'node:fs';
export default function teardown() {
  try {
    const pids=JSON.parse(readFileSync(pidFile,'utf8')) as number[];
    for(const pid of pids) { try { process.kill(pid); } catch {} }
    unlinkSync(pidFile);
  } catch {}
}
