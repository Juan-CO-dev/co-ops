import { describe,expect,it } from 'vitest';
import {readFileSync} from 'node:fs';
import {SWAP_ERROR_CODES} from '../lib/catalog/swap-shared';
const sql=readFileSync('supabase/migrations/0265_sku_swaps.sql','utf8');
describe('0265 contract',()=>{
 it('maps every literal refusal to the closed application list',()=>{for(const match of sql.matchAll(/swap:([a-z_]+)/g))expect(SWAP_ERROR_CODES).toContain(match[1]);});
 it('keeps file-only gate and required product snapshot',()=>{expect(sql).toContain('-- AUTHORED 2026-10-16; FILE ONLY.');expect(sql).toContain('p_actor uuid,p_product_snapshot jsonb,');expect(sql).toContain("raise exception 'swap:product_changed' using errcode='P0001'");});
 it('advances revision on every update without timestamp comparison',()=>{expect(sql).toContain('new.revision := old.revision + 1');expect(sql).toContain('before update on public.product_primaries');expect(sql).toContain("v_p->>'revision'=s.primary_after->>'revision'");});
 it('journals before resolved content and after concurrency identity',()=>{for(const field of ['product_snapshot_before','product_snapshot_after','primary_before','primary_after','after_version_id','own_version_id'])expect(sql).toContain(field);expect(sql).toContain('create table public.sku_swap_ends');expect(sql).not.toMatch(/update public\.sku_swaps/i);});
});
