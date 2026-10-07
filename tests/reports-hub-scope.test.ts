import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listReportsPage, loadReportDetail, listReportSkeleton } from "@/lib/reports-hub";
import { buildSearchCorpus } from "@/lib/reports-search";
import { compareReportTuples } from "@/lib/report-pagination";

type Row = Record<string, unknown>;
function fake(tables: Record<string, Row[]>, failTable?: string) {
  const reads: Array<{table:string; columns:string; rows:Row[]}> = [];
  const client = { from(table:string) {
    let rows = [...(tables[table] ?? [])]; let columns = ""; let start = 0; let end = Infinity;
    const q = {
      select(c:string) { columns=c; return q; },
      eq(k:string,v:unknown) { rows=rows.filter(r=>r[k]===v); return q; },
      match(m:Row) { for(const [k,v] of Object.entries(m)) q.eq(k,v); return q; },
      in(k:string,v:unknown[]) { if (k === "id" && table === "checklist_instances") expect(v.some(id=>String(id).startsWith("maintenance-"))).toBe(false); rows=rows.filter(r=>v.includes(r[k]));return q; },
      is(k:string,v:unknown) { rows=rows.filter(r=>(r[k]??null)===v);return q; },
      gte(k:string,v:string) {rows=rows.filter(r=>String(r[k])>=v);return q;},
      lte(k:string,v:string) {rows=rows.filter(r=>String(r[k])<=v);return q;},
      lt(k:string,v:string) {rows=rows.filter(r=>String(r[k])<v);return q;},
      or() {return q;}, order() {return q;}, returns() {return q;},
      range(a:number,b:number) {start=a;end=b;return q;},
      maybeSingle() {return Promise.resolve({data:rows[0]??null,error:null});},
      then(resolve:(v:unknown)=>unknown) { const data=rows.slice(start,end===Infinity?undefined:end+1); reads.push({table,columns,rows:data}); return Promise.resolve(resolve({data,error:table===failTable?{message:"read failed"}:null})); },
    }; return q;
  }} as unknown as SupabaseClient;
  return { client, reads };
}
const viewer={userId:"me",level:3,locations:["shop"]};
const instance={id:"shared",location_id:"shop",date:"2026-10-06",template_id:"t",status:"open",confirmed_by:"colleague",confirmed_at:null};
const tables = () => ({
  checklist_instances:[instance], checklist_templates:[{id:"t",type:"opening",prep_subtype:null}],
  checklist_template_items:[{id:"own",template_id:"t",label:"Own item",station:"Kitchen",required:true,active:true}, {id:"other",template_id:"t",label:"Private colleague item",station:"Kitchen",required:true,active:true}],
  checklist_completions:[{id:"c1",instance_id:"shared",template_item_id:"own",completed_by:"me",count_value:2,notes:"own note",prep_data:{phase1:{opener_recount:2}}}, {id:"c2",instance_id:"shared",template_item_id:"other",completed_by:"colleague",count_value:99,notes:"private note",prep_data:{phase2:{opener_prepped:99}}}],
  users:[{id:"me",name:"Me"},{id:"colleague",name:"Private colleague"}], maintenance_equipment:[],
});
afterEach(()=>vi.useRealTimers());
describe("operations loader data boundaries",()=>{
  it("throws failed skeleton reads instead of reporting missing activity",async()=>{
    const {client}=fake(tables(),"checklist_instances");
    await expect(listReportSkeleton(client,{viewer,locationId:"shop",dateFrom:instance.date,dateTo:instance.date})).rejects.toThrow("read failed");
  });
  it("own rows only in shared opening details, signals and search",async()=>{
    const {client}=fake(tables());
    const detail=await loadReportDetail(client,{viewer,type:"opening",id:"shared",locationId:"shop"});
    expect(detail?.kind).toBe("opening");
    if(detail?.kind!=="opening") throw new Error("wrong detail");
    expect(detail.items).toHaveLength(1); expect(detail.items[0]?.phase2).toBeNull(); expect(detail.signals.total).toBe(1);expect(detail.signals.skipped).toBe(0);
    expect(JSON.stringify(detail)).not.toContain("Private"); expect(JSON.stringify(detail)).not.toContain("99");
    const corpus=await buildSearchCorpus(client,{viewer,locationId:"shop",items:[{id:"shared",type:"opening",date:instance.date,locationId:"shop",status:"open",submitterName:null},{id:"maintenance-2026-10-06",type:"maintenance",date:instance.date,locationId:"shop",status:"ok",submitterName:null}]});
    expect(JSON.stringify([...corpus])).not.toContain("Private"); expect(JSON.stringify([...corpus])).not.toContain("private note");
  });
  it("refuses cross-shop scope before any data query",async()=>{
    const {client,reads}=fake(tables());
    await expect(loadReportDetail(client,{viewer,type:"opening",id:"shared",locationId:"other"})).rejects.toThrow("report_scope_forbidden");expect(reads).toEqual([]);
  });
  it("maintenance contains only the employee's readings and notes, with notes redacted below 5",async()=>{
    const data:Record<string,Row[]> = tables();
    data.maintenance_equipment=[{id:"fridge",name:"Fridge",kind:"fridge",active:true,location_id:"shop",opening_temp_item_id:"own",closing_temp_item_id:"other",safe_max_f:41}];
    data.maintenance_notes=[{id:"n1",created_by:"me",location_id:"shop",created_at:"2026-10-06T14:00:00Z",equipment_id:"fridge",note:"own note"},{id:"n2",created_by:"colleague",location_id:"shop",created_at:"2026-10-06T14:01:00Z",equipment_id:"fridge",note:"private colleague note"}];
    const {client}=fake(data);
    const result=await loadReportDetail(client,{viewer,type:"maintenance",id:"maintenance-2026-10-06",locationId:"shop"});
    if(result?.kind!=="maintenance") throw new Error("wrong detail");
    expect(result.equipment[0]?.readings.map(r=>r.valueF)).toEqual([2]);
    expect(result.equipment[0]?.notes.map(r=>r.id)).toEqual(["n1"]);
    expect(result.flagCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private colleague");
    expect(JSON.stringify(result)).not.toContain("own note");
  });
  it("retains unfinished past days, hides unfinished today and employee cash",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const data=tables();data.checklist_instances.push({...instance,id:"today",date:"2026-10-07"});
    const {client}=fake(data);
    const list=await listReportSkeleton(client,{viewer,locationId:"shop",dateFrom:"2026-10-01",dateTo:"2026-10-07"});
    expect(list.map(r=>r.id)).toEqual(["shared"]);expect(list.some(r=>r.type==="cash")).toBe(false);
  });
  it("pages over 100 mixed rows without gaps; enrichment is bounded to candidates",async()=>{
    const data=tables();data.checklist_instances=Array.from({length:120},(_,n)=>({...instance,id:String(n).padStart(3,"0"),template_id:n%2?"t":"t2"}));
    data.checklist_templates.push({id:"t2",type:"closing",prep_subtype:null});
    const {client,reads}=fake(data); const args={viewer:{...viewer,level:4},locationId:"shop",dateFrom:instance.date,dateTo:instance.date};
    const first=await listReportsPage(client,args);
    expect(first.items).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const enriched=reads.filter(r=>r.table==="checklist_instances"&&r.columns==="id, template_id");
    expect(enriched.flatMap(r=>r.rows)).toHaveLength(51); // page plus one existence probe
    expect(enriched.every(r=>r.rows.length<=50)).toBe(true);
    const second=await listReportsPage(client,{...args,cursor:first.nextCursor!});
    const third=await listReportsPage(client,{...args,cursor:second.nextCursor!});
    const all=[...first.items,...second.items,...third.items];expect(all).toHaveLength(120);expect(new Set(all.map(r=>r.id)).size).toBe(120);expect([...all].sort(compareReportTuples)).toEqual(all);expect(third.nextCursor).toBeNull();
    const sparse=await listReportsPage(client,{...args,query:"sparse",match:async rows=>rows.filter(r=>Number(r.id)%30===0)});
    expect(sparse.items).toHaveLength(4);expect(sparse.nextCursor).toBeNull();
  });
});
