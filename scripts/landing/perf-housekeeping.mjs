import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';

export function bestEffort(label, action) {
  try { action(); } catch (error) { console.error(`${label}: ${error}`); }
}

export function cleanupPids(file) {
  bestEffort('PID cleanup', () => {
    let pids;
    try { pids = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!Array.isArray(pids)) throw Error('Invalid PID list');
    for (const pid of pids) {
      if (!Number.isSafeInteger(pid) || pid <= 0) continue;
      bestEffort(`Stop PID ${pid}`, () => process.kill(pid));
    }
  });
  bestEffort('Remove PID file', () => {
    try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
}

export function writePidsAtomic(file, pids) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(pids));
    renameSync(temporary, file);
  } finally {
    bestEffort('Remove temporary PID file', () => {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    });
  }
}
