import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixture, fixtureSQL, retireSQL, preflight, runProof, signatures, userColumns } from '../scripts/sim/marketing-0289-lock-check-management.mjs';
import { projectRef, SIM_REF, PROD_REF } from '../scripts/supabase-management-query.mjs';

const grants = signatures.map((signature: string) => ({ signature, present: true, executable: true }));
const columns = userColumns.map((column_name: string) => ({ column_name }));

describe('0289 sim Management API proof (offline)', () => {
  it('guards the designated sim before creating transport and reads no environment files', () => {
    const source=readFileSync('scripts/sim/marketing-0289-lock-check-management.mjs','utf8');
    expect(source).toContain('projectRef(process.argv.slice(2),true)');
    expect(source.match(/process\.env\.[A-Z_]+/g)).toEqual(['process.env.SUPABASE_ACCESS_TOKEN']);
    expect(source).not.toMatch(/import.*dotenv/);
    expect(projectRef([`--ref=${SIM_REF}`],true)).toBe(SIM_REF);
    for (const ref of [PROD_REF,'aaaaaaaaaaaaaaaaaaaa']) expect(() => projectRef([`--ref=${ref}`],true)).toThrow();
  });
  it('allocates isolated valid codes and retains history while retiring only its fixtures', () => {
    const a=fixture(),b=fixture();
    expect(a.actor).not.toBe(b.actor);
    for (const code of a.codes) expect(code).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    expect(fixtureSQL(a)).toContain("'owner','SIM-NO-VALID-CREDENTIAL',true");
    const cleanup=retireSQL(a);
    expect(cleanup).not.toMatch(/\bdelete\b|\btruncate\b/i);
    expect(cleanup).toContain(`id='${a.actor}' and name='${a.tag}'`);
    for (const code of a.codes) expect(cleanup).toContain(code);
  });
  it.each(['grant','column','required','enum','capacity'])('refuses %s drift before inserts', async mode => {
    const query=vi.fn().mockResolvedValueOnce(mode==='grant'?[]:grants)
      .mockResolvedValueOnce(mode==='column'?columns.slice(1):mode==='required'?
        [...columns,{column_name:'extra',is_nullable:'NO',column_default:null}]:columns)
      .mockResolvedValueOnce(mode==='enum'?[{column_name:'role',enumlabel:'wrong'}]:[])
      .mockResolvedValueOnce([{max_slot:1023}]);
    await expect(preflight(query)).rejects.toThrow();
    expect(query.mock.calls.every(([sql]) => !String(sql).includes('insert into'))).toBe(true);
  });
  it.each([true,false])('requires observed lock blocking and checks committed allocations: blocked=%s',async blocked => {
    let time=0;
    let release: (rows: unknown[]) => void=()=>{};
    const codes:string[]=[];
    const query=vi.fn(async (sql:string):Promise<unknown[]> => {
      if (sql.includes('unnest(array[')) return grants;
      if (sql.includes('information_schema.columns')) return columns;
      if (sql.includes('join pg_enum')) return [];
      if (sql.includes('max(slot)')) return [{max_slot:2}];
      if (sql.includes('insert into public.users')) return [];
      if (sql.includes('landing_ad_code_create(')) {
        expect(sql).toContain('set local role service_role');
        expect(sql).toMatch(/commit;$/);
        codes.push(/,'([^']+)'\) as slot/.exec(sql)![1]!);
        if (sql.includes('pg_sleep(7)')) return new Promise(resolve => {release=resolve;});
        time=7000; release([]); return [{slot:4}];
      }
      if (sql.includes(' as ready')) return [{ready:true}];
      if (sql.includes('pg_blocking_pids')) { expect(sql).toContain('not l.granted'); return [{blocked}]; }
      if (sql.includes('select code,slot,active')) return codes.map((code,i)=>({code,slot:i+3,active:true}));
      if (sql.includes('update public.landing_ad_codes')) return [];
      if (sql.includes(' as retired')) return [{retired:true}];
      throw new Error('unexpected SQL');
    });
    const proof=runProof(query,vi.fn(),{now:()=>time,sleep:async(ms:number)=>{time+=ms;}});
    if (blocked) await proof; else await expect(proof).rejects.toThrow('ungranted lock');
    expect(codes).toHaveLength(2);
    expect(query.mock.calls.filter(([sql])=>sql.includes('update public.landing_ad_codes'))).toHaveLength(1);
  });
  it('logs recovery IDs before ambiguous writes and never retries fixture insertion',async () => {
    const events:string[]=[];
    const query=vi.fn(async(sql:string) => {
      events.push(sql);
      if(sql.includes('unnest(array[')) return grants;
      if(sql.includes('information_schema.columns')) return columns;
      if(sql.includes('join pg_enum')) return [];
      if(sql.includes('max(slot)')) return [{max_slot:2}];
      if(sql.includes('insert into public.users')) throw new Error('ambiguous write');
      if(sql.includes('update public.landing_ad_codes')) return [];
      if(sql.includes(' as retired')) return [{retired:true}];
      throw new Error('unexpected SQL');
    });
    await expect(runProof(query,(s:string)=>{events.push(s);})).rejects.toThrow('ambiguous write');
    expect(events.findIndex(s=>s.startsWith('FIXTURE allocated'))).toBeLessThan(events.findIndex(s=>s.includes('insert into')));
    expect(query.mock.calls.filter(([sql])=>sql.includes('insert into'))).toHaveLength(1);
  });
});
