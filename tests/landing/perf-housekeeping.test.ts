import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {bestEffort,cleanupPids,writePidsAtomic} from '../../scripts/landing/perf-housekeeping.mjs';

vi.mock('node:fs',()=>({readFileSync:vi.fn(),writeFileSync:vi.fn(),renameSync:vi.fn(),unlinkSync:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());
it('logs malformed PID data and unlink failures without throwing',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.mocked(readFileSync).mockReturnValue('{');
 vi.mocked(unlinkSync).mockImplementation(()=>{throw Error('access denied');});
 expect(()=>cleanupPids('pids.json')).not.toThrow();
 expect(log).toHaveBeenCalledTimes(2);
});
it('continues killing remaining valid PIDs after a kill failure',()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.mocked(readFileSync).mockReturnValue('[123,0,-1,"456",456]');
 vi.mocked(unlinkSync).mockImplementation(()=>{});
 const kill=vi.spyOn(process,'kill').mockImplementation(pid=>{if(pid===123)throw Error('gone');return true;});
 cleanupPids('pids.json');
 expect(kill.mock.calls.map(call=>call[0])).toEqual([123,456]);
 expect(unlinkSync).toHaveBeenCalledWith('pids.json');
});
it('logs failed error-evidence writes and continues',()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 expect(()=>bestEffort('error evidence',()=>{throw Error('disk full');})).not.toThrow();
 expect(log).toHaveBeenCalledWith('error evidence: Error: disk full');
});
it('publishes complete PID JSON by renaming a sibling temporary file',()=>{
 vi.mocked(unlinkSync).mockImplementation(()=>{});
 writePidsAtomic('pids.json',[123,456]);
 const temporary=`pids.json.${process.pid}.tmp`;
 expect(writeFileSync).toHaveBeenCalledWith(temporary,'[123,456]');
 expect(renameSync).toHaveBeenCalledWith(temporary,'pids.json');
 expect(vi.mocked(writeFileSync).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(renameSync).mock.invocationCallOrder.at(-1)!);
});
