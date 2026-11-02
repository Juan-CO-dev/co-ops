import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixture, fixtureSQL, retireSQL, pairings, corrections, calls, correctionSQL,
  refusalSQL, rollbackQuery, fixturePreflight, requiredColumns, runProof,
} from '../scripts/sim/checklist-0287-lock-check-management.mjs';
import { transactionSQL, proveRace } from '../scripts/sim/checklist-0276-lock-check-management.mjs';
import { signatures } from '../scripts/preflight-0276.mjs';
import { managementQuery, projectRef, SIM_REF, PROD_REF } from '../scripts/supabase-management-query.mjs';

const columns = Object.entries(requiredColumns).flatMap(([table_name,names]) =>
  (names as string[]).map(column_name=>({table_name,column_name})));
const grants = signatures.map((signature:string)=>({signature,present:true,executable:true}));

describe('0287 Management API proof (offline only)',()=>{
  it('covers every ordered correction pair and both orders against all three writers',()=>{
    expect(pairings).toHaveLength(27);
    expect(new Set(pairings.map((p:string[])=>p.join(':'))).size).toBe(27);
    for(const c of corrections) for(const w of ['replace','submit','confirm',...corrections]) {
      expect(pairings).toContainEqual([c,w]); expect(pairings).toContainEqual([w,c]);
    }
  });
  it('allocates isolated IDs, retains history, and scopes retirement to owned configuration',()=>{
    const a=fixture(),b=fixture();
    const ids=(f:ReturnType<typeof fixture>)=>[f.actor,f.authority,f.shop,f.template,f.item,f.quickItem,f.referenceItem,f.prepItem,
      ...f.cases.flatMap((c:Record<string,string>)=>Object.values(c))];
    expect(new Set([...ids(a),...ids(b)]).size).toBe(ids(a).length*2);
    expect(a.tag).toBe(`SIM-0287-${a.template}`);
    expect(a.cases).toHaveLength(31);
    const sql=fixtureSQL(a);
    expect(sql).toContain("date '2099-01-01'");
    expect(sql).toContain('SIM-NO-VALID-CREDENTIAL');
    expect(sql).toContain("'cash_report'"); expect(sql).toContain("'{\"phase1\":true}'");
    expect(sql).toContain("clock_timestamp()-interval '2 minutes'");
    expect(sql).not.toMatch(/\b(update|delete|truncate)\b/i);
    const retired=retireSQL(a);
    expect(retired).not.toMatch(/delete|truncate|checklist_completions|checklist_instances|checklist_submissions/i);
    expect(retired.match(/set active=false/g)).toHaveLength(5);
    for(const id of [a.actor,a.authority,a.shop,a.template,a.item,a.quickItem,a.referenceItem,a.prepItem]) expect(retired).toContain(id);
  });
  it('binds correction targets and distinct authority, with real writer signatures',()=>{
    const f=fixture(),c=f.cases[0],quick='00000000-0000-4000-8000-000000000001';
    const ops=calls(f,c,quick);
    expect(ops.revoke).toContain(`('${quick}','${f.actor}')`);
    expect(ops.reason).toContain(`('${c.old}','${f.actor}','other'`);
    expect(ops.authority).toContain(`('${c.old}','${f.authority}'`);
    expect(ops.replace).toContain(`'${f.quickItem}',3,null`);
    expect(ops.submit).toContain(`array['${c.old}']::uuid[]`);
    expect(ops.confirm).toContain(`array['${c.old}','${quick}']::uuid[]`);
  });
  it('asserts exact SQLSTATE and refusal without swallowing unexpected success/errors',()=>{
    const f=fixture();
    for(const expected of ['instance_not_open','reference_row_not_correctable','prep_data_not_correctable']) {
      const sql=refusalSQL(correctionSQL('reason',f,f.cases[0].old),expected);
      expect(sql).toContain("exception when sqlstate 'P0001'");
      expect(sql).toContain(`if sqlerrm = '${expected}' then return; end if; raise;`);
      expect(sql).toContain("raise exception 'expected refusal missing' using errcode='XX000'");
      expect(sql).toContain('perform public.checklist_revoke_with_reason(');
      expect(sql).not.toContain(' as result');
    }
    expect(()=>refusalSQL('select 1','arbitrary')).toThrow();
  });
  it('rolls back whole race requests, preserves observer reads and committed fixture calls',async()=>{
    const query=vi.fn().mockResolvedValue([]), wrapped=rollbackQuery(query);
    const tx=transactionSQL('test','select real_writer()',true);
    await wrapped(tx);
    expect(query).toHaveBeenLastCalledWith(tx.replace(/commit;$/,'rollback;'));
    expect(query.mock.calls[0]?.[0]).toContain('select pg_sleep(7);');
    await wrapped('select observer()'); expect(query).toHaveBeenLastCalledWith('select observer()');
    expect(transactionSQL('test','select fixture_writer()')).toMatch(/commit;$/);
  });
  it.each([true,false])('requires observed blocking with the rollback adapter: %s',async blocked=>{
    let time=0;
    let release: (rows:unknown[])=>void = ()=>{};
    const query=vi.fn(async(sql:string):Promise<unknown[]>=>{
      if(sql.includes('pg_sleep(7)')) { expect(sql).toMatch(/rollback;$/); return new Promise(resolve=>{release=resolve;}); }
      if(sql.startsWith('begin')) { expect(sql).toMatch(/rollback;$/); time=7000; release([]); return []; }
      if(sql.includes(' as ready')) return [{ready:true}];
      expect(sql).toContain('pg_blocking_pids'); expect(sql).toContain('not l.granted');
      return [{blocked}];
    });
    const result=proveRace(rollbackQuery(query),'select a()','select b()','SIM-0287-test',{
      now:()=>time,sleep:async(ms:number)=>{time+=ms;},
    });
    if(blocked) expect(await result).toMatchObject({ok:true});
    else await expect(result).rejects.toThrow('ungranted lock');
  });
  it.each(['missing-column','omitted-required','bad-enum','ok'])('checks catalog before fixture inserts: %s',async mode=>{
    const cols=mode==='missing-column'?columns.slice(1):mode==='omitted-required'?
      [...columns,{table_name:'users',column_name:'new_required',is_nullable:'NO',column_default:null}]:columns;
    const query=vi.fn().mockResolvedValueOnce(cols).mockResolvedValueOnce(mode==='bad-enum'?
      [{table_name:'checklist_template_items',column_name:'report_reference_type',enumlabel:'wrong'}]:
      [{table_name:'checklist_template_items',column_name:'report_reference_type',enumlabel:'cash_report'}]);
    if(mode==='ok') await fixturePreflight(query); else await expect(fixturePreflight(query)).rejects.toThrow();
    expect(query.mock.calls.every(([sql])=>!sql.includes('insert into'))).toBe(true);
  });
  it('preflight is first; a failed grant never emits fixtures',async()=>{
    const query=vi.fn().mockResolvedValue([]);
    await expect(runProof(query,vi.fn())).rejects.toThrow('missing');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/^begin read only;/);
  });
  it('does not retry an ambiguous fixture creation; logs IDs before emission and retires once',async()=>{
    const events:string[]=[],log=vi.fn((s:string)=>{events.push(s);});
    const query=vi.fn(async(sql:string)=>{
      events.push(sql);
      if(sql.includes('unnest(array[')) return grants;
      if(sql.includes('information_schema.columns')) return columns;
      if(sql.includes('join pg_enum')) return [];
      if(sql.includes('insert into public.locations')) throw new Error('ambiguous network failure');
      if(sql.includes('update public.checklist_template_items')) return [];
      if(sql.includes(' as retired')) return [{retired:true}];
      throw new Error('unexpected query');
    });
    await expect(runProof(query,log)).rejects.toThrow('ambiguous network failure');
    expect(query.mock.calls.filter(([sql])=>sql.includes('insert into public.locations'))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql])=>sql.includes('update public.checklist_template_items'))).toHaveLength(1);
    expect(events.findIndex(s=>s.startsWith('FIXTURE allocated'))).toBeLessThan(events.findIndex(s=>s.includes('insert into public.locations')));
    expect(log).toHaveBeenCalledWith('FAIL fixture creation');
    expect(log).toHaveBeenCalledWith('PASS own fixture configuration retired; append-only evidence retained');
  });
  it('entry point guards the exact sim before constructing transport and never loads dotenv',()=>{
    const source=readFileSync('scripts/sim/checklist-0287-lock-check-management.mjs','utf8');
    expect(source).toContain('projectRef(process.argv.slice(2),true)');
    expect(source).not.toMatch(/import.*dotenv|process\.env\.SIM_DATABASE_URL/);
    expect(projectRef([`--ref=${SIM_REF}`],true)).toBe(SIM_REF);
    for(const ref of [PROD_REF,'aaaaaaaaaaaaaaaaaaaa']) expect(()=>projectRef([`--ref=${ref}`],true)).toThrow();
  });
  it('transport does not retry ambiguous failures or expose response text',async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error('private sentinel'));
    await expect(managementQuery(SIM_REF,'test-token',fetcher)('select 1')).rejects.toThrow('Management query failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
