import { describe, expect, it, vi } from 'vitest';
import { managementQuery, projectRef, SIM_REF, PROD_REF } from '../scripts/supabase-management-query.mjs';
import { preflightManagement } from '../scripts/preflight-0276-management.mjs';
import { signatures } from '../scripts/preflight-0276.mjs';
import { fixture, fixtureSQL, retireSQL, proveRace, runProof } from '../scripts/sim/checklist-0276-lock-check-management.mjs';

describe('Management API operator tools (offline)', () => {
  it.each(['success','broken-counter','bad-enum','missing-required-column'])('runs all four scenarios and retires only own configuration: %s', async mode => {
    let time=0, actor='', retired=false, fixtureCreated=false, edits=0, body='';
    let finishHolder: (value: unknown[]) => void = () => {};
    let holderActive=false, races=0;
    const instances = new Map<string,{head:string,confirmed:boolean}>();
    const log=vi.fn();
    const query=vi.fn(async (sql:string):Promise<unknown[]> => {
      if(sql.includes('unnest(array[')) return signatures.map((signature:string)=>({signature,present:true,executable:true}));
      if(sql.includes('information_schema.columns')) {
        const cols:Record<string,string>= {
          locations:'id name code type active',users:'id name role pin_hash active',user_locations:'user_id location_id active',
          checklist_templates:'id location_id type name active',checklist_template_items:'id template_id label min_role_level active',
          checklist_instances:'id template_id location_id date status',
          written_reports:'id location_id submitted_by submitted_by_role title body category visibility_min_level edit_count',
        };
        const rows = Object.entries(cols).flatMap(([table_name,names])=>names.split(' ').map(column_name=>({table_name,column_name})));
        if(mode==='missing-required-column') return [...rows,{table_name:'users',column_name:'new_required',is_nullable:'NO',column_default:null,is_identity:'NO',is_generated:'NEVER'}];
        return rows;
      }
      if(sql.includes('join pg_enum')) return mode==='bad-enum' ? [{table_name:'users',column_name:'role',enumlabel:'employee'}] : [];
      if(sql.includes('insert into public.locations')) {
        fixtureCreated=true;
        actor=/insert into public.users[^;]*values\('([^']+)'/.exec(sql)![1]!;
        const rows=sql.split('insert into public.checklist_instances')[1]!.split(';')[0]!;
        for(const match of rows.matchAll(/\('([^']+)'/g)) instances.set(match[1]!,{head:`head-${match[1]}`,confirmed:false});
        return [];
      }
      if(sql.includes('update public.checklist_template_items')) { retired=true; return []; }
      if(sql.includes(' as retired')) return [{retired}];
      if(sql.includes(' as ready')) return [{ready:holderActive}];
      if(sql.includes(' as blocked')) return [{blocked:true}];
      if(sql.includes('select to_jsonb(c)')) {
        const id=/instance_id='([^']+)'/.exec(sql)![1]!;
        return [{row:{id:instances.get(id)!.head}}];
      }
      if(sql.includes('select status,confirmed_by')) {
        const id=/where id='([^']+)'/.exec(sql)![1]!;
        return [{status:instances.get(id)!.confirmed ? 'confirmed':'open',confirmed_by:actor,finals:1}];
      }
      if(sql.includes('select edit_count,body')) return [{edit_count:mode==='broken-counter'?1:edits,body}];
      if(sql.startsWith('begin isolation')) {
        const hold=sql.includes('pg_sleep(7)');
        if(!hold && holderActive) {time+=5000;holderActive=false;finishHolder([]);}
        const call=/select public\.(\w+)\('([^']+)','([^']+)'/.exec(sql)!;
        const kind=call[1],id=call[3]!;
        if(kind==='written_report_update_self') {edits++;body=sql.includes('SIM second queued edit')?'SIM second queued edit':'SIM first queued edit';}
        else {
          const instance=instances.get(id)!;
          if(instance.confirmed) throw Object.assign(new Error('instance_not_open'),{refusal:'instance_not_open'});
          if(kind==='checklist_write_completion') instance.head=`replacement-${id}`;
          else {
            if(!sql.includes(`'${instance.head}'`)) throw Object.assign(new Error('completion_set_changed'),{refusal:'completion_set_changed'});
            instance.confirmed=true;
          }
        }
        if(hold) {holderActive=true;races++;return new Promise(resolve=>{finishHolder=resolve;});}
        return [{result:1}];
      }
      throw new Error('Unexpected mock query');
    });
    const result=runProof(query,log,{now:()=>time,sleep:async(ms:number)=>{time+=ms;}});
    if(mode==='success') await result;
    else await expect(result).rejects.toThrow(mode==='broken-counter'?'both queued increments':mode==='bad-enum'?'enum labels':'omitted column');
    if(mode==='bad-enum'||mode==='missing-required-column') {expect(fixtureCreated).toBe(false);expect(races).toBe(0);}
    else {expect(races).toBe(4);expect(edits).toBe(2);expect(retired).toBe(true);expect(instances.size).toBe(3);}
    if(mode==='success') expect(log).toHaveBeenCalledTimes(5);
  });
  it('hard-refuses production and any non-sim target for lock proof; permits prod read preflight', () => {
    expect(projectRef([`--ref=${SIM_REF}`],true)).toBe(SIM_REF);
    expect(() => projectRef([`--ref=${PROD_REF}`],true)).toThrow();
    expect(() => projectRef(['--ref=aaaaaaaaaaaaaaaaaaaa'],true)).toThrow();
    expect(projectRef([`--ref=${PROD_REF}`])).toBe(PROD_REF);
    expect(() => projectRef([`--ref=${SIM_REF}`, '--extra'])).toThrow();
  });
  it('sends fixed endpoint, bearer header and only query JSON; redacts failures', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok:true, json:async () => [{ok:true}] });
    const query = managementQuery(SIM_REF,'secret-sentinel',fetcher);
    expect(await query('select 1')).toEqual([{ok:true}]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://api.supabase.com/v1/projects/${SIM_REF}/database/query`);
    expect(fetcher.mock.calls[0]?.[1].body).toBe('{"query":"select 1"}');
    fetcher.mockRejectedValue(new Error('secret-sentinel'));
    await expect(query('select 1')).rejects.toThrow('Management query failed');
    fetcher.mockResolvedValue({ok:false,text:async () => 'secret-sentinel P0001: instance_not_open'});
    await expect(query('select 1')).rejects.toMatchObject({message:'instance_not_open',refusal:'instance_not_open'});
  });
  it('preflight is one read-only request and fails on missing or false EXECUTE', async () => {
    const rows = signatures.map((signature: string) => ({signature,present:true,executable:true}));
    const query = vi.fn().mockResolvedValue(rows);
    await preflightManagement(query);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/^begin read only;/);
    query.mockResolvedValue(rows.slice(1));
    await expect(preflightManagement(query)).rejects.toThrow('missing');
    query.mockResolvedValue(rows.map((row: object) => ({...row,executable:false})));
    await expect(preflightManagement(query)).rejects.toThrow('missing');
  });
  it('allocates fresh fixture IDs and retirement never deletes or edits existing history', () => {
    const f = fixture(), second = fixture();
    expect(f.actor).not.toBe(second.actor);
    expect(fixtureSQL(f)).toContain('2099-01-01');
    expect(fixtureSQL(f)).toContain('SIM-NO-VALID-CREDENTIAL');
    const sql = retireSQL(f);
    expect(sql).not.toMatch(/delete|written_reports|checklist_instances|checklist_completions|checklist_submissions/i);
    expect(sql.match(/set active=false/g)).toHaveLength(5);
  });
  it.each([true,false])('requires actual ungranted-lock proof even after elapsed waiting: %s', async blocked => {
    let time=0;
    let finishHolder: (value: unknown[]) => void = () => {};
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_sleep(7)')) return new Promise<unknown[]>(resolve => {finishHolder=resolve;});
      if (sql.startsWith('begin')) { time=7000; finishHolder([]); return [{result:1}]; }
      if (sql.includes(' as ready')) return [{ready:true}];
      expect(sql).toContain('not l.granted');
      expect(sql).toContain('pg_blocking_pids');
      return [{blocked}];
    });
    const promise = proveRace(query,'select holder()','select racer()','SIM-test',{
      now:()=>time,sleep:async(ms:number)=>{time+=ms;},
    });
    if(blocked) expect(await promise).toMatchObject({ok:true});
    else await expect(promise).rejects.toThrow('ungranted lock');
  });
  it('rejects a racer finishing early even when an observer claims blocking', async () => {
    let time=0;
    let finishHolder: (value: unknown[]) => void = () => {};
    const query = async (sql:string):Promise<unknown[]> => {
      if(sql.includes('pg_sleep(7)')) return new Promise(resolve=>{finishHolder=resolve;});
      if(sql.startsWith('begin')) {finishHolder([]);return [];}
      return sql.includes(' as ready') ? [{ready:true}] : [{blocked:true}];
    };
    await expect(proveRace(query,'select holder()','select racer()','SIM-test',{
      now:()=>time,sleep:async(ms:number)=>{time+=ms;},
    })).rejects.toThrow('elapsed time');
  });
});
