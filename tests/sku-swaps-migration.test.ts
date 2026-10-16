import { describe,expect,it } from 'vitest';
import {readFileSync} from 'node:fs';
import {SWAP_ERROR_CODES, SWAP_RPC_STATUS, swapErrorFromRpc} from '../lib/catalog/swap-shared';
const sql=readFileSync('supabase/migrations/0265_sku_swaps.sql','utf8');
describe('0265 contract',()=>{
 it('pins the authored gate while allowing dated SIM and PROD stamps',()=>{
  const valid=(source:string)=>{const lines=source.replace(/\r\n/g,'\n').split('\n');return lines[0]==='-- 0265_sku_swaps.sql'
   && lines[1]==='-- AUTHORED 2026-10-16; FILE ONLY. Apply only after CC/Juan review.'
   && lines.filter(line=>line.startsWith('-- APPLIED ')).every(line=>/^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}(?: \(.*\))?$/.test(line));};
  expect(valid(sql)).toBe(true);const [head,gate,...rest]=sql.replace(/\r\n/g,'\n').split('\n');
  for(const target of ['SIM','PROD'])expect(valid([head,gate,`-- APPLIED TO ${target} 2026-10-17`,...rest].join('\n'))).toBe(true);
  expect(valid(sql.replace('FILE ONLY','READY'))).toBe(false);
  expect(valid([head,...rest].join('\n'))).toBe(false);
  expect(valid([head,gate,'-- APPLIED TO SIM yesterday',...rest].join('\n'))).toBe(false);
 });
 it('maps every literal refusal to the closed application list',()=>{for(const match of sql.matchAll(/swap:([a-z_]+)/g)){
  const code = match[1] as keyof typeof SWAP_RPC_STATUS;
  expect(SWAP_ERROR_CODES).toContain(code);
  expect(() => swapErrorFromRpc(`swap:${code}`)).toThrow(expect.objectContaining({code,status:SWAP_RPC_STATUS[code]}));
 }});
 it('keeps file-only gate and required product snapshot',()=>{expect(sql).toContain('-- AUTHORED 2026-10-16; FILE ONLY.');expect(sql).toContain('p_actor uuid,p_product_snapshot jsonb,');expect(sql).toContain("raise exception 'swap:product_changed' using errcode='P0001'");});
 it('advances revision on every update without timestamp comparison',()=>{expect(sql).toContain('new.revision := old.revision + 1');expect(sql).toContain('before update on public.product_primaries');expect(sql).toContain("v_p->>'revision'=s.primary_after->>'revision'");});
 it('journals before resolved content and after concurrency identity',()=>{for(const field of ['product_snapshot_before','product_snapshot_after','primary_before','primary_after','after_version_id','own_version_id'])expect(sql).toContain(field);expect(sql).toContain('create table public.sku_swap_ends');expect(sql).not.toMatch(/update public\.sku_swaps/i);});
});
