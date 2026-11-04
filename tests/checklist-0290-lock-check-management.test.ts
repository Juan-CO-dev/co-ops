import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { pairings, main, fixture, calls, fixtureSQL, retireSQL, functionalProbes, runProof,
} from '../scripts/sim/checklist-0290-lock-check-management.mjs';
import { SIM_REF, PROD_REF, projectRef } from '../scripts/supabase-management-query.mjs';

type Case = Record<'closing'|'am'|'old'|'generic'|'extra'|'stale', string>;
type Fixture = { cases: Case[]; tag: string; actor: string; referenceItem: string; amTemplate: string };

describe('0290 Management API proof (offline only)',()=>{
  it('pins all eight ordered pairs, including AM submit against closing confirm',()=>{
    expect(pairings).toEqual([
      ['replace','confirm'],['confirm','replace'],
      ['replace','revoke'],['revoke','replace'],
      ['replace','am'],['am','replace'],
      ['am','confirm'],['confirm','am'],
    ]);
  });
  it('refuses every non-SIM target before transport or token access',()=>{
    const fetcher=vi.fn(()=>{throw new Error('network forbidden');});
    vi.stubGlobal('fetch',fetcher);
    try {
      expect(projectRef([`--ref=${SIM_REF}`],true)).toBe(SIM_REF);
      for(const args of [[`--ref=${PROD_REF}`],['--ref=aaaaaaaaaaaaaaaaaaaa'],[],
        [`--ref=${SIM_REF}`,`--ref=${PROD_REF}`]]) expect(()=>main(args)).toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('allocates isolated fixture cases and scopes retirement to owned configuration',()=>{
    const f=fixture() as unknown as Fixture;
    expect(f.cases).toHaveLength(13);
    expect(f.tag).toMatch(/^SIM-0290-/);
    const sql=fixtureSQL(f),retired=retireSQL(f);
    expect(sql).toContain("date '2099-01-01'");
    expect(sql).toContain("'am_prep'");
    expect(sql).toContain('SIM-NO-VALID-CREDENTIAL');
    expect(sql).not.toMatch(/\b(update|delete|truncate)\b/i);
    expect(retired.match(/set active=false/g)).toHaveLength(5);
    expect(retired).toContain(f.amTemplate);
    expect(retired).not.toMatch(/delete|truncate|checklist_completions|checklist_instances|checklist_submissions/i);
    const c=f.cases[0]!;
    const ops=calls(f,c);
    expect(ops.revoke).toContain(`('${c.generic}','${f.actor}','other'`);
    expect(ops.confirm).toContain(`'${c.closing}'`);
    expect(ops.am).toContain(`'${c.am}','${f.actor}','[]'::jsonb,'${f.referenceItem}',false`);
  });
  it('pins five committed probe groups and exact failure/success contracts',()=>{
    const probes=functionalProbes(fixture());
    expect(probes.map((p:{name:string})=>p.name)).toEqual(['revoked','multiple','stale','correct','correction']);
    expect(probes[0]!.sql).toContain('closing_ref_revoked');
    expect(probes[1]!.sql).toContain('closing_ref_multiple_heads');
    expect(probes[1]!.sql).toContain("exception when sqlstate 'P0001'");
    expect(probes[1]!.sql).toContain('expected refusal missing');
    expect(probes[2]!.sql).toContain("r->>'result' = 'lost'");
    expect(probes[3]!.sql).toContain('fresh.id=old.superseded_by');
    expect(probes[3]!.sql).toContain('fresh.auto_complete_meta=');
    expect(probes[4]!.sql).toContain('reference_row_not_correctable');
    for(const i of [0,1,2,4]) expect(probes[i]!.sql).toContain('= before_rows');
  });
  it('fails before allocating fixtures if initial preflight fails',async()=>{
    const query=vi.fn().mockResolvedValue([]);
    await expect(runProof(query,vi.fn())).rejects.toThrow('missing');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/^begin read only;/);
  });
  it('uses shared rollback races and separate committed probes without direct DB dependencies',()=>{
    const source=readFileSync('scripts/sim/checklist-0290-lock-check-management.mjs','utf8');
    expect(source).toContain('proveRace(rollbackQuery(query),ops[a],ops[b]');
    expect(source).toContain('query(transactionSQL(`${f.tag}-${probe.name}`,probe.sql))');
    expect(source).toContain('projectRef(args,true)');
    expect(source).not.toMatch(/import.*dotenv|process\.env\.SIM_DATABASE_URL|import\(['"]pg['"]\)/);
  });
});
